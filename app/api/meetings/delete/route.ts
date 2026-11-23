import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// Delete a meeting from Meeting Logs & History (soft delete, owner
// only). The history row disappears; NOTHING else is destroyed.
//
// WHY THIS ROUTE EXISTS: the meetings table has a client-side UPDATE
// policy (owners can change their own rows, e.g. cancel via status),
// but a deletion must be a single verified act — owner-checked,
// scope-checked, and recorded — so it goes through this route with
// the service-role client instead of a direct client update.
//   - The route marks the row deleted_at/deleted_by (hidden from the
//     history queries, which read deleted_at best-effort).
//   - It writes one row to meeting_deletions, the audit trail a
//     future super-admin audit viewer will read. The audit row has
//     no foreign key to meetings, so it survives any later hard
//     delete of the meeting row.
//   - The matching SQL file (giinmeet_delete_history.sql) drops the
//     old client-side DELETE policy on meetings, so a hard delete can
//     no longer bypass the audit trail.
//
// Rules, all verified here:
//   - Only the meeting OWNER (user_id, or admin_id where set) can
//     delete, and only while signed in (a session token is required).
//   - Only Completed meetings, or Scheduled meetings whose start
//     time has passed ("expired"), can be deleted. In Progress and
//     upcoming Scheduled meetings are refused — an upcoming meeting
//     is cancelled, not deleted. Whether delete should also cover
//     scheduled/upcoming entries is a separate decision; this rule
//     is one line, so extending it later is trivial.
//   - Deleting is idempotent: a meeting that is already deleted
//     answers ok with alreadyDeleted instead of an error.
//   - Until giinmeet_delete_history.sql has run, the deleted_at /
//     deleted_by columns do not exist, so the update fails at the
//     database — the route says so plainly (DELETE_NOT_SET_UP)
//     instead of failing silently.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isCurrentOwner(meeting: { admin_id?: string | null; user_id?: string | null } | null, userId: string | null | undefined) {
  if (!meeting || !userId) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
}

// The delete scope: Completed, or a Scheduled meeting whose start
// time has already passed (expired). Anything else — In Progress, or
// a Scheduled meeting still in the future — is refused here.
function isDeletable(meeting: { status?: string | null; time?: string | null }) {
  if (meeting.status === 'Completed') return true;
  if (meeting.status !== 'Scheduled') return false;
  if (!meeting.time) return false;
  return new Date(meeting.time).getTime() < Date.now();
}

export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'meetings-delete', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const { meetingId, accessToken } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the signed-in meeting owner can delete from history.' }, { status: 401 });
    }
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, status, time, title')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'This meeting could not be found.' }, { status: 404 });
    }
    if (!isCurrentOwner(meeting, user.id)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting owner can delete it from history.' }, { status: 403 });
    }
    if (!isDeletable(meeting)) {
      return NextResponse.json({ error: 'NOT_DELETABLE', message: 'Only completed meetings and expired scheduled meetings can be deleted from history. Cancel an upcoming meeting instead.' }, { status: 403 });
    }
    // Already deleted? Best-effort read — the column only exists once
    // giinmeet_delete_history.sql has run, so a missing column means
    // "not deleted", never a failure.
    try {
      const { data: delRow } = await admin
        .from('meetings')
        .select('deleted_at')
        .eq('id', meetingId)
        .maybeSingle();
      if ((delRow as any)?.deleted_at) {
        return NextResponse.json({ ok: true, alreadyDeleted: true });
      }
    } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    } /* deleted_at column not set up yet: not deleted */ }
    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from('meetings')
      .update({ deleted_at: now, deleted_by: user.id })
      .eq('id', meetingId);
    if (updateError) {
      const msg = String((updateError as any)?.message || updateError);
      if (/deleted_at/i.test(msg) && /column|does not exist/i.test(msg)) {
        return NextResponse.json({ error: 'DELETE_NOT_SET_UP', message: 'Deleting from history is not set up yet — run giinmeet_delete_history.sql in the Supabase SQL Editor once, then try again.' }, { status: 500 });
      }
      console.error('[Delete API] Failed to mark meeting deleted:', updateError);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not delete the meeting from history.' }, { status: 500 });
    }
    // Audit row. Best-effort: the meeting is already deleted and
    // hidden; a missing audit table must not turn that into a
    // failure for the owner, so a failure here is only logged.
    try {
      const { error: auditError } = await admin.from('meeting_deletions').insert({
        meeting_id: meetingId,
        meeting_title: (meeting as any).title || null,
        meeting_time: (meeting as any).time || null,
        deleted_by: user.id,
        deleted_at: now,
      });
      if (auditError) console.error('[Delete API] Audit row not written:', auditError);
    } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
      console.error('[Delete API] Audit row not written:', e);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Delete API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' }, { status: 500 });
  }
}
