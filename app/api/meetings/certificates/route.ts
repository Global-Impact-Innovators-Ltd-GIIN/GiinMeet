// Phase C2a (5), attendance certificate list for one meeting.
//
// GET ?meetingId=, host or admitted participant. Attendees come from
// the Phase C1 attendance events (feature 34, 'join' events) plus the
// Phase 1 meeting_attendance rows, de-duplicated by name, earliest
// join first. Only names and join times are returned, no emails and
// no other personal data. Needs giinmeet_phaseC1.sql for the events
// table; without it the route answers honestly instead of pretending.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isUuid,
  jsonWithSecurity,
} from '../../_lib/security';
import { isHostOrAdmitted } from '../../_lib/meetingAccess';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-certificates', 60, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to see attendance certificates.', 401);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host and admitted participants can see attendance for a meeting.', 403);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, title, time')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return errorWithSecurity('NOT_FOUND', 'This meeting does not exist.', 404);
    }
    const byName = new Map<string, { name: string; joinedAt: string | null }>();
    const add = (name: unknown, joinedAt: unknown) => {
      const clean = typeof name === 'string' ? name.trim().slice(0, 120) : '';
      if (!clean || clean.toLowerCase() === 'guest') return;
      const at = typeof joinedAt === 'string' ? joinedAt : null;
      const prev = byName.get(clean.toLowerCase());
      if (!prev || (at && prev.joinedAt && at < prev.joinedAt)) {
        byName.set(clean.toLowerCase(), { name: clean, joinedAt: at });
      } else if (!prev) {
        byName.set(clean.toLowerCase(), { name: clean, joinedAt: at });
      }
    };
    // Phase C1 attendance events first.
    const { data: events, error: eventsError } = await admin
      .from('meeting_attendance_events')
      .select('name, at')
      .eq('meeting_id', meetingId)
      .eq('event_type', 'join')
      .order('at', { ascending: true });
    if (eventsError) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Certificates need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    (events || []).forEach((e: any) => add(e.name, e.at));
    // Phase 1 attendance rows as a second source.
    const { data: rows } = await admin
      .from('meeting_attendance')
      .select('name, joined_at')
      .eq('meeting_id', meetingId)
      .order('joined_at', { ascending: true });
    (rows || []).forEach((r: any) => add(r.name, r.joined_at));
    const attendees = [...byName.values()].sort((a, b) =>
      (a.joinedAt || '').localeCompare(b.joinedAt || ''),
    );
    return jsonWithSecurity({
      ok: true,
      meeting: { title: (meeting as any).title || 'Meeting', time: (meeting as any).time || null },
      attendees,
    });
  } catch (err) {
    return internalError('Meeting Certificates API', err);
  }
}
