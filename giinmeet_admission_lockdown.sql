-- GiinMeet — Fix Round 7, finding #4: admission lockdown.
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org project, the
-- giinmeet project). Run AFTER the Fix Round 7 deploy.
--
-- WHY: admission used to be a direct client-side row update under a
-- public UPDATE policy, so anyone could flip their own
-- meeting_participants row to Admitted with the anon key and walk in.
-- Fix Round 7 moved admission to the host-verified server route
-- POST /api/meetings/admit, which writes with the service-role key.
-- This SQL closes the bypass for good: the public can no longer
-- UPDATE the status column at all.
--
-- WHAT STAYS WORKING after this runs:
--   - The app's client-side writes to meeting_participants are only
--     updateParticipantStatus (status — going away) and
--     setParticipantRole (role — kept below, and only used while the
--     giinmeet_cohost_role.sql "CoHost" role exists).
--   - Guests still INSERT their own row when they join the waiting
--     room, and still read rows — INSERT/SELECT are untouched.
--   - The admit route writes with the service role, which bypasses
--     RLS entirely.
--
-- VERIFY after running (should return exactly one row, "restricted"):
--   select 'restricted' as result
--   from information_schema.role_column_grants
--   where table_name = 'meeting_participants'
--     and column_name = 'status'
--     and privilege_type = 'UPDATE'
--     and grantee in ('anon', 'authenticated');
--   -- expected: 0 rows.

-- 1. Drop the wide-open public UPDATE policy, if it exists.
drop policy if exists "Public can update participants" on public.meeting_participants;

-- 2. Re-grant UPDATE on the meeting_participants table, but ONLY for
--    the role column (used by setParticipantRole when a host makes
--    someone a co-host) and updated_at. The status column is
--    deliberately NOT granted, so no client can flip Admitted/Waiting/
--    Declined any more. (Column-level grants replace the table-level
--    UPDATE the old policy relied on.)
revoke update on public.meeting_participants from anon, authenticated;
grant update (role, updated_at) on public.meeting_participants to anon, authenticated;

-- 3. Belt and braces: even if a policy is re-added later, a status
--    update from a non-service-role caller is blocked at the policy
--    level too. The admit route uses the service role, which bypasses
--    RLS, so it is unaffected.
--    (No new policy is created here — the existing public UPDATE policy
--    was dropped in step 1. If a future policy re-opens UPDATE, the
--    column grant in step 2 still stops status writes.)
