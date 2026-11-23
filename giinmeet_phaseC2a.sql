-- GiinMeet, Phase C2a schema (short links, agenda storage, certificates).
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org, project giinmeet,
-- ref umeptngfntryekzxifvq) AFTER giinmeet_phaseC1.sql.
-- Run order for the whole phase: giinmeet_phaseB_transcripts.sql ->
-- giinmeet_phaseC1.sql -> THIS FILE.
-- It only ADDS tables/columns; it changes nothing that already exists,
-- and it is safe to run twice (IF NOT EXISTS / DO blocks that check
-- first). Until it runs, the app keeps working: every C2a feature
-- probes for its table or column and says plainly that setup is needed
-- instead of crashing (short links, saved agenda, certificates).
--
-- SECURITY (standing rule):
--   * Every new table has RLS enabled and NO client policies on purpose:
--     only the service role (the Next.js API routes, which re-verify the
--     session token and the DB role/host check server-side) may read or
--     write them. A direct client query returns nothing.
--   * Short codes are unguessable (8 random base62 characters, about
--     218 trillion combinations) and unique; the code alone only resolves
--     to a meeting id, never to a passcode, and the normal join flow
--     (passcode gate + waiting room for everyone except the host) still
--     applies after the redirect.
--   * Least privilege: no grants are added beyond the Supabase defaults
--     (RLS with no policy = denied). No secrets in this file.
--   * NEVER run giinmeet_cohost_role.sql. Do NOT run
--     giinmeet_passcode_lockdown.sql as part of this phase; if it still
--     needs running, it runs LAST, after everything else.
--
-- WHAT each piece exists for:
--   short_links ............ short code -> meeting id (feature 1)
--   meetings.agenda_items .. saved agenda with a time per item (feature 4,
--                            also read by the meeting prep brief, feature 6)
--   meeting_files 'certificate' kind .. attendance certificates listed
--                            in the library (features 5 and 9)

-- ================================================================ 1. SHORT LINKS
create table if not exists public.short_links (
  id uuid primary key default gen_random_uuid(),
  -- 8 random base62 characters, unguessable, unique. One short link per
  -- meeting: a second create for the same meeting returns the first one.
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{6,16}$'),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  use_count integer not null default 0,
  constraint short_links_one_per_meeting unique (meeting_id)
);
alter table public.short_links enable row level security;
-- No client policies on purpose: service role (API routes) only.
create index if not exists short_links_code_idx on public.short_links (code);
create index if not exists short_links_meeting_idx on public.short_links (meeting_id);

-- ================================================================ 4. SAVED AGENDA
-- The in-room agenda already exists live; this column persists it so the
-- timer, the prep brief and the next meeting can read the same agenda.
-- Shape: [{ "id": "...", "text": "...", "startTime": "14:00",
-- "endTime": "14:15", "durationMinutes": 15 }]
alter table public.meetings
  add column if not exists agenda_items jsonb not null default '[]'::jsonb;

-- ================================================================ 5 + 9. CERTIFICATES
-- Certificates are files in the library (kind 'certificate'), issued
-- from attendance. The Phase C1 check constraint only allowed
-- 'local-recording' and 'file', so replace it, whatever its current
-- name is, with one that also allows 'certificate'.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.meeting_files'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute 'alter table public.meeting_files drop constraint ' || quote_ident(r.conname);
  end loop;
end $$;
alter table public.meeting_files
  add constraint meeting_files_kind_check
  check (kind in ('local-recording', 'file', 'certificate'));
