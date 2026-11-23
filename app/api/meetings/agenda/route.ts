// Phase C2a (4 + 6), saved meeting agenda.
//
// GET ?meetingId=, host or admitted participant, reads the agenda the
//   host saved for a meeting (meetings.agenda_items, Phase C2a SQL).
// POST { accessToken, meetingId, items }, host only, saves the agenda.
//   Items: [{ id, text, startTime?, endTime?, durationMinutes? }],
//   at most 50, text at most 200 chars, times 24h HH:MM, duration
//   1 to 480 minutes. The in-room timer reads the same items live
//   over the LiveKit signal channel; this route is the durable copy
//   the prep brief reads before the meeting.
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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanItems(raw: unknown): { id: string; text: string; startTime?: string; endTime?: string; durationMinutes?: number }[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const out: { id: string; text: string; startTime?: string; endTime?: string; durationMinutes?: number }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const it = item as Record<string, unknown>;
    const text = cleanText(it.text, 200);
    if (!text) return null;
    const id = typeof it.id === 'string' && it.id.length > 0 && it.id.length <= 64 ? it.id : null;
    if (!id) return null;
    const startTime = typeof it.startTime === 'string' && TIME_RE.test(it.startTime) ? it.startTime : undefined;
    const endTime = typeof it.endTime === 'string' && TIME_RE.test(it.endTime) ? it.endTime : undefined;
    const durationMinutes =
      typeof it.durationMinutes === 'number' && Number.isFinite(it.durationMinutes)
        ? Math.max(1, Math.min(480, Math.floor(it.durationMinutes)))
        : undefined;
    out.push({ id, text, ...(startTime ? { startTime } : {}), ...(endTime ? { endTime } : {}), ...(durationMinutes ? { durationMinutes } : {}) });
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-agenda', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to see the agenda.', 401);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host and admitted participants can see the agenda for a meeting.', 403);
    }
    const { data, error } = await admin
      .from('meetings')
      .select('agenda_items')
      .eq('id', meetingId)
      .maybeSingle();
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'The saved agenda needs the Phase C2a database setup first (run giinmeet_phaseC2a.sql).',
      });
    }
    const items = Array.isArray((data as any)?.agenda_items) ? (data as any).agenda_items : [];
    return jsonWithSecurity({ ok: true, items });
  } catch (err) {
    return internalError('Meeting Agenda API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-agenda', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to save the agenda.', 401);
    }
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host can save the agenda.', 403);
    }
    const items = cleanItems(body.items);
    if (items === null) {
      return errorWithSecurity('BAD_REQUEST', 'The agenda items are not valid. Each item needs a short title and, where given, a valid time.', 400);
    }
    const { error } = await admin
      .from('meetings')
      .update({ agenda_items: items })
      .eq('id', meetingId);
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'The saved agenda needs the Phase C2a database setup first (run giinmeet_phaseC2a.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, items });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Meeting Agenda API', err);
  }
}
