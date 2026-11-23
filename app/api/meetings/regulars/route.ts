// Phase D (38), regulars: people the host trusts to bypass the lobby.
//
// A regular is an email the host listed. When that person signs in and
// joins one of the host's meetings, the waiting room lets them straight
// in (checked by /api/meetings/waiting-room, action check-regular, and
// enforced again by the token route, which is the final gate). Only
// the host manages their own list, and only signed-in people can be
// regulars: a guest with no account cannot bypass by email alone.
//
// POST { accessToken, action: 'list' | 'add' | 'remove', email?, name? }
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

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-regulars', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage your regulars.', 401);
    }
    const action = typeof body.action === 'string' ? body.action : 'list';

    if (action === 'list') {
      const { data, error } = await admin
        .from('host_regulars')
        .select('id,email,name,created_at')
        .eq('host_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Regulars need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true, regulars: data || [] });
    }

    if (action === 'add') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(email)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid email address is required.', 400);
      }
      if (email === (user.email || '').toLowerCase()) {
        return errorWithSecurity('BAD_REQUEST', 'You already bypass your own lobby, no need to list yourself.', 400);
      }
      // Idempotent: update the name when the email is already listed,
      // insert when it is not. (The unique index is on lower(email),
      // an expression index, so an upsert onConflict cannot name it.)
      const { data: existing } = await admin
        .from('host_regulars')
        .select('id')
        .eq('host_id', user.id)
        .eq('email', email)
        .maybeSingle();
      const name = cleanText(body.name, 120) || null;
      const { error } = existing
        ? await admin.from('host_regulars').update({ name }).eq('id', (existing as any).id)
        : await admin.from('host_regulars').insert({ host_id: user.id, email, name });
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Regulars need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true });
    }

    if (action === 'remove') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(email)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid email address is required.', 400);
      }
      await admin
        .from('host_regulars')
        .delete()
        .eq('host_id', user.id)
        .eq('email', email);
      return jsonWithSecurity({ ok: true });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown regulars action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Regulars API', err);
  }
}
