// Phase C1 (23) — disconnect a calendar.
// POST { provider, accessToken } — signed-in user only, deletes their
// own connection row (their tokens with it). Best effort, the provider
// token is also revoked at Google when possible. Rate limited.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { decryptToken, getCalendarConnection } from '../../_lib/calendar';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'calendar-disconnect', 10, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const provider = body.provider as string | undefined;
    if (provider !== 'google' && provider !== 'outlook') {
      return errorWithSecurity('BAD_REQUEST', 'Choose Google or Outlook.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to disconnect a calendar.', 401);
    }
    const connection = await getCalendarConnection(admin, user.id, provider);
    if (connection) {
      // Best-effort provider-side revoke (Google only; Microsoft has no
      // equivalent for delegated tokens, the stored token just dies here).
      if (provider === 'google') {
        try {
          const token = decryptToken(connection.access_token);
          if (token) {
            await fetch(
              `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
              { method: 'POST' },
            );
          }
        } catch {
          // Revocation is best effort; the local delete below is what matters.
        }
      }
      await admin.from('calendar_connections').delete().eq('id', connection.id);
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Calendar Disconnect API', err);
  }
}
