// Phase D (39), report a meeting: abuse and spam reports.
//
// Anyone in the meeting (signed-in, or a guest with an email) can
// report it. Reports land in meeting_reports, which only the
// superadmin can see, in the superadmin portal (Reports section).
// Reporting never reveals whether the meeting or the reporter was
// already known: the answer is the same either way.
//
// POST { meetingId, reason, detail?, accessToken?, reporterEmail? }
//   reason: spam, abuse, harassment, scam, or other.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isEmail,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

const REASONS = ['spam', 'abuse', 'harassment', 'scam', 'other'];

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-report', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (!REASONS.includes(reason)) {
      return errorWithSecurity('BAD_REQUEST', 'Choose a reason for the report.', 400);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    const reporterEmail =
      user?.email ||
      (typeof body.reporterEmail === 'string' && isEmail(body.reporterEmail.trim())
        ? body.reporterEmail.trim().toLowerCase()
        : '');
    if (!user && !reporterEmail) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in, or leave an email address, to report a meeting.', 401);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      // Same answer as a real report: the caller learns nothing about
      // which meeting ids exist.
      return jsonWithSecurity({ ok: true });
    }
    const { error } = await admin.from('meeting_reports').insert({
      meeting_id: meetingId,
      reporter_id: user?.id || null,
      reporter_email: reporterEmail || null,
      reason,
      detail: cleanText(body.detail, 500) || null,
      status: 'open',
    });
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Reporting needs the Phase D database setup first (run giinmeet_phaseD.sql).',
      });
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Report API', err);
  }
}
