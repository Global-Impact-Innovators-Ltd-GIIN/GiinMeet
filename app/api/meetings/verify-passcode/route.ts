import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Server-side passcode verification. The passcode is NEVER compared in the
// browser: the `meetings` table is publicly readable by design (passwordless
// guests), so any client-side comparison is only a UI gate. This route uses
// the service-role key (server only) to read the real passcode and compare
// it. It returns only whether the code matches — never the passcode itself.
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
    const { meetingId, passcode } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const { data: meeting, error } = await admin
      .from('meetings')
      .select('id, passcode')
      .eq('id', meetingId)
      .maybeSingle();
    if (error || !meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'The meeting could not be found.' }, { status: 404 });
    }
    const hasPasscode = !!meeting.passcode;
    const supplied = typeof passcode === 'string' ? passcode.trim().toUpperCase() : '';
    const valid = hasPasscode && supplied !== '' && supplied === String(meeting.passcode).toUpperCase();
    // No passcode set means the meeting is open: any caller "passes".
    return NextResponse.json({ hasPasscode, valid: !hasPasscode || valid });
  } catch (err: any) {
    console.error('[Verify Passcode API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected server error occurred.' }, { status: 500 });
  }
}
