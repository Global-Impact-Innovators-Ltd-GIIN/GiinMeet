# Supabase Auth email via Resend SMTP — setup + live retest

## Why this is needed

Supabase Auth (password-reset emails, sign-up confirmations, magic links)
does **not** use GiinMeet's own Resend mailer. It uses Supabase's own SMTP
settings, which were never configured. Supabase's built-in mailer is a test
service: it sends **at most 2 emails per hour, and only to members of the
project's own team** (from `noreply@mail.app.supabase.io`), with no delivery
guarantee. So even with the code fixed, most real users would never receive
a reset email. Pointing Supabase Auth at Resend fixes delivery, the sender
domain, and the rate limit.

The app already has a Resend account and a verified domain
(`mail.nimdaukus.com`, verified 2026-11-14). No new account is needed — this
only points Supabase Auth at the same provider.

## Setup (Supabase dashboard — about 5 minutes, needs Suku)

### 1. Create a sending-only Resend API key

1. Log in to Resend (resend.com) as `globalimpactinnovators26@gmail.com`.
2. **API Keys → Create API Key**.
3. Name: `Supabase Auth SMTP`.
4. Permission: **Sending access** (sending-only — the key Supabase stores
   must not be able to do anything but send). Domain: `mail.nimdaukus.com`.
5. **Copy the key (`re_...`) immediately — it is shown only once.** Keep it
   in the password manager. Never paste it into chat.

### 2. Point Supabase Auth at Resend

1. Supabase dashboard → project `giinmeet` (`umeptngfntryekzxifvq`) →
   **Authentication → Emails → SMTP Settings**.
2. Turn **Enable Custom SMTP** ON and fill in:

   | Field | Value |
   |---|---|
   | Sender email | `noreply@mail.nimdaukus.com` |
   | Sender name | `GIIN Meet` |
   | Host | `smtp.resend.com` |
   | Port | `465` (if sending fails with an error, try `587`) |
   | Username | `resend` (the literal word — not an email address) |
   | Password | the `re_...` key from step 1 |

3. **Save.** Supabase tests the handshake on save — a red error means the
   credentials are wrong (usually the username is not literally `resend`,
   or a character was dropped from the key).

### 3. Raise the email rate limit

With custom SMTP, Supabase starts at **30 emails/hour**. Raise it under
**Authentication → Rate Limits** once delivery is proven (100/hour is
plenty for GiinMeet's size).

### 4. (Optional, recommended) Brand the reset email

**Authentication → Emails → Templates → Reset Password.** The link
variable is `{{ .ConfirmationURL }}` — keep it, and add GiinMeet branding
around it. The default template works as-is; this is polish, not a blocker.

## Live retest (proves the whole flow — do this after steps 1–3)

1. Sign out of GiinMeet (or open a private/incognito window).
2. On the sign-in screen, click **Forgot password?**, enter the GIIN
   account email (`globalimpactinnovators26@gmail.com`), click
   **Send Reset Link**. You should see "Check your email".
3. Open the email (check Spam if it is not in the inbox within a few
   minutes). It should come from **GIIN Meet <noreply@mail.nimdaukus.com>**.
4. Click the link in the email. You should land on **"Choose a new
   password"** — not the sign-in screen, not a blank page.
5. Enter a new password (at least 8 characters), confirm it, click
   **Set New Password**. You should see **"Password updated"**, then be
   signed straight into the dashboard.
6. Sign out, then sign back in with the **new** password to confirm it works.

## Checks for the other paths (same retest session)

- **Expired link:** click the same email link a second time (links work
  once). You should see **"This reset link has expired"** with a
  **Request a new reset link** button — not a dead screen.
- **Wrong email:** request a reset for an address with no account. You
  should still see "Check your email" — the app must never reveal
  whether an account exists.
- **Too many requests:** request twice within a minute. The second one
  should say "Too many reset requests — please wait a few minutes" in
  plain words, not a raw Supabase error.

## Code note (already fixed, 2026-11-15)

`requestPasswordReset` in `src/supabaseClient.ts` uses
`redirectTo: window.location.origin` (plain origin, no hash route).
Supabase appends the recovery tokens as a hash fragment; a hash route
(`/#/reset-password`) put the tokens after a second `#`, and supabase-js
parsed only the first fragment segment — so `access_token` was lost, no
recovery session was ever established, and setting the new password failed
with "Auth session missing!". The app detects recovery from
`type=recovery` in the hash, so no route is needed (same pattern as the
Google sign-in redirect, which already uses the plain origin).
