// GiinMeet Live Interview Mode — candidate recording upload.
//
// POST multipart formData { interviewId, accessToken, file }
//   The lead interviewer recorded the candidate's remote tracks in
//   their browser with MediaRecorder. This route stores the .webm in
//   the private interview-recordings bucket (service role only) and
//   records the path on the interview row, so the integrity report can
//   link it with a signed URL.
//
//   Honest limits: there is no cloud recording. This is a local
//   capture uploaded after the interview. Files are capped at 500 MB
//   per upload; a longer interview at 1 Mbps is about 450 MB an hour.
//   Supabase free storage is 1 GB per project, so recordings are the
//   host's storage to manage, and old ones should be deleted from the
//   bucket when the report no longer needs them. If the upload fails,
//   the client keeps the file as a local download instead and says so.
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

const TAG = 'interview-recording';
const MAX_BYTES = 500 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'interview-recording', 10, 60 * 1000);
    if (limited) return limited;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const form = await req.formData();
    const interviewId = typeof form.get('interviewId') === 'string' ? (form.get('interviewId') as string) : '';
    const accessToken = typeof form.get('accessToken') === 'string' ? (form.get('accessToken') as string) : '';
    const file = form.get('file');
    if (!isUuid(interviewId)) return errorWithSecurity('BAD_REQUEST', 'That interview id is not valid.', 400);
    if (!file || typeof file === 'string') return errorWithSecurity('BAD_REQUEST', 'No recording file was sent.', 400);
    const blob = file as unknown as Blob;
    if (blob.size === 0) return errorWithSecurity('BAD_REQUEST', 'The recording is empty.', 400);
    if (blob.size > MAX_BYTES) {
      return errorWithSecurity('FILE_TOO_LARGE', 'The recording is over 500 MB and was not uploaded. Keep the local download instead.', 413);
    }
    const caller = await getCaller(admin, accessToken || undefined);
    if (!caller) return errorWithSecurity('UNAUTHORIZED', 'Sign in to upload the recording.', 401);
    const { data: interview, error: ivErr } = await admin
      .from('interviews')
      .select('id, host_id, meeting_id')
      .eq('id', interviewId)
      .maybeSingle();
    if (ivErr || !interview) return errorWithSecurity('NOT_FOUND', 'That interview does not exist.', 404);
    if ((interview as any).host_id !== caller.id) {
      return errorWithSecurity('FORBIDDEN', 'Only the lead interviewer can upload the recording.', 403);
    }
    const path = `${interviewId}/${Date.now()}.webm`;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from('interview-recordings')
      .upload(path, bytes, { contentType: 'video/webm', upsert: false });
    if (upErr) return internalError(TAG, upErr);
    await admin.from('interviews').update({
      recording_path: path,
      recording_uploaded_at: new Date().toISOString(),
    }).eq('id', interviewId);
    return jsonWithSecurity({ ok: true, path, size: blob.size });
  } catch (e: any) {
    return internalError(TAG, e);
  }
}
