// Phase C2b (10), private whisper messages.
//
// Tag a person in the meeting chat to send a message only that person
// can see. Whispers live in their OWN table, never in the shared
// messages table, so they can never appear in the shared meeting
// transcript or the library. The API returns a whisper only to its
// sender or its recipient, and the client never receives anyone
// else's whispers at all.
//
// POST { meetingId, accessToken?, participantRowId?, recipientKey, text }
//   Send a whisper. Both sides must be admitted participants of this
//   meeting. Text is capped at 1000 characters.
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   Only whispers where the caller is the sender or the recipient.
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
import { isAdmittedKey, nameForKey, resolveC2bCaller } from '../../_lib/c2b';

const TABLE_MISSING = 'Whispers need the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'whispers', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to read whispers.', 401);
    }
    // One query, then filter in code: the caller must never receive a
    // whisper that is not theirs, even if the query shape changes.
    const { data, error } = await admin
      .from('meeting_whispers')
      .select('id, sender_key, sender_name, recipient_key, recipient_name, text, created_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING, whispers: [] });
    }
    const mine = ((data || []) as any[]).filter(
      (w) => w.sender_key === caller.key || w.recipient_key === caller.key,
    );
    return jsonWithSecurity({
      ok: true,
      whispers: mine.map((w) => ({
        id: w.id,
        senderKey: w.sender_key,
        senderName: w.sender_name,
        recipientKey: w.recipient_key,
        recipientName: w.recipient_name,
        text: w.text,
        createdAt: w.created_at,
        self: w.sender_key === caller.key,
      })),
    });
  } catch (err) {
    return internalError('Whispers API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'whispers', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const meetingId = body.meetingId as string | undefined;
    const recipientKey = cleanText(body.recipientKey, 64);
    const text = cleanText(body.text, 1000);
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    if (!recipientKey) {
      return errorWithSecurity('BAD_REQUEST', 'Choose who the whisper is for.', 400);
    }
    if (!text) {
      return errorWithSecurity('BAD_REQUEST', 'Write the whisper first.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const caller = await resolveC2bCaller(admin, meetingId, body);
    if (!caller) {
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to whisper.', 401);
    }
    if (recipientKey === caller.key) {
      return errorWithSecurity('BAD_REQUEST', 'A whisper needs someone else to receive it.', 400);
    }
    if (!(await isAdmittedKey(admin, meetingId!, recipientKey))) {
      return errorWithSecurity('NOT_FOUND', 'That person is not in this meeting.', 404);
    }
    const recipientName = (await nameForKey(admin, meetingId!, recipientKey)) || 'Participant';
    const { data, error } = await admin
      .from('meeting_whispers')
      .insert([
        {
          meeting_id: meetingId,
          sender_key: caller.key,
          sender_name: caller.name,
          recipient_key: recipientKey,
          recipient_name: recipientName,
          text,
        },
      ])
      .select('id, sender_key, sender_name, recipient_key, recipient_name, text, created_at')
      .maybeSingle();
    if (error || !data) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
    }
    return jsonWithSecurity({
      ok: true,
      whisper: {
        id: (data as any).id,
        senderKey: caller.key,
        senderName: caller.name,
        recipientKey,
        recipientName,
        text,
        createdAt: (data as any).created_at,
        self: true,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Whispers API', err);
  }
}
