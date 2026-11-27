// GiinMeet Live Interview Mode — integrity events.
//
// POST { interviewId, token, events: [...] }
//   The candidate (or an interviewer client) reports detected events.
//   The token proves the caller belongs to this interview. Each event
//   carries a client_id; a retry or a flush after a dropped connection
//   never double-logs, because interview_id + client_id is unique and
//   the insert ignores conflicts. The original occurred_at is kept, so
//   a queued event still shows its real time.
//   Event types: tab-hidden, tab-visible, window-blur, window-focus,
//   fullscreen-exit, fullscreen-enter, copy, paste, right-click,
//   new-window-attempt, screen-share-attempt, connection-lost,
//   connection-restored, question-asked, interview-paused,
//   interview-resumed, candidate-sent-to-waiting, candidate-readmitted.
//   Severity: low (short blur, question, pause), medium (tab switch,
//   fullscreen exit, long blur, right click, copy), high (paste,
//   repeated events, long absence, screen-share attempt).
//
// GET ?interviewId=...&accessToken=...  or  &token=...
//   Host or interviewer only. The candidate never reads the event
//   log, so the candidate's own client never calls this. Returns the
//   full timeline ordered by occurred_at, plus counts by type and
//   severity for the report.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

const TAG = 'interview-events';

const SEVERITIES = new Set(['low', 'medium', 'high']);

async function callerMayRead(admin: any, interview: any, accessToken: string | undefined, token: string | undefined) {
  if (accessToken) {
    const caller = await getCaller(admin, accessToken);
    if (caller) {
      if (interview.host_id === caller.id) return true;
      const { data: row } = await admin
        .from('interview_participants')
        .select('id')
        .eq('interview_id', interview.id)
        .eq('user_id', caller.id)
        .in('role', ['interviewer', 'lead'])
        .maybeSingle();
      if (row) return true;
    }
  }
  if (token && isUuid(token)) {
    const { data: row } = await admin
      .from('interview_participants')
      .select('id')
      .eq('interview_id', interview.id)
      .eq('token', token)
      .in('role', ['interviewer', 'lead'])
      .maybeSingle();
    if (row) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'interview-events', 60, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req, 128 * 1024);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const interviewId = typeof body.interviewId === 'string' ? body.interviewId : '';
    const token = typeof body.token === 'string' ? body.token : '';
    if (!isUuid(interviewId) || !isUuid(token)) {
      return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
    }
    const { data: interview, error: ivErr } = await admin
      .from('interviews')
      .select('id, status')
      .eq('id', interviewId)
      .maybeSingle();
    if (ivErr || !interview) return errorWithSecurity('NOT_FOUND', 'That interview does not exist.', 404);
    const { data: who } = await admin
      .from('interview_participants')
      .select('id, role')
      .eq('interview_id', interviewId)
      .eq('token', token)
      .maybeSingle();
    if (!who) return errorWithSecurity('FORBIDDEN', 'That link does not belong to this interview.', 403);

    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0 || events.length > 50) {
      return errorWithSecurity('BAD_REQUEST', 'Send between 1 and 50 events.', 400);
    }
    const rows = events
      .filter((e: any) => e && typeof e.clientId === 'string' && e.clientId && typeof e.type === 'string' && e.type)
      .slice(0, 50)
      .map((e: any) => {
        const occurred = typeof e.occurredAt === 'string' ? new Date(e.occurredAt) : new Date();
        const occurredAt = Number.isNaN(occurred.getTime()) ? new Date() : occurred;
        return {
          interview_id: interviewId,
          client_id: cleanText(e.clientId, 120),
          event_type: cleanText(e.type, 60),
          detail: cleanText(e.detail, 500),
          severity: SEVERITIES.has(e.severity) ? e.severity : 'low',
          occurred_at: occurredAt.toISOString(),
          away_seconds: typeof e.awaySeconds === 'number' && e.awaySeconds >= 0
            ? Math.min(86400, Math.round(e.awaySeconds)) : null,
          actor: (who as any).role === 'candidate' ? 'candidate' : 'interviewer',
        };
      });
    if (rows.length === 0) return errorWithSecurity('BAD_REQUEST', 'No usable events were sent.', 400);
    const { error } = await admin
      .from('interview_events')
      .upsert(rows, { onConflict: 'interview_id,client_id', ignoreDuplicates: true });
    if (error) return internalError(TAG, error);
    return jsonWithSecurity({ ok: true, saved: rows.length });
  } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError(TAG, e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'interview-events-get', 60, 60 * 1000);
    if (limited) return limited;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const url = new URL(req.url);
    const interviewId = url.searchParams.get('interviewId') || '';
    const accessToken = url.searchParams.get('accessToken') || undefined;
    const token = url.searchParams.get('token') || undefined;
    if (!isUuid(interviewId)) return errorWithSecurity('BAD_REQUEST', 'That interview id is not valid.', 400);
    const { data: interview, error: ivErr } = await admin
      .from('interviews')
      .select('*')
      .eq('id', interviewId)
      .maybeSingle();
    if (ivErr || !interview) return errorWithSecurity('NOT_FOUND', 'That interview does not exist.', 404);
    if (!(await callerMayRead(admin, interview, accessToken, token))) {
      return errorWithSecurity('FORBIDDEN', 'You are not part of this interview.', 403);
    }
    const { data: events } = await admin
      .from('interview_events')
      .select('id, event_type, detail, severity, occurred_at, away_seconds, actor')
      .eq('interview_id', interviewId)
      .order('occurred_at', { ascending: true })
      .limit(1000);
    const list = events || [];
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = { low: 0, medium: 0, high: 0 };
    let longestAway = 0;
    for (const e of list) {
      byType[e.event_type] = (byType[e.event_type] || 0) + 1;
      if (e.severity === 'low' || e.severity === 'medium' || e.severity === 'high') bySeverity[e.severity] += 1;
      if (typeof e.away_seconds === 'number' && e.away_seconds > longestAway) longestAway = e.away_seconds;
    }
    return jsonWithSecurity({
      ok: true,
      events: list,
      counts: { byType, bySeverity, total: list.length, longestAwaySeconds: longestAway },
    });
  } catch (e: any) {
    return internalError(TAG, e);
  }
}
