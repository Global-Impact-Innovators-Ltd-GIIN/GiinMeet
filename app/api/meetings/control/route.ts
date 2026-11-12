import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Room controls, host-verified server-side. (Fix Round 7, findings
// #1 + #3: every participant used to broadcast mute/kick/settings to
// the room with no sender check, and guests never even received those
// broadcasts — the sig-webrtc channel was passcode-gated and
// loadDetails sets passcode='' for every non-host. Now the client
// calls this route, the route verifies the caller is the host (or a
// co-host, for mutes), and the SERVER broadcasts the event with a
// `server: true` marker. Receivers ignore these events without the
// marker, so a participant can no longer mute, kick, or reconfigure
// anyone from the browser.)
//
//   - mute-all, mute-participant, disable-video-all: host or co-host.
//   - remove-participant, settings-update: host only.
//   - remove-participant also deletes the participant row server-side,
//     so the kicked guest leaves even if the broadcast is missed (the
//     participants poll has a self-row-gone check as well).
//
// The broadcast goes out on the sig-webrtc-<id> channel, the same
// channel every client in the room is subscribed to. The server joins
// it with the service-role client and sends once — no websocket is
// kept open.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isCurrentHost(meeting: { admin_id?: string | null; user_id?: string | null } | null, userId: string | null | undefined) {
  if (!meeting || !userId) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
}

async function broadcastToRoom(admin: any, meetingId: string, event: string, payload: any) {
  const channelName = 'sig-webrtc-' + meetingId;
  const ch = admin.channel(channelName, { config: { broadcast: { self: false } } });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out joining the room channel.')), 8000);
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Could not join the room channel (' + status + ').')); }
      });
    });
    const result = await ch.send({ type: 'broadcast', event, payload });
    if (result && result !== 'ok') throw new Error('The room did not accept the broadcast.');
  } finally {
    try { await admin.removeChannel(ch); } catch (e) { /* already gone */ }
  }
}

const MODERATOR_ACTIONS = ['mute-all', 'mute-participant', 'disable-video-all'];
const HOST_ONLY_ACTIONS = ['remove-participant', 'settings-update'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken, participantRowId, action, targetUserId, targetRowId, settings } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!action || (MODERATOR_ACTIONS.indexOf(action) === -1 && HOST_ONLY_ACTIONS.indexOf(action) === -1)) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Unknown control action.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }

    // Caller credential: a signed-in user's session token, or a guest
    // co-host's participant row id (the same dual credential the token
    // route uses). One of them is required.
    if (!accessToken && !participantRowId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the host or a co-host can control the room.' }, { status: 401 });
    }

    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, status')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'This meeting could not be found.' }, { status: 404 });
    }
    if (meeting.status === 'Completed') {
      return NextResponse.json({ error: 'MEETING_ENDED', message: 'This meeting has ended.' }, { status: 403 });
    }

    // Authorise: host (by auth user id), or a co-host row. A guest
    // co-host proves it with their participant row id.
    let isHost = false;
    let isCoHost = false;
    if (accessToken) {
      const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
      if (userError || !user) {
        return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
      }
      isHost = isCurrentHost(meeting, user.id);
      if (!isHost) {
        const { data: coRow } = await admin
          .from('meeting_participants')
          .select('id')
          .eq('meeting_id', meetingId)
          .eq('user_id', user.id)
          .eq('role', 'CoHost')
          .eq('status', 'Admitted')
          .maybeSingle();
        isCoHost = !!coRow;
      }
    } else {
      const { data: grow } = await admin
        .from('meeting_participants')
        .select('id, user_id, status, role')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      if (!grow || grow.status !== 'Admitted' || grow.role !== 'CoHost') {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host or a co-host can control the room.' }, { status: 403 });
      }
      isCoHost = true;
      isHost = isCurrentHost(meeting, grow.user_id);
    }

    const hostOnly = HOST_ONLY_ACTIONS.indexOf(action) !== -1;
    if (hostOnly && !isHost) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can do that.' }, { status: 403 });
    }
    if (!isHost && !isCoHost) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host or a co-host can control the room.' }, { status: 403 });
    }

    // Kick: delete the row server-side first, so the guest leaves even
    // if the broadcast is missed (the participants poll has a
    // self-row-gone check as a second line of defence).
    let rowDeleted = false;
    if (action === 'remove-participant') {
      const key = targetRowId || targetUserId;
      if (!key) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Choose a participant to remove.' }, { status: 400 });
      }
      const { data: deleted, error: deleteError } = await admin
        .from('meeting_participants')
        .delete()
        .eq('meeting_id', meetingId)
        .or('id.eq.' + key + ',user_id.eq.' + key)
        .select('id');
      if (deleteError) {
        console.error('[Control API] Failed to delete participant row:', deleteError);
        return NextResponse.json({ error: 'DB_ERROR', message: 'Could not remove the participant from the meeting.' }, { status: 500 });
      }
      rowDeleted = (deleted || []).length > 0;
    }

    // Broadcast the control event with the server marker. Receivers
    // ignore these events without it.
    const payload: any = { server: true };
    if (targetUserId) payload.targetUserId = targetUserId;
    if (targetRowId) payload.targetRowId = targetRowId;
    if (action === 'settings-update') {
      if (!settings || typeof settings !== 'object') {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Settings are required.' }, { status: 400 });
      }
      Object.assign(payload, settings);
    }
    try {
      await broadcastToRoom(admin, meetingId, action, payload);
    } catch (e: any) {
      console.error('[Control API] Broadcast failed:', e?.message || e);
      return NextResponse.json({ error: 'BROADCAST_FAILED', message: 'The room could not be reached. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, action, rowDeleted });
  } catch (err: any) {
    console.error('[Control API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
