-- GiinMeet Live Interview Mode — database setup.
--
-- Run in the Supabase dashboard: SQL Editor > New query, paste, Run.
-- Idempotent: safe to run twice (IF NOT EXISTS + drop/create policies).
--
-- What it creates:
--   * interviews — one row per interview, linked to a normal meetings row.
--   * interview_participants — candidate + interviewers, each with a
--     random token. The token in the invite link is the credential; it is
--     never shown in the app to anyone except the host who created it.
--   * interview_events — the integrity timeline. One row per detected
--     event, with the exact time, plain words, severity, and away
--     duration. Rows are append-only: no UPDATE or DELETE policy exists,
--     so a candidate can never edit the log after the fact.
--   * interview_questions — question bank entries, per interview, with
--     order and an optional per-question time limit in seconds.
--   * interview_notes — private notes, one row per interviewer per
--     question. A candidate never reads these (no public policy).
--   * interview_scores — 1 to 5 scores per interviewer per criterion.
--   * interview_templates — saved question sets + rubric + timings.
--   * interview_feedback — the candidate's short feedback after.
--   * bucket 'interview-recordings' (private) — the lead interviewer's
--     recording of the candidate, uploaded through a service-role API
--     route. Files live under <interviewId>/<timestamp>.webm.
--   * No public SELECT/INSERT/UPDATE policy on any interview table:
--     every read and write goes through the service-role API routes in
--     app/api/interviews, which verify the caller (signed-in host or
--     interviewer, or a valid invite token). The anon key alone reads
--     nothing from these tables.
--
-- Honest limits, stated here so nobody over-promises them later:
--   * A browser cannot prevent tab switching. interview_events records
--     DETECTION only.
--   * Second screen use cannot be detected by a browser, and is never
--     claimed in the report.
--   * There is no cloud recording. The recording is the lead
--     interviewer's local capture of the candidate's remote tracks,
--     uploaded after the interview.

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  role_title text not null default '',
  description text not null default '',
  duration_minutes integer not null default 60 check (duration_minutes > 0 and duration_minutes <= 480),
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'paused', 'ended', 'cancelled')),
  candidate_row_id uuid,
  recording_path text,
  recording_uploaded_at timestamptz,
  transcript_text text,
  criteria jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists public.interview_participants (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  role text not null check (role in ('candidate', 'interviewer', 'lead')),
  name text not null,
  email text not null default '',
  phone text not null default '',
  token uuid not null default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  meeting_participant_id uuid,
  identity_confirmed boolean not null default false,
  identity_method text check (identity_method in ('email-code', 'id-camera', 'name-confirm')),
  identity_confirmed_at timestamptz,
  otp_hash text,
  otp_expires_at timestamptz,
  id_shown_at timestamptz,
  created_at timestamptz not null default now(),
  unique (interview_id, token)
);

create table if not exists public.interview_events (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  client_id text not null,
  event_type text not null,
  detail text not null default '',
  severity text not null check (severity in ('low', 'medium', 'high')),
  occurred_at timestamptz not null,
  away_seconds integer,
  actor text not null default 'candidate',
  created_at timestamptz not null default now(),
  unique (interview_id, client_id)
);

create table if not exists public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_text text not null,
  sort_order integer not null default 0,
  time_limit_seconds integer,
  created_at timestamptz not null default now()
);

create table if not exists public.interview_notes (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  interviewer_id text not null,
  interviewer_name text not null default '',
  question_id uuid references public.interview_questions(id) on delete set null,
  note_text text not null default '',
  updated_at timestamptz not null default now(),
  unique (interview_id, interviewer_id, question_id)
);

create table if not exists public.interview_scores (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  interviewer_id text not null,
  interviewer_name text not null default '',
  criterion text not null,
  score integer not null check (score >= 1 and score <= 5),
  updated_at timestamptz not null default now(),
  unique (interview_id, interviewer_id, criterion)
);

create table if not exists public.interview_templates (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role_title text not null default '',
  questions jsonb not null default '[]'::jsonb,
  criteria jsonb not null default '[]'::jsonb,
  default_time_limit_seconds integer,
  created_at timestamptz not null default now()
);

create table if not exists public.interview_feedback (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  rating integer check (rating >= 1 and rating <= 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

alter table public.interviews enable row level security;
alter table public.interview_participants enable row level security;
alter table public.interview_events enable row level security;
alter table public.interview_questions enable row level security;
alter table public.interview_notes enable row level security;
alter table public.interview_scores enable row level security;
alter table public.interview_templates enable row level security;
alter table public.interview_feedback enable row level security;

-- No public policies on purpose: the service-role API routes are the
-- only readers and writers. Dropping any stray policy keeps that true
-- even if an older migration created one.
drop policy if exists "interview public read" on public.interviews;
drop policy if exists "interview public read" on public.interview_participants;
drop policy if exists "interview public read" on public.interview_events;
drop policy if exists "interview public read" on public.interview_questions;
drop policy if exists "interview public read" on public.interview_notes;
drop policy if exists "interview public read" on public.interview_scores;
drop policy if exists "interview public read" on public.interview_templates;
drop policy if exists "interview public read" on public.interview_feedback;

create index if not exists interview_events_interview_idx on public.interview_events (interview_id, occurred_at);
create index if not exists interview_participants_interview_idx on public.interview_participants (interview_id);
create index if not exists interview_participants_token_idx on public.interview_participants (token);
create index if not exists interview_questions_interview_idx on public.interview_questions (interview_id, sort_order);
create index if not exists interviews_host_idx on public.interviews (host_id, created_at desc);
create index if not exists interviews_meeting_idx on public.interviews (meeting_id);

-- Private storage bucket for candidate recordings. The bucket is NOT
-- public: the report links to a signed URL minted by the API route, so
-- a recording is only downloadable by the host or an interviewer.
insert into storage.buckets (id, name, public)
values ('interview-recordings', 'interview-recordings', false)
on conflict (id) do update set public = false;

drop policy if exists "interview-recordings public read" on storage.objects;
drop policy if exists "interview-recordings service write" on storage.objects;
