import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// Phase B (9): meeting transcripts — save and read.
//
// POST { meetingId, accessToken, lines: [{ name, text, time }] }
//   Saves (upserts) the full caption log for a meeting. Host-only:
//   the host's client holds the merged transcript — every participant's
//   final captions are broadcast to the whole room — so only the host
//   saves, once, when the meeting ends. A participant leaving early
//   never overwrites the host's copy.
// GET ?meetingId=...&accessToken=...
//   Returns { transcript: { lines, lineCount, updatedAt } | null,
//             summary: { summary, decisions, actionItems, generatedAt } | null }
//   for the meeting's record (dashboard). Caller must be signed in and
//   be the host/creator or an admitted participant of the meeting.
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

async function getCaller(admin: any, accessToken: string | undefined) {
  if (!accessToken) return null;
  const { data: { user }, error } = await admin.auth.getUser(accessToken);
  if (error || !user) return null;
  return user;
}

export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'meetings-transcript', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const { meetingId, accessToken, lines } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    if (!Array.isArray(lines)) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'lines must be an array.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the meeting host can save the transcript.' }, { status: 401 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting || !isCurrentHost(meeting, user.id)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can save the transcript.' }, { status: 403 });
    }
    // Keep only sane lines: a name and non-empty text, capped so one bad
    // client can never store a giant blob.
    const clean = lines
      .filter((l: any) => l && typeof l.text === 'string' && l.text.trim().length > 0)
      .slice(0, 5000)
      .map((l: any) => ({
        name: typeof l.name === 'string' ? l.name.slice(0, 120) : 'Guest',
        text: String(l.text).slice(0, 2000),
        time: typeof l.time === 'string' ? l.time.slice(0, 16) : '',
      }));
    const { error } = await admin
      .from('meeting_transcripts')
      .upsert(
        { meeting_id: meetingId, lines: clean, line_count: clean.length, saved_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'meeting_id' }
      );
    if (error) {
      // The transcript table may not exist yet (SQL not run): the meeting
      // itself is unaffected, so say so honestly instead of failing the end.
      return NextResponse.json({ ok: false, reason: 'TRANSCRIPT_UNAVAILABLE', message: 'The transcript could not be saved yet — the meeting record is not set up. Ask your workspace admin to run giinmeet_phaseB_transcripts.sql.' }, { status: 200 });
    }
    return NextResponse.json({ ok: true, lineCount: clean.length });
  } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'SERVER_ERROR', message: 'An unexpected server error occurred.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'meetings-transcript', 60, 60 * 1000);
  if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId');
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    if (!meetingId) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sign in to view the meeting record.' }, { status: 401 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'Meeting not found.' }, { status: 404 });
    }
    const allowed = isCurrentHost(meeting, user.id);
    if (!allowed) {
      const { data: part } = await admin
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('user_id', user.id)
        .eq('status', 'Admitted')
        .maybeSingle();
      if (!part) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host and participants of this meeting can view its record.' }, { status: 403 });
      }
    }
    const { data: transcript } = await admin
      .from('meeting_transcripts')
      .select('lines, line_count, updated_at')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    const { data: summary } = await admin
      .from('meeting_summaries')
      .select('summary, decisions, action_items, generated_at')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    return NextResponse.json({
      ok: true,
      transcript: transcript
        ? { lines: transcript.lines || [], lineCount: transcript.line_count || 0, updatedAt: transcript.updated_at }
        : null,
      summary: summary
        ? { summary: summary.summary || '', decisions: summary.decisions || [], actionItems: summary.action_items || [], generatedAt: summary.generated_at }
        : null,
    });
  } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'SERVER_ERROR', message: 'An unexpected server error occurred.' }, { status: 500 });
  }
}
