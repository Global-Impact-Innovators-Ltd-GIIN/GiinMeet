import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RoomServiceClient } from 'livekit-server-sdk';
import { checkRateLimit, isUuid, readJsonBody } from '../../_lib/security';

// Room controls, host-verified server-side. (Fix Round 7, findings
// #1 + #3: every participant used to broadcast mute/kick/settings to
// the room with no sender check, and guests never even received those
// broadcasts — the sig-webrtc channel was passcode-gated and
// loadDetails sets passcode='' for every non-host. Now the client
// calls this route, the route verifies the caller is the host (or a
// co-host / moderator, for moderation actions), and the SERVER
// broadcasts the event with a `server: true` marker. Receivers ignore
// these events without the marker, so a participant can no longer
// mute, kick, or reconfigure anyone from the browser.)
//
// Phase 3 (Feature 2) — role split, all verified here:
//   - mute-all, mute-participant, disable-video-all, remove-participant:
//     host, co-host, or moderator. (Remove used to be host-only; it is
//     an in-meeting moderation power, so moderators and co-hosts get
//     it — BUT a co-host / moderator can never remove the host or
//     another role-holder; only the host can remove a co-host or a
//     moderator. See the guard in the remove block below.)
//   - settings-update: host only. Ending the meeting, locking it, and
//     transferring the host role stay host-only too (their own routes).
//   - Admit from the waiting room is NOT here: it is the admit route,
//     host + co-host only. A moderator cannot admit people.
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
    try { await admin.removeChannel(ch); } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    } /* already gone */ }
  }
}

const MODERATOR_ACTIONS = ['mute-all', 'mute-participant', 'disable-video-all', 'remove-participant'];
const HOST_ONLY_ACTIONS = ['settings-update'];

