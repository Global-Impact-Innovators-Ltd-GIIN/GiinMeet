import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readJsonBody } from '../../_lib/security';
import {
  checkRateLimit,
  clearFailures,
  errorWithSecurity,
  getClientIp,
  isLockedOut,
  recordFailureAndCheckLockout,
  secretsEqual,
} from '../../_lib/security';

// Server-side passcode verification. The passcode is NEVER compared in the
// browser: the `meetings` table is publicly readable by design (passwordless
// guests), so any client-side comparison is only a UI gate. This route uses
// the service-role key (server only) to read the real passcode and compare
// it. It returns only whether the code matches, never the passcode itself.
//
// Phase C1, brute-force control: 30 attempts/min per IP, plus a lockout
// after 5 wrong codes for the same meeting from the same IP in 10 minutes
// (locked out for 15 minutes). A right code clears the failure count.
// The counters are in-memory per server instance (see security.ts): they
// blunt guessing, they are not a durable cross-instance lockout.
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
    const limited = checkRateLimit(req, 'verify-passcode', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const { meetingId, passcode } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const lockKey = `passcode-fail:${meetingId}:${getClientIp(req)}`;
    const lock = isLockedOut(lockKey);
    if (lock.locked) {
      return errorWithSecurity(
        'LOCKED_OUT',
        'Too many wrong codes, please wait a few minutes and try again.',
        429,
        { 'Retry-After': String(lock.retryAfterSeconds) },
      );
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
    // Constant-time compare, so the response time does not leak how
    // many leading characters of the code matched.
    const valid = hasPasscode && supplied !== '' && secretsEqual(supplied, String(meeting.passcode).toUpperCase());
    if (hasPasscode) {
      if (valid) {
        clearFailures(lockKey);
      } else {
        const fail = recordFailureAndCheckLockout(lockKey, 5, 10 * 60 * 1000, 15 * 60 * 1000);
        if (fail.locked) {
          return errorWithSecurity(
            'LOCKED_OUT',
            'Too many wrong codes, please wait a few minutes and try again.',
            429,
            { 'Retry-After': String(fail.retryAfterSeconds) },
          );
        }
      }
    }
    // No passcode set means the meeting is open: any caller "passes".
    return NextResponse.json({ hasPasscode, valid: !hasPasscode || valid });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Verify Passcode API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }, { status: 500 });
  }
}
