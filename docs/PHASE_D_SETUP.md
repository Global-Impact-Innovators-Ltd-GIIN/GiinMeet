# Phase D setup (what Suku must do)

Phase D adds: per-meeting end-to-end encryption (37), waiting-room
upgrades with branded rooms, agenda preview and knock messages (38),
abuse and spam controls (39), usage analytics (40), Microsoft SSO (41),
public API and webhooks (42), health monitoring and alerts (43), deeper
team workspaces (44), feedback after every meeting (46), and
white-label organisations (47).

## 1. Run the database setup (required)

In the Supabase SQL Editor, for project `giinmeet`
(`umeptngfntryekzxifvq`), run this file once:

```
giinmeet_phaseD.sql
```

Run order:

1. `giinmeet_phaseC2b.sql` (already done, if not yet run, run it first)
2. `giinmeet_security_audit.sql` (already done, if not yet run, run it first)
3. `giinmeet_phaseD.sql` (this phase)
4. The passcode lockdown grant, if it is still outstanding, runs LAST

The file is idempotent, it is safe to run it twice. It creates the new
tables (`organisations`, `organisation_members`, `api_keys`,
`webhooks`, `webhook_deliveries`, `meeting_reports`, `user_blocks`,
`host_regulars`, `meeting_feedback`, `health_checks`, `health_alerts`)
and adds columns to `meetings` (`e2ee_enabled`, `organisation_id`),
`teams` (`logo_url`, `accent_color`, `accent_hover`,
`room_meeting_id`) and `meeting_participants` (`knock_message`).

Until this runs, the new features refuse honestly instead of pretending
to work: the dashboard shows a plain message, the API returns
`NOT_CONFIGURED`, and the superadmin portal shows the same note. Nothing
is faked. The older features keep working as before.

## 2. Microsoft sign-in (SSO, 41)

Google sign-in already works. Microsoft sign-in needs an app
registration that only Suku can create, because it lives in his own
Microsoft and Supabase accounts. No key is invented here.

Steps:

1. In the Azure portal (portal.azure.com), register a new application:
   - Name: `GiinMeet`
   - Supported account types: accounts in any organisational directory
     and personal Microsoft accounts.
   - Redirect URI (Web): `https://umeptngfntryekzxifvq.supabase.co/auth/v1/callback`
2. In the app registration, create a client secret under Certificates
   and secrets, and copy the secret value at once (it is shown only
   once).
3. In the Supabase dashboard for project `giinmeet`, go to
   Authentication, Providers, Azure, and turn it on:
   - Paste the Application (client) ID from Azure.
   - Paste the client secret from step 2.
   - Save.
4. No code change and no environment variable is needed: the app signs
   in with Supabase OAuth provider `azure`, the same way Google already
   works. If Azure is not enabled yet, the Microsoft button in the
   sign-in page says so plainly instead of failing silently.

If Microsoft sign-in is not wanted yet, skip this whole step. Google
sign-in and email sign-in are unaffected.

## 3. Health alerts email (43)

Health alerts email the superadmin (`nimdaukus@gmail.com`) using the
same Resend setup the app already uses for other mail, sender
`GIIN Meet <noreply@mail.nimdaukus.com>`. Nothing new to configure:
if `RESEND_API_KEY` is already set in Vercel, alerts are emailed. If it
is not set, the alert still appears in the superadmin portal under
Monitoring, Service health, marked "email not sent", and nothing breaks.

To check it works: open the superadmin portal, Monitoring, press
"Run health check". The card shows LiveKit, Supabase and this site as
Up, Down or Degraded, with the detail of each probe.

## 4. No new environment variables

Phase D adds no new environment variables. Everything it needs already
exists (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`RESEND_API_KEY`, LiveKit keys). API keys and webhook secrets for the
public API are created in the app itself, from the dashboard Developer
section, and are never stored in environment variables.

## 5. What to retest live (a build passing is not proof)

After the SQL runs and the site deploys, retest on a real phone plus a
real two-person meeting:

- End-to-end encryption: schedule a meeting with a passcode and the
  encryption box ticked, join from two devices, confirm the encrypted
  badge shows, and confirm a meeting without a passcode cannot turn
  encryption on.
- Waiting room: a guest knocks with a one-line message, the host sees
  it, admits all, and a message sent to the lobby reaches the waiting
  guest. A regular (added by the host) joins straight past the lobby.
- Blocking: block a signed-in participant from the room, then have
  them try to rejoin by refreshing, they must stay out.
- Reporting: report a meeting from the ended screen, then check it
  appears in the superadmin portal under Reports.
- Feedback: rate a meeting at the end, then check the host can see the
  rating and the superadmin Analytics shows the average.
- API: create a key in the Developer section, create a meeting with
  curl (see `docs/API.md`), and check a webhook delivery arrives with a
  valid signature.
- Team room: open a team room in one tap from Teams, and check the
  team's past meetings show under Meeting history.
- Organisation brand: create an organisation from the dashboard
  Organisations section, set a logo and colour there, then schedule a
  meeting under it to see the branded waiting room.

## 6. Two audit holes left untouched on purpose

These were found by the security audit and need Suku or a product
decision, so Phase D did not touch them:

1. The co-host self-grant bypass is still open because
   `giinmeet_cohost_moderator_roles.sql` was never run live. Running
   that file is Suku's step, it is not fixed by code.
2. Anonymous users can read every profile's email, phone and
   `is_superadmin` flag. That is not safely fixable by SQL alone and
   needs a product decision first.

## 7. Files added in this phase

Server routes: `app/api/meetings/e2ee`, `app/api/meetings/waiting-room`,
`app/api/meetings/regulars`, `app/api/meetings/block`,
`app/api/meetings/report`, `app/api/meetings/feedback`,
`app/api/superadmin/analytics`, `app/api/superadmin/reports`,
`app/api/superadmin/health`, `app/api/public-api/keys`,
`app/api/public-api/meetings`, `app/api/public-api/webhooks`,
`app/api/organisations`, `app/api/teams/room`, plus the shared helper
`app/api/_lib/phaseD.ts`.

Client: `src/components/MeetingFeedback.tsx`,
`src/components/ApiDeveloperPanel.tsx`, and changes in `Waitroom.tsx`,
`MeetingRoom.tsx`, `Auth.tsx`, `Teams.tsx`, `SuperadminPortal.tsx`,
`Dashboard.tsx`, `App.tsx`, `src/supabaseClient.ts`.

Docs: `docs/API.md` (public API and webhooks), this file.
