import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, readJsonBody } from '../../_lib/security';
import { isUserBlocked } from '../../_lib/phaseD';

// Round 9 (9A): reactivate a participant's existing row on rejoin,
// server-side (the admission lockdown blocks client status writes, so
// the client cannot do this itself).
//
//   - No row -> { found: false } (the client inserts a fresh row).
//   - Row 'Removed' -> 403 REMOVED. A kicked guest can never rejoin
//     unless the host re-invites them through the admit route.
//   - Row 'Admitted' -> returned as-is. Rejoin without re-admission.
//   - Row 'Left' / 'Waiting' / 'Declined' -> set to the requested
//     status, BUT 'Admitted' is only granted when the meeting bypasses
//     the waiting room, the caller is the host, or the caller proves
//     they were actually in the room before: a LEFT LiveKit allocation
//     row for their identity. A waiting guest who only closed the tab
//     has no allocation row, so they go back to 'Waiting' — the
//     waitroom cannot be skipped by leaving and coming back.
//
// The caller proves ownership with their participant row id (a random
// UUID only they hold) or a signed-in session token. A client-supplied
// userId is never trusted on its own.

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isCurrentHost(meeting: { admin_id?: string | null; user_id?: string | null } | null, userId: string) {
  if (!meeting) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
}

export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'meetings-rejoin', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const { meetingId, participantRowId, accessToken, name, role, status } = body;
    // Phase C2b (11), organisation badge text for guests (and for
    // signed-in users whose profile has none). Saved best-effort: a
    // missing column must never break a rejoin.
    const organisation = typeof body.organisation === 'string' ? body.organisation.trim().slice(0, 80) : '';
    const saveOrganisation = async (rowId: string) => {
      if (!organisation) return;
      try {
        await admin.from('meeting_participants').update({ organisation }).eq('id', rowId);
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    } /* column not set up yet: badge stays blank */ }
    };
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }

    // Find the caller's existing row.
    let row: { id: string; name: string; status: string; user_id: string | null; role: string } | null = null;
    let verifiedUserId: string | null = null;
    if (participantRowId && typeof participantRowId === 'string') {
      const { data } = await admin
        .from('meeting_participants')
        .select('id, name, status, user_id, role')
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
      verifiedUserId = user.id;
      const { data } = await admin
        .from('meeting_participants')
        .select('id, name, status, user_id, role')
        .eq('meeting_id', meetingId)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .maybeSingle();
      row = data as any;
    }
    if (!row) return NextResponse.json({ found: false });
    // Phase D (39): a blocked user cannot reactivate an old row by
    // rejoining. The meeting host is the blocker; guests (no account)
    // are covered by the Removed / admit checks instead.
    if (verifiedUserId) {
      const { data: hostMeeting } = await admin
        .from('meetings')
        .select('admin_id, user_id')
        .eq('id', meetingId)
        .maybeSingle();
      if (hostMeeting) {
        const { data: callerProfile } = await admin
          .from('profiles')
          .select('email')
          .eq('id', verifiedUserId)
          .maybeSingle();
        if (await isUserBlocked(admin, (hostMeeting as any).admin_id || (hostMeeting as any).user_id, verifiedUserId, (callerProfile as any)?.email || null)) {
          return NextResponse.json({ error: 'BLOCKED', message: 'The host has blocked you from this meeting.' }, { status: 403 });
        }
      }
    }
    if (row.status === 'Removed') {
      return NextResponse.json({ error: 'REMOVED', message: 'You were removed from this meeting by the host.' }, { status: 403 });
    }

    const requested = (status === 'Admitted' || status === 'Waiting' || status === 'Declined')
      ? status
      : (role === 'Admin' ? 'Admitted' : 'Waiting');

    // Already admitted: rejoin as-is (a name change is still saved).
    if (row.status === 'Admitted') {
      if (name && typeof name === 'string' && name !== row.name) {
        await admin.from('meeting_participants').update({ name, updated_at: new Date().toISOString() }).eq('id', row.id);
        row = { ...row, name };
      }
      await saveOrganisation(row.id);
      return NextResponse.json({ found: true, row });
    }

    // Decide what the reactivation may grant.
    let granted: string = requested;
    if (requested === 'Admitted') {
      const { data: meeting } = await admin
        .from('meetings')
        .select('id, admin_id, user_id, require_waiting_room, status')
        .eq('id', meetingId)
        .maybeSingle();
      if (!meeting || meeting.status === 'Completed') {
        return NextResponse.json({ error: 'MEETING_ENDED', message: 'This meeting has ended.' }, { status: 403 });
      }
      const bypass = meeting.require_waiting_room === false;
      const callerIsHost = !!(verifiedUserId && isCurrentHost(meeting, verifiedUserId));
      let wasInRoom = false;
      if (!bypass && !callerIsHost && row.status === 'Left') {
        // Proof of prior admission: a LEFT LiveKit allocation row for
        // this identity means they were connected to the media room.
        const identity = verifiedUserId || row.id;
        const slug = `meet-${meetingId}`;
        const { data: rooms } = await admin.from('rooms').select('id').eq('slug', slug);
        const roomId = (rooms || [])[0]?.id;
        if (roomId) {
          const { data: alloc } = await admin
            .from('participants')
            .select('id')
            .eq('room_id', roomId)
            .eq('user_id', identity)
            .eq('status', 'LEFT')
            .maybeSingle();
          wasInRoom = !!alloc;
        }
      }
      if (!bypass && !callerIsHost && !wasInRoom) granted = 'Waiting';
    }

    const { data: updated, error: updateError } = await admin
      .from('meeting_participants')
      .update({ status: granted, name: (name && typeof name === 'string') ? name : row.name, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('id, name, status, user_id, role')
      .maybeSingle();
    if (updateError) {
      console.error('[Rejoin API] Failed to reactivate participant row:', updateError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not rejoin the meeting.' }, { status: 500 });
    }
    if (updated) await saveOrganisation(updated.id);
    return NextResponse.json({ found: true, row: updated });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Rejoin API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }, { status: 500 });
  }
}
