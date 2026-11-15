-- GiinMeet — Fix Round 7, finding #6: meeting lock column.
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org project, the
-- giinmeet project). Run BEFORE using the meeting lock, and AFTER the
-- Fix Round 7 deploy (the app treats a missing column as unlocked,
-- so nothing breaks if the deploy lands first).
--
-- WHY: the meeting lock used to be client-only state synced by
-- broadcast, so auto-admit and the token route never saw it. Fix
-- Round 7 persists it on the meeting row (POST /api/meetings/lock),
-- the waiting room checks it before auto-admitting, and the token
-- route refuses new mints while it is set. Hosts and already-Admitted
-- rows can still mint while locked.
--
-- VERIFY after running (should return one row, is_locked boolean):
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'meetings' and column_name = 'is_locked';

-- 1. Add the column (safe to re-run: IF NOT EXISTS).
alter table public.meetings
  add column if not exists is_locked boolean not null default false;

-- 2. Let the public read it. The passcode-lockdown SQL revoked
--    table-level SELECT on meetings and re-granted only named columns,
--    so is_locked must be added to that grant list or the app cannot
--    see the lock. (If that lockdown file is ever re-run, add
--    is_locked to its grant list too.)
grant select (is_locked) on public.meetings to anon, authenticated;
