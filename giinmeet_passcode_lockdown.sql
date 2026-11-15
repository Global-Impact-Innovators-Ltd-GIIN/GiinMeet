-- =====================================================================
-- GiinMeet Phase 4 — Passcode lockdown (RUN IN SUPABASE SQL EDITOR)
-- =====================================================================
-- Problem (Phase 4 audit defect #6): the `meetings` table had a public
-- SELECT policy (USING (true)) AND the app read the whole row, so anyone
-- with the anon key could read ANY meeting's passcode via the Supabase
-- API. The passcode was a UI gate, not a secret.
--
-- What Phase 4 already changed in code (deployed):
--   * The passcode is verified SERVER-SIDE only, in
--     POST /api/meetings/verify-passcode (service-role key).
--   * The host fetches a passcode through the host-only
--     POST /api/meetings/passcode route (signed-in host, verified
--     server-side).
--   * Every client-side meetings query now selects an explicit column
--     list (MEETING_PUBLIC_COLUMNS in src/supabaseClient.ts) that does
--     NOT include `passcode`. No client code does select('*') on
--     meetings any more (checked 2026-11-08).
--
-- What THIS file does: revoke table-level SELECT on `meetings` from the
-- anon/authenticated roles and re-grant SELECT on every column EXCEPT
-- `passcode`. After this runs, an anon-key read of the passcode column
-- fails — the passcode can only be reached through the two server
-- routes above. INSERT/UPDATE/DELETE policies are untouched, so
-- creating meetings (which writes a passcode) keeps working.
--
-- SAFE TO RUN NOW: the deployed Phase 4 code no longer selects the
-- passcode column from the browser. If you roll the app back to Phase 3
-- code, DO NOT run this file (the old code selects '*' and would break).
--
-- RUN ORDER (updated 2026-11-15): run this file AFTER
-- giinmeet_phase3_teams.sql and giinmeet_delete_history.sql, because
-- the grant below now includes team_id and deleted_at — those columns
-- must exist first or the GRANT fails.
--
-- After running, verify with the check at the bottom: as anon, selecting
-- the public columns must work and selecting `passcode` must fail.
-- =====================================================================

-- 1. Drop the table-level SELECT grant, then grant only the safe columns.
revoke select on public.meetings from anon, authenticated;
grant select (
  id, user_id, title, time, duration, status, host, notes,
  action_items_count, created_at, admin_id, require_waiting_room,
  is_locked, series_id, recurrence_rule, recurrence_count,
  deleted_at, team_id
) on public.meetings to anon, authenticated;
-- NOTE (Fix Round 7, #6): is_locked was added to the grant list so the
-- app can read the persisted meeting lock. If this file is ever re-run,
-- keep is_locked in the list.
-- NOTE (2026-11-15): series_id / recurrence_rule / recurrence_count
-- (recurring-series grouping, 47ddca2), deleted_at (delete from
-- history, 075f4c6) and team_id (team workspaces, Phase 3) were added
-- because MEETING_PUBLIC_COLUMNS in src/supabaseClient.ts now selects
-- them from the browser. A grant that omits them would break history
-- grouping, delete, and team meetings with "permission denied".

-- 2. Server-side verification helper (used by the API route as a second
-- path; the route itself uses the service key, so this function is a
-- convenience for SQL-level checks, not something the browser calls).
-- SECURITY DEFINER = runs with the owner's rights, bypassing the revoke.
create or replace function public.verify_meeting_passcode(
  p_meeting_id uuid,
  p_passcode text
)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.meetings
    where id = p_meeting_id
      and passcode is not null
      and upper(passcode) = upper(nullif(trim(p_passcode), ''))
  );
$$;

-- =====================================================================
-- VERIFY (run these after the statements above):
--
--   -- As the dashboard (postgres role) this still works:
--   select id, title, status from public.meetings limit 1;
--
--   -- As anon (use the SQL Editor's "Run as anon" if available, or the
--   -- API): this MUST fail with "permission denied for table meetings"
--   -- or "permission denied for column passcode":
--   --   select passcode from public.meetings limit 1;
--
-- If the passcode select still returns rows, the revoke did not apply —
-- do not rely on the passcode being secret until it fails.
-- =====================================================================
