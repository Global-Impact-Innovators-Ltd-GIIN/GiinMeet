// Phase C1 (34), attendance and engagement insights.
//
// POST { accessToken, meetingId, events: [{ participantKey, name,
//        eventType: 'join' | 'leave' | 'speak', at, seconds? }] }
//   Host only. The host's browser flushes its local attendance record
//   plus its speaking-time counts when the meeting ends. The POST
//   REPLACES the meeting's events, so a retry or a second flush never
//   double-counts anyone. Events are capped (1000) and every field is
//   validated server-side. Rate limited.
// GET ?accessToken=&meetingId=, host or admitted participant. Returns
//   the events plus a per-person summary (joined, left, stayed, spoke,
//   never spoke) computed server-side, so the dashboard never has to
//   trust a client-side count.
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
import { isHost, isHostOrAdmitted } from '../../_lib/meetingAccess';

const EVENT_TYPES = new Set(['join', 'leave', 'speak']);

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'attendance-events', 10, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to save attendance.', 401);
    }
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host can save attendance for a meeting.', 403);
    }
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0 || events.length > 1000) {
      return errorWithSecurity('BAD_REQUEST', 'Send between 1 and 1000 attendance events.', 400);
    }
    const rows: { meeting_id: string; participant_key: string; name: string; event_type: string; at: string; seconds: number | null }[] = [];
    for (const e of events) {
      const key = cleanText((e as any)?.participantKey, 128);
      const name = cleanText((e as any)?.name, 120);
      const type = String((e as any)?.eventType || '');
      const atMs = typeof (e as any)?.at === 'string' ? new Date((e as any).at).getTime() : NaN;
      if (!key || !name || !EVENT_TYPES.has(type) || !Number.isFinite(atMs)) continue;
      const seconds =
        type === 'speak'
          ? Math.max(0, Math.min(86400, Math.floor(Number((e as any)?.seconds) || 0)))
          : null;
      rows.push({
        meeting_id: meetingId,
        participant_key: key,
        name,
        event_type: type,
        at: new Date(atMs).toISOString(),
        seconds,
      });
    }
    if (rows.length === 0) {
      return errorWithSecurity('BAD_REQUEST', 'No valid attendance events were sent.', 400);
    }
    const { error: delError } = await admin
      .from('meeting_attendance_events')
      .delete()
      .eq('meeting_id', meetingId);
    if (delError) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Attendance insights need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    const { error } = await admin.from('meeting_attendance_events').insert(rows);
    if (error) {
      return errorWithSecurity('DB_ERROR', 'Attendance could not be saved. Please try again.', 500);
    }
    return jsonWithSecurity({ ok: true, saved: rows.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Attendance Events API', err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'attendance-events', 30, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken || undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to see attendance.', 401);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host and admitted participants can see attendance for a meeting.', 403);
    }
    const { data: events } = await admin
      .from('meeting_attendance_events')
      .select('participant_key, name, event_type, at, seconds')
      .eq('meeting_id', meetingId)
      .order('at', { ascending: true });
    const perPerson = new Map<string, { key: string; name: string; joinedAt: string | null; leftAt: string | null; spokeSeconds: number }>();
    for (const e of events || []) {
      const key = (e as any).participant_key as string;
      if (!perPerson.has(key)) {
        perPerson.set(key, { key, name: (e as any).name, joinedAt: null, leftAt: null, spokeSeconds: 0 });
      }
      const p = perPerson.get(key)!;
      p.name = (e as any).name;
      if ((e as any).event_type === 'join' && !p.joinedAt) p.joinedAt = (e as any).at;
      if ((e as any).event_type === 'leave') p.leftAt = (e as any).at;
      if ((e as any).event_type === 'speak') p.spokeSeconds += Number((e as any).seconds || 0);
    }
    const people = [...perPerson.values()].map((p) => {
      const joined = p.joinedAt ? new Date(p.joinedAt).getTime() : null;
      const left = p.leftAt ? new Date(p.leftAt).getTime() : null;
      const staySeconds = joined !== null ? Math.max(0, Math.floor(((left ?? Date.now()) - joined) / 1000)) : null;
      return { ...p, staySeconds, neverSpoke: p.spokeSeconds === 0 };
    });
    const joined = people.length;
    const spoke = people.filter((p) => p.spokeSeconds > 0).length;
    const stays = people.map((p) => p.staySeconds).filter((s): s is number => s !== null);
    const avgStaySeconds = stays.length > 0 ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : 0;
    return jsonWithSecurity({
      ok: true,
      source: 'server',
      summary: { joined, spoke, neverSpoke: joined - spoke, avgStaySeconds },
      people,
    });
  } catch (err) {
    return internalError('Attendance Events API', err);
  }
}
