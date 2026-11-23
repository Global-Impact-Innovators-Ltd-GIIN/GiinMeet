// Phase C2a (1), short meeting links.
//
// POST { accessToken, meetingId }, host only, creates (or returns the
//   existing) short link for a meeting. One short link per meeting.
// GET ?code=, public resolve, returns only the meeting id, never a
//   passcode. The /s/<code> page redirects from it to the normal join
//   flow, so the passcode gate and waiting room still apply.
// Rate limited per IP, and per user on create. Codes are 8 random
// base62 characters (about 218 trillion combinations), unique in the
// database, with a retry on collision. Needs giinmeet_phaseC2a.sql.
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../_lib/security';
import { isHost } from '../_lib/meetingAccess';

const CODE_RE = /^[A-Za-z0-9_-]{6,16}$/;

function makeCode(): string {
  return randomBytes(6).toString('base64url');
}

function shortUrlFor(code: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://giinmeet.nimdaukus.com').replace(/\/$/, '');
  return `${base}/s/${code}`;
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'short-links-resolve', 60, 60 * 1000);
    if (limited) return limited;
    const code = (req.nextUrl.searchParams.get('code') || '').trim();
    if (!CODE_RE.test(code)) {
      return errorWithSecurity('BAD_REQUEST', 'That short link is not valid.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const { data, error } = await admin
      .from('short_links')
      .select('meeting_id')
      .eq('code', code)
      .maybeSingle();
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Short links need the Phase C2a database setup first (run giinmeet_phaseC2a.sql).',
      });
    }
    if (!data) {
      return errorWithSecurity('NOT_FOUND', 'This short link does not exist. Check the link and try again.', 404);
    }
    return jsonWithSecurity({ ok: true, meetingId: (data as any).meeting_id });
  } catch (err) {
    return internalError('Short Links API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'short-links-create', 20, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to create a short link.', 401);
    }
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return errorWithSecurity('NOT_FOUND', 'This meeting does not exist.', 404);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host can create a short link for a meeting.', 403);
    }
    // Reuse the existing link for this meeting.
    const { data: existing } = await admin
      .from('short_links')
      .select('code')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (existing) {
      const code = (existing as any).code as string;
      return jsonWithSecurity({ ok: true, code, shortUrl: shortUrlFor(code), reused: true });
    }
    // Create one, retrying on the rare code collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = makeCode();
      const { error } = await admin.from('short_links').insert([
        { code, meeting_id: meetingId, created_by: user.id },
      ]);
      if (!error) {
        return jsonWithSecurity({ ok: true, code, shortUrl: shortUrlFor(code), reused: false });
      }
      if (!/duplicate|unique/i.test(String((error as any)?.message || ''))) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Short links need the Phase C2a database setup first (run giinmeet_phaseC2a.sql).',
        });
      }
    }
    return errorWithSecurity('INTERNAL_SERVER_ERROR', 'The short link could not be created right now.', 500);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Short Links API', err);
  }
}
