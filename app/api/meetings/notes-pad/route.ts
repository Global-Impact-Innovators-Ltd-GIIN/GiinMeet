// Phase C2b (2), shared live notes pad.
//
// One pad per meeting, everyone in the meeting types in the same
// page. Live keystrokes travel on the Supabase broadcast channel
// (client to client, same as the in-room polls); this route is the
// durable copy: debounced saves while typing, and the save that
// matters, into the library (meeting_notes) when the meeting ends.
//
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   The current pad text. Host or admitted participant only.
// POST { meetingId, accessToken?, participantRowId?, body }
//   Save the pad text (any admitted participant, capped at 20000
//   characters). Live edits are last-write-wins with a version
//   number carried by the client broadcast, not by this route.
// POST { meetingId, ..., action: 'save-to-library' }
//   Copy the pad into meeting_notes (the Library), once, so the
//   notes live on after the meeting. Called by the host when the
//   meeting ends, and by anyone from the pad's Save button.
// Rate limited per IP; every value validated server-side.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { resolveC2bCaller } from '../../_lib/c2b';

const TABLE_MISSING = 'Live notes need the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';
const MAX_PAD_CHARS = 20000;

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'notes-pad', 60, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const participantRowId = req.nextUrl.searchParams.get('participantRowId') || undefined;
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const caller = await resolveC2bCaller(admin, meetingId, { accessToken, participantRowId });
    if (!caller) {
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to read the notes pad.', 401);
    }
    const { data, error } = await admin
      .from('meeting_live_notes')
      .select('body, updated_at')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
    }
    return jsonWithSecurity({ ok: true, body: (data as any)?.body || '', updatedAt: (data as any)?.updated_at || null });
  } catch (err) {
    return internalError('Notes Pad API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'notes-pad', 60, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req, 64 * 1024);
    const meetingId = body.meetingId as string | undefined;
    const action = cleanText(body.action, 20);
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const caller = await resolveC2bCaller(admin, meetingId, body);
    if (!caller) {
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to write in the notes pad.', 401);
    }

    if (action === 'save-to-library') {
      const { data: pad } = await admin
        .from('meeting_live_notes')
        .select('body')
        .eq('meeting_id', meetingId)
        .maybeSingle();
      const text = ((pad as any)?.body || '').trim();
      if (!text) {
        return jsonWithSecurity({ ok: true, saved: false, message: 'The notes pad is empty, nothing to save.' });
      }
      // One library row per save, labelled as the shared pad, so the
      // Library shows it next to the meeting's other notes. The
      // user_id must be a real auth user: guests save under the host.
      let ownerId = caller.userId;
      if (!ownerId) {
        const { data: meeting } = await admin
          .from('meetings')
          .select('admin_id, user_id')
          .eq('id', meetingId)
          .maybeSingle();
        ownerId = (meeting as any)?.admin_id || (meeting as any)?.user_id || null;
      }
      if (!ownerId) {
        return jsonWithSecurity({ ok: false, reason: 'NO_OWNER', message: 'The notes could not be saved to the library.' });
      }
      const { error } = await admin.from('meeting_notes').insert([
        { meeting_id: meetingId, user_id: ownerId, body: `Shared notes pad:\n${text}` },
      ]);
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, saved: true });
    }

    const text = cleanText(body.body, MAX_PAD_CHARS);
    const { error } = await admin.from('meeting_live_notes').upsert(
      [{ meeting_id: meetingId, body: text, updated_by: caller.key, updated_at: new Date().toISOString() }],
      { onConflict: 'meeting_id' },
    );
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'Those notes are too long.', 413);
    }
    return internalError('Notes Pad API', err);
  }
}
