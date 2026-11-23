// Phase C1 (33), scheduling polls: "find a time that works for
// everyone" when calendars alone are not enough.
//
// POST { accessToken, title, durationMinutes, slots: string[], attendeeEmails? }
//   Signed-in host only. Creates a poll and returns its unguessable link
//   (32 random chars). Anyone with the link can vote, nobody can list
//   polls: the token is the only key, and it is never published anywhere.
// GET ?token=..., the poll plus its votes (token required; the token is
//   the authorisation). Rate limited.
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
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

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'scheduling-poll', 30, 60 * 1000);
    if (limited) return limited;
    const token = (req.nextUrl.searchParams.get('token') || '').trim();
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      return errorWithSecurity('BAD_REQUEST', 'That poll link is not valid.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const { data: poll } = await admin
      .from('scheduling_polls')
      .select('id, title, duration_minutes, slots, attendee_emails, created_at, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (!poll) {
      return errorWithSecurity('NOT_FOUND', 'That poll does not exist. Check the link and try again.', 404);
    }
    if (new Date((poll as any).expires_at).getTime() < Date.now()) {
      return errorWithSecurity('NOT_FOUND', 'That poll has expired.', 404);
    }
    const { data: votes } = await admin
      .from('scheduling_poll_votes')
      .select('voter_name, votes, created_at')
      .eq('poll_id', (poll as any).id)
      .order('created_at', { ascending: true });
    return jsonWithSecurity({
      ok: true,
      poll: {
        title: (poll as any).title,
        durationMinutes: (poll as any).duration_minutes,
        slots: (poll as any).slots,
        attendeeEmails: (poll as any).attendee_emails,
        expiresAt: (poll as any).expires_at,
      },
      votes: votes || [],
    });
  } catch (err) {
    return internalError('Scheduling Poll API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'scheduling-poll', 20, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to ask attendees for a time.', 401);
    }
    const title = cleanText(body.title, 200) || 'GiinMeet meeting';
    const durationMinutes =
      typeof body.durationMinutes === 'number'
        ? Math.floor(body.durationMinutes)
        : parseInt(String(body.durationMinutes || '60'), 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      return errorWithSecurity('BAD_REQUEST', 'Pick a duration between 15 minutes and 8 hours.', 400);
    }
    const slots = Array.isArray(body.slots) ? body.slots : [];
    if (slots.length < 2 || slots.length > 10) {
      return errorWithSecurity('BAD_REQUEST', 'Offer 2 to 10 times to vote on.', 400);
    }
    const now = Date.now();
    const cleanSlots: string[] = [];
    for (const s of slots) {
      if (typeof s !== 'string') continue;
      const t = new Date(s).getTime();
      if (!Number.isFinite(t) || t < now || t > now + 60 * 24 * 60 * 60 * 1000) continue;
      cleanSlots.push(new Date(t).toISOString());
    }
    if (cleanSlots.length < 2) {
      return errorWithSecurity('BAD_REQUEST', 'Offer at least 2 future times to vote on.', 400);
    }
    const attendeeEmails = Array.isArray(body.attendeeEmails)
      ? (body.attendeeEmails as unknown[])
          .filter((e) => isEmail(e))
          .map((e) => String(e).trim().toLowerCase())
          .slice(0, 20)
      : [];
    const token = randomBytes(24).toString('base64url');
    const { data, error } = await admin
      .from('scheduling_polls')
      .insert([
        {
          token,
          host_user_id: user.id,
          title,
          duration_minutes: durationMinutes,
          slots: cleanSlots,
          attendee_emails: attendeeEmails,
        },
      ])
      .select('token')
      .maybeSingle();
    if (error || !data) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Scheduling polls need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    const origin = req.nextUrl.origin;
    return jsonWithSecurity({
      ok: true,
      token,
      link: `${origin}/poll/${token}`,
      slots: cleanSlots,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Scheduling Poll API', err);
  }
}
