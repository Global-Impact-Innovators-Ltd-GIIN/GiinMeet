import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { tierLimitForPremium, tierForPremium, TIER_LABELS } from '../../../../src/utils/tiers';

// Admit or decline a waiting-room participant, server-side. (Fix
// Round 7, finding #4: admission used to be a direct client-side row
// update under a public UPDATE policy, so anyone could flip their own
// row to Admitted with the anon key and walk in. Now the host (or a
// co-host) calls this route, the route verifies them, flips the row
// with the service-role key, and broadcasts the decision with a
// `server: true` marker. The public UPDATE policy on
// meeting_participants.status is restricted separately — see
// giinmeet_admission_lockdown.sql, which Suku runs in the Supabase
// SQL Editor. Until that SQL runs, this route is still the only writer
// the app uses; after it runs, the bypass is closed for good.)
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken, participantRowId, participantId, status, settings } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!participantId || typeof participantId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Choose a participant to admit or decline.' }, { status: 400 });
    }
    if (status !== 'Admitted' && status !== 'Declined') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Status must be Admitted or Declined.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    if (!accessToken && !participantRowId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the host or a co-host can admit people.' }, { status: 401 });
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
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host or a co-host can admit people.' }, { status: 403 });
      }
      isCoHost = true;
      isHost = isCurrentHost(meeting, grow.user_id);
    }
    if (!isHost && !isCoHost) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host or a co-host can admit people.' }, { status: 403 });
    }

    // Round 3: participant limit by host tier, checked at admit time.
    // The token route is the exact final gate (live LiveKit count);
    // this is the early, human-readable one, so the host is not
    // offered an admit that can never join. Count Admitted rows; the
    // host occupies one seat on top. (Edge: if the host also holds an
    // Admitted row, this blocks one seat early — the token route's
    // live count stays the exact arbiter.)
    if (status === 'Admitted') {
      const hostUserId = meeting.admin_id || meeting.user_id;
      let hostIsPremium = false;
      if (hostUserId) {
        try {
          const { data: hostProfile } = await admin
            .from('profiles')
            .select('is_premium')
            .eq('id', hostUserId)
            .maybeSingle();
          hostIsPremium = !!(hostProfile as any)?.is_premium;
        } catch (e) { /* profile unreadable: Free tier */ }
      }
      const hostTier = tierForPremium(hostIsPremium);
      const maxCapacity = tierLimitForPremium(hostIsPremium);
      const { count: admittedCount } = await admin
        .from('meeting_participants')
        .select('*', { count: 'exact', head: true })
        .eq('meeting_id', meetingId)
        .eq('status', 'Admitted');
      const seatsTaken = (admittedCount ?? 0) + 1;
      if (seatsTaken >= maxCapacity) {
        return NextResponse.json({
          error: 'MAX_CAPACITY_REACHED',
          message: `This meeting is full for the host's ${TIER_LABELS[hostTier]} plan. Maximum capacity is ${maxCapacity} participants.`,
          maxCapacity,
          tier: hostTier,
        }, { status: 403 });
      }
    }

    // Flip the row with the service-role key.
    const { data: updated, error: updateError } = await admin
      .from('meeting_participants')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', participantId)
      .eq('meeting_id', meetingId)
      .select('id');
    if (updateError) {
      console.error('[Admit API] Failed to update participant status:', updateError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not update the participant.' }, { status: 500 });
    }
    const rowUpdated = (updated || []).length > 0;

    // Broadcast the decision with the server marker, plus the room's
    // current settings so the new participant syncs immediately. The
    // database row is the source of truth — if the broadcast fails,
    // the guest still sees the decision on their next poll.
    try {
      await broadcastToRoom(admin, meetingId, 'waitroom-response', { server: true, targetKey: participantId, status });
      if (settings && typeof settings === 'object') {
        await broadcastToRoom(admin, meetingId, 'settings-update', { server: true, ...settings });
      }
    } catch (e: any) {
      console.error('[Admit API] Broadcast failed after the row was updated:', e?.message || e);
      return NextResponse.json({ error: 'BROADCAST_FAILED', message: 'The guest was ' + (status === 'Admitted' ? 'admitted' : 'declined') + ', but the instant notification could not be sent — they will see it on the next check (a few seconds).' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, status, rowUpdated });
  } catch (err: any) {
    console.error('[Admit API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
