// Phase C1 (28), meeting notes (the library).
//
// GET ?meetingId=...&accessToken=..., notes for one meeting, host or
// admitted participant only.
// POST { meetingId, accessToken, body }, add a note (host or admitted
// participant; the note is shared with everyone who can read the
// meeting record). Body is plain text, capped at 5000 chars.
// DELETE ?meetingId=...&id=...&accessToken=..., delete the caller's own
// note, or any note when the caller is the host.
// Rate limited; every value validated server-side.
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

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'library-notes', 60, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to read meeting notes.', 401);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'You cannot read this meeting record.', 403);
    }
    const { data, error } = await admin
      .from('meeting_notes')
      .select('id, body, created_at, updated_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Notes need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, notes: data || [] });
  } catch (err) {
    return internalError('Library Notes API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'library-notes', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const meetingId = body.meetingId as string | undefined;
    const noteBody = cleanText(body.body, 5000);
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    if (!noteBody) {
      return errorWithSecurity('BAD_REQUEST', 'Write the note first.', 400);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to add a note.', 401);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'You cannot add notes to this meeting.', 403);
    }
    const { data, error } = await admin
      .from('meeting_notes')
      .insert([{ meeting_id: meetingId, user_id: user.id, body: noteBody }])
      .select('id, body, created_at, updated_at')
      .maybeSingle();
    if (error || !data) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Notes need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, note: data });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That note is too large.', 413);
    }
    return internalError('Library Notes API', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'library-notes', 30, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const id = req.nextUrl.searchParams.get('id') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    if (!isUuid(meetingId) || !isUuid(id)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid note is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to delete a note.', 401);
    }
    const host = await isHost(admin, meetingId, user.id);
    const query = admin.from('meeting_notes').delete().eq('id', id).eq('meeting_id', meetingId);
    if (!host) query.eq('user_id', user.id);
    const { error } = await query;
    if (error) {
      return errorWithSecurity('DB_ERROR', 'That note could not be deleted.', 500);
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    return internalError('Library Notes API', err);
  }
}
