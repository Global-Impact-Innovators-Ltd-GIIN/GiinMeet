# GiinMeet Phase 2 — setup Suku must do himself

These are the steps only Suku can do: accounts, keys and SQL in the
Supabase dashboard. Nothing here is done for him, and nothing in the
app pretends a step is done until it really is.

## SQL to run (Supabase dashboard → SQL Editor → New query)

Run in this order. Each file is in the repo root and copied to
`~/workspace/giinmeet/` on Rocky's side.

| # | File | What it does |
|---|------|--------------|
| 1 | `giinmeet_phase2_chat_files_bucket.sql` | Creates the `chat-files` Storage bucket (public read, authenticated upload) + storage policies. Without it, file sharing shows its honest "not set up yet" error. |

> Note: the Phase 1 / Round 8 / Round 9 SQL files from earlier work
> (`giinmeet_phase1.sql`, `giinmeet_link_expiry.sql`, etc.) are
> separate and unchanged — this table only lists Phase 2 additions.

## #2 WhatsApp invites — works now, nothing to set up

WhatsApp invites are a `wa.me` share link. No provider, no account,
no cost. The host opens the invite modal (dashboard) or the invite
card (in the room) and taps **WhatsApp Invite**.

## #2 SMS invites — needs a Twilio account (Suku)

SMS is built and gated behind env vars, but there is no Twilio
account yet, so the SMS button stays off with an honest note until
Suku does this:

1. Create an account at https://www.twilio.com/try-twilio
   (trial is fine to test with; a trial account can only text
   verified numbers — a paid upgrade removes that limit).
2. In the Twilio Console, copy the **Account SID** and **Auth Token**
   (Console dashboard), and get a **phone number** (Phone Numbers →
   Buy a number — a US number is the cheapest; it is the sender).
3. In Vercel (project `giin-meet` → Settings → Environment
   Variables), add:
   - `TWILIO_ACCOUNT_SID` = the Account SID
   - `TWILIO_AUTH_TOKEN` = the Auth Token
   - `TWILIO_FROM_NUMBER` = the Twilio number, E.164 format
     (e.g. `+15551234567`)
4. Redeploy (Vercel → Deployments → ⋯ → Redeploy) so the server
   route picks the new vars up.
5. Check: open any meeting's Invite modal — the SMS button is now
   enabled. Send a test SMS to your own number.

Cost: Twilio SMS is pay-as-you-go (roughly $0.01–$0.08 per SMS
depending on destination; the Twilio number itself is ~$1/month).
No subscription was created and no money was spent by Rocky.

## #5 Google Calendar booking — two paths

### Path A — works now, nothing to set up (template link)

Every meeting's **Google Calendar** button opens
`calendar.google.com/calendar/render?action=TEMPLATE…` with the
title, time and join link pre-filled. The guest/host just saves it
in their own Google Calendar. The `.ics` download next to it works
the same way for Outlook/Apple Calendar. No OAuth, no keys.

### Path B — full two-way sync (not built yet, needs Suku)

Creating the event directly in the host's Google Calendar from
GiinMeet (and updating it if the meeting moves) needs a Google
Cloud OAuth client, which does not exist yet. Rocky did **not**
create a Google Cloud project or OAuth client — that is Suku's
Google account, so it is his call:

1. Go to https://console.cloud.google.com/ → create a project
   (e.g. `GiinMeet`) → APIs & Services → Library → enable
   **Google Calendar API**.
2. APIs & Services → OAuth consent screen → External → fill the app
   name (`GIIN Meet`) and support email → add scope
   `https://www.googleapis.com/auth/calendar.events` → add Suku's
   Google account as a test user (until the app is verified).
3. APIs & Services → Credentials → Create Credentials → OAuth
   client ID → Web application → Authorised redirect URI:
   `https://<your-vercel-domain>/api/calendar/google/callback`
   (the callback route does not exist yet — it is built once the
   client exists).
4. Give Rocky the **Client ID** and **Client Secret** (Vercel env
   vars `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and say the
   word — then the connect flow + token storage can be built.

Until then, Path A is the working Google Calendar booking.

## #11 File sharing in chat — run the bucket SQL (step 1 above)

The in-room file sharing is already built (upload → `chat-files`
bucket → clickable link in chat, 25 MB limit, signed-in users only —
guests can read chat but cannot send messages or files, same rule as
text chat). The only missing piece is the bucket itself: run
`giinmeet_phase2_chat_files_bucket.sql` (row 1 of the table above).
After that, attach a file from the chat box in any meeting; anyone
with the link can download it (public read, same as the design).

Limits: 25 MB per file; executable/script types (`.exe`, `.bat`,
`.sh`, `.js`, `.msi`, `.ps1`, `.vbs`, `.apk`, `.dmg`, `.cmd`,
`.com`, `.scr`, `.jar`) are blocked in the app. Files are stored
under `<meetingId>/…` so they are scoped per meeting.

## #13 Q&A queue — works now, nothing to set up

The Q&A Hub tab in the room is now a real queue: anyone asks,
anyone upvotes, the host/co-host marks questions answered, open
questions sort by votes then newest first, answered ones sit in
their own section and can be reopened. No SQL, no keys — it rides
the same live broadcast channel as the polls, and like the polls it
is live-only (questions do not survive a refresh).
