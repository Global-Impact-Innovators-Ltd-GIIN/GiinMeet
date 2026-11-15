-- =====================================================================
-- GiinMeet Phase 3 (Feature 2) — Co-host + Moderator roles
-- (RUN IN SUPABASE SQL EDITOR, GIIN org project, the giinmeet project)
-- =====================================================================
-- RUN ORDER: deploy the Phase 3 Feature 2 code FIRST, then run this
-- file once. The new code's role route works for Co-Host before this
-- runs (the Round 9 statuses SQL, run by Suku 2026-11-14, already
-- widened meeting_participants.role to include 'CoHost'); a Moderator
-- grant answers honestly "roles are not set up yet" until this runs.
-- If this file ran first, the OLD app's Make Co-Host button would
-- break (see step 3), so deploy first.
--
-- This file SUPERSEDES giinmeet_cohost_role.sql — do not run that old
-- file as well. It only added 'CoHost'; this file adds 'CoHost' AND
-- 'Moderator' to both role columns, and closes the hole below.
--
-- WHY:
--  1. The Moderator role is new: the host grants it from the
--     participants panel (meeting_participants.role = 'Moderator') and
--     the token route derives it. Both role columns have CHECK
--     constraints that reject it until this runs:
--       * meeting_participants.role IN ('Admin', 'Participant',
--         'CoHost')            — 'CoHost' came from the Round 9 SQL
--       * participants.role         IN ('HOST', 'SPEAKER', 'GUEST')
--  2. SELF-PROMOTION HOLE (the reason role grants moved server-side):
--     the admission-lockdown SQL deliberately kept
--     UPDATE (role, updated_at) granted to anon / authenticated so the
--     old direct client-side setParticipantRole kept working — which
--     meant ANYONE with the anon key could grant THEMSELVES the CoHost
--     role on any meeting and then admit people and mute participants
--     through the host-verified admit/control routes (those routes
--     trust the row). The new code grants roles only through
--     POST /api/meetings/role, which verifies the host and writes with
--     the service-role key — so step 3 below revokes the client-side
--     role grant. After this runs, the only writer of the role column
--     is the service role; a direct client update fails.
--
-- WHAT STAYS WORKING after this runs:
--   - Guests still INSERT their own row when they join the waiting
--     room, and still read rows — INSERT/SELECT are untouched.
--   - The admit / control / token / role / breakout routes all write
--     with the service role, which bypasses RLS and column grants.
--   - No client code updates meeting_participants.role any more
--     (setParticipantRole now calls POST /api/meetings/role).
-- =====================================================================

do $$
declare
  c_name text;
begin
  -- 1. meeting_participants.role: allow 'CoHost' and 'Moderator'.
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.meeting_participants'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%role%';
  if c_name is not null then
    execute format('alter table public.meeting_participants drop constraint %I', c_name);
  end if;
  alter table public.meeting_participants
    add constraint meeting_participants_role_check
    check (role in ('Admin', 'Participant', 'CoHost', 'Moderator'));

  -- 2. participants.role: allow 'COHOST' and 'MODERATOR'.
  --    (The token route still stores role-holders as 'GUEST' in this
  --    allocation row as a safe default; the widening is for
  --    consistency and future use, not a live dependency.)
  select conname into c_name
  from pg_constraint
  where conrelid = 'public.participants'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%role%';
  if c_name is not null then
    execute format('alter table public.participants drop constraint %I', c_name);
  end if;
  alter table public.participants
    add constraint participants_role_check
    check (role in ('HOST', 'SPEAKER', 'GUEST', 'COHOST', 'MODERATOR'));
end $$;

-- 3. Close the self-promotion bypass: no client (anon / authenticated)
--    may UPDATE the role column any more. The service-role key used by
--    POST /api/meetings/role bypasses grants and RLS, so role grants
--    keep working — only through the host-verified route.
revoke update (role) on public.meeting_participants from anon, authenticated;

-- Verify (both CHECKs must list the new values; the role grant must
-- be gone for anon / authenticated):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid in ('public.meeting_participants'::regclass,
--                      'public.participants'::regclass)
--     and contype = 'c' and pg_get_constraintdef(oid) like '%role%';
--   select 'role-update-still-granted' as problem
--   from information_schema.role_column_grants
--   where table_name = 'meeting_participants'
--     and column_name = 'role'
--     and privilege_type = 'UPDATE'
--     and grantee in ('anon', 'authenticated');
--   -- expected: 0 rows (no problem).
