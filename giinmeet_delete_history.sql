-- =====================================================================
-- GiinMeet — Delete meetings from Meeting Logs & History (soft delete)
-- (RUN IN SUPABASE SQL EDITOR, GIIN org project, the giinmeet project)
-- =====================================================================
-- RUN ORDER: deploy the delete code FIRST, then run this file once.
-- Before this runs, the app still works fully: the history queries
-- probe for the deleted_at column and fall back cleanly when it is
-- missing, the Delete button only appears once the column exists,
-- and POST /api/meetings/delete answers DELETE_NOT_SET_UP honestly.
-- If this file ran first, the OLD app would simply ignore the new
-- columns (nothing in it reads them).
--
-- WHY SOFT DELETE, NOT HARD DELETE:
--  1. The history row disappears from Meeting Logs & History, which
--     is the pain: expired links/meetings pile up and the list gets
--     very long.
--  2. NOTHING else is destroyed. The meeting row stays (status,
--     notes, passcode, admin, link expiry), meeting_participants
--     rows stay (attendance history), and chat messages live in the
--     thread-based messages table, which is not linked to meetings
--     at all. There is no recordings table. Only the history
--     listing hides the row.
--  3. Every deletion is recorded in meeting_deletions below, so a
--     super-admin audit viewer can be built on top later. (The
--     viewer UI itself is NOT part of this change.)
--  4. The old client-side DELETE policy is dropped (step 3): the
--     anon key could previously hard-delete any own meeting, which
--     would destroy the record and bypass the audit trail — the
--     same self-service hole the co-host SQL closed for roles.
--     After this runs, the only writer of a deletion is the
--     service-role delete route, which verifies the owner first.
--
-- SCOPE: only the meeting OWNER can delete, and only Completed
-- meetings or Scheduled meetings whose start time has passed
-- ("expired"). In Progress and upcoming Scheduled meetings are
-- refused by the route — an upcoming meeting is cancelled, not
-- deleted. Whether delete should also cover scheduled/upcoming
-- entries is a separate decision; the route's rule is one line,
-- so extending it later is trivial.
--
-- WHAT THIS CREATES:
--   * meetings.deleted_at  — timestamptz, NULL = visible in history
--   * meetings.deleted_by  — uuid (auth.users), who deleted it
--   * meeting_deletions    — audit row per deletion: meeting_id,
--                             meeting_title, meeting_time, deleted_by,
--                             deleted_at. NO foreign key to meetings,
--                             so the audit row survives even if a
--                             meeting row is ever hard-deleted later.
--
-- WHAT STAYS WORKING after this runs:
--   - All personal and team meetings are untouched (deleted_at NULL).
--   - History queries read deleted_at best-effort: a meeting without
--     the column (SQL not run yet) is treated as not deleted.
--   - No existing RLS policy on meetings is changed, except the
--     client DELETE policy dropped in step 3 (nothing in the app
--     used a client-side meetings DELETE — cancel uses a status
--     update, and end uses the server route).
-- =====================================================================

-- 1. Soft-delete columns on meetings.
alter table public.meetings
  add column if not exists deleted_at timestamp with time zone,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists idx_meetings_deleted_at on public.meetings(deleted_at);

-- 2. Audit table: one row per deletion. RLS is enabled but there are
--    deliberately NO permissive policies yet — only the service-role
--    delete route writes here, and the service role bypasses RLS. A
--    future super-admin audit viewer will add its own SELECT policy;
--    until then nobody can read or write these rows with the anon key.
create table if not exists public.meeting_deletions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null,
  meeting_title text,
  meeting_time timestamp with time zone,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_at timestamp with time zone default now() not null
);

alter table public.meeting_deletions enable row level security;

-- 3. Close the hard-delete bypass: drop the client-side DELETE policy
--    on meetings. The delete route (service role) still works — the
--    service role bypasses RLS.
drop policy if exists "Allow individual delete access to own meetings" on public.meetings;

-- Verify (run after this file; all checks must pass):
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'meetings'
--     and column_name in ('deleted_at', 'deleted_by');
--   -- expected: 2 rows.
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name = 'meeting_deletions';
--   -- expected: 1 row.
--   select policyname from pg_policies
--   where schemaname = 'public' and tablename = 'meetings'
--     and cmd = 'DELETE';
--   -- expected: 0 rows (the client DELETE policy is gone).
