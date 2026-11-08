import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Transfer the host role to another participant, server-side, for real.
// (Fix Round 6 / Phase 6: the old transfer was a direct client-side
// update of meetings.admin_id whose error was never checked, broadcast
// BEFORE the write, and it could hand the host role to a guest — whose
// user_id is NULL, so the "new host" was a row id no auth user could
// ever match. The meeting was left hostless while everyone believed
// the transfer had worked.)
//
// Rules, all verified here:
//   - Only the CURRENT host can transfer (admin_id moves; the creator
//     user_id only counts when admin_id was never set).
//   - The new host must be a signed-in participant who is currently
//     Admitted to this meeting (a meeting_participants row with a real
//     user_id). Guests who joined without signing in cannot become host:
//     they hold no auth identity, so they could never mint a HOST token
//     or call a host-only route.
//   - The move is a single database update of meetings.admin_id. The
//     token route derives HOST from admin_id, so the new host's next
//     token mint (and the in-room watcher) picks the role up, and the
//     old host stops being host immediately — user_id (creator) alone
//     no longer grants host powers once admin_id is set.
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
    const body = await req.json().catch(() => ({}));
    const { meetingId, newHostUserId, accessToken } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!newHostUserId || typeof newHostUserId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Choose a participant to make the new host.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the meeting host can transfer the host role.' }, { status: 401 });
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
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can transfer the host role.' }, { status: 403 });
    }
    if (newHostUserId === user.id) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'You are already the host of this meeting.' }, { status: 400 });
    }

    // The new host must be a signed-in participant currently in the
    // meeting. Guests have user_id NULL, so no row with a real user_id
    // can ever match them — the check below rejects them by construction.
    const { data: newHostRow } = await admin
      .from('meeting_participants')
      .select('id, user_id, name, status')
      .eq('meeting_id', meetingId)
      .eq('user_id', newHostUserId)
      .maybeSingle();
    if (!newHostRow || newHostRow.status !== 'Admitted') {
      return NextResponse.json(
        { error: 'NEW_HOST_NOT_ADMITTED', message: 'The new host must be a signed-in participant who is currently in the meeting. Guests who joined without signing in cannot become host.' },
        { status: 400 }
      );
    }

    const { error: updateError } = await admin
      .from('meetings')
      .update({ admin_id: newHostUserId })
      .eq('id', meetingId);
    if (updateError) {
      console.error('[Transfer Host API] Failed to move admin_id:', updateError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not transfer the host role.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, newAdminId: newHostUserId, newHostName: newHostRow.name || null });
  } catch (err: any) {
    console.error('[Transfer Host API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
