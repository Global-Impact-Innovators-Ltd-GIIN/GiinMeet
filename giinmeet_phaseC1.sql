-- GiinMeet, Phase C1 schema (features 23, 24, 28, 29, 33, 34, 35, 36).
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org, project giinmeet,
-- ref umeptngfntryekzxifvq) AFTER giinmeet_phaseB_transcripts.sql.
-- Run order for the whole phase: phaseB transcripts -> THIS FILE.
-- It only ADDS tables/columns; it changes nothing that already exists,
-- and it is safe to run twice (IF NOT EXISTS / ON CONFLICT / DROP POLICY
-- IF EXISTS). Until it runs, the app keeps working: every C1 feature
-- probes for its table and says plainly that setup is needed instead of
-- crashing (calendar sync, templates, notes, action items, polls).
--
-- SECURITY (standing Phase C1 rule):
--   * Every new table has RLS enabled and NO client policies on purpose:
--     only the service role (the Next.js API routes, which re-verify the
--     session token and the DB role/host check server-side) may read or
--     write them. A direct client query returns nothing.
--   * Least privilege: no grants are added beyond the Supabase defaults
--     (RLS with no policy = denied). Calendar OAuth tokens are stored
--     server-side only and are NEVER sent to a browser; when
--     GIINMEET_TOKEN_ENCRYPTION_KEY is set, the API encrypts tokens
--     (AES-256-GCM) before storing them.
--   * No secrets in this file. The translate/LLM/calendar keys live only
--     in Vercel env vars, never in SQL.
--   * Passcodes are stored as plain text today (same as the existing
--     meetings.passcode column), the post-Phase-C security audit owns
--     hashing them; this file does not add any new passcode column.
--   * NEVER run giinmeet_cohost_role.sql. Do NOT run
--     giinmeet_passcode_lockdown.sql as part of this phase; if it still
--     needs running, it runs LAST, after everything else.
--
-- WHAT each piece exists for:
--   calendar_connections ..... OAuth tokens for Google / Outlook sync (23)
--   meetings.calendar_sync ... provider event ids per meeting (23)
--   meeting_templates ........ saved meeting setups, one-tap start (24)
--   meeting_notes ............ per-meeting notes in the library (28)
--   meeting_files ............ local recordings + files, registered (28)
--   action_items ............. tracked actions from summaries (35)
--   meeting_attendance_events  join/leave/speak events per meeting (34)
--   scheduling_polls/votes ... "find a time" polls + responses (33)
--   profiles.caption_language  the user's ONE caption language (36)

-- ================================================================ 23. CALENDAR
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  -- Tokens are opaque blobs to the database: access_token and
  -- refresh_token are AES-256-GCM ciphertext (base64) when the server
  -- encryption key is configured, plain provider tokens otherwise.
  -- They are NEVER returned to a browser by any route.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  calendar_id text,
  account_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connections_one_per_user_provider unique (user_id, provider)
);
alter table public.calendar_connections enable row level security;
-- No client policies on purpose: service role (API routes) only.

alter table public.meetings
  add column if not exists calendar_sync jsonb not null default '{}'::jsonb;

-- ================================================================ 24. TEMPLATES
create table if not exists public.meeting_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  title text not null,
  duration_minutes integer not null default 60 check (duration_minutes > 0 and duration_minutes <= 1440),
  require_waiting_room boolean not null default true,
  passcode text,
  attendee_emails jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meeting_templates enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_templates_user_idx on public.meeting_templates (user_id);

-- ================================================================ 28. LIBRARY
create table if not exists public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meeting_notes enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_notes_meeting_idx on public.meeting_notes (meeting_id);

create table if not exists public.meeting_files (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- kind: 'local-recording' (a recording file that lives on the host's
  -- own device, GiinMeet has NO cloud recording, so the library records
  -- where the file is, it does not hold the video) or 'file' (a document
  -- or file shared with the meeting, e.g. a chat-files bucket URL).
  kind text not null check (kind in ('local-recording', 'file')),
  name text not null,
  url text,
  size_bytes bigint,
  duration_seconds integer,
  recorded_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
alter table public.meeting_files enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_files_meeting_idx on public.meeting_files (meeting_id);

-- ================================================================ 35. ACTION ITEMS
create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  text text not null,
  owner text not null default 'Unassigned',
  status text not null default 'open' check (status in ('open', 'done')),
  -- 'summary' = copied from the AI summary; 'manual' = added by the host;
  -- 'carried' = carried into this meeting from an earlier one.
  source text not null default 'summary' check (source in ('summary', 'manual', 'carried')),
  carried_from_meeting_id uuid references public.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.action_items enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists action_items_meeting_idx on public.action_items (meeting_id);
create index if not exists action_items_open_idx on public.action_items (meeting_id, status);

-- ================================================================ 34. ATTENDANCE EVENTS
create table if not exists public.meeting_attendance_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  participant_key text not null,
  name text not null,
  -- event_type: 'join' | 'leave' | 'speak' (speak rows carry the total
  -- seconds that person spoke, aggregated by the host's browser).
  event_type text not null check (event_type in ('join', 'leave', 'speak')),
  at timestamptz not null default now(),
  seconds integer,
  created_at timestamptz not null default now()
);
alter table public.meeting_attendance_events enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_attendance_events_meeting_idx
  on public.meeting_attendance_events (meeting_id);

-- ================================================================ 33. SCHEDULING POLLS
create table if not exists public.scheduling_polls (
  id uuid primary key default gen_random_uuid(),
  -- token is the unguessable poll link key (32 random chars). Anyone with
  -- the link can vote, that is the point, but the token is never listed
  -- anywhere and votes are rate-limited server-side.
  token text not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  duration_minutes integer not null default 60 check (duration_minutes > 0 and duration_minutes <= 1440),
  slots jsonb not null default '[]'::jsonb,
  attendee_emails jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);
alter table public.scheduling_polls enable row level security;
-- No client policies on purpose: service role (API routes) only.

create table if not exists public.scheduling_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.scheduling_polls(id) on delete cascade,
  voter_name text not null,
  -- votes: { "<slot ISO time>": "yes" | "no" | "maybe" }
  votes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.scheduling_poll_votes enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists scheduling_poll_votes_poll_idx on public.scheduling_poll_votes (poll_id);

-- ================================================================ 36. CAPTION LANGUAGE
-- Each user chooses ONE caption language (or none): 'en' | 'fr' | 'rw' |
-- 'off'. Stored here so the choice follows the user; the browser also
-- keeps a local copy for guests and for before sign-in.
alter table public.profiles
  add column if not exists caption_language text not null default 'en'
  check (caption_language in ('en', 'fr', 'rw', 'off'));
