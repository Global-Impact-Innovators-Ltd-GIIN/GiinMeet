import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RoomServiceClient } from 'livekit-server-sdk';

// End a meeting, server-side, for real. The old client-side end only set
// the meeting status (and overwrote its notes with a canned string). This
// route, callable only by the meeting's host (signed-in, verified
// server-side), does everything an end must do:
//   1. meetings.status = 'Completed' — notes are PRESERVED, never overwritten.
//   2. rooms.is_active = false for the meeting's room — the token route
//      only mints for active rooms, so the link stops working.
//   3. participants.status = 'LEFT' for everyone in that room — frees the
//      capacity slots the leak used to hold forever.
//   4. The LiveKit room itself is deleted (RoomService deleteRoom), so
//      already-connected participants are disconnected by the video
//      server instead of keeping media flowing on a 6-hour token.
//      (Fix Round 6 / Phase 6: before this, step 4 did not exist —
//      ending only changed database rows, so everyone already in the
//      room stayed in the room.)
//   5. Waiting-room rows for this meeting are closed (Declined), so
//      nobody sits in a waiting room for a meeting that no longer exists.
//   6. The meeting's shared chat files are deleted from the chat-files
//      bucket, so nothing shared in the meeting survives it.
// The token route additionally rejects mints for Completed meetings, so
// even a stale room row cannot be re-entered, and in-room clients watch
// the meeting row (Realtime + polling) so a missed broadcast still ends
// them within seconds.
//
// The meeting row is the source of truth: if the LiveKit teardown fails,
// the meeting is still ended (steps 1-3 + 5 stand) and the response says
// so honestly via livekitWarning, instead of pretending the teardown
// happened or refusing to end a meeting the app can still end.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// The CURRENT host is meetings.admin_id (it moves on transfer). The
// creator (user_id) only counts when admin_id was never set (old rows).
function isCurrentHost(meeting: { admin_id?: string | null; user_id?: string | null } | null, userId: string) {
  if (!meeting) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    // Ending a meeting for everyone is a host-only act: the route
    // requires a signed-in host session, verified server-side. (App calls
    // onEndMeeting for every leaver, including guests — a guest leaving
    // must never be able to end the meeting, so this route refuses
    // callers who cannot prove they are the host.)
    if (!accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the meeting host can end the meeting for everyone.' }, { status: 401 });
    }
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting || !isCurrentHost(meeting, user.id)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can end the meeting for everyone.' }, { status: 403 });
    }

    // 1. Status only — notes untouched.
    const { error: meetingError } = await admin
      .from('meetings')
      .update({ status: 'Completed' })
      .eq('id', meetingId);
    if (meetingError) {
      console.error('[End Meeting API] Failed to complete meeting:', meetingError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not end the meeting.' }, { status: 500 });
    }

    // 2. Deactivate the room(s) for this meeting.
    const slug = `meet-${meetingId}`;
    const { data: rooms } = await admin.from('rooms').select('id').eq('slug', slug);
    const roomIds = (rooms || []).map((r: any) => r.id);
    if (roomIds.length > 0) {
      await admin.from('rooms').update({ is_active: false }).in('id', roomIds);
      // 3. Free every capacity slot held by this room.
      await admin.from('participants').update({ status: 'LEFT' }).in('room_id', roomIds).eq('status', 'JOINED');
    }
    // Waiting-room rows for this meeting are closed out too, so nobody
    // sits in a waiting room for a meeting that no longer exists.
    await admin.from('meeting_participants').update({ status: 'Declined' }).eq('meeting_id', meetingId).eq('status', 'Waiting');

    // 4. Tear the LiveKit room down, so connected participants are
    // disconnected by the video server. A room that is already gone
    // counts as deleted. Any other failure is reported honestly in
    // the response instead of failing the end: the database state
    // above is the source of truth, and in-room clients also watch
    // the meeting row and leave on their own within seconds.
    let livekitRoomDeleted = false;
    let livekitWarning: string | undefined;
    const lkUrl = process.env.LIVEKIT_URL;
    const lkKey = process.env.LIVEKIT_API_KEY;
    const lkSecret = process.env.LIVEKIT_API_SECRET;
    if (!lkUrl || !lkKey || !lkSecret) {
      livekitWarning = 'The video server room could not be torn down automatically (the video service is not configured on this server). The meeting is still ended — participants are removed by the app.';
    } else {
      try {
        const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
        await roomService.deleteRoom(slug);
        livekitRoomDeleted = true;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/not found/i.test(msg)) {
          livekitRoomDeleted = true;
        } else {
          console.error('[End Meeting API] LiveKit room teardown failed:', msg);
          livekitWarning = 'The video server room could not be torn down automatically. The meeting is still ended — participants are removed by the app within seconds.';
        }
      }
    }

    // 6. The meeting's shared chat files are done when the meeting ends:
    // delete every object under <meetingId>/ in the chat-files bucket.
    // The service-role client does this (there is deliberately no
    // client DELETE policy), and the meeting is already host-verified
    // above. Best-effort: the end never fails because of it, and the
    // count is reported honestly. After this, thumbnails and viewer
    // links for those files stop resolving.
    let chatFilesDeleted = 0;
    try {
      let offset = 0;
      for (;;) {
        const { data: objects, error: listError } = await admin.storage
          .from('chat-files')
          .list(meetingId, { limit: 100, offset });
        if (listError || !objects || objects.length === 0) break;
        const paths = objects.map((o: any) => `${meetingId}/${o.name}`);
        const { error: removeError } = await admin.storage.from('chat-files').remove(paths);
        if (removeError) break;
        chatFilesDeleted += paths.length;
        if (objects.length < 100) break;
        offset += 100;
      }
    } catch (e: any) {
      console.error('[End Meeting API] Could not delete meeting chat files:', e?.message || e);
    }

    return NextResponse.json({ ok: true, livekitRoomDeleted, chatFilesDeleted, ...(livekitWarning ? { livekitWarning } : {}) });
  } catch (err: any) {
    console.error('[End Meeting API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
