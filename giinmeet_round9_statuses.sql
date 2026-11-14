-- GiinMeet — Fix Round 9: widen the status CHECK constraints.
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org project, the
-- giinmeet project). Safe to run once; re-running is harmless (each
-- DROP is IF EXISTS and each ADD recreates the same constraint).
--
-- WHY: Round 8's cancel uses meetings.status = 'Cancelled', and Round 9
-- keeps a removed participant's row with status 'Removed' (the rejoin
-- block) and a leaver's row with status 'Left' (the rejoin reactivate).
-- The canonical schema's CHECK constraints only allow
-- ('Completed','In Progress','Scheduled') and
-- ('Waiting','Admitted','Declined'), so those writes fail until this
-- runs. The app falls back honestly until then (kick falls back to
-- delete, leave falls back to delete, cancel reports the failure) —
-- nothing breaks, but the Round 9 behaviours only go fully live after
-- this file runs.
--
-- NOTE: the constraint names below are Postgres's defaults for the
-- inline CHECKs in the canonical schema. If the live table's
-- constraints were renamed, the DROP IF EXISTS skips silently and the
-- ADD fails with "constraint already exists" — in that case check the
-- real names with:  select conname from pg_constraint where
-- conrelid = 'public.meetings'::regclass;  (and the same for
-- public.meeting_participants) and re-run with the real names.

-- 1. meetings.status gains 'Cancelled'.
ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_status_check;
ALTER TABLE public.meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('Completed', 'In Progress', 'Scheduled', 'Cancelled'));

-- 2. meeting_participants.status gains 'Removed' and 'Left'.
ALTER TABLE public.meeting_participants DROP CONSTRAINT IF EXISTS meeting_participants_status_check;
ALTER TABLE public.meeting_participants ADD CONSTRAINT meeting_participants_status_check
  CHECK (status IN ('Waiting', 'Admitted', 'Declined', 'Removed', 'Left'));

-- 3. meeting_participants.role gains 'CoHost' (re-asserts what
-- giinmeet_cohost_role.sql set up; harmless if already applied).
ALTER TABLE public.meeting_participants DROP CONSTRAINT IF EXISTS meeting_participants_role_check;
ALTER TABLE public.meeting_participants ADD CONSTRAINT meeting_participants_role_check
  CHECK (role IN ('Admin', 'Participant', 'CoHost'));
