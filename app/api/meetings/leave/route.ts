import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RoomServiceClient } from 'livekit-server-sdk';

// Round 9 (9A/9B): a participant leaving a meeting, server-side.
//   1. Their meeting_participants row becomes 'Left' — it PERSISTS,
//      so a rejoin reactivates the same row instead of inserting a
//      duplicate, and a kicked guest's 'Removed' row is never touched
//      here. Until giinmeet_round9_statuses.sql runs, the CHECK
//      constraint rejects 'Left' and the route falls back to deleting
//      the row (the old behaviour — rejoin then needs re-admission).
//   2. If the meeting is 'In Progress' and nobody Admitted remains,
//      the meeting is completed (status Completed, room deactivated,
//      capacity slots freed, LiveKit room deleted, waiting rows
//      declined) — the same end the host's end-for-all performs. This
//      is what stops "In Progress" rows going stale when the last
//      person just closes the tab.
// The caller proves ownership with EITHER their participant row id
// (a random UUID only they hold, saved in localStorage when they
// joined) OR a signed-in session token. Either is enough; neither
// lets anyone touch another person's row. The last-person completion
// check only ever fires when zero Admitted rows remain, so it cannot
// end a meeting anyone is still in.

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
    const { meetingId, participantRowId, accessToken } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!participantRowId && !accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'A participant row or a session is required to leave.' }, { status: 401 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }

    // Identify the leaver's own row (never anyone else's).
    let row: { id: string; status: string; user_id: string | null } | null = null;
    if (participantRowId && typeof participantRowId === 'string') {
      const { data } = await admin
        .from('meeting_participants')
        .select('id, status, user_id')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      row = data as any;
    }
    if (!row && accessToken) {
      const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
      if (userError || !user) {
        return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
      }
      const { data } = await admin
        .from('meeting_participants')
        .select('id, status, user_id')
        .eq('meeting_id', meetingId)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .maybeSingle();
      row = data as any;
    }

    if (row && row.status !== 'Removed' && row.status !== 'Declined') {
      const { error: leftError } = await admin
        .from('meeting_participants')
        .update({ status: 'Left', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (leftError) {
        // CHECK constraint (statuses SQL not run yet): fall back to delete.
        await admin.from('meeting_participants').delete().eq('id', row.id);
      }
    }

    // Last-person check: only for a meeting that is actually running.
    let meetingCompleted = false;
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, status')
      .eq('id', meetingId)
      .maybeSingle();
    if (meeting && meeting.status === 'In Progress') {
      const { data: remaining } = await admin
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('status', 'Admitted');
      if ((remaining || []).length === 0) {
        await admin.from('meetings').update({ status: 'Completed' }).eq('id', meetingId);
        const slug = `meet-${meetingId}`;
        const { data: rooms } = await admin.from('rooms').select('id').eq('slug', slug);
        const roomIds = (rooms || []).map((r: any) => r.id);
        if (roomIds.length > 0) {
          await admin.from('rooms').update({ is_active: false }).in('id', roomIds);
          await admin.from('participants').update({ status: 'LEFT' }).in('room_id', roomIds).eq('status', 'JOINED');
        }
        await admin.from('meeting_participants').update({ status: 'Declined' }).eq('meeting_id', meetingId).eq('status', 'Waiting');
        const lkUrl = process.env.LIVEKIT_URL;
        const lkKey = process.env.LIVEKIT_API_KEY;
        const lkSecret = process.env.LIVEKIT_API_SECRET;
        if (lkUrl && lkKey && lkSecret) {
          try {
            const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
            await roomService.deleteRoom(slug);
          } catch (e) {
            // The database state above is the source of truth; a room
            // that is already gone counts as deleted.
          }
        }
        meetingCompleted = true;
      }
    }

    return NextResponse.json({ ok: true, meetingCompleted });
  } catch (err: any) {
    console.error('[Leave API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
