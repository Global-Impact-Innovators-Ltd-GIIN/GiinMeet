import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Phase B (10): AI meeting summary — generate from the stored transcript.
//
// POST { meetingId, accessToken }
//   Host-only. Reads the saved transcript and asks the configured LLM
//   for a short summary with decisions and action items (with owners),
//   then stores it in meeting_summaries. The generation and storage are
//   built now; the post-meeting send hooks into Phase C (feature 29).
//
// Provider — env-configurable, nothing hardcoded, no key ever committed:
//   GIINMEET_LLM_API_KEY    — the provider key. REQUIRED to generate.
//                             With no key, nothing is generated and the
//                             route answers { ok:false, reason:'NO_LLM_KEY' }
//                             so the UI can say so plainly.
//   GIINMEET_LLM_API_URL    — OpenAI-compatible chat-completions endpoint.
//                             Default: https://api.openai.com/v1/chat/completions
//   GIINMEET_LLM_MODEL      — model name. Default: gpt-4o-mini
//   GIINMEET_LLM_PROVIDER   — label stored with the summary (default 'openai').
// Suku supplies the key himself in Vercel (see the Phase B handover note);
// Rocky never invents a key, signs up for a paid service, or agrees to
// usage-based billing on his behalf.
// GET ?meetingId=...&accessToken=... — returns the stored summary (same
// access rule as the transcript route: host/creator or admitted participant).
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

function parseSummaryText(raw: string): { summary: string; decisions: string[]; actionItems: { text: string; owner: string }[] } {
  const fallback = { summary: raw.slice(0, 4000), decisions: [] as string[], actionItems: [] as { text: string; owner: string }[] };
  if (!raw) return { summary: '', decisions: [], actionItems: [] };
  // The model is asked for JSON; accept it with or without code fences.
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed && typeof parsed === 'object') {
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 4000) : '',
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter((d: any) => typeof d === 'string').slice(0, 20) : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems
              .filter((a: any) => a && typeof a.text === 'string')
              .slice(0, 30)
              .map((a: any) => ({ text: String(a.text).slice(0, 500), owner: typeof a.owner === 'string' ? a.owner.slice(0, 120) : 'Unassigned' }))
          : [],
      };
    }
  } catch (e) { /* not JSON — fall through to plain text */ }
  return fallback;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, accessToken } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Only the meeting host can generate the summary.' }, { status: 401 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, title')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting || !isCurrentHost(meeting, user.id)) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the meeting host can generate the summary.' }, { status: 403 });
    }
    const { data: transcript } = await admin
      .from('meeting_transcripts')
      .select('lines')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    const lines = (transcript?.lines || []) as { name: string; text: string; time: string }[];
    if (lines.length === 0) {
      return NextResponse.json({ ok: false, reason: 'NO_TRANSCRIPT', message: 'There is no transcript to summarise yet — captions were off or nobody spoke.' }, { status: 200 });
    }
    const apiKey = process.env.GIINMEET_LLM_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, reason: 'NO_LLM_KEY', message: 'AI summaries need setup — no summary provider key is configured. Add GIINMEET_LLM_API_KEY in Vercel to turn them on.' }, { status: 200 });
    }
    const apiUrl = process.env.GIINMEET_LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
    const model = process.env.GIINMEET_LLM_MODEL || 'gpt-4o-mini';
    const provider = process.env.GIINMEET_LLM_PROVIDER || 'openai';
    const transcriptText = lines.slice(0, 1500).map((l) => `${l.name}: ${l.text}`).join('\n');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You summarise meeting transcripts. Reply with JSON only: {"summary": "a short paragraph, max 6 sentences", "decisions": ["decision 1"], "actionItems": [{"text": "what to do", "owner": "person name or Unassigned"}]}. Base everything only on the transcript; never invent names, decisions or action items that are not in it.' },
            { role: 'user', content: `Meeting: ${meeting.title || 'GiinMeet meeting'}\n\nTranscript:\n${transcriptText}` },
          ],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      return NextResponse.json({ ok: false, reason: 'LLM_UNREACHABLE', message: 'The summary service could not be reached. The transcript is saved — try generating the summary again from the meeting record.' }, { status: 200 });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: 'LLM_ERROR', message: 'The summary service returned an error. The transcript is saved — try generating the summary again from the meeting record.' }, { status: 200 });
    }
    const data = await res.json().catch(() => ({}));
    const raw = data?.choices?.[0]?.message?.content || '';
    if (!raw) {
      return NextResponse.json({ ok: false, reason: 'LLM_EMPTY', message: 'The summary service returned nothing. The transcript is saved — try again from the meeting record.' }, { status: 200 });
    }
    const parsed = parseSummaryText(raw);
    if (!parsed.summary) {
      return NextResponse.json({ ok: false, reason: 'LLM_EMPTY', message: 'The summary service returned nothing usable. The transcript is saved — try again from the meeting record.' }, { status: 200 });
    }
    const { error } = await admin
      .from('meeting_summaries')
      .upsert(
        { meeting_id: meetingId, summary: parsed.summary, decisions: parsed.decisions, action_items: parsed.actionItems, provider, model, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'meeting_id' }
      );
    if (error) {
      return NextResponse.json({ ok: false, reason: 'SUMMARY_UNAVAILABLE', message: 'The summary was generated but could not be stored yet — ask your workspace admin to run giinmeet_phaseB_transcripts.sql.' }, { status: 200 });
    }
    return NextResponse.json({ ok: true, summary: parsed.summary, decisions: parsed.decisions, actionItems: parsed.actionItems });
  } catch (e: any) {
    return NextResponse.json({ error: 'SERVER_ERROR', message: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
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
    if (!isCurrentHost(meeting, user.id)) {
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
    const { data: summary } = await admin
      .from('meeting_summaries')
      .select('summary, decisions, action_items, generated_at')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    return NextResponse.json({
      ok: true,
      summary: summary
        ? { summary: summary.summary || '', decisions: summary.decisions || [], actionItems: summary.action_items || [], generatedAt: summary.generated_at }
        : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'SERVER_ERROR', message: String(e?.message || e) }, { status: 500 });
  }
}
