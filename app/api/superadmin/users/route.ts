import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireSuperadmin, writeAudit } from '../lib';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

const VALID_TIERS = ['free', 'pro', 'enterprise'] as const;

// POST /api/superadmin/users
//   { accessToken }                          -> list all users (profiles + auth timestamps)
//   { accessToken, action: 'set-tier', userId, tier }
//   { accessToken, action: 'suspend', userId, reason? }
//   { accessToken, action: 'activate', userId }
//   { accessToken, action: 'reset-password', userId }  -> returns a one-time temp password
//   { accessToken, action: 'toggle-superadmin', userId, value }
// Every mutating action writes a superadmin_audit_log row (best-effort).
export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'superadmin-users', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin, user: actor } = checked.caller;
    const action = body?.action as string | undefined;

    // ---- List -------------------------------------------------------
    if (!action || action === 'list') {
      const { data: profiles, error } = await admin
        .from('profiles')
        .select('id,name,email,workspace_name,domain,phone,is_premium,plan_tier,is_superadmin,is_suspended,suspended_at,suspended_reason,updated_at')
        .order('name', { ascending: true });
      if (error) {
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not list users: ${error.message}` }, { status: 500 });
      }
      // Auth timestamps (created_at / last_sign_in_at) — profiles has
      // no created_at column, so they come from the Auth admin list.
      const authById = new Map<string, { createdAt: string; lastSignInAt: string | null }>();
      try {
        let page = 1;
        for (; page <= 2; page++) {
          const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (listErr || !data?.users) break;
          for (const u of data.users) {
            authById.set(u.id, {
              createdAt: u.created_at || '',
              lastSignInAt: (u as any).last_sign_in_at || null,
            });
          }
          if (data.users.length < 1000) break;
        }
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        console.error('[Superadmin Users] auth list failed:', (e as any)?.message);
      }
      const users = (profiles || []).map((p: any) => ({
        ...p,
        created_at: authById.get(p.id)?.createdAt || null,
        last_sign_in_at: authById.get(p.id)?.lastSignInAt || null,
      }));
      return NextResponse.json({ ok: true, users });
    }

    // ---- Mutations need a target ------------------------------------
    const userId = body?.userId as string | undefined;
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'userId is required.' }, { status: 400 });
    }
    const { data: target } = await admin
      .from('profiles')
      .select('id,email,name,is_superadmin,is_suspended,plan_tier')
      .eq('id', userId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'That user could not be found.' }, { status: 404 });
    }
    const targetEmail = (target as any).email || '';

    // ---- Set tier -----------------------------------------------------
    if (action === 'set-tier') {
      const tier = body?.tier as string | undefined;
      if (!VALID_TIERS.includes(tier as any)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'tier must be free, pro or enterprise.' }, { status: 400 });
      }
      const { error } = await admin
        .from('profiles')
        .update({ plan_tier: tier, is_premium: tier !== 'free' })
        .eq('id', userId);
      if (error) {
        const msg = String(error.message || '');
        if (/plan_tier/i.test(msg) && /column|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'TIER_NOT_SET_UP', message: 'Plan tiers are not set up yet — run giinmeet_plan_tier.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not set the tier: ${msg}` }, { status: 500 });
      }
      await writeAudit(admin, actor, 'set-tier', 'user', userId, { email: targetEmail, tier });
      return NextResponse.json({ ok: true, tier });
    }

    // ---- Suspend --------------------------------------------------------
    if (action === 'suspend') {
      if ((target as any).is_superadmin) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'A superadmin account cannot be suspended.' }, { status: 403 });
      }
      if (userId === actor.id) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'You cannot suspend your own account.' }, { status: 403 });
      }
      const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : null;
      const { error } = await admin
        .from('profiles')
        .update({ is_suspended: true, suspended_at: new Date().toISOString(), suspended_reason: reason })
        .eq('id', userId);
      if (error) {
        const msg = String(error.message || '');
        if (/is_suspended/i.test(msg) && /column|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'SUSPEND_NOT_SET_UP', message: 'Suspension is not set up yet — run giinmeet_superadmin.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not suspend the account: ${msg}` }, { status: 500 });
      }
      // Auth-layer ban: a suspended account cannot sign in at all.
      // Best-effort — the flag above is the record; a ban failure is
      // reported honestly instead of pretending it worked.
      let banWarning: string | undefined;
      try {
        const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: '87600h',
        } as any);
        if (banErr) banWarning = `The account is flagged suspended, but the sign-in ban could not be applied: ${banErr.message}`;
      } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        banWarning = `The account is flagged suspended, but the sign-in ban could not be applied: ${e?.message || e}`;
      }
      await writeAudit(admin, actor, 'suspend', 'user', userId, { email: targetEmail, reason });
      return NextResponse.json({ ok: true, ...(banWarning ? { warning: banWarning } : {}) });
    }

    // ---- Activate -------------------------------------------------------
    if (action === 'activate') {
      const { error } = await admin
        .from('profiles')
        .update({ is_suspended: false, suspended_at: null, suspended_reason: null })
        .eq('id', userId);
      if (error) {
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not activate the account: ${error.message}` }, { status: 500 });
      }
      let banWarning: string | undefined;
      try {
        const { error: unbanErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: null,
        } as any);
        if (unbanErr) banWarning = `The account is active again, but the sign-in ban could not be cleared: ${unbanErr.message}`;
      } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        banWarning = `The account is active again, but the sign-in ban could not be cleared: ${e?.message || e}`;
      }
      await writeAudit(admin, actor, 'activate', 'user', userId, { email: targetEmail });
      return NextResponse.json({ ok: true, ...(banWarning ? { warning: banWarning } : {}) });
    }

    // ---- Reset password ---------------------------------------------------
    // Generates a one-time temporary password, sets it via the Auth
    // Admin API, and returns it ONCE for the superadmin to share with
    // the user. The password is never stored or logged anywhere.
    if (action === 'reset-password') {
      const temp = randomBytes(12).toString('base64url');
      const { error } = await admin.auth.admin.updateUserById(userId, { password: temp });
      if (error) {
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not reset the password: ${error.message}` }, { status: 500 });
      }
      await writeAudit(admin, actor, 'reset-password', 'user', userId, { email: targetEmail });
      return NextResponse.json({ ok: true, tempPassword: temp });
    }

    // ---- Toggle superadmin ---------------------------------------------
    if (action === 'toggle-superadmin') {
      const value = body?.value === true;
      if (userId === actor.id) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'You cannot change your own superadmin role.' }, { status: 403 });
      }
      if (!value && (target as any).is_superadmin) {
        // Never remove the last superadmin.
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_superadmin', true);
        if ((count ?? 0) <= 1) {
          return NextResponse.json(
            { error: 'FORBIDDEN', message: 'This is the last superadmin — another superadmin must exist before this role is removed.' },
            { status: 403 }
          );
        }
      }
      const { error } = await admin
        .from('profiles')
        .update({ is_superadmin: value })
        .eq('id', userId);
      if (error) {
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not change the role: ${error.message}` }, { status: 500 });
      }
      await writeAudit(admin, actor, value ? 'grant-superadmin' : 'revoke-superadmin', 'user', userId, { email: targetEmail });
      return NextResponse.json({ ok: true, is_superadmin: value });
    }

    return NextResponse.json({ error: 'BAD_REQUEST', message: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Superadmin Users] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
