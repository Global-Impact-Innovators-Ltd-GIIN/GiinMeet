import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendMail } from '../../../../src/utils/mailer';

// Phase 1 — the email outbox runner. Called by Vercel Cron every 5 minutes
// (see vercel.json) and does two jobs in one pass:
//   A. Queue reminders: scheduled meetings starting within their reminder
//      window (default 15 minutes before, per meeting) get one
//      pending_emails row each (meeting_reminder) addressed to the HOST.
//      Reminders go to the host only — the app has no stored invitee list
//      (invites are shared as links), so there is nobody else to remind.
//      A reminder is queued exactly once (unique index on
//      (meeting_id, type) + the meetings.reminder_sent_at marker).
//   B. Send queued mail: up to 20 pending rows per run (attempts < 5).
//      A row only counts as sent when Resend accepts it (HTTP 200). With
//      no Resend API key configured the row becomes awaiting_provider and
//      waits — nothing is ever faked as sent.
// Auth: when CRON_SECRET is set in Vercel env vars, the caller must send
// `Authorization: Bearer <CRON_SECRET>` (Vercel Cron does this
// automatically when the secret is configured). Without it the endpoint
// still runs — the URL is unguessable, but set the secret in production.
// Scheduling note: Vercel Cron runs every 5 minutes only on a Pro plan —
// on Hobby the same endpoint can be called by Supabase pg_cron (pg_net)
// on any schedule. Either way, this route is the only sender.
// Needs giinmeet_phase1.sql (pending_emails + meetings.reminder_*);
// without it the route refuses honestly instead of pretending to work.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function siteOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin || 'https://giinmeet.nimdaukus.com';
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization') || '';
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'UNAUTHORIZED', message: 'A valid cron secret is required.' }, { status: 401 });
      }
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }

    // The outbox must exist before either job can run.
    const { error: tableError } = await admin.from('pending_emails').select('id').limit(1);
    if (tableError) {
      return NextResponse.json({ error: 'EMAIL_TABLES_NOT_CONFIGURED', message: 'Email is not set up yet — run giinmeet_phase1.sql in the Supabase SQL Editor first.' }, { status: 500 });
    }

    const now = new Date();
    const origin = siteOrigin(req);
    let queuedReminders = 0;

    // ---- A. Queue reminders due in this run. ----
    const lookAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const { data: upcoming, error: upcomingError } = await admin
      .from('meetings')
      .select('id,title,time,admin_id,user_id,reminder_enabled,reminder_minutes_before,reminder_sent_at')
      .eq('status', 'Scheduled')
      .is('reminder_sent_at', null)
      .gt('time', now.toISOString())
      .lte('time', lookAhead);
    if (upcomingError) {
      // The reminder columns do not exist until giinmeet_phase1.sql runs.
      return NextResponse.json({ error: 'EMAIL_TABLES_NOT_CONFIGURED', message: 'Email is not set up yet — run giinmeet_phase1.sql in the Supabase SQL Editor first.' }, { status: 500 });
    }
    for (const meeting of upcoming || []) {
      const enabled = (meeting as any).reminder_enabled ?? true;
      if (!enabled) continue;
      const minutes = (meeting as any).reminder_minutes_before ?? 15;
      const startAt = new Date((meeting as any).time).getTime();
      if (startAt - minutes * 60 * 1000 > now.getTime()) continue; // not due yet
      const hostId = (meeting as any).admin_id || (meeting as any).user_id;
      let hostEmail: string | null = null;
      let hostName = 'Host';
      try {
        const { data: prof } = await admin.from('profiles').select('name,email').eq('id', hostId).maybeSingle();
        hostEmail = (prof as any)?.email || null;
        if ((prof as any)?.name) hostName = (prof as any).name;
      } catch (e) { /* no host email: cannot remind */ }
      if (!hostEmail) continue;
      const joinLink = `${origin}/#/join?id=${(meeting as any).id}`;
      const when = new Date(startAt).toLocaleString();
      const subject = `Reminder: ${(meeting as any).title} starts in ${minutes} minutes`;
      const text = [
        `Hi ${hostName},`,
        ``,
        `Your meeting "${(meeting as any).title}" starts at ${when} — in about ${minutes} minutes.`,
        ``,
        `Join here: ${joinLink}`,
        ``,
        `— GIIN Meet`,
      ].join('\n');
      const html = `<p>Hi ${hostName},</p><p>Your meeting <strong>${(meeting as any).title}</strong> starts at ${when} — in about ${minutes} minutes.</p><p><a href="${joinLink}">Join the meeting</a></p><p>— GIIN Meet</p>`;
      const { error: insertError } = await admin.from('pending_emails').insert([{
        type: 'meeting_reminder',
        meeting_id: (meeting as any).id,
        to_email: hostEmail,
        subject,
        body_text: text,
        body_html: html,
        status: 'queued',
      }]);
      // A duplicate (already queued) is fine — the unique index did its job.
      if (insertError && !/duplicate|unique/i.test(String((insertError as any)?.message || ''))) {
        console.error('[Cron] Could not queue reminder for meeting', (meeting as any).id, insertError);
        continue;
      }
      await admin.from('meetings').update({ reminder_sent_at: now.toISOString() }).eq('id', (meeting as any).id);
      queuedReminders++;
    }

    // ---- B. Send queued mail (up to 20 rows per run). ----
    const { data: queued } = await admin
      .from('pending_emails')
      .select('id,to_email,subject,body_text,body_html,attempts')
      .in('status', ['queued', 'failed'])
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(20);
    let sent = 0;
    let failed = 0;
    let awaitingProvider = 0;
    for (const row of queued || []) {
      const result = await sendMail((row as any).to_email, (row as any).subject, (row as any).body_text, (row as any).body_html || undefined);
      if (result.ok) {
        await admin.from('pending_emails').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: (row as any).attempts + 1 }).eq('id', (row as any).id);
        sent++;
      } else if ((result as any).reason === 'NO_RESEND_CONFIG') {
        await admin.from('pending_emails').update({ status: 'awaiting_provider', attempts: (row as any).attempts + 1, last_error: 'No Resend API key configured (RESEND_API_KEY).' }).eq('id', (row as any).id);
        awaitingProvider++;
      } else {
        await admin.from('pending_emails').update({ status: 'failed', attempts: (row as any).attempts + 1, last_error: (result as any).reason || 'Send failed.' }).eq('id', (row as any).id);
        failed++;
      }
    }

    return NextResponse.json({ ok: true, queuedReminders, sent, failed, awaitingProvider });
  } catch (err: any) {
    console.error('[Cron] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected error occurred.' }, { status: 500 });
  }
}
