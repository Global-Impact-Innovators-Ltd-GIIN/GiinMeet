import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Host-only passcode fetch. Once the `passcode` column is hidden from anon
// reads (see giinmeet_passcode_lockdown.sql), the browser can no longer read
// a meeting's passcode at all — not even the host, for the invite panel and
// the dashboard Copy Link. This route is the one legitimate way back: it
// verifies the caller is the meeting's host (signed-in, server-side) and
// only then returns the passcode. Guests and non-hosts get 403.
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
    if (!meetingId || !accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'A signed-in host session is required.' }, { status: 401 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
    }
    const { data: meeting, error } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, passcode')
      .eq('id', meetingId)
      .maybeSingle();
    if (error || !meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'The meeting could not be found.' }, { status: 404 });
    }
    if (meeting.admin_id !== user.id && meeting.user_id !== user.id) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can see the passcode.' }, { status: 403 });
    }
    return NextResponse.json({ passcode: meeting.passcode || null });
  } catch (err: any) {
    console.error('[Meeting Passcode API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
