# Supabase Auth delivery setup — email (Resend SMTP) + phone OTP (Twilio)

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

---

# Part 2 — Phone OTP sign-in via Twilio SMS — setup + live retest

## Why this is needed

The app's phone sign-in (6-digit SMS code) uses Supabase phone auth.
Supabase has **no built-in SMS sender at all** — without an SMS provider
configured, phone sign-in cannot deliver a single code, and the "Send
Verification Code" button fails for every user. The code already handles
that failure honestly; this setup makes the codes actually arrive.

## Setup (Twilio + Supabase dashboard — needs Suku)

### 1. Create a Twilio account and get a sending number

1. Sign up at twilio.com/try-twilio (free trial gives test credit).
2. **Trial warning:** a Twilio trial account can only send SMS to phone
   numbers you have verified in the Twilio console. To send OTP codes to
   **any** user, the Twilio account must be **upgraded to paid** and have
   a purchased SMS-capable number (about $1.15/month). Without the
   upgrade, only your own verified numbers receive codes.
3. In the Twilio console, note down:
   - **Account SID** (starts with `AC`)
   - **Auth Token** (click to reveal — treat it like a password)
   - Buy a phone number: **Phone Numbers → Buy a number** (any
     SMS-capable number; it does not need to be Rwandan — Twilio sends
     to Rwanda from international numbers).
4. Rwanda note: Twilio sends SMS to +250 numbers. Use E.164 format
   (`+250788123456`, 9-digit national number, **no leading 0** — the app
   already strips the leading 0). Alphanumeric sender IDs in Rwanda need
   carrier registration, so send from the purchased number instead.

### 2. Point Supabase phone auth at Twilio

Supabase's recommended option is **Twilio Verify** (a dedicated OTP
service — it handles code generation, expiry and retries). The app's code
works with either option; Verify is the one to pick.

**Option A — Twilio Verify (recommended):**

1. Twilio console → **Verify → Services → Create service**. Name it
   `GiinMeet`. Copy the **Service SID** (starts with `VA`).
2. Supabase dashboard → project `giinmeet` → **Authentication →
   Providers → Phone** → toggle **on**.
3. Phone provider: **Twilio Verify**.
4. Fill in: **Twilio Account SID** (`AC...`), **Twilio Auth Token**,
   **Twilio Verify Service SID** (`VA...`).
5. Save.

**Option B — Twilio Programmable Messaging (generic SMS):**

1. Supabase dashboard → **Authentication → Providers → Phone** →
   toggle **on**.
2. Phone provider: **Twilio**.
3. Fill in: **Twilio Account SID**, **Twilio Auth Token**,
   **Twilio Message Service SID** (or the sender phone number from
   step 1).
4. Save.

### 3. Cost to expect

Twilio charges about **$0.26 per SMS to Rwanda** (verify current pricing
in the Twilio console before launch) plus ~$1.15/month for the number.
Each sign-in costs one SMS; each resend costs another. There is no
free-forever SMS tier.

## Live retest (proves the whole flow — do this after setup)

1. Sign out of GiinMeet (or open a private/incognito window).
2. On the sign-in screen, switch to the **Phone Number** tab.
3. The country code should already be **+250 (Rwanda)**. Enter your
   number **without the leading 0** (e.g. `788 123 456`) and click
   **Send Verification Code**.
4. The 6-digit code should arrive by SMS within a minute. **Paste the
   whole code** into the first box — it should spread across all six
   boxes. (Typing digit by digit also works.)
5. Click **Verify & Authenticate**. You should be signed straight into
   the dashboard.

## Checks for the other paths (same retest session)

- **Wrong code:** enter a wrong 6-digit code. You should see "That code
  has expired or is wrong. Request a new code and try again." in plain
  words — and the **Resend** button should be available immediately
  (no waiting out the countdown for a dead code).
- **Resend:** after the 60-second countdown, click **Resend
  Verification SMS**. A fresh code should arrive; the old one stops
  working.
- **Provider not set up:** if Twilio is not configured yet, "Send
  Verification Code" should say "Phone sign-in isn't set up for this
  project yet — try signing in with email instead." — not a raw
  Supabase error.

## Code note (already fixed, 2026-11-15)

`src/components/Auth.tsx`: OTP errors are translated to plain language;
pasting a full code spreads it across the six boxes; an expired/wrong
code clears the boxes and frees the resend button immediately; the resend
button is disabled while a send is in flight; the default country code
is +250 (Rwanda) with a Rwandan placeholder; a leading 0 is stripped so
the number is valid E.164 (`+250788...`, never `+2500788...`).
