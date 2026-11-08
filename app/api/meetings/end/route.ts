import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// End a meeting, server-side, for real. The old client-side end only set
// the meeting status (and overwrote its notes with a canned string). This
// route, callable only by the meeting's host (signed-in, verified
// server-side), does all three things an end must do:
//   1. meetings.status = 'Completed' — notes are PRESERVED, never overwritten.
//   2. rooms.is_active = false for the meeting's room — the token route
//      only mints for active rooms, so the link stops working.
//   3. participants.status = 'LEFT' for everyone in that room — frees the
//      capacity slots the leak used to hold forever.
// The token route additionally rejects mints for Completed meetings, so
// even a stale room row cannot be re-entered.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
    if (!meeting || (meeting.admin_id !== user.id && meeting.user_id !== user.id)) {
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

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[End Meeting API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
