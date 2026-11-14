import nodemailer from 'nodemailer';

// Phase 1 — the app's only mail sender (reminders + attendance reports).
// There is NO mail provider configured until Suku adds SMTP settings as
// Vercel env vars:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
//   SMTP_FROM (e.g. "GIIN Meet <meetings@giinmeet.nimdaukus.com>"),
//   SMTP_SECURE ("true" only for port 465, otherwise false).
// The same SMTP server Supabase uses for its own auth emails (configured
// in the Supabase dashboard) can be reused here — same host, user and
// password — but those values live in the dashboard, not in this repo, so
// they must be copied into Vercel env vars by hand.
// Without them sendMail() returns { ok: false, reason: 'NO_SMTP_CONFIG' }
// and the caller queues the email as awaiting_provider. Nothing is ever
// faked as sent: an email only counts as sent when the SMTP server
// accepts it.
export type MailResult = { ok: true } | { ok: false; reason: string };

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export function mailerConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  if (!mailerConfigured()) return { ok: false, reason: 'NO_SMTP_CONFIG' };
  try {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html: html || undefined,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
