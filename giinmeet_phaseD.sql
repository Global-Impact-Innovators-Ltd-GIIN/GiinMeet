-- GiinMeet Phase D (features 37 to 47, except 45 which was never assigned).
--
-- RUN ORDER: run this file ONCE in the Supabase SQL Editor, after
-- giinmeet_phaseC2b.sql and giinmeet_security_audit.sql. It is safe to
-- re-run: every change is guarded (IF NOT EXISTS / DO blocks), so a
-- second run changes nothing.
--
-- DO NOT run giinmeet_cohost_role.sql (old file, superseded). The
-- passcode lockdown grant (giinmeet_passcode_lockdown.sql), if it still
-- needs running, runs LAST, after this file.
--
-- What this adds:
--   meetings.e2ee_enabled + meetings.organisation_id (37, 47)
--   meeting_participants.knock_message + lobby_message (38c, 38 lobby chat)
--   host_regulars: regulars who bypass the waiting room (38)
--   user_blocks + meeting_reports (39, server-enforced)
--   meeting_feedback: one-tap rating after a meeting (46)
--   organisations + organisation_members: white-label brands (47, 41 roles)
--   api_keys + webhooks + webhook_deliveries: public API (42)
--   health_checks + health_alerts: monitoring (43)
--   teams.logo_url / accent colours + teams.room_meeting_id (44)
--
-- SECURITY: every new table has RLS enabled. Only the service-role key
-- (the /api routes) can insert, update or delete. The single exception
-- is organisations, which anyone may SELECT (a waiting-room guest must
-- see the organisation's name, logo and colours before signing in).
-- No table here stores a secret in plain text: api_keys stores only a
-- SHA-256 hash plus a short prefix, webhook secrets are only ever
-- returned once, at creation, by the API route.
-- The profiles public-readability issue found by the security audit
-- (anon can read email, phone and is_superadmin) is NOT touched here:
-- it needs a product decision first.

-- 47 + 41: organisations (white-label brand) and their members/roles
-- ---------------------------------------------------------------------------
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  accent_color text,
  accent_hover text,
  slogan text,
  owner_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists organisations_owner_idx
  on public.organisations (owner_id);

create table if not exists public.organisation_members (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  constraint organisation_members_role_check
    check (role in ('admin', 'member'))
);
create index if not exists organisation_members_user_idx
  on public.organisation_members (user_id);

-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 37 + 47: meeting columns
-- ---------------------------------------------------------------------------
alter table public.meetings
  add column if not exists e2ee_enabled boolean not null default false;

alter table public.meetings
  add column if not exists organisation_id uuid references public.organisations(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 38: waiting-room knock + lobby message, on the participant row
-- ---------------------------------------------------------------------------
alter table public.meeting_participants
  add column if not exists knock_message text;

alter table public.meeting_participants
  add column if not exists lobby_message text;

-- ---------------------------------------------------------------------------
-- 38: regulars who bypass the lobby (per host, by email)
-- ---------------------------------------------------------------------------
create table if not exists public.host_regulars (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);
create unique index if not exists host_regulars_host_email_idx
  on public.host_regulars (host_id, lower(email));
create index if not exists host_regulars_host_idx
  on public.host_regulars (host_id);

-- ---------------------------------------------------------------------------
-- 39: blocks and reports (server-enforced, see the token / admit /
-- rejoin routes; a blocked user cannot rejoin by refreshing)
-- ---------------------------------------------------------------------------
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null,
  blocked_user_id uuid,
  blocked_email text,
  reason text,
  created_at timestamptz not null default now(),
  constraint user_blocks_target_check
    check (blocked_user_id is not null or blocked_email is not null)
);
create index if not exists user_blocks_blocker_idx
  on public.user_blocks (blocker_id);
create index if not exists user_blocks_blocked_user_idx
  on public.user_blocks (blocked_user_id);
create index if not exists user_blocks_blocked_email_idx
  on public.user_blocks (lower(blocked_email));

create table if not exists public.meeting_reports (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  reporter_id uuid,
  reporter_email text,
  reason text not null,
  detail text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint meeting_reports_status_check
    check (status in ('open', 'reviewed', 'dismissed'))
);
create index if not exists meeting_reports_meeting_idx
  on public.meeting_reports (meeting_id);
create index if not exists meeting_reports_status_idx
  on public.meeting_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 46: one-tap feedback after a meeting (rating 1 to 5, optional line)
-- ---------------------------------------------------------------------------
create table if not exists public.meeting_feedback (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid,
  guest_name text,
  rating smallint not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint meeting_feedback_rating_check
    check (rating between 1 and 5)
);
-- One rating per signed-in user per meeting; guests (user_id null)
-- may each leave one line.
create unique index if not exists meeting_feedback_user_meeting_idx
  on public.meeting_feedback (meeting_id, user_id)
  where user_id is not null;
create index if not exists meeting_feedback_meeting_idx
  on public.meeting_feedback (meeting_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 42: public API keys and webhooks
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_owner_idx
  on public.api_keys (owner_id);

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  url text not null,
  secret text not null,
  events text[] not null default '{meeting.created,meeting.started,meeting.ended}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists webhooks_owner_idx
  on public.webhooks (owner_id);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  meeting_id uuid,
  event text not null,
  status_code integer,
  ok boolean not null default false,
  attempted_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_webhook_idx
  on public.webhook_deliveries (webhook_id, attempted_at desc);

-- ---------------------------------------------------------------------------
-- 43: health monitoring (checks written by /api/superadmin/health)
-- ---------------------------------------------------------------------------
create table if not exists public.health_checks (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  status text not null,
  detail text,
  checked_at timestamptz not null default now(),
  constraint health_checks_status_check
    check (status in ('up', 'down', 'not-configured'))
);
create index if not exists health_checks_service_idx
  on public.health_checks (service, checked_at desc);

create table if not exists public.health_alerts (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  status text not null,
  message text,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists health_alerts_open_idx
  on public.health_alerts (service, resolved_at)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- 44: team branding + persistent team room
-- ---------------------------------------------------------------------------
alter table public.teams
  add column if not exists logo_url text;

alter table public.teams
  add column if not exists accent_color text;

alter table public.teams
  add column if not exists accent_hover text;

alter table public.teams
  add column if not exists room_meeting_id uuid references public.meetings(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Row level security: service-role only, except organisations SELECT.
-- The /api routes use the service-role key, which bypasses RLS, so
-- they are unaffected. Nothing here grants anon or authenticated
-- users a write path to any new table.
-- ---------------------------------------------------------------------------
alter table public.host_regulars enable row level security;
alter table public.user_blocks enable row level security;
alter table public.meeting_reports enable row level security;
alter table public.meeting_feedback enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.health_checks enable row level security;
alter table public.health_alerts enable row level security;

-- Organisations are the one public read: a guest in the waiting room
-- must see the organisation name, logo and colours before signing in.
-- There is deliberately NO insert, update or delete policy, so only
-- the service-role key (the /api routes, owner/admin verified there)
-- can change an organisation.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'organisations'
      and policyname = 'organisations_public_read'
  ) then
    create policy organisations_public_read
      on public.organisations for select
      using (true);
  end if;
end $$;
