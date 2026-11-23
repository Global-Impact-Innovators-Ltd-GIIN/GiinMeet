-- GiinMeet, Phase C2b schema (remote control, live notes pad,
-- interpretation, anonymous polls, voice notes, whispers, document
-- viewer, breakout self-select, organisation badges).
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org, project giinmeet,
-- ref umeptngfntryekzxifvq) AFTER giinmeet_phaseC2a.sql.
-- Run order for the whole phase: giinmeet_phaseB_transcripts.sql ->
-- giinmeet_phaseC1.sql -> giinmeet_phaseC2a.sql -> THIS FILE.
-- It only ADDS tables/columns; it changes nothing that already exists,
-- and it is safe to run twice (IF NOT EXISTS / DO blocks that check
-- first). Until it runs, the app keeps working: every C2b feature
-- probes for its table or column and says plainly that setup is needed
-- instead of crashing.
--
-- SECURITY (standing rule):
--   * Every new table has RLS enabled and NO client policies on purpose:
--     only the service role (the Next.js API routes, which re-verify the
--     session token and the DB role/host check server-side) may read or
--     write them. A direct client query returns nothing.
--   * Anonymous poll votes store NO voter identity at all: only a
--     one-way hash (poll + voter key + server pepper) used to stop
--     double voting. The API returns totals only, never the hash, so
--     no client, including the host, can read back who voted what.
--   * Whispers are stored in their own table, never in the shared
--     messages table, so they can never leak into the meeting
--     transcript or the library. The API returns a whisper only to
--     its sender or its recipient.
--   * Voice notes are capped server-side (60 seconds, 2 MB) and play
--     only on the listener's own device, never into shared audio.
--   * Least privilege: no grants are added beyond the Supabase defaults
--     (RLS with no policy = denied). No secrets in this file.
--   * NEVER run giinmeet_cohost_role.sql. Do NOT run
--     giinmeet_passcode_lockdown.sql as part of this phase; if it still
--     needs running, it runs LAST, after everything else.
--
-- WHAT each piece exists for:
--   meeting_remote_control .. screen-share control grants (feature 1)
--   meeting_live_notes ...... shared live notes pad, one row per meeting (2)
--   meeting_interpretation .. human interpreter channel state (3)
--   meeting_polls/votes ..... server-run polls, anonymous votes (8)
--   meeting_voice_notes ..... voice notes in chat, private playback (9)
--   meeting_whispers ........ private 1-to-1 chat messages (10)
--   meeting_doc_viewer ...... shared document, host page control (7)
--   meeting_breakout_state .. live breakout rooms, self-select (6)
--   profiles.organisation ... organisation badge text (11)
--   meeting_participants.organisation .. guest badge text (11)

