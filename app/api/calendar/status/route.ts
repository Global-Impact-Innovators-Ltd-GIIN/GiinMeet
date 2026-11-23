// Phase C1 (23) — calendar sync status.
// GET ?accessToken=... — signed-in user only. Returns which providers are
// configured on the server and which calendars this user connected.
// Provider tokens are NEVER returned: only the account email and the
// connection state. Rate limited per IP.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  jsonWithSecurity,
} from '../../_lib/security';
import {
  calendarProviderConfigured,
  listCalendarConnections,
  tokensEncryptionEnabled,
} from '../../_lib/calendar';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'calendar-status', 60, 60 * 1000);
    if (limited) return limited;
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity(
        'UNAUTHORIZED',
        'Sign in to see your calendar connections.',
        401,
      );
    }
    let connections: { provider: string; accountEmail: string | null }[] = [];
    try {
      const rows = await listCalendarConnections(admin, user.id);
      connections = rows.map((r) => ({
        provider: r.provider,
        accountEmail: r.account_email,
      }));
    } catch {
      // The Phase C1 SQL has not run yet: no connections, not a crash.
      connections = [];
    }
    return jsonWithSecurity({
      ok: true,
      configured: {
        google: calendarProviderConfigured('google'),
        outlook: calendarProviderConfigured('outlook'),
      },
      tokensEncrypted: tokensEncryptionEnabled(),
      connections,
    });
  } catch (err) {
    return internalError('Calendar Status API', err);
  }
}
