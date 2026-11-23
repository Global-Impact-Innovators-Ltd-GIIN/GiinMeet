# GiinMeet, Phase C1 setup (what Suku must do)

Phase C1 (features 23, 24, 25, 26, 27, 28, 29, 32, 33, 34, 35, 36) is built
to degrade gracefully: **with no keys and no SQL run, the app still works**
and every new surface says in plain words what needs setup. Nothing here
is a paid sign-up made on Suku's behalf, every step below is his own
account, his own click.

## 1. Run the SQL (Supabase SQL Editor, project giinmeet)

Run order:

1. `giinmeet_phaseB_transcripts.sql` (already done in Phase B, skip if run)
2. **`giinmeet_phaseC1.sql`** (this phase, new tables for calendar,
   templates, notes/files, action items, attendance events, polls, and the
   `profiles.caption_language` column)

Safe to run twice. Do **NOT** run `giinmeet_cohost_role.sql` (old, never).
If `giinmeet_passcode_lockdown.sql` still needs running, it runs **LAST**,
after everything else.

## 2. Environment variables (Vercel → giin-meet → Settings → Environment Variables)

All server-only unless marked public. Never commit a value, never paste one
in chat. Set them in **Production** (and Preview if you test there).

| Variable | What it is | Required for |
|---|---|---|
| `GOOGLE_CALENDAR_CLIENT_ID` | Google Cloud OAuth client ID (see §3) | Feature 23, Google sync |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Cloud OAuth client secret | Feature 23, Google sync |
| `OUTLOOK_CLIENT_ID` | Azure app (client) ID (see §4) | Feature 23, Outlook sync |
| `OUTLOOK_CLIENT_SECRET` | Azure client secret value | Feature 23, Outlook sync |
| `GIINMEET_OAUTH_STATE_SECRET` | Any long random string (e.g. 64 hex chars from `openssl rand -hex 32`). Signs the calendar OAuth state so a login cannot be hijacked. Without it, calendar connect works on one server instance only. | Feature 23 |
| `GIINMEET_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored calendar tokens (AES-256-GCM). Without it, tokens are stored as the provider issued them and the UI says so. | Feature 23 |
| `GIINMEET_TRANSLATE_API_KEY` | Translation provider key (see §5) | Feature 36, translated captions |
| `GIINMEET_TRANSLATE_API_URL` | Translation endpoint (LibreTranslate-compatible). Default: `https://libretranslate.com/translate` | Feature 36 |
| `GIINMEET_LLM_API_KEY` | Already documented in Phase B, the summary provider key | Features 10, 29, 35 |
| `RESEND_API_KEY` | Already set, Resend sending key | Feature 29 follow-up emails |

With a variable missing, the feature says so plainly in the UI and keeps
working without it, nothing crashes, nothing is faked as sent/connected.

## 3. Google Calendar OAuth client (feature 23)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) →
   sign in as the GIIN Google account → create/select project "GiinMeet".
2. APIs & Services → Library → enable **Google Calendar API**.
3. APIs & Services → OAuth consent screen → External → fill app name
   "GiinMeet", support email, then add scope
   `https://www.googleapis.com/auth/calendar` (create/read/update/delete
   calendar events) → save.
4. APIs & Services → Credentials → Create Credentials → OAuth client ID →
   **Web application**.
5. Authorised redirect URI, add exactly:
   `https://giinmeet.nimdaukus.com/api/calendar/callback?provider=google`
6. Copy the Client ID → `GOOGLE_CALENDAR_CLIENT_ID` and the Client secret
   → `GOOGLE_CALENDAR_CLIENT_SECRET` in Vercel. Redeploy.

Each user then connects their own Google account from the dashboard
(Calendar section → "Connect Google"). GiinMeet never sees their Google
password; Google issues a token that can be revoked in the dashboard
("Disconnect") or in the user's Google account at any time.

## 4. Outlook / Microsoft Calendar OAuth client (feature 23)

1. Go to [Azure Portal](https://portal.azure.com/) → App registrations →
   New registration → name "GiinMeet", supported account types "Accounts
   in any organizational directory and personal Microsoft accounts".
2. Redirect URI (Web), add exactly:
   `https://giinmeet.nimdaukus.com/api/calendar/callback?provider=outlook`
3. API permissions → Add → Microsoft Graph → Delegated →
   `Calendars.ReadWrite`, `offline_access` → Grant admin consent if asked.
4. Certificates & secrets → New client secret → copy the **value**
   (it is shown once) → `OUTLOOK_CLIENT_SECRET`; the Application
   (client) ID → `OUTLOOK_CLIENT_ID` in Vercel. Redeploy.

Each user connects from the dashboard (Calendar section → "Connect
Outlook") and can disconnect the same way.

## 5. Translation provider (feature 36)

Translated captions call a translation API **from the server** (the key
never reaches a browser). Two options:

- **LibreTranslate (free, open source):** self-host it (Docker, free) and
  set `GIINMEET_TRANSLATE_API_URL` to your instance, no key needed; or use
  the public instance at libretranslate.com with a key from
  [portal.libretranslate.com](https://portal.libretranslate.com) (paid
  plans start small, do not buy anything until you want it).
- **Any LibreTranslate-compatible endpoint** works by setting the URL.

Honest technical note: Kinyarwanda speech recognition is weak, so GiinMeet
does **not** claim native Kinyarwanda transcription. It transcribes the
spoken English (or French) and translates the caption text into
Kinyarwanda, the reliable path. French transcription is good, so French
captions transcribe French speech directly. Each user picks **one**
caption language (English, French, Kinyarwanda, or off), never all three
at once.

## 6. What works without any of the above

- Templates, personal room link, rejoin/recent, guest join, library,
  action items, attendance insights, scheduling assistant (from stated
  availability), follow-up email (once a summary exists and Resend is
  configured, it already is).
- Calendar sync shows "Calendar sync needs setup" until §3/§4 are done.
- Translated captions show "Translated captions are not set up yet"
  until §5 is done; English/French live captions still work on-device
  with no key at all.

## 7. After deploy, Suku's live retest (the final proof)

A passing build is not proof. On a real phone + a real two-person meeting,
check: connect Google/Outlook and see a scheduled meeting appear on the
calendar; create a template and start it in one tap; open the personal
room link signed out; rejoin from Recent; guest joins with just a name;
notes + a local recording registered in the library; follow-up email
arrives after the host ends the meeting; install the PWA on the phone home
screen; scheduling assistant proposes a time; insights show who spoke;
an action item carries into the next meeting; captions in French and in
Kinyarwanda.
