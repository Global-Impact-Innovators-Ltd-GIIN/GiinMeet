import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Grant or revoke a meeting role, server-side. (Phase 3, Feature 2.)
//
// WHY THIS ROUTE EXISTS: granting a role used to be a direct
// client-side update (giinApi.setParticipantRole wrote
// meeting_participants.role with the anon key). The admission-lockdown
// SQL deliberately kept `UPDATE (role, updated_at)` granted to anon /
// authenticated so that call kept working — which meant ANYONE with
// the anon key could grant THEMSELVES the CoHost role on any meeting
// and then admit people and mute participants through the
// host-verified admit/control routes (those routes trust the row).
// Now the host calls this route, the route verifies them, and the
// service-role client writes the row. The matching SQL file
// (giinmeet_cohost_moderator_roles.sql) revokes the client-side role
// grant, closing the bypass for good.
//
// Rules, all verified here:
//   - Only the CURRENT host can grant or revoke a role, and only while
//     signed in (a session token is required — the same rule as
//     transfer-host; a guest host holds no auth identity).
//   - Only 'CoHost', 'Moderator' and 'Participant' (revoke) can be set.
//     The host's own 'Admin' row is never touched, and a role is never
//     granted to the host themself.
//   - The target must be a participant of THIS meeting who is currently
//     Admitted. Someone still in the waiting room must be admitted
//     first; a Removed row stays removed.
//   - Until giinmeet_cohost_moderator_roles.sql has run, the role CHECK
//     only allows ('Admin', 'Participant') — and the Round 9 statuses
//     SQL widened it to include 'CoHost' — so a 'Moderator' grant fails
//     at the database until that file runs. The route says so plainly
//     (ROLE_NOT_SET_UP) instead of failing silently.
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

const GRANTABLE_ROLES = ['CoHost', 'Moderator', 'Participant'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, participantRowId, role, accessToken } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!participantRowId || typeof participantRowId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Choose a participant to change the role of.' }, { status: 400 });
    }
    if (!role || GRANTABLE_ROLES.indexOf(role) === -1) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Role must be CoHost, Moderator or Participant.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the signed-in meeting host can change roles.' }, { status: 401 });
    }
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
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
    if (!isCurrentHost(meeting, user.id)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can change roles.' }, { status: 403 });
    }
    const { data: target } = await admin
      .from('meeting_participants')
      .select('id, user_id, name, status, role')
      .eq('id', participantRowId)
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'That participant is not in this meeting.' }, { status: 404 });
    }
    if (target.role === 'Admin' || (target.user_id && isCurrentHost(meeting, target.user_id))) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'The host already holds the host role — it cannot be changed here.' }, { status: 400 });
    }
    if (target.status !== 'Admitted') {
      return NextResponse.json({ error: 'NOT_ADMITTED', message: 'Only a participant who is currently in the meeting can be given a role. Admit them first.' }, { status: 400 });
    }
    if (target.role === role) {
      return NextResponse.json({ ok: true, role, unchanged: true });
    }
    const { error: updateError } = await admin
      .from('meeting_participants')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', participantRowId)
      .eq('meeting_id', meetingId);
    if (updateError) {
      const msg = String((updateError as any)?.message || updateError);
      if (/role/i.test(msg) && /check|constraint|violates/i.test(msg)) {
        return NextResponse.json({ error: 'ROLE_NOT_SET_UP', message: 'Roles are not set up yet — run giinmeet_cohost_moderator_roles.sql in the Supabase SQL Editor once, then try again.' }, { status: 500 });
      }
      console.error('[Role API] Failed to set participant role:', updateError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not change the role.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, role });
  } catch (err: any) {
    console.error('[Role API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
