import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Persist the meeting lock on the meeting row, host-only. (Fix Round
// 7, finding #6: the lock used to be client-only state synced by
// broadcast, so auto-admit and the token route never saw it. Now the
// host sets meetings.is_locked here, the waiting room checks it before
// auto-admitting, and the token route refuses new mints while it is
// set. The column is added by giinmeet_meeting_lock.sql, which Suku
// runs once in the Supabase SQL Editor — until then this route answers
// 500 and says so plainly, and the app treats the meeting as unlocked.)
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken, locked } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (typeof locked !== 'boolean') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'locked must be true or false.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the meeting host can lock the meeting.' }, { status: 401 });
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
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can lock the meeting.' }, { status: 403 });
    }
    const { error: updateError } = await admin
      .from('meetings')
      .update({ is_locked: locked })
      .eq('id', meetingId);
    if (updateError) {
      const msg = String((updateError as any)?.message || updateError);
      if (/is_locked/i.test(msg)) {
        return NextResponse.json({ error: 'LOCK_NOT_SET_UP', message: 'The meeting lock is not set up yet — run giinmeet_meeting_lock.sql in the Supabase SQL Editor once, then try again.' }, { status: 500 });
      }
      console.error('[Lock API] Failed to set meeting lock:', updateError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not change the meeting lock.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, locked });
  } catch (err: any) {
    console.error('[Lock API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
