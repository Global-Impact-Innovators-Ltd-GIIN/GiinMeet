// Phase C1 (23) — start a calendar connect.
// POST { provider: 'google' | 'outlook', accessToken } — signed-in user
// only. Returns the provider authorisation URL; the browser goes there,
// the provider asks the user to approve, and the callback finishes the
// connect. The OAuth state is HMAC-signed and bound to this user, so the
// callback cannot be replayed for another account. Rate limited.
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
import {
  buildCalendarAuthUrl,
  calendarProviderConfigured,
  signCalendarState,
} from '../../_lib/calendar';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'calendar-connect', 10, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to connect a calendar.', 401);
    }
    if (!calendarProviderConfigured(provider)) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message:
          provider === 'google'
            ? 'Google calendar sync needs setup: create a Google OAuth client and add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET in Vercel (see docs/PHASE_C1_SETUP.md).'
            : 'Outlook calendar sync needs setup: create an Azure app registration and add OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET in Vercel (see docs/PHASE_C1_SETUP.md).',
      });
    }
    const origin = req.nextUrl.origin;
    const state = signCalendarState(user.id, provider);
    const authUrl = buildCalendarAuthUrl(provider, origin, state);
    return jsonWithSecurity({ ok: true, authUrl });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Calendar Connect API', err);
  }
}
