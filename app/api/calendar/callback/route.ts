// Phase C1 (23) — calendar OAuth callback.
// GET ?provider=google|outlook&code=...&state=... — the provider sends
// the browser here after the user approves. The state is HMAC-verified
// (bound to the user who started the connect, 10-minute expiry), the
// code is exchanged server-side, and the tokens are stored server-side
// only, never in a cookie or a page. The browser is then sent back to
// the dashboard. Rate limited per IP.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, checkRateLimit } from '../../_lib/security';
import {
  exchangeCalendarCode,
  fetchAccountEmail,
  upsertCalendarConnection,
  verifyCalendarState,
} from '../../_lib/calendar';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/#/dashboard?calendar=error`, origin));
  try {
    const limited = checkRateLimit(req, 'calendar-callback', 20, 60 * 1000);
    if (limited) return fail('rate');
    const provider = req.nextUrl.searchParams.get('provider');
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    if ((provider !== 'google' && provider !== 'outlook') || !code || !state) {
      return fail('bad');
    }
    const verified = verifyCalendarState(state);
    if (!verified || verified.provider !== provider) {
      // Replayed, expired or tampered state: never exchange the code.
      return fail('state');
    }
    const admin = getAdminClient();
    if (!admin) return fail('config');
    let tokens;
    try {
      tokens = await exchangeCalendarCode(provider, code, origin);
    } catch {
      return fail('exchange');
    }
    if (!tokens.accessToken) return fail('exchange');
    const accountEmail = await fetchAccountEmail(provider, tokens.accessToken);
    try {
      await upsertCalendarConnection(admin, verified.userId, provider, tokens, accountEmail);
    } catch {
      // The Phase C1 SQL has not run yet: say so on the dashboard.
      return NextResponse.redirect(
        new URL(`/#/dashboard?calendar=needs-sql`, origin),
      );
    }
    return NextResponse.redirect(
      new URL(`/#/dashboard?calendar=${provider}-connected`, origin),
    );
  } catch (err) {
    console.error('[Calendar Callback API]', err instanceof Error ? err.message : 'unknown error');
    return fail('error');
  }
}
