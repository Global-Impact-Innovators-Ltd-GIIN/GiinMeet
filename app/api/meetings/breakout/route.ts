import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveC2bCaller } from '../../_lib/c2b';

// Breakout-room control, host-verified server-side. (Phase 3,
// Feature 1 built the rooms; Feature 2 enforces who may run them.)
//
// WHY THIS ROUTE EXISTS: Feature 1 sent start / end / move /
// broadcast as direct client broadcasts on the meeting-events channel,
// gated only by `isAdmin` in the UI. Any participant with the anon key
// could send those same broadcasts from the browser and move everyone
// between rooms or end the breakouts. Now the client calls this route,
// the route verifies the caller is the host, a co-host, or a moderator,
// and the SERVER broadcasts the event with a `server: true` marker on
// the meeting-events channel — the only channel every room hears.
// Receivers ignore breakout events without the marker.
//
// Powers: host, co-host and moderator alike may start breakouts, end
// them, move participants between rooms, and broadcast to all rooms,
// and answer a rejoiner's state request (Phase A (6): 'breakout-state').
// (Admit stays host + co-host only — see the admit route. Ending the
// meeting, locking it, and changing room settings stay host-only.)
//
// The `from` name on a broadcast is set here from the verified
// caller's own row / session, never from the request body, so nobody
// can send a breakout message signed as the host.
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

async function broadcastToMeetingEvents(admin: any, meetingId: string, event: string, payload: any) {
  const channelName = 'meeting-events-' + meetingId;
  const ch = admin.channel(channelName, { config: { broadcast: { self: false } } });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out joining the meeting events channel.')), 8000);
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Could not join the meeting events channel (' + status + ').')); }
      });
    });
    const result = await ch.send({ type: 'broadcast', event, payload });
    if (result && result !== 'ok') throw new Error('The room did not accept the broadcast.');
  } finally {
    try { await admin.removeChannel(ch); } catch (e) { /* already gone */ }
  }
}

const BREAKOUT_EVENTS = ['start-breakout', 'end-breakout', 'move-breakout', 'breakout-broadcast', 'breakout-state', 'self-select'];

// Phase C2b (6), breakout self-select: the live session, persisted so
// a refresh lands a participant back in their room (Phase A (6)) and
// a participant's own room choice survives. Best effort: when the
// Phase C2b table is not set up yet, the broadcast still moves people
// and the in-tab snapshot still restores them.
async function saveBreakoutState(admin: any, meetingId: string, roomsCount: number, endsAt: Date, assignments: Record<string, number>) {
  try {
    await admin.from('meeting_breakout_state').upsert(
      [{ meeting_id: meetingId, rooms_count: roomsCount, ends_at: endsAt.toISOString(), assignments, updated_at: new Date().toISOString() }],
      { onConflict: 'meeting_id' },
    );
  } catch (e) { /* table not set up yet: broadcast still works */ }
}

async function clearBreakoutState(admin: any, meetingId: string) {
  try { await admin.from('meeting_breakout_state').delete().eq('meeting_id', meetingId); } catch (e) { /* ignore */ }
}

async function loadBreakoutState(admin: any, meetingId: string): Promise<{ roomsCount: number; endsAt: string; assignments: Record<string, number> } | null> {
  try {
    const { data } = await admin
      .from('meeting_breakout_state')
      .select('rooms_count, ends_at, assignments')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (!data) return null;
    return { roomsCount: (data as any).rooms_count, endsAt: (data as any).ends_at, assignments: (data as any).assignments || {} };
  } catch (e) { return null; }
}

