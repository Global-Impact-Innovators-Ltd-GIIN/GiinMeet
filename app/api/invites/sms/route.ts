import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Phase 2 (#2) — SMS invites via Twilio, gated behind env vars.
//
//   GET  -> { configured: boolean } — env presence only, no secrets.
//   POST -> sends one SMS invite to a phone number, host-only.
//
// The route is deliberately boring about money: Twilio is a paid
// provider and Suku has no Twilio account yet, so until
// TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER are set
// in Vercel env vars, POST answers 501 SMS_NOT_CONFIGURED and nothing
// is ever pretended sent. The dashboard disables the SMS button on
// that same signal (GET), so the host sees the real state up front.
//
// Auth follows the admit route: the caller passes their Supabase
// accessToken, the route verifies it server-side, and only the
// meeting's host (or an admitted co-host) may send. The invite text
// is composed server-side from the meeting row (title + scheduled
// time from the database, join link supplied by the caller and
// checked to contain the meeting id) and capped at 1000 characters,
// so the endpoint cannot be used as a free-form SMS relay.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function smsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

function isCurrentHost(meeting: { admin_id?: string | null; user_id?: string | null } | null, userId: string | null | undefined) {
  if (!meeting || !userId) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
}

export async function GET() {
  return NextResponse.json({ configured: smsConfigured() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { meetingId, phone, accessToken, link, title, time } = body;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const cleanPhone = String(phone || '').replace(/[\s\-()]/g, '');
    if (!/^\+?[1-9]\d{6,14}$/.test(cleanPhone)) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'Enter a phone number with country code, e.g. +250788123456.' }, { status: 400 });
    }
    if (!link || typeof link !== 'string' || !link.includes(meetingId)) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'A valid join link for this meeting is required.' }, { status: 400 });
    }
    if (!accessToken || typeof accessToken !== 'string') {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sign in again to send an SMS invite.' }, { status: 401 });
    }

    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, status, title, time')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'This meeting could not be found.' }, { status: 404 });
    }
    if (meeting.status === 'Completed') {
      return NextResponse.json({ error: 'MEETING_ENDED', message: 'This meeting has ended.' }, { status: 403 });
    }

    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !user) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' }, { status: 401 });
    }
    let isHost = isCurrentHost(meeting, user.id);
    if (!isHost) {
      const { data: coRow } = await admin
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('user_id', user.id)
        .eq('role', 'CoHost')
        .eq('status', 'Admitted')
        .maybeSingle();
      if (!coRow) {
        return NextResponse.json({ error: 'FORBIDDEN', message: 'Only the host or a co-host can send SMS invites.' }, { status: 403 });
      }
    }

    if (!smsConfigured()) {
      return NextResponse.json(
        {
          error: 'SMS_NOT_CONFIGURED',
          message: 'SMS invites need a Twilio account: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in Vercel env vars (see docs/phase2-setup.md). WhatsApp invites work now with no account.',
        },
        { status: 501 }
      );
    }

    const dbTitle = String(meeting.title || title || 'GIIN Meet meeting');
    const dbTime = meeting.time || time;
    const timeStr = dbTime ? new Date(dbTime).toLocaleString() : '';
    const text = [
      'Please join my GIIN Meet video meeting:',
      `Topic: ${dbTitle}`,
      ...(timeStr ? [`Time: ${timeStr}`] : []),
      `Join link: ${link}`,
      `Meeting ID: ${meetingId}`,
      '',
      'Media encrypted in transit (DTLS-SRTP).',
    ].join('\n').slice(0, 1000);

    const sid = process.env.TWILIO_ACCOUNT_SID as string;
    const token = process.env.TWILIO_AUTH_TOKEN as string;
    const from = process.env.TWILIO_FROM_NUMBER as string;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: cleanPhone, Body: text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json(
        { error: 'SMS_SEND_FAILED', message: `Twilio refused the message (HTTP ${res.status}). Check the Twilio number and credentials.${detail ? ` ${detail.slice(0, 200)}` : ''}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: 'SMS_SEND_FAILED', message: String(e?.message || e) }, { status: 500 });
  }
}
