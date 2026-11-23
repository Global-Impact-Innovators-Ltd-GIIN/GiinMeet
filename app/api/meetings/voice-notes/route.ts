// Phase C2b (9), voice notes in meeting chat.
//
// Hold the microphone button in chat and send a short voice message.
// PRIVACY RULE: a voice note plays ONLY on the listener's own device,
// through their own headphones or speaker, never broadcast into the
// meeting's shared audio. Each person chooses to play it themselves.
//
// Caps, enforced server-side: 60 seconds, 2 MB. The audio file lives
// in the existing 'chat-files' storage bucket under voice-notes/; the
// row here only holds its path. Uploads go through a signed upload
// URL minted here, so the client never needs storage credentials.
//
// POST { meetingId, accessToken?, participantRowId?, action, ... }
//   action 'request-upload' { fileName, fileSize, durationSeconds }
//          -> { ok, uploadUrl, storagePath } (signed, one use)
//   action 'confirm' { storagePath, durationSeconds }
//          -> registers the note after the upload lands
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   Voice notes for the meeting, newest last, with view URLs.
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

const TABLE_MISSING = 'Voice notes need the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';
const BUCKET = 'chat-files';
const MAX_SECONDS = 60;
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'voice-notes', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to hear voice notes.', 401);
    }
    const { data, error } = await admin
      .from('meeting_voice_notes')
      .select('id, sender_key, sender_name, storage_path, duration_seconds, created_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING, notes: [] });
    }
    const notes = ((data || []) as any[]).map((n) => {
      const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(n.storage_path);
      return {
        id: n.id,
        senderKey: n.sender_key,
        senderName: n.sender_name,
        url: urlData?.publicUrl || '',
        durationSeconds: n.duration_seconds,
        createdAt: n.created_at,
        self: n.sender_key === caller.key,
      };
    });
    return jsonWithSecurity({ ok: true, notes });
  } catch (err) {
    return internalError('Voice Notes API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'voice-notes', 20, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to send voice notes.', 401);
    }

    if (action === 'request-upload') {
      const fileSize = Number(body.fileSize);
      const durationSeconds = Number(body.durationSeconds);
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_BYTES) {
        return errorWithSecurity('BAD_REQUEST', 'Voice notes are limited to 2 MB.', 400);
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_SECONDS) {
        return errorWithSecurity('BAD_REQUEST', 'Voice notes are limited to 60 seconds.', 400);
      }
      const safeName = `${Date.now()}-${caller.key.slice(0, 8)}.webm`;
      const storagePath = `voice-notes/${meetingId}/${safeName}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      if (error || !data?.signedUrl) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: 'Voice notes need the chat files storage bucket first (run giinmeet_phase2_chat_files_bucket.sql).' });
      }
      return jsonWithSecurity({ ok: true, uploadUrl: data.signedUrl, storagePath });
    }

    if (action === 'confirm') {
      const storagePath = cleanText(body.storagePath, 200);
      const durationSeconds = Number(body.durationSeconds);
      if (!storagePath.startsWith(`voice-notes/${meetingId}/`)) {
        return errorWithSecurity('BAD_REQUEST', 'That voice note path is not valid.', 400);
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_SECONDS) {
        return errorWithSecurity('BAD_REQUEST', 'Voice notes are limited to 60 seconds.', 400);
      }
      // The file must actually be there, and within the size cap.
      const { data: fileList } = await admin.storage.from(BUCKET).list(`voice-notes/${meetingId}`, { limit: 100 });
      const found = (fileList || []).find((f: any) => `voice-notes/${meetingId}/${f.name}` === storagePath);
      if (!found) {
        return errorWithSecurity('NOT_FOUND', 'The voice note upload did not arrive. Please record it again.', 404);
      }
      if (typeof (found as any).metadata?.size === 'number' && (found as any).metadata.size > MAX_BYTES) {
        await admin.storage.from(BUCKET).remove([storagePath]);
        return errorWithSecurity('BAD_REQUEST', 'Voice notes are limited to 2 MB.', 400);
      }
      const { data, error } = await admin
        .from('meeting_voice_notes')
        .insert([
          {
            meeting_id: meetingId,
            sender_key: caller.key,
            sender_name: caller.name,
            storage_path: storagePath,
            duration_seconds: Math.round(durationSeconds),
          },
        ])
        .select('id, sender_key, sender_name, storage_path, duration_seconds, created_at')
        .maybeSingle();
      if (error || !data) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
      return jsonWithSecurity({
        ok: true,
        note: {
          id: (data as any).id,
          senderKey: caller.key,
          senderName: caller.name,
          url: urlData?.publicUrl || '',
          durationSeconds: (data as any).duration_seconds,
          createdAt: (data as any).created_at,
          self: true,
        },
      });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown voice note action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Voice Notes API', err);
  }
}
