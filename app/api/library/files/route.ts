// Phase C1 (28), meeting files (the library).
//
// GiinMeet has NO cloud recording (feature 11 was not chosen), so this
// route registers what exists: a local recording file that lives on the
// host's own device (kind 'local-recording': name, size, length, when it
// was recorded, where it is kept), or a file shared with the meeting
// (kind 'file', e.g. a chat-files bucket URL). The video itself is never
// uploaded here; the library records where it is, so it can be found
// again. Host-only writes; host or admitted participant reads.
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
    const limited = checkRateLimit(req, 'library-files', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to see meeting files.', 401);
    }
    if (!(await isHostOrAdmitted(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'You cannot read this meeting record.', 403);
    }
    const { data, error } = await admin
      .from('meeting_files')
      .select('id, kind, name, url, size_bytes, duration_seconds, recorded_at, note, created_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false });
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'The library needs the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, files: data || [] });
  } catch (err) {
    return internalError('Library Files API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'library-files', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const meetingId = body.meetingId as string | undefined;
    // Phase C2a (5): 'certificate' is a library kind too, for the
    // attendance certificates a download registers in the library.
    const kind = body.kind === 'file' ? 'file' : body.kind === 'certificate' ? 'certificate' : 'local-recording';
    const name = cleanText(body.name, 300);
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    if (!name) {
      return errorWithSecurity('BAD_REQUEST', 'Give the file a name.', 400);
    }
    const url = typeof body.url === 'string' ? body.url.trim().slice(0, 1000) : null;
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
      return errorWithSecurity('BAD_REQUEST', 'That file link is not a valid web address.', 400);
    }
    const sizeBytes =
      typeof body.sizeBytes === 'number' && Number.isFinite(body.sizeBytes)
        ? Math.max(0, Math.floor(body.sizeBytes))
        : null;
    const durationSeconds =
      typeof body.durationSeconds === 'number' && Number.isFinite(body.durationSeconds)
        ? Math.max(0, Math.min(86400, Math.floor(body.durationSeconds)))
        : null;
    const recordedAt =
      typeof body.recordedAt === 'string' && !Number.isNaN(new Date(body.recordedAt).getTime())
        ? new Date(body.recordedAt).toISOString()
        : null;
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to add a file.', 401);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the meeting host can add files.', 403);
    }
    const { data, error } = await admin
      .from('meeting_files')
      .insert([
        {
          meeting_id: meetingId,
          user_id: user.id,
          kind,
          name,
          url,
          size_bytes: sizeBytes,
          duration_seconds: durationSeconds,
          recorded_at: recordedAt,
          note: cleanText(body.note, 500) || null,
        },
      ])
      .select('id, kind, name, url, size_bytes, duration_seconds, recorded_at, note, created_at')
      .maybeSingle();
    if (error || !data) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'The library needs the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, file: data });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Library Files API', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'library-files', 30, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const id = req.nextUrl.searchParams.get('id') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    if (!isUuid(meetingId) || !isUuid(id)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid file is required.', 400);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to remove a file.', 401);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the meeting host can remove files.', 403);
    }
    const { error } = await admin
      .from('meeting_files')
      .delete()
      .eq('id', id)
      .eq('meeting_id', meetingId);
    if (error) {
      return errorWithSecurity('DB_ERROR', 'That file could not be removed.', 500);
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    return internalError('Library Files API', err);
  }
}