export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'meetings-control', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
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
    // co-host's / moderator's participant row id (the same dual
    // credential the token route uses). One of them is required.
    if (!accessToken && !participantRowId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the host, a co-host or a moderator can control the room.' }, { status: 401 });
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
    // A guest role-holder proves it with their participant row id.
    // isModerator covers BOTH granted roles: 'CoHost' and 'Moderator'.
    let isHost = false;
    let isModerator = false;
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
          .in('role', ['CoHost', 'Moderator'])
          .eq('status', 'Admitted')
          .maybeSingle();
        isModerator = !!coRow;
      }
    } else {
      const { data: grow } = await admin
        .from('meeting_participants')
        .select('id, user_id, status, role')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      if (!grow || grow.status !== 'Admitted' || (grow.role !== 'CoHost' && grow.role !== 'Moderator')) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host, a co-host or a moderator can control the room.' }, { status: 403 });
      }
      isModerator = true;
      isHost = isCurrentHost(meeting, grow.user_id);
    }

    const hostOnly = HOST_ONLY_ACTIONS.indexOf(action) !== -1;
    if (hostOnly && !isHost) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can do that.' }, { status: 403 });
    }
    if (!isHost && !isModerator) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host, a co-host or a moderator can control the room.' }, { status: 403 });
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
      // Security audit: the key below is interpolated into a PostgREST
      // .or() filter string. A non-UUID value could inject extra
      // filters (commas separate filters), widening the remove to
      // every participant in the meeting. Both key forms are UUIDs.
      if (!isUuid(key)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: 'Choose a participant to remove.' }, { status: 400 });
      }
      // Phase 3 (Feature 2): a co-host / moderator may remove ordinary
      // participants, but never the host and never another role-holder.
      // Only the host can remove a co-host or a moderator (and only the
      // host can remove the host — nobody else). Without this, two
      // moderators could remove each other, and a moderator could
      // remove the host who granted them the role.
      if (!isHost) {
        const hostUserId = meeting.admin_id || meeting.user_id;
        if (targetUserId && hostUserId && targetUserId === hostUserId) {
          return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host can remove the host.' }, { status: 403 });
        }
        const { data: targetRow } = await admin
          .from('meeting_participants')
          .select('id, user_id, role')
          .eq('meeting_id', meetingId)
          .or('id.eq.' + key + ',user_id.eq.' + key)
          .maybeSingle();
        if (targetRow && targetRow.user_id && hostUserId && targetRow.user_id === hostUserId) {
          return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host can remove the host.' }, { status: 403 });
        }
        if (targetRow && (targetRow.role === 'CoHost' || targetRow.role === 'Moderator')) {
          return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host can remove a co-host or a moderator.' }, { status: 403 });
        }
      }
      // Round 9 (9A): a removed participant keeps their row with status
      // 'Removed' — it is the marker that blocks rejoin (the token route
      // refuses non-Admitted rows, and the waitroom shows "You were
      // removed"). The status value needs giinmeet_round9_statuses.sql;
      // until it runs, the CHECK constraint rejects the update and the
      // route falls back to the old delete (the room still works, but a
      // removed guest could rejoin with the link until the SQL runs).
      const { data: removed, error: removeError } = await admin
        .from('meeting_participants')
        .update({ status: 'Removed', updated_at: new Date().toISOString() })
        .eq('meeting_id', meetingId)
        .or('id.eq.' + key + ',user_id.eq.' + key)
        .select('id');
      if (removeError) {
        const { data: deleted, error: deleteError } = await admin
          .from('meeting_participants')
          .delete()
          .eq('meeting_id', meetingId)
          .or('id.eq.' + key + ',user_id.eq.' + key)
          .select('id');
        if (deleteError) {
          console.error('[Control API] Failed to remove participant row:', deleteError);
          return NextResponse.json({ error: 'DB_ERROR', message: 'Could not remove the participant from the meeting.' }, { status: 500 });
        }
        rowDeleted = (deleted || []).length > 0;
      } else {
        rowDeleted = (removed || []).length > 0;
      }
    }

    // Phase A (4): also remove the kicked participant from the LiveKit
    // room itself, so their media stops at the server even if their
    // client is dead or misses the broadcast — a kicked guest used to
    // linger in the room until their own client reacted. Best-effort
    // only: the row removal above + the broadcast are what eject them,
    // and a LiveKit failure here never fails the kick. They may be in
    // a breakout room, so try the main room and each breakout room,
    // and both identity forms (user id for signed-in users, row id
    // for guests — the LiveKit identity is one or the other).
    if (action === 'remove-participant' && rowDeleted) {
      try {
        const lkUrl = process.env.LIVEKIT_URL;
        const lkKey = process.env.LIVEKIT_API_KEY;
        const lkSecret = process.env.LIVEKIT_API_SECRET;
        if (lkUrl && lkKey && lkSecret) {
          const { data: roomRow } = await admin.from('rooms').select('slug').eq('slug', 'meet-' + meetingId).eq('is_active', true).maybeSingle();
          const mainSlug = (roomRow as any)?.slug || ('meet-' + meetingId);
          const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
          const identities = Array.from(new Set([targetUserId, targetRowId].filter(Boolean))) as string[];
          const roomSlugs = [mainSlug, 1, 2, 3, 4, 5].map(n => typeof n === 'number' ? `${mainSlug}-breakout-${n}` : n);
          for (const slug of roomSlugs) {
            for (const identity of identities) {
              try { await roomService.removeParticipant(slug, identity); } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    } /* not in this room: try the next */ }
            }
          }
        }
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    } /* LiveKit removal is best-effort: the kick already stands */ }
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
      // Security audit: client settings must never override the
      // server marker or retarget the broadcast at someone else.
      const { server: _s, targetUserId: _tu, targetRowId: _tr, ...safeSettings } = settings as Record<string, unknown>;
      void _s; void _tu; void _tr;
      Object.assign(payload, safeSettings);
    }
    try {
      await broadcastToRoom(admin, meetingId, action, payload);
    } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
      console.error('[Control API] Broadcast failed:', e?.message || e);
      return NextResponse.json({ error: 'BROADCAST_FAILED', message: 'The room could not be reached. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, action, rowDeleted });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Control API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }, { status: 500 });
  }
}
