// Phase 1 — the app's only mail sender (reminders + attendance reports).
// Provider: Resend, over its HTTP API (POST https://api.resend.com/emails).
// Suku created the Resend account himself (globalimpactinnovators26@gmail.com)
// and made an API key named "GiinMeet" with Sending access, stored in the
// secure connector custom.resend. The key value is NEVER in this repo and
// NEVER in chat — it reaches the app only as the RESEND_API_KEY env var,
// which Suku sets in Vercel env vars and in the laptop .env.local after
// this code lands. Nothing is hardcoded here and no value is invented.
// From: GIIN Meet <noreply@mail.nimdaukus.com> (domain mail.nimdaukus.com verified in Resend 2026-11-14).
// Without RESEND_API_KEY, sendMail() returns { ok: false,
// reason: 'NO_RESEND_CONFIG' } and the caller queues the email as
// awaiting_provider. Nothing is ever faked as sent: an email only counts
// as sent when Resend accepts it (HTTP 200).
export type MailResult = { ok: true } | { ok: false; reason: string };

export function mailerConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'NO_RESEND_CONFIG' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'GIIN Meet <noreply@mail.nimdaukus.com>',
        to: [to],
        subject,
        text,
        html: html || undefined,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: `RESEND_${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
