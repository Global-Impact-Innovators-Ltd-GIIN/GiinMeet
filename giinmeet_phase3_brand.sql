-- =====================================================================
-- GiinMeet Phase 3 (Feature 4) — Custom branding: the SHARED
-- workspace brand
-- (RUN IN SUPABASE SQL EDITOR, GIIN org project, the giinmeet project)
-- =====================================================================
-- RUN ORDER: deploy the Phase 3 Feature 4 code FIRST, then run this
-- file once. The new code probe-gates every brand read/write, so
-- before this runs the app behaves exactly as before — local-only
-- branding on each device, default GiinMeet brand everywhere else —
-- and says honestly in Settings that shared branding is not set up
-- yet, instead of crashing. If this file ran first, the OLD app would
-- simply ignore the new table (nothing in it reads it).
--
-- WHY:
--  1. Until now branding was localStorage-only: Settings wrote
--     giin_custom_logo / giin_brand_name / giin_brand_slogan on ONE
--     device and App / MeetingRoom read them back on THAT device
--     only. A second user — or the same user on a fresh device —
--     always saw the default GiinMeet brand, and the sign-in screen,
--     waiting room and lobby never read the local keys at all.
--  2. This table holds ONE row (id = 1, enforced by CHECK): the logo,
--     name, slogan and accent the workspace admin set. Every client
--     loads it on app start — signed in or not, so guests see it on
--     the sign-in, waiting-room and lobby screens too — and syncs it
--     into the same localStorage keys, so the App header, the
--     MeetingRoom watermark and the Settings inputs all show the
--     shared brand with no second theme system and no change to
--     those readers. The accent reuses the b230f62 theme variables
--     (applyAccentColor), it is not a second theme system.
--  3. The logo is stored as a data URL in logo_url (the same base64
--     string Settings already produces from the file picker), so NO
--     Storage bucket is needed for this feature and none has to be
--     created. The existing chat-files bucket is NOT reused: it is
--     chat-scoped and its policies do not fit a public brand asset.
--  4. The server email routes (reminder + attendance report) read
--     this row best-effort and sign off with the workspace brand
--     name instead of the hardcoded "— GIIN Meet". If the table is
--     missing or no brand is set, they keep the default sign-off.
--
-- ENFORCEMENT LIVES SERVER-SIDE, not in the client:
--   * SELECT is open to everyone (anon included): the brand is
--     public-facing by design — guests in the waiting room and lobby
--     must see it without signing in.
--   * INSERT / UPDATE / DELETE are superadmin-only, locked in RLS to
--     the email nimdaukus@gmail.com — the same lock App.tsx uses for
--     the superadmin view. The Settings UI also gates publishing to
--     the superadmin, but that is display only; this policy is the
--     real enforcement. Without it, anyone with the anon key could
--     rebrand the whole workspace.
--
-- WHAT THIS CREATES:
--   * workspace_brand — id (always 1), brand_name, slogan,
--     logo_url (data URL, nullable = default logo), accent_color,
--     accent_hover, updated_at, updated_by.
--
-- WHAT STAYS WORKING after this runs:
--   - No row is seeded: with no brand set, every surface shows the
--     default GiinMeet brand, exactly as before. The admin publishes
--     the first shared brand from Settings > Branding & Layout.
--   - Personal per-device settings (watermark mode, layout, fonts,
--     glass opacity) are untouched — they stay local-only.
--   - No existing RLS policy on any other table is changed.
-- =====================================================================

create table if not exists public.workspace_brand (
  id integer primary key default 1 check (id = 1),
  brand_name text not null default 'GiinMeet',
  slogan text not null default 'Connect, Collaborate, Virtualize',
  logo_url text,
  accent_color text not null default '#3B82F6',
  accent_hover text not null default '#2563EB',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.workspace_brand enable row level security;

-- Everyone (including signed-out guests) can read the brand: it is
-- shown on the sign-in screen, waiting room and lobby.
drop policy if exists "Workspace brand readable by everyone" on public.workspace_brand;
create policy "Workspace brand readable by everyone"
  on public.workspace_brand for select
  using (true);

-- Only the superadmin can create, change or remove the shared brand.
-- auth.jwt() ->> 'email' is null for the anon key, so signed-out
-- callers can never write.
drop policy if exists "Workspace brand written by the superadmin" on public.workspace_brand;
create policy "Workspace brand written by the superadmin"
  on public.workspace_brand for all
  using ((auth.jwt() ->> 'email') = 'nimdaukus@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'nimdaukus@gmail.com');

-- Verify (run after this file):
--   select * from public.workspace_brand;
--     -- empty until the admin publishes a brand from Settings.
--   select policyname, cmd from pg_policies
--     where tablename = 'workspace_brand';
--     -- expect 2 rows: the select policy and the superadmin write policy.