-- ================================================================ 1. REMOTE CONTROL
-- One row per request. status: 'requested', 'granted', 'denied',
-- 'revoked'. Only one granted row per sharer at a time (enforced in
-- the API route, which revokes any earlier grant first). The sharer
-- is the only person who can grant; the controller is the only other
-- person who can revoke their own grant.
create table if not exists public.meeting_remote_control (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sharer_key text not null,
  controller_key text not null,
  controller_name text not null default 'Participant',
  status text not null default 'requested' check (status in ('requested', 'granted', 'denied', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meeting_remote_control enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_remote_control_meeting_idx on public.meeting_remote_control (meeting_id);
create index if not exists meeting_remote_control_sharer_idx on public.meeting_remote_control (meeting_id, sharer_key, status);

-- ================================================================ 2. LIVE NOTES PAD
-- One row per meeting, the shared pad text. Written by the API route
-- (debounced saves from the room); when the meeting ends the host
-- saves it into meeting_notes (the library), so the pad itself is
-- never the permanent copy.
create table if not exists public.meeting_live_notes (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  body text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.meeting_live_notes enable row level security;
-- No client policies on purpose: service role (API routes) only.

-- ================================================================ 3. INTERPRETATION
-- One row per meeting: who is interpreting, into which language.
-- The interpreter speaks on their normal microphone; listeners pick
-- original or interpreter, and the app mutes the other voices for
-- listeners who pick the interpreter. No second audio track, no AI.
create table if not exists public.meeting_interpretation (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  interpreter_key text not null,
  interpreter_name text not null default 'Interpreter',
  interpreter_lang text not null default 'rw' check (interpreter_lang in ('en', 'fr', 'rw')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.meeting_interpretation enable row level security;
-- No client policies on purpose: service role (API routes) only.

-- ================================================================ 8. ANONYMOUS POLLS
-- Server-run polls. is_anonymous polls never store who voted: the
-- votes table holds only a one-way hash used to stop double voting,
-- and the API never returns that hash to any client.
create table if not exists public.meeting_polls (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  is_anonymous boolean not null default false,
  is_closed boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.meeting_polls enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_polls_meeting_idx on public.meeting_polls (meeting_id);

create table if not exists public.meeting_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.meeting_polls(id) on delete cascade,
  option_index integer not null,
  -- One-way hash of (poll id + voter key + server pepper). It proves
  -- this voter already voted, it cannot be read back as an identity.
  voter_hash text not null,
  created_at timestamptz not null default now(),
  constraint meeting_poll_votes_one_per_voter unique (poll_id, voter_hash)
);
alter table public.meeting_poll_votes enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_poll_votes_poll_idx on public.meeting_poll_votes (poll_id);

-- ================================================================ 9. VOICE NOTES
-- One row per voice note. The audio file lives in the existing
-- 'chat-files' storage bucket under voice-notes/, the row only holds
-- its path, never the audio itself. Playback is per-device only.
create table if not exists public.meeting_voice_notes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sender_key text not null,
  sender_name text not null default 'Participant',
  storage_path text not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0 and duration_seconds <= 60),
  created_at timestamptz not null default now()
);
alter table public.meeting_voice_notes enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_voice_notes_meeting_idx on public.meeting_voice_notes (meeting_id);

-- ================================================================ 10. WHISPERS
-- Private 1-to-1 messages. Kept OUT of the messages table on purpose:
-- whispers never appear in the shared transcript or the library.
-- sender_key / recipient_key are the same keys the room uses
-- everywhere (auth user id, or the participant row id for guests).
create table if not exists public.meeting_whispers (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sender_key text not null,
  sender_name text not null default 'Participant',
  recipient_key text not null,
  recipient_name text not null default 'Participant',
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.meeting_whispers enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists meeting_whispers_meeting_idx on public.meeting_whispers (meeting_id);

-- ================================================================ 7. DOCUMENT VIEWER
-- One row per meeting: which document is open, which page everyone
-- sees, and whether viewers may turn pages themselves. The file
-- itself lives in the existing 'chat-files' storage bucket.
create table if not exists public.meeting_doc_viewer (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  title text not null default 'Document',
  storage_path text not null,
  kind text not null default 'pdf' check (kind in ('pdf', 'image')),
  page_count integer not null default 1 check (page_count >= 1),
  current_page integer not null default 1 check (current_page >= 1),
  viewers_can_turn boolean not null default false,
  opened_by text not null,
  updated_at timestamptz not null default now()
);
alter table public.meeting_doc_viewer enable row level security;
-- No client policies on purpose: service role (API routes) only.

-- ================================================================ 6. BREAKOUT STATE
-- The live breakout session, so a refresh lands the participant back
-- in their room (Phase A feature 6) and a participant's own room
-- choice survives. assignments is { peerKey: roomNumber }.
create table if not exists public.meeting_breakout_state (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  rooms_count integer not null default 2 check (rooms_count >= 1 and rooms_count <= 5),
  ends_at timestamptz not null,
  assignments jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.meeting_breakout_state enable row level security;
-- No client policies on purpose: service role (API routes) only.

-- ================================================================ 11. ORGANISATION BADGES
-- The badge text. Signed-in users set it in Settings; guests may set
-- it when they join. Empty means no badge, never an invented one.
alter table public.profiles
  add column if not exists organisation text not null default '';
alter table public.meeting_participants
  add column if not exists organisation text not null default '';
