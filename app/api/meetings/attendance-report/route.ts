import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Phase 1 — attendance auto-report. Called once by the host's browser
// when a meeting ends for everyone (fire-and-forget — the end never
// waits for it and never fails because of it). The route:
//   1. Verifies the caller is the meeting's host (signed-in, server-side,
//      same check as /api/meetings/end).
//   2. Stores one meeting_attendance row per participant (upsert on
//      meeting_id + participant_key, so a double end never duplicates).
//   3. Flags late joiners: anyone who joined more than 5 minutes after
//      the FIRST person joined (the meeting's actual start — fairer than
//      the scheduled time when the host started late).
//   4. Queues ONE attendance_report email to the host (unique index on
//      (meeting_id, type) prevents a second end from queueing a second
//      copy). The email itself is sent by the /api/cron/due-emails runner,
//      so it only goes out once the Resend API key is configured — until
//      then the row
//      waits as awaiting_provider and the report stays in the dashboard.
// Needs giinmeet_phase1.sql (meeting_attendance + pending_emails);
// without it the route answers honestly instead of pretending to work.
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

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

function formatTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '—';
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken, rows } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the meeting host can request the attendance report.' }, { status: 401 });
    }
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id,title,time,admin_id,user_id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting || !isCurrentHost(meeting, user.id)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can request the attendance report.' }, { status: 403 });
    }

    const cleanRows: { key: string; name: string; joinedAt: number; leftAt: number | null }[] = Array.isArray(rows)
      ? rows
          .filter((r: any) => r && typeof r.key === 'string' && typeof r.joinedAt === 'number')
          .map((r: any) => ({ key: r.key, name: String(r.name || 'Guest'), joinedAt: r.joinedAt, leftAt: typeof r.leftAt === 'number' ? r.leftAt : null }))
      : [];
    if (cleanRows.length === 0) {
      return NextResponse.json({ ok: true, queued: false, reason: 'NO_ATTENDANCE', message: 'Nobody was recorded in attendance, so there is no report to send.' });
    }

    // Late = joined more than 5 minutes after the first person joined.
    const earliest = Math.min(...cleanRows.map((r) => r.joinedAt));
    const lateAfter = earliest + 5 * 60 * 1000;
    const endedAt = Date.now();
    const withLate = cleanRows.map((r) => ({
      ...r,
      isLate: r.joinedAt > lateAfter,
      stayedMs: (r.leftAt || endedAt) - r.joinedAt,
    }));

    // Store the rows (upsert — a second end for the same meeting updates
    // the same rows instead of duplicating them).
    const { error: storeError } = await admin.from('meeting_attendance').upsert(
      withLate.map((r) => ({
        meeting_id: meetingId,
        participant_key: r.key,
        name: r.name,
        joined_at: new Date(r.joinedAt).toISOString(),
        left_at: r.leftAt ? new Date(r.leftAt).toISOString() : null,
        is_late: r.isLate,
      })),
      { onConflict: 'meeting_id,participant_key' },
    );
    if (storeError) {
      return NextResponse.json({ ok: false, error: 'ATTENDANCE_TABLES_NOT_CONFIGURED', message: 'The attendance report is not set up yet — run giinmeet_phase1.sql in the Supabase SQL Editor first.' });
    }

    // Queue the email to the host (one per meeting — the unique index
    // drops a second queue attempt for the same meeting).
    let hostEmail: string | null = null;
    let hostName = 'Host';
    try {
      const { data: prof } = await admin.from('profiles').select('name,email').eq('id', user.id).maybeSingle();
      hostEmail = (prof as any)?.email || null;
      if ((prof as any)?.name) hostName = (prof as any).name;
    } catch (e) { /* no host email: the report stays in the dashboard */ }
    if (!hostEmail) {
      return NextResponse.json({ ok: true, queued: false, reason: 'NO_HOST_EMAIL', message: 'The attendance report was saved, but no email address is on file for the host, so no email was queued.' });
    }
    const title = (meeting as any).title || 'Meeting';
    const when = (meeting as any).time ? new Date((meeting as any).time).toLocaleString() : '';
    const lateCount = withLate.filter((r) => r.isLate).length;
    const subject = `Attendance: ${title}${when ? ` — ${when}` : ''}`;
    const textLines = [
      `Hi ${hostName},`,
      ``,
      `Attendance for "${title}"${when ? ` (${when})` : ''}: ${withLate.length} participant${withLate.length === 1 ? '' : 's'}${lateCount ? `, ${lateCount} late` : ''}.`,
      ``,
      ...withLate
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((r) => `- ${r.name}: joined ${formatTime(r.joinedAt)}, ${r.leftAt ? `left ${formatTime(r.leftAt)}` : 'still in the room at the end'}, stayed ${formatDuration(r.stayedMs)}${r.isLate ? ' — LATE (joined more than 5 minutes after the meeting started)' : ''}`),
      ``,
      `You can also view and download this attendance list from your dashboard.`,
      ``,
      `— GIIN Meet`,
    ];
    const htmlRows = withLate
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((r) => `<tr><td>${r.name}</td><td>${formatTime(r.joinedAt)}</td><td>${r.leftAt ? formatTime(r.leftAt) : '—'}</td><td>${formatDuration(r.stayedMs)}</td><td>${r.isLate ? '<strong>Late</strong>' : ''}</td></tr>`)
      .join('');
    const html = `<p>Hi ${hostName},</p><p>Attendance for <strong>${title}</strong>${when ? ` (${when})` : ''}: ${withLate.length} participant${withLate.length === 1 ? '' : 's'}${lateCount ? `, ${lateCount} late` : ''}.</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Name</th><th>Joined</th><th>Left</th><th>Stayed</th><th></th></tr></thead><tbody>${htmlRows}</tbody></table><p>You can also view and download this attendance list from your dashboard.</p><p>— GIIN Meet</p>`;
    const { error: queueError } = await admin.from('pending_emails').insert([{
      type: 'attendance_report',
      meeting_id: meetingId,
      to_email: hostEmail,
      subject,
      body_text: textLines.join('\n'),
      body_html: html,
      status: 'queued',
    }]);
    if (queueError && !/duplicate|unique/i.test(String((queueError as any)?.message || ''))) {
      return NextResponse.json({ ok: true, queued: false, reason: 'QUEUE_FAILED', message: 'The attendance report was saved, but the email could not be queued.' });
    }
    return NextResponse.json({ ok: true, queued: true, participants: withLate.length, late: lateCount });
  } catch (err: any) {
    console.error('[AttendanceReport] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected error occurred.' }, { status: 500 });
  }
}
