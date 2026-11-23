# Supabase service-role key rotation — steps for Suku

## Why

The Supabase **service-role key** for the GiinMeet project was shared in chat on
2026-11-08 and was never rotated. That key bypasses all Row Level Security —
anyone holding it can read and write everything in the Supabase project
(`giinmeet`, ref `umeptngfntryekzxifvq`). Rotate it now.

## Code side — already done (2026-11-23, Phase A feature 7)

- The key is read from the environment **only**: every use in the repo is
  `process.env.SUPABASE_SERVICE_ROLE_KEY`, in 18 server-side files under
  `app/api/` (each route's own `getAdminClient()`, or the shared one in
  `app/api/superadmin/lib.ts`). No route, component or script hardcodes it.
- Verified by grep on 2026-11-23: no JWT (`eyJ…`) value exists anywhere in
  tracked code — the only `eyJ` match is a base64 fragment inside a `sha512`
  integrity hash in `package-lock.json`, which is not a key. The untracked
  `patch_media_round4.cjs` is also clean.
- No `.env` file is tracked in git, and `.gitignore` covers `.env`, `.env.local`
  and `.env*`.
- The **anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is public by design and
  does **not** need rotating for this. Only the service-role key does.

So rotation is purely a dashboard job: **no code change is needed**. Follow the
steps below in order. The order matters — **never revoke the old key first**.

## Steps

### 1. Create the new key in Supabase (do NOT delete the old one yet)

1. Open the Supabase dashboard and select the **giinmeet** project
   (ref `umeptngfntryekzxifvq`, region eu-west-1).
2. Go to **Settings → API** (in the newer dashboard: **Settings → API Keys**).
3. Find the **service_role** key and create/generate a **new** service-role key.
4. Copy the new key value somewhere safe for the next step only (for example a
   password manager). **Do not paste it in any chat, ticket or document.**
5. Leave the old key in place for now — the live site still runs on it until
   step 3 is done.

### 2. Update the Vercel env var

1. Open the Vercel dashboard → the **giinmeet** project → **Settings →
   Environment Variables**.
2. Find `SUPABASE_SERVICE_ROLE_KEY` and change its value to the **new** key.
   Make sure it applies to **Production** (and Preview, if the variable has
   separate entries — keep the same new value in each).
3. Save. Nothing else in Vercel needs to change: the code reads this variable
   by name, so no redeploy-time code edit is needed.

### 3. Redeploy so the live site picks the new key up

1. In Vercel → **Deployments**, open the current Production deployment and
   choose **Redeploy** (or push any commit to `main` — a redeploy alone is
   enough).
2. Wait for the deployment to finish and become **Ready**.

### 4. Verify the new key works (before touching the old one)

1. Open https://giinmeet.nimdaukus.com, sign in, and join a meeting
   (starting a meeting mints a LiveKit token, which needs the service-role
   key server-side). If video connects, the new key works.
2. As a second check, admit a guest from the waiting room — admission also
   runs through the service-role key.
3. Optional: in Vercel → **Logs**, look for
   `[Token API] SUPABASE_SERVICE_ROLE_KEY is not set on the server.` — its
   **absence** is the good sign. If meetings fail to join with a
   "video service is not configured" message, the new value did not reach the
   deployment: re-check step 2 (right project, right variable name, saved)
   and redeploy again. The old key still works in the meantime, so nothing is
   lost — just do not revoke it yet.

### 5. Only now: revoke the old key

1. Back in the Supabase dashboard → **Settings → API / API Keys**.
2. Revoke/delete the **old** service-role key.
3. The old key stops working immediately. The chat message from 2026-11-08
   that contained it is now useless to anyone who saw it.

### 6. Check for any other copy of the old key

CORRECTION (security audit 2026-11-23): the repo was NOT fully clean.
The file `giinmeet_pg_cron_reminders.sql` contained a live CRON_SECRET
value, committed in git. That is a separate secret from the service-role
key: it authorises the email-outbox endpoint, and anyone with the repo
could trigger reminder sends with it. The audit replaced the value in
the file with a placeholder, but the value is still in git history, so
rotate the CRON_SECRET too (section below). Vercel is the only place
the app reads the service-role key from. If you ever pasted the old key
anywhere else — a local `.env.local` on your laptop, another dashboard,
a script, a note — update that place to the new key or delete the copy.
If you find a copy somewhere you cannot update, revoking the old key in
step 5 already neutralises it.

## Rules for the future

- **Never paste the service-role key in chat, email or a ticket again.** If a
  helper ever needs it, set it directly in the Vercel env var yourself.
- **Never commit a `.env` file.** They are gitignored for exactly this reason.
- If the key is ever shared again, repeat these steps — create new, update
  Vercel, redeploy, verify, then revoke old.


## CRON_SECRET rotation (also do this — audit 2026-11-23)

Why: the old CRON_SECRET was printed in `giinmeet_pg_cron_reminders.sql`,
which is committed in git. Anyone with the repo could call
`GET /api/cron/due-emails` with it and trigger the email outbox. The
damage is small (reminders are de-duplicated and only go to meeting
hosts), but a committed secret is a committed secret: rotate it.

Steps (do them in this order):

1. Pick a NEW secret: a long random string, for example from
   `openssl rand -hex 32` (or any password generator). Keep it in a
   password manager. Never paste it in chat, email or a ticket.
2. Vercel -> project giinmeet -> Settings -> Environment Variables ->
   find `CRON_SECRET`, change its value to the new secret (Production),
   save, then redeploy so the live site accepts it.
3. Supabase dashboard -> project giinmeet -> SQL Editor -> run
   `giinmeet_security_audit.sql` section 3 (it re-schedules the
   `giinmeet-due-emails` pg_cron job with the new secret). Replace the
   `PASTE_NEW_CRON_SECRET_HERE` placeholder with the new secret first.
4. Verify: wait 5 minutes, then in the SQL Editor run
   `select status_code, created from net._http_response order by created`
   `desc limit 5;` — the newest rows should be 200. (401 means the job
   still carries the old secret; re-check steps 2 and 3.)
5. Only now is the old secret dead: it was never stored anywhere else
   except the git history of `giinmeet_pg_cron_reminders.sql`, which
   the audit already replaced with a placeholder. Rewriting git history
   to purge it is NOT recommended (it would rewrite every commit after
   it); rotation alone neutralises it.

Rules for the future: never commit a real secret in a SQL file, a doc
or a script. Placeholders only; the real value lives in Vercel env
vars (and, for the pg_cron job, in the Supabase scheduled job itself).

## GIINMEET_POLL_PEPPER (new env var — audit 2026-11-23)

The anonymous-poll vote hash needs its own pepper, separate from every
other key. Set `GIINMEET_POLL_PEPPER` in Vercel env vars (Production)
to a long random string (for example `openssl rand -hex 32`), then
redeploy. Until it is set, polls keep working on a temporary
per-process pepper, but a voter could vote twice across a redeploy.
This is the only new env var the audit needs.
