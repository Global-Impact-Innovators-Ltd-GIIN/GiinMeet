// Phase C1 (35), action item tracker.
//
// GET ?meetingId=, tracked items for one meeting (host or admitted
//   participant). GET ?open=true, the caller's own open items across
//   their meetings, newest meeting first (host only, for carry-over).
// POST { accessToken, meetingId, text, owner? }, host adds an item
//   by hand (source 'manual').
// POST { accessToken, meetingId, text, owner?, carriedFromMeetingId }
//  , host carries an open item into this meeting (source 'carried').
// PATCH { accessToken, id, done }, host marks an item done or reopens
//   it. Only the host can write; reads are host-or-admitted. Every
//   field is validated server-side. Rate limited.
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
} from '../_lib/security';
import { isHost, isHostOrAdmitted } from '../_lib/meetingAccess';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'action-items', 30, 60 * 1000);
    if (limited) return limited;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const accessToken = req.nextUrl.searchParams.get('accessToken') || '';
    const user = await getCaller(admin, accessToken || undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to see action items.', 401);
    }
    const openOnly = req.nextUrl.searchParams.get('open') === 'true';
    if (openOnly) {
      // The caller's open items across meetings they host.
      const { data: meetings } = await admin
        .from('meetings')
        .select('id, title, time')
        .or(`user_id.eq.${user.id},admin_id.eq.${user.id}`)
        .order('time', { ascending: false })
        .limit(50);
      const ids = (meetings || []).map((m: any) => m.id);
      if (ids.length === 0) return jsonWithSecurity({ ok: true, items: [] });
      const { data: items } = await admin
        .from('action_items')
        .select('id, meeting_id, text, owner, status, source, carried_from_meeting_id, created_at')
        .in('meeting_id', ids)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      const byId = new Map((meetings || []).map((m: any) => [m.id, m]));
      return jsonWithSecurity({
        ok: true,
        items: (items || []).map((it: any) => ({
          ...it,
          meetingTitle: (byId.get(it.meeting_id) as any)?.title || 'Meeting',
          meetingTime: (byId.get(it.meeting_id) as any)?.time || null,
        })),
      });
    }
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host and admitted participants can see action items for a meeting.', 403);
    }
    const { data: items } = await admin
      .from('action_items')
      .select('id, meeting_id, text, owner, status, source, carried_from_meeting_id, created_at, done_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });
    return jsonWithSecurity({ ok: true, items: items || [] });
  } catch (err) {
    return internalError('Action Items API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'action-items', 20, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to add an action item.', 401);
    }
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host can add action items.', 403);
    }
    const text = cleanText(body.text, 500);
    if (!text) {
      return errorWithSecurity('BAD_REQUEST', 'Write what needs doing.', 400);
    }
    const owner = cleanText(body.owner, 120) || 'Unassigned';
    const carriedFrom =
      typeof body.carriedFromMeetingId === 'string' && isUuid(body.carriedFromMeetingId)
        ? body.carriedFromMeetingId
        : null;
    const { data, error } = await admin
      .from('action_items')
      .insert([
        {
          meeting_id: meetingId,
          text,
          owner,
          status: 'open',
          source: carriedFrom ? 'carried' : 'manual',
          carried_from_meeting_id: carriedFrom,
        },
      ])
      .select('id, meeting_id, text, owner, status, source, carried_from_meeting_id, created_at')
      .maybeSingle();
    if (error || !data) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Action items need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, item: data });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Action Items API', err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'action-items', 20, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to update an action item.', 401);
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!isUuid(id)) {
      return errorWithSecurity('BAD_REQUEST', 'That action item id is not valid.', 400);
    }
    const { data: item } = await admin
      .from('action_items')
      .select('id, meeting_id')
      .eq('id', id)
      .maybeSingle();
    if (!item) {
      return errorWithSecurity('NOT_FOUND', 'That action item does not exist.', 404);
    }
    if (!(await isHost(admin, (item as any).meeting_id, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host can mark action items done.', 403);
    }
    const done = body.done === true;
    const { error } = await admin
      .from('action_items')
      .update({
        status: done ? 'done' : 'open',
        done_at: done ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) {
      return errorWithSecurity('DB_ERROR', 'That action item could not be updated. Please try again.', 500);
    }
    return jsonWithSecurity({ ok: true, done });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Action Items API', err);
  }
}
