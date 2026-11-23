// Phase C2b (7), document viewer.
//
// Upload slides or a PDF and everyone sees the same page at the same
// time, with the host turning the pages. Lighter on bandwidth than
// sharing a whole screen: the file is uploaded once to the existing
// 'chat-files' storage bucket, and every viewer opens the same file.
//
// Supported: PDF and images (PNG, JPG, GIF, WebP). A slide deck
// (PowerPoint, Keynote) cannot be shown directly in a browser, so the
// host is asked to export it as PDF first; the upload check says so
// plainly instead of failing silently.
//
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   The open document and the page everyone should be on.
// POST { meetingId, accessToken?, participantRowId?, action, ... }
//   action 'open'  { storagePath, title, kind, pageCount }
//          host only. Registers the file in the library too, so it
//          stays findable after the meeting.
//   action 'page'  { page } host only, unless viewers_can_turn is on
//          (then any admitted participant, or the current remote
//          controller when the sharer granted control).
//   action 'allow-turn' { allowed } host only, lets viewers turn pages.
//   action 'close' host only.
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

const TABLE_MISSING = 'The document viewer needs the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';
const BUCKET = 'chat-files';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'doc-viewer', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to view the document.', 401);
    }
    const { data, error } = await admin
      .from('meeting_doc_viewer')
      .select('title, storage_path, kind, page_count, current_page, viewers_can_turn, opened_by')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING, open: false });
    }
    if (!data) {
      return jsonWithSecurity({ ok: true, open: false });
    }
    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl((data as any).storage_path);
    return jsonWithSecurity({
      ok: true,
      open: true,
      title: (data as any).title,
      url: urlData?.publicUrl || '',
      kind: (data as any).kind,
      pageCount: (data as any).page_count,
      currentPage: (data as any).current_page,
      viewersCanTurn: !!(data as any).viewers_can_turn,
      isHost: caller.isHost,
      openedBy: (data as any).opened_by,
    });
  } catch (err) {
    return internalError('Document Viewer API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'doc-viewer', 30, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to use the document viewer.', 401);
    }

    if (action === 'open') {
      if (!caller.isHost) {
        return errorWithSecurity('FORBIDDEN', 'Only the host can open a document for everyone.', 403);
      }
      const storagePath = cleanText(body.storagePath, 300);
      const title = cleanText(body.title, 200) || 'Document';
      const kind = body.kind === 'image' ? 'image' : 'pdf';
      const pageCount = Number(body.pageCount);
      if (!storagePath.startsWith(`${meetingId}/`)) {
        return errorWithSecurity('BAD_REQUEST', 'That document was not uploaded for this meeting.', 400);
      }
      if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 500) {
        return errorWithSecurity('BAD_REQUEST', 'The page count is not valid.', 400);
      }
      const { error } = await admin.from('meeting_doc_viewer').upsert(
        [
          {
            meeting_id: meetingId,
            title,
            storage_path: storagePath,
            kind,
            page_count: pageCount,
            current_page: 1,
            viewers_can_turn: false,
            opened_by: caller.key,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'meeting_id' },
      );
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      // Register in the library as a shared file, so it stays findable
      // after the meeting. Best effort: the viewer works without it.
      try {
        let ownerId = caller.userId;
        if (!ownerId) {
          const { data: meeting } = await admin
            .from('meetings')
            .select('admin_id, user_id')
            .eq('id', meetingId)
            .maybeSingle();
          ownerId = (meeting as any)?.admin_id || (meeting as any)?.user_id || null;
        }
        if (ownerId) {
          const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
          await admin.from('meeting_files').insert([
            { meeting_id: meetingId, user_id: ownerId, kind: 'file', name: title, url: urlData?.publicUrl || storagePath },
          ]);
        }
      } catch (e) { /* library registration is best effort */ }
      return jsonWithSecurity({ ok: true, open: true, currentPage: 1, pageCount });
    }

    const { data: doc } = await admin
      .from('meeting_doc_viewer')
      .select('page_count, viewers_can_turn')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (!doc) {
      return errorWithSecurity('NOT_FOUND', 'No document is open right now.', 404);
    }

    if (action === 'page') {
      const page = Number(body.page);
      if (!Number.isInteger(page) || page < 1 || page > (doc as any).page_count) {
        return errorWithSecurity('BAD_REQUEST', 'That page does not exist in this document.', 400);
      }
      let allowed = caller.isHost || !!(doc as any).viewers_can_turn;
      if (!allowed) {
        // A remote controller the sharer granted control to may turn
        // the pages of the shared document too.
        const { data: grant } = await admin
          .from('meeting_remote_control')
          .select('id')
          .eq('meeting_id', meetingId)
          .eq('controller_key', caller.key)
          .eq('status', 'granted')
          .maybeSingle();
        allowed = !!grant;
      }
      if (!allowed) {
        return errorWithSecurity('FORBIDDEN', 'Only the host can turn the pages right now.', 403);
      }
      const { error } = await admin
        .from('meeting_doc_viewer')
        .update({ current_page: page, updated_at: new Date().toISOString() })
        .eq('meeting_id', meetingId);
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, currentPage: page });
    }

    if (action === 'allow-turn') {
      if (!caller.isHost) {
        return errorWithSecurity('FORBIDDEN', 'Only the host can change that.', 403);
      }
      const allowed = body.allowed === true;
      await admin
        .from('meeting_doc_viewer')
        .update({ viewers_can_turn: allowed, updated_at: new Date().toISOString() })
        .eq('meeting_id', meetingId);
      return jsonWithSecurity({ ok: true, viewersCanTurn: allowed });
    }

    if (action === 'close') {
      if (!caller.isHost) {
        return errorWithSecurity('FORBIDDEN', 'Only the host can close the document.', 403);
      }
      await admin.from('meeting_doc_viewer').delete().eq('meeting_id', meetingId);
      return jsonWithSecurity({ ok: true, open: false });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown document viewer action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Document Viewer API', err);
  }
}