export async function GET(req: NextRequest) {
  try {
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const participantRowId = req.nextUrl.searchParams.get('participantRowId') || undefined;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const caller = await resolveC2bCaller(admin, meetingId, { accessToken, participantRowId });
    if (!caller) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Join the meeting to see breakout rooms.' }, { status: 401 });
    }
    const state = await loadBreakoutState(admin, meetingId);
    if (!state || new Date(state.endsAt).getTime() <= Date.now()) {
      return NextResponse.json({ ok: true, active: false });
    }
    const remainingSeconds = Math.max(0, Math.floor((new Date(state.endsAt).getTime() - Date.now()) / 1000));
    return NextResponse.json({ ok: true, active: true, roomsCount: state.roomsCount, durationSeconds: remainingSeconds, assignments: state.assignments, myRoom: state.assignments[caller.key] ?? null });
  } catch (err: any) {
    console.error('[Breakout API] GET Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}

function isValidAssignments(v: any): boolean {
  // An empty object is valid: the host may start breakouts before
  // anyone else has joined, then move late joiners in.
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.every((k) => typeof k === 'string' && k.length > 0 && Number.isInteger(v[k]) && v[k] >= 1 && v[k] <= 5);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken, participantRowId, event, assignments, durationSeconds, peerKey, roomNumber, message, roomsCount } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!event || BREAKOUT_EVENTS.indexOf(event) === -1) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Unknown breakout action.' }, { status: 400 });
    }
    // Validate the payload before authorising, so a bad request never
    // reaches the room even from the host.
    if (event === 'start-breakout') {
      if (!isValidAssignments(assignments)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout assignments are invalid (rooms 1-5).' }, { status: 400 });
      }
      if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 3600) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout duration must be between 1 and 60 minutes.' }, { status: 400 });
      }
      // The room count every client's roster needs (see the start
      // receiver): optional for older clients, which never sent it.
      if (roomsCount !== undefined && (!Number.isInteger(roomsCount) || roomsCount < 1 || roomsCount > 5)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout room count must be between 1 and 5.' }, { status: 400 });
      }
    }
    if (event === 'move-breakout') {
      if (!peerKey || typeof peerKey !== 'string') {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Choose a participant to move.' }, { status: 400 });
      }
      if (roomNumber !== null && (!Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > 5)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Room must be 1-5, or the main room.' }, { status: 400 });
      }
      if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 3600)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout duration is invalid.' }, { status: 400 });
      }
    }
    if (event === 'breakout-broadcast') {
      if (!message || typeof message !== 'string' || !message.trim() || message.trim().length > 500) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Write a message of up to 500 characters to broadcast.' }, { status: 400 });
      }
    }
    // Phase A (6): the live state, answering a rejoiner's
    // breakout-state-request. Same roster shape as start-breakout,
    // but the duration is the REMAINING seconds — it can be under a
    // minute near the end of a session.
    if (event === 'breakout-state') {
      if (!isValidAssignments(assignments)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout assignments are invalid (rooms 1-5).' }, { status: 400 });
      }
      if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 3600) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout duration is invalid.' }, { status: 400 });
      }
      if (roomsCount !== undefined && (!Number.isInteger(roomsCount) || roomsCount < 1 || roomsCount > 5)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Breakout room count must be between 1 and 5.' }, { status: 400 });
      }
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }

    // Phase C2b (6), self-select: ANY admitted participant may choose
    // their own room while breakouts are live. It does not need host
    // powers, so it is authorised here, before the host/moderator
    // check below. The choice is written to the persisted state and
    // broadcast as a server-verified move, so it is respected by every
    // client and survives a refresh, and it can never strand the
    // participant: roomNumber null means back to the main room.
    if (event === 'self-select') {
      if (roomNumber !== null && (!Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > 5)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Room must be 1-5, or the main room.' }, { status: 400 });
      }
      const adminSelf = getAdminClient();
      if (!adminSelf) {
        return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
      }
      const callerSelf = await resolveC2bCaller(adminSelf, meetingId, body);
      if (!callerSelf) {
        return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Join the meeting to choose a breakout room.' }, { status: 401 });
      }
      const state = await loadBreakoutState(adminSelf, meetingId);
      if (!state || new Date(state.endsAt).getTime() <= Date.now()) {
        return NextResponse.json({ error: 'NO_BREAKOUT', message: 'Breakout rooms are not running right now.' }, { status: 409 });
      }
      if (roomNumber !== null && roomNumber > state.roomsCount) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'That room does not exist in this session.' }, { status: 400 });
      }
      const nextAssignments = { ...state.assignments };
      if (roomNumber === null) delete nextAssignments[callerSelf.key];
      else nextAssignments[callerSelf.key] = roomNumber;
      const remainingSeconds = Math.max(0, Math.floor((new Date(state.endsAt).getTime() - Date.now()) / 1000));
      await saveBreakoutState(adminSelf, meetingId, state.roomsCount, new Date(state.endsAt), nextAssignments);
      try {
        await broadcastToMeetingEvents(adminSelf, meetingId, 'move-breakout', { server: true, peerKey: callerSelf.key, roomNumber: roomNumber === undefined ? null : roomNumber, durationSeconds: remainingSeconds });
      } catch (e: any) {
        console.error('[Breakout API] Self-select broadcast failed:', e?.message || e);
        return NextResponse.json({ error: 'BROADCAST_FAILED', message: 'The rooms could not be reached. Please try again.' }, { status: 502 });
      }
      return NextResponse.json({ ok: true, event: 'self-select', roomNumber: roomNumber === undefined ? null : roomNumber });
    }

    // Caller credential: a signed-in user's session token, or a guest
    // role-holder's participant row id (the same dual credential the
    // token and control routes use). One of them is required.
    if (!accessToken && !participantRowId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the host, a co-host or a moderator can manage breakout rooms.' }, { status: 401 });
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

    // Authorise: host (by auth user id), or a co-host / moderator row.
    let isHost = false;
    let isModerator = false;
    let callerName: string | null = null;
    if (accessToken) {
      const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
      if (userError || !user) {
        return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
      }
      isHost = isCurrentHost(meeting, user.id);
      callerName = (user.user_metadata?.name as string) || (user.user_metadata?.full_name as string) || user.email || null;
      if (!isHost) {
        const { data: coRow } = await admin
          .from('meeting_participants')
          .select('id, name')
          .eq('meeting_id', meetingId)
          .eq('user_id', user.id)
          .in('role', ['CoHost', 'Moderator'])
          .eq('status', 'Admitted')
          .maybeSingle();
        isModerator = !!coRow;
        if (coRow?.name) callerName = coRow.name;
      } else {
        const { data: hrow } = await admin
          .from('meeting_participants')
          .select('name')
          .eq('meeting_id', meetingId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (hrow?.name) callerName = hrow.name;
      }
    } else {
      const { data: grow } = await admin
        .from('meeting_participants')
        .select('id, user_id, name, status, role')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      if (!grow || grow.status !== 'Admitted' || (grow.role !== 'CoHost' && grow.role !== 'Moderator')) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host, a co-host or a moderator can manage breakout rooms.' }, { status: 403 });
      }
      isModerator = true;
      isHost = isCurrentHost(meeting, grow.user_id);
      callerName = grow.name || null;
    }
    if (!isHost && !isModerator) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host, a co-host or a moderator can manage breakout rooms.' }, { status: 403 });
    }

    // Persist the live session for self-select + refresh restore.
    if (event === 'start-breakout') {
      const rooms = Number.isInteger(roomsCount) ? roomsCount : Math.max(1, ...(Object.values(assignments) as number[]));
      await saveBreakoutState(admin, meetingId, rooms, new Date(Date.now() + durationSeconds * 1000), assignments);
    } else if (event === 'end-breakout') {
      await clearBreakoutState(admin, meetingId);
    } else if (event === 'move-breakout') {
      const state = await loadBreakoutState(admin, meetingId);
      if (state) {
        const next = { ...state.assignments };
        if (roomNumber === null) delete next[peerKey];
        else next[peerKey] = roomNumber;
        await saveBreakoutState(admin, meetingId, state.roomsCount, new Date(state.endsAt), next);
      }
    }

    // Broadcast with the server marker. Receivers ignore breakout
    // events without it, so a forged client broadcast is inert.
    const payload: any = { server: true };
    if (event === 'start-breakout') {
      payload.assignments = assignments;
      payload.durationSeconds = durationSeconds;
      // Forwarded so every moderator's panel knows how many rooms
      // exist — not just the client that started them. Falls back to
      // the highest assigned room when an older client omits it.
      payload.roomsCount = Number.isInteger(roomsCount) ? roomsCount : Math.max(1, ...(Object.values(assignments) as number[]));
    } else if (event === 'move-breakout') {
      payload.peerKey = peerKey;
      payload.roomNumber = roomNumber === undefined ? null : roomNumber;
      if (typeof durationSeconds === 'number') payload.durationSeconds = durationSeconds;
    } else if (event === 'breakout-broadcast') {
      payload.message = message.trim();
      payload.from = callerName || (isHost ? 'Host' : 'Moderator');
    } else if (event === 'breakout-state') {
      // Phase A (6): the live state, answering a rejoiner's
      // breakout-state-request. Same shape as start-breakout, but the
      // duration is the REMAINING seconds and receivers apply it
      // without moving anyone who is already in place.
      payload.assignments = assignments;
      payload.durationSeconds = durationSeconds;
      payload.roomsCount = Number.isInteger(roomsCount) ? roomsCount : Math.max(1, ...(Object.values(assignments) as number[]));
    }
    try {
      await broadcastToMeetingEvents(admin, meetingId, event, payload);
    } catch (e: any) {
      console.error('[Breakout API] Broadcast failed:', e?.message || e);
      return NextResponse.json({ error: 'BROADCAST_FAILED', message: 'The rooms could not be reached. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, event });
  } catch (err: any) {
    console.error('[Breakout API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
