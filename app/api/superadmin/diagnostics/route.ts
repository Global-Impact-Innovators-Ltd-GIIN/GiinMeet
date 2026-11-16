import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireSuperadmin } from '../lib';

// POST /api/superadmin/diagnostics
//   { accessToken }                      -> migration status for every repo SQL file (probed, never guessed)
//   { accessToken, action: 'lookup', email } -> one user's auth + profile + meetings status at a glance
//
// Probes are real reads: a column/table probe selects that column
// with limit 1 — an error means "not applied". Files whose effect is
// only a CHECK constraint, an RLS policy, or an extension cannot be
// detected by a read, so they report 'manual' with what to check in
// the SQL Editor history instead of a guessed answer.
interface SqlCheck {
  file: string;
  what: string;
  status: 'applied' | 'not-applied' | 'manual';
  detail: string;
}

async function probe(admin: any, table: string, column: string): Promise<boolean> {
  try {
    const { error } = await admin.from(table).select(column).limit(1);
    return !error;
  } catch (e) {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin } = checked.caller;

    // ---- User lookup -------------------------------------------------
    if (body?.action === 'lookup') {
      const email = String(body?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'A valid email address is required.' }, { status: 400 });
      }
      let authUser: any = null;
      try {
        let page = 1;
        for (; page <= 3 && !authUser; page++) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (error || !data?.users) break;
          authUser = data.users.find((u: any) => (u.email || '').toLowerCase() === email) || null;
          if (data.users.length < 1000) break;
        }
      } catch (e) {
        console.error('[Superadmin Diagnostics] auth lookup failed:', (e as any)?.message);
      }
      if (!authUser) {
        return NextResponse.json({ ok: true, found: false, message: `No GiinMeet auth account uses ${email}.` });
      }
      const { data: profile } = await admin
        .from('profiles')
        .select('id,name,email,workspace_name,domain,phone,is_premium,plan_tier,is_superadmin,is_suspended,suspended_at,suspended_reason,updated_at')
        .eq('id', authUser.id)
        .maybeSingle();
      let meetingsCount = 0;
      let liveMeetings = 0;
      try {
        const { data: meets } = await admin
          .from('meetings')
          .select('status')
          .eq('user_id', authUser.id);
        meetingsCount = (meets || []).length;
        liveMeetings = (meets || []).filter((m: any) => m.status === 'In Progress').length;
      } catch (e) {
        meetingsCount = 0;
      }
      return NextResponse.json({
        ok: true,
        found: true,
        user: {
          id: authUser.id,
          email: authUser.email,
          created_at: authUser.created_at,
          last_sign_in_at: (authUser as any).last_sign_in_at || null,
          email_confirmed_at: (authUser as any).email_confirmed_at || null,
          banned_until: (authUser as any).banned_until || null,
          profile: profile || null,
          meetings_count: meetingsCount,
          live_meetings: liveMeetings,
        },
      });
    }

    // ---- Migration status --------------------------------------------
    const checks: SqlCheck[] = [];
    const add = async (
      file: string,
      what: string,
      run: () => Promise<'applied' | 'not-applied' | 'manual'>,
      manualDetail?: string
    ) => {
      try {
        const status = await run();
        checks.push({
          file,
          what,
          status,
          detail:
            status === 'applied'
              ? 'Verified live: the table/column exists.'
              : status === 'not-applied'
                ? 'Not applied yet — run the file in the Supabase SQL Editor.'
                : manualDetail || 'Cannot be verified by a read — check the SQL Editor history.',
        });
      } catch (e) {
        checks.push({ file, what, status: 'manual', detail: `Probe failed: ${String((e as any)?.message || e)}` });
      }
    };

    await add('schema.sql', 'Core tables: profiles, meetings, messages, meeting_participants', async () =>
      (await probe(admin as any, 'profiles', 'id')) ? 'applied' : 'not-applied'
    );
    await add('schema_phase1.sql', 'rooms + participants tables (LiveKit capacity)', async () =>
      (await probe(admin as any, 'rooms', 'id')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_plan_tier.sql', 'profiles.plan_tier (Free / Pro / Enterprise)', async () =>
      (await probe(admin as any, 'profiles', 'plan_tier')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_tier_limits.sql', 'rooms.max_capacity default 50', async () => 'manual',
      'Only changes a column default — verify in the SQL Editor history or check rooms.max_capacity in the Table Editor.'
    );
    await add('giinmeet_round9_statuses.sql', 'Meeting + participant status values (Left / Removed / CoHost)', async () => 'manual',
      'Only widens CHECK constraints — verify in the SQL Editor history.'
    );
    await add('giinmeet_link_expiry.sql', 'meetings.link_expires_at / link_expiry_mode', async () =>
      (await probe(admin as any, 'meetings', 'link_expires_at')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_delete_history.sql', 'meetings.deleted_at / deleted_by + meeting_deletions audit', async () =>
      (await probe(admin as any, 'meetings', 'deleted_at')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_meeting_lock.sql', 'meetings.is_locked (persisted meeting lock)', async () =>
      (await probe(admin as any, 'meetings', 'is_locked')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_phase1.sql', 'personal_rooms, reminders, recurring series', async () =>
      (await probe(admin as any, 'personal_rooms', 'id')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_phase2_chat_files_bucket.sql', "chat-files storage bucket", async () => {
      try {
        const { data } = await admin.storage.listBuckets();
        return (data || []).some((b: any) => b.name === 'chat-files') ? 'applied' : 'not-applied';
      } catch (e) {
        return 'manual';
      }
    });
    await add('giinmeet_phase3_teams.sql', 'teams, team_members, team_settings', async () =>
      (await probe(admin as any, 'teams', 'id')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_phase3_brand.sql', 'workspace_brand (shared workspace brand)', async () =>
      (await probe(admin as any, 'workspace_brand', 'id')) ? 'applied' : 'not-applied'
    );
    await add('giinmeet_admission_lockdown.sql', 'Admission lockdown (waiting-room status writes server-only)', async () => 'manual',
      'Only changes RLS policies — verify in the SQL Editor history.'
    );
    await add('giinmeet_passcode_lockdown.sql', 'Passcode hidden from anonymous reads', async () => {
      // Probe with the ANON key: if the column is revoked, the select
      // errors; if it is still readable, the passcode field comes back.
      // Passcode values are never returned — only whether the field exists.
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
        if (!url || !anonKey) return 'manual';
        const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
        const { data, error } = await anon.from('meetings').select('passcode').limit(1);
        if (error) return 'applied';
        if (data && data.length > 0 && Object.prototype.hasOwnProperty.call(data[0], 'passcode')) return 'not-applied';
        return 'manual';
      } catch (e) {
        return 'manual';
      }
    });
    await add('giinmeet_cohost_moderator_roles.sql', 'Moderator role on meeting_participants', async () => 'manual',
      'Only widens the role CHECK constraint — verify in the SQL Editor history.'
    );
    await add('giinmeet_pg_cron_reminders.sql', 'pg_cron + pg_net for meeting reminders', async () => 'manual',
      'Creates extensions and a cron job — verify in the SQL Editor history and Database > Extensions.'
    );
    await add('giinmeet_reconcile_stale_meetings.sql', 'Stale-meeting reconciliation', async () => 'manual',
      'One-off reconciliation SQL — verify in the SQL Editor history.'
    );
    await add('giinmeet_stale_rows_cleanup.sql', 'Stale-rows cleanup', async () => 'manual',
      'One-off cleanup SQL — verify in the SQL Editor history.'
    );
    await add('giinmeet_superadmin.sql', 'Superadmin portal: system_settings, audit log, suspension', async () => {
      const settings = await probe(admin as any, 'system_settings', 'key');
      const audit = await probe(admin as any, 'superadmin_audit_log', 'id');
      const suspended = await probe(admin as any, 'profiles', 'is_suspended');
      return settings && audit && suspended ? 'applied' : 'not-applied';
    });

    return NextResponse.json({ ok: true, checks });
  } catch (err: any) {
    console.error('[Superadmin Diagnostics] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
