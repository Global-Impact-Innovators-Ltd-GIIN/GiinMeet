// Phase D (39), blocking: server-enforced, not a client hide.
//
// A signed-in user blocks another account (by email, resolved to the
// account) or an email address. The block is enforced in the token
// route (no new video token), the admit route (the host cannot admit
// a blocked person by mistake) and the rejoin route (a blocked person
// cannot reactivate an old row), so a blocked user cannot rejoin by
// refreshing or by reusing an old link. Unblocking is the same list.
//
// A block only ever applies to the blocker's own meetings: the
// enforcement checks are always "did THIS meeting's host block this
// person". A superadmin block of an account is suspension, which
// already exists in the superadmin portal.
//
// POST { accessToken, action: 'list' | 'block' | 'unblock', email?, reason? }
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isEmail,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

async function resolveUserId(admin: any, email: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    return (data as any)?.id || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-block', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage your block list.', 401);
    }
    const action = typeof body.action === 'string' ? body.action : 'list';

    if (action === 'list') {
      const { data, error } = await admin
        .from('user_blocks')
        .select('id,blocked_user_id,blocked_email,reason,created_at')
        .eq('blocker_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Blocking needs the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true, blocks: data || [] });
    }

    // Blocking takes an email, or a user id straight from the
    // participant list (the route resolves the email itself, so the
    // client never has to know it).
    let email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    let blockedUserId = typeof body.userId === 'string' && body.userId ? body.userId : null;
    if (blockedUserId) {
      const { data: targetProfile } = await admin
        .from('profiles')
        .select('email')
        .eq('id', blockedUserId)
        .maybeSingle();
      email = ((targetProfile as any)?.email || '').toLowerCase();
    }
    if (!isEmail(email)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid email address is required.', 400);
    }
    if (email === (user.email || '').toLowerCase() || blockedUserId === user.id) {
      return errorWithSecurity('BAD_REQUEST', 'You cannot block yourself.', 400);
    }

    if (action === 'block') {
      if (!blockedUserId) blockedUserId = await resolveUserId(admin, email);
      // Idempotent: an existing block for this email is kept, not
      // duplicated. (The Phase D SQL has no unique constraint on
      // this pair, so the check-then-insert below is the guard.)
      const { data: existing } = await admin
        .from('user_blocks')
        .select('id')
        .eq('blocker_id', user.id)
        .eq('blocked_email', email)
        .maybeSingle();
      if (!existing) {
        const { error } = await admin.from('user_blocks').insert({
          blocker_id: user.id,
          blocked_user_id: blockedUserId,
          blocked_email: email,
          reason: cleanText(body.reason, 200) || null,
        });
        if (error) {
          return jsonWithSecurity({
            ok: false,
            reason: 'NOT_CONFIGURED',
            message: 'Blocking needs the Phase D database setup first (run giinmeet_phaseD.sql).',
          });
        }
      }
      return jsonWithSecurity({ ok: true, blockedUserId });
    }

    if (action === 'unblock') {
      await admin
        .from('user_blocks')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_email', email);
      return jsonWithSecurity({ ok: true });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown block action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Block API', err);
  }
}
