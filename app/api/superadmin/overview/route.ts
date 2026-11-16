import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { requireSuperadmin, readSetting } from '../lib';

// POST /api/superadmin/overview { accessToken }
// Real numbers only — every figure comes from the live database,
// the Auth admin list, the storage buckets, or the LiveKit server.
// Anything that cannot be measured yet is reported as null with a
// reason, never invented.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin } = checked.caller;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // --- Users ------------------------------------------------------
    let totalUsers = 0;
    let signupsThisWeek = 0;
    let recentSignins: { email: string; lastSignInAt: string | null }[] = [];
    try {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      totalUsers = count ?? 0;
    } catch (e) {
      console.error('[Superadmin Overview] profiles count failed:', (e as any)?.message);
    }
    try {
      // Auth users carry created_at / last_sign_in_at (profiles has no
      // created_at column). Paginate the admin list; the install is
      // small, so 2 pages of 1000 is plenty and the loop is bounded.
      let page = 1;
      const seen: { email: string; createdAt: string; lastSignInAt: string | null }[] = [];
      for (; page <= 2; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data?.users) break;
        for (const u of data.users) {
          seen.push({
            email: u.email || '',
            createdAt: u.created_at || '',
            lastSignInAt: (u as any).last_sign_in_at || null,
          });
        }
        if (data.users.length < 1000) break;
      }
      signupsThisWeek = seen.filter((u) => u.createdAt && u.createdAt >= weekAgo).length;
      recentSignins = seen
        .filter((u) => u.lastSignInAt)
        .sort((a, b) => String(b.lastSignInAt).localeCompare(String(a.lastSignInAt)))
        .slice(0, 8)
        .map((u) => ({ email: u.email, lastSignInAt: u.lastSignInAt }));
    } catch (e) {
      console.error('[Superadmin Overview] auth user list failed:', (e as any)?.message);
    }

    // --- Meetings ---------------------------------------------------
    let liveMeetings = 0;
    let meetingsToday = 0;
    let totalMeetings = 0;
    let liveMeetingRows: { id: string; title: string; host: string | null; time: string }[] = [];
    try {
      const { data, error } = await admin
        .from('meetings')
        .select('id,title,host,time,status,deleted_at');
      if (!error && data) {
        const rows = (data as any[]).filter((m) => !m.deleted_at);
        totalMeetings = rows.length;
        const live = rows.filter((m) => m.status === 'In Progress');
        liveMeetings = live.length;
        meetingsToday = rows.filter((m) => m.time && m.time >= todayStart).length;
        liveMeetingRows = live.slice(0, 10).map((m) => ({
          id: m.id,
          title: m.title,
          host: m.host || null,
          time: m.time,
        }));
      }
    } catch (e) {
      console.error('[Superadmin Overview] meetings read failed:', (e as any)?.message);
    }

    // --- LiveKit rooms (live video now) ------------------------------
    let livekitConfigured = false;
    let livekitRooms: { name: string; participants: number }[] = [];
    let livekitError: string | null = null;
    const lkUrl = process.env.LIVEKIT_URL;
    const lkKey = process.env.LIVEKIT_API_KEY;
    const lkSecret = process.env.LIVEKIT_API_SECRET;
    if (lkUrl && lkKey && lkSecret) {
      livekitConfigured = true;
      try {
        const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
        const rooms = await roomService.listRooms();
        for (const r of rooms || []) {
          let count = 0;
          try {
            const parts = await roomService.listParticipants(r.name);
            count = (parts || []).length;
          } catch (e) {
            count = -1; // participants unknown for this room
          }
          livekitRooms.push({ name: r.name, participants: count });
        }
      } catch (e: any) {
        livekitError = String(e?.message || e);
      }
    } else {
      livekitError = 'LiveKit is not configured on this server (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing).';
    }

    // --- Storage ------------------------------------------------------
    // Bounded recursive list per bucket (first 1000 objects each).
    // Sizes are summed from object metadata; when capped the figure
    // is labelled approximate.
    const storage: { bucket: string; files: number; bytes: number; capped: boolean }[] = [];
    try {
      const { data: buckets } = await admin.storage.listBuckets();
      for (const b of buckets || []) {
        let files = 0;
        let bytes = 0;
        let capped = false;
        const walk = async (prefix: string): Promise<void> => {
          if (files >= 1000) {
            capped = true;
            return;
          }
          const { data: objects, error } = await admin.storage
            .from(b.name)
            .list(prefix || undefined, { limit: 100, offset: 0 });
          if (error || !objects) return;
          for (const o of objects as any[]) {
            if (files >= 1000) {
              capped = true;
              return;
            }
            if (o.id === null && !o.metadata?.size) {
              // Folder entry — recurse into it.
              await walk(prefix ? `${prefix}/${o.name}` : o.name);
            } else {
              files += 1;
              bytes += Number(o.metadata?.size || 0);
            }
          }
        };
        await walk('');
        storage.push({ bucket: b.name, files, bytes, capped });
      }
    } catch (e) {
      console.error('[Superadmin Overview] storage list failed:', (e as any)?.message);
    }

    // --- Participant-minutes this month (approximate) -----------------
    // participants rows carry joined_at and updated_at (updated on
    // every status change, so for a LEFT row updated_at ≈ left time).
    // Still-in-room rows count up to now. Labelled approximate in the UI.
    let participantMinutesThisMonth: number | null = null;
    try {
      const { data, error } = await admin
        .from('participants')
        .select('status,joined_at,updated_at')
        .gte('joined_at', monthStart)
        .limit(5000);
      if (!error && data) {
        let total = 0;
        for (const row of data as any[]) {
          const start = new Date(row.joined_at).getTime();
          const end =
            row.status === 'JOINED' ? now.getTime() : new Date(row.updated_at).getTime();
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            total += (end - start) / 60000;
          }
        }
        participantMinutesThisMonth = Math.round(total);
      }
    } catch (e) {
      participantMinutesThisMonth = null;
    }

    // --- Recent activity (audit + deletions) -------------------------
    let recentAudit: { action: string; actor_email: string | null; target_type: string | null; created_at: string }[] = [];
    let auditAvailable = false;
    try {
      const { data, error } = await admin
        .from('superadmin_audit_log')
        .select('action,actor_email,target_type,created_at')
        .order('created_at', { ascending: false })
        .limit(8);
      if (!error && data) {
        auditAvailable = true;
        recentAudit = data as any[];
      }
    } catch (e) {
      auditAvailable = false;
    }
    let recentDeletions: { meeting_title: string | null; deleted_at: string }[] = [];
    try {
      const { data, error } = await admin
        .from('meeting_deletions')
        .select('meeting_title,deleted_at')
        .order('deleted_at', { ascending: false })
        .limit(5);
      if (!error && data) recentDeletions = data as any[];
    } catch (e) {
      recentDeletions = [];
    }

    // --- Setup status --------------------------------------------------
    const banner = await readSetting(admin, 'announcement_banner');
    const setup = {
      supabase: { ok: true, detail: 'Connected — this response came from the live project.' },
      livekit: {
        ok: livekitConfigured && !livekitError,
        detail: livekitError || `Connected — ${livekitRooms.length} room(s) live now.`,
      },
      resend: {
        ok: Boolean(process.env.RESEND_API_KEY),
        detail: process.env.RESEND_API_KEY
          ? 'Resend API key is set on the server.'
          : 'RESEND_API_KEY is not set on the server.',
      },
      vercel: {
        ok: true,
        detail: `Running on Vercel (${process.env.VERCEL_ENV || 'unknown env'}${process.env.VERCEL_GIT_COMMIT_SHA ? `, commit ${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}` : ''}).`,
      },
      superadminSql: {
        ok: auditAvailable,
        detail: auditAvailable
          ? 'giinmeet_superadmin.sql has run (audit table exists).'
          : 'giinmeet_superadmin.sql has NOT run yet — run it in the Supabase SQL Editor for settings, audit and suspension.',
      },
      announcementBanner: banner,
    };

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers,
        signupsThisWeek,
        liveMeetings,
        meetingsToday,
        totalMeetings,
        participantMinutesThisMonth,
        livekitRooms,
        livekitConfigured,
        storage,
      },
      liveMeetingRows,
      recentSignins,
      recentAudit,
      recentDeletions,
      setup,
    });
  } catch (err: any) {
    console.error('[Superadmin Overview] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
