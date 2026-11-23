// Phase D (37), per-meeting media encryption toggle, host only.
//
// HONEST LABEL, read before trusting the toggle: when this is ON, the
// audio and video in the LiveKit room are encrypted between the
// participants with a key derived in each browser from the meeting
// passcode (LiveKit E2EE, ExternalE2EEKeyProvider, PBKDF2). The
// GiinMeet server and the LiveKit server only relay encrypted media
// and never see the key, which is never sent to the server and never
// stored. What it does NOT cover: chat messages, shared files, names,
// the agenda and all other meeting metadata, which are protected only
// in transit (TLS) and at rest. Anyone who knows the passcode can join
// and decrypt, so a leaked passcode defeats it, and a meeting with no
// passcode cannot use it at all. The toggle refuses to turn on for a
// meeting with no passcode, instead of pretending.
//
// POST { action: 'get', meetingId, accessToken?, participantRowId? }
//   -> { ok, enabled } for the host, an admitted participant, or a
//      guest holding their admitted row id.
// POST { action: 'set', meetingId, accessToken, enabled }
//   -> host only, turns the toggle on or off.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { isHost } from '../../_lib/meetingAccess';

export const E2EE_COVERAGE =
  'When on, audio and video are encrypted between participants with a key derived in your browser from the meeting passcode. GiinMeet and LiveKit only relay encrypted media and never see the key. Chat, files, names and meeting details are not covered by this, they are protected in transit and at rest only. Anyone with the passcode can join and decrypt.';

async function canSeeMeeting(
  admin: any,
  meetingId: string,
  userId: string | null,
  participantRowId: string | undefined,
): Promise<boolean> {
  if (userId && (await isHost(admin, meetingId, userId))) return true;
  if (userId) {
    const { data: row } = await admin
      .from('meeting_participants')
      .select('id')
      .eq('meeting_id', meetingId)
      .eq('user_id', userId)
      .eq('status', 'Admitted')
      .maybeSingle();
    if (row) return true;
  }
  if (participantRowId) {
    const { data: grow } = await admin
      .from('meeting_participants')
      .select('id')
      .eq('id', participantRowId)
      .eq('meeting_id', meetingId)
      .eq('status', 'Admitted')
      .maybeSingle();
    if (grow) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-e2ee', 30, 60 * 1000);
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
    const action = body.action === 'set' ? 'set' : 'get';
    const user = await getCaller(admin, body.accessToken as string | undefined);
    const participantRowId =
      typeof body.participantRowId === 'string' ? body.participantRowId : undefined;

    if (action === 'get') {
      if (!(await canSeeMeeting(admin, meetingId, user?.id || null, participantRowId))) {
        return errorWithSecurity('FORBIDDEN', 'Only the host and admitted participants can see this meeting encryption setting.', 403);
      }
      const { data, error } = await admin
        .from('meetings')
        .select('e2ee_enabled')
        .eq('id', meetingId)
        .maybeSingle();
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Meeting encryption needs the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({
        ok: true,
        enabled: !!(data as any)?.e2ee_enabled,
        coverage: E2EE_COVERAGE,
      });
    }

    // set: host only.
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to change the meeting encryption setting.', 401);
    }
    if (!(await isHost(admin, meetingId, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the meeting host can change the encryption setting.', 403);
    }
    if (typeof body.enabled !== 'boolean') {
      return errorWithSecurity('BAD_REQUEST', 'enabled must be true or false.', 400);
    }
    if (body.enabled) {
      // No passcode, no encryption: the key is derived from the
      // passcode, so a meeting without one cannot be encrypted.
      const { data: row } = await admin
        .from('meetings')
        .select('passcode')
        .eq('id', meetingId)
        .maybeSingle();
      if (!(row as any)?.passcode) {
        return errorWithSecurity(
          'PASSCODE_REQUIRED',
          'Add a meeting passcode first. The encryption key is derived from the passcode, so a meeting without one cannot be encrypted.',
          400,
        );
      }
    }
    const { error } = await admin
      .from('meetings')
      .update({ e2ee_enabled: body.enabled })
      .eq('id', meetingId);
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Meeting encryption needs the Phase D database setup first (run giinmeet_phaseD.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, enabled: body.enabled, coverage: E2EE_COVERAGE });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Meeting E2EE API', err);
  }
}
