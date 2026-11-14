-- GiinMeet — Phase 1 schema: personal rooms, recurring series, reminders,
-- pending-email queue, server-side attendance.
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org, giinmeet project).
-- Safe to run once; re-running is harmless (IF NOT EXISTS / ON CONFLICT /
-- DROP POLICY IF EXISTS). Until it runs, the app keeps working: new
-- columns are probe-gated in code (like link expiry) and fall back to
-- localStorage, and the cron/attendance routes refuse honestly when the
-- tables do not exist yet.
--
-- WHY each piece exists:
--   personal_rooms .... one permanent room per user, addressed by a slug.
--   meetings.series_id / recurrence_* .... links the occurrences of one
--     recurring series so the dashboard can group them and cancel the
--     whole series at once.
--   meetings.reminder_* ... per-meeting reminder settings + a marker so
--     a reminder is queued exactly once.
--   pending_emails ..... the outbox for reminders + attendance reports.
--     Rows are created by the app/cron and sent by /api/cron/due-emails
--     once SMTP is configured (see src/utils/mailer.ts). No client ever
--     reads or writes this table (service role only).
--   meeting_attendance  server-side copy of who was in a meeting, so the
--     attendance report survives the host's browser. Written by
--     /api/meetings/attendance-report at end-of-meeting time.

-- ---------------------------------------------------------------- 1. PERSONAL ROOMS
create table if not exists public.personal_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  passcode text,
  require_waiting_room boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_rooms_slug_unique unique (slug),
  constraint personal_rooms_one_per_user unique (user_id)
);
alter table public.personal_rooms enable row level security;
-- Anyone can resolve a slug to its host (guests open the link signed out).
drop policy if exists "Allow public read access to personal rooms" on public.personal_rooms;
create policy "Allow public read access to personal rooms"
  on public.personal_rooms for select using (true);
-- Only the owner creates / edits their own room.
drop policy if exists "Allow individual insert access to own personal room" on public.personal_rooms;
create policy "Allow individual insert access to own personal room"
  on public.personal_rooms for insert with check (auth.uid() = user_id);
drop policy if exists "Allow individual update access to own personal room" on public.personal_rooms;
create policy "Allow individual update access to own personal room"
  on public.personal_rooms for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------- 2. MEETINGS — series + reminders + personal-room link
alter table public.meetings add column if not exists personal_room_slug text;
alter table public.meetings add column if not exists series_id uuid;
alter table public.meetings add column if not exists recurrence_rule text;
alter table public.meetings add column if not exists recurrence_count integer;
alter table public.meetings add column if not exists reminder_enabled boolean not null default true;
alter table public.meetings add column if not exists reminder_minutes_before integer not null default 15;
alter table public.meetings add column if not exists reminder_sent_at timestamptz;
create index if not exists meetings_series_id_idx on public.meetings (series_id);
create index if not exists meetings_personal_room_slug_idx on public.meetings (personal_room_slug);

-- ---------------------------------------------------------------- 3. PENDING EMAILS (outbox)
create table if not exists public.pending_emails (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('meeting_reminder', 'attendance_report')),
  meeting_id uuid references public.meetings(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'awaiting_provider')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.pending_emails enable row level security;
-- No client policies on purpose: only the service role (API routes) may
-- read/write the outbox. A select with no policy returns nothing.
create unique index if not exists pending_emails_one_per_meeting_type
  on public.pending_emails (meeting_id, type);

-- ---------------------------------------------------------------- 4. SERVER-SIDE ATTENDANCE
create table if not exists public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  participant_key text not null,
  name text not null,
  joined_at timestamptz not null,
  left_at timestamptz,
  is_late boolean not null default false,
  created_at timestamptz not null default now(),
  constraint meeting_attendance_one_row unique (meeting_id, participant_key)
);
alter table public.meeting_attendance enable row level security;
-- No client policies on purpose: written by the attendance-report API
-- route (service role) only.
create index if not exists meeting_attendance_meeting_idx on public.meeting_attendance (meeting_id);
