-- =====================================================================
-- GiinMeet Phase 4 — One-time stale-row cleanup (RUN IN SUPABASE SQL
-- EDITOR, after reviewing the counts). The Phase 4 code fix stops NEW
-- leaks (participants are marked LEFT on leave, the token route counts
-- live LiveKit participants, ending a meeting deactivates its room).
-- This file cleans up the mess the leak already left behind.
--
-- Live state at audit time (2026-11-08 ~12:30 SAST):
--   * 72 meetings: 50 Completed / 19 "In Progress" / 3 Scheduled
--   * 1 rooms row still active (slug meet-745cad2f-..., created
--     2026-11-08 02:09, Phase 3 test room, never deactivated)
--   * 1 participants row still JOINED, role HOST, from the same test
--
-- HOW TO RUN: run the SELECTs in Part 1 first and check the numbers
-- look right. Only then run the UPDATEs in Part 2. Everything is
-- guarded by age (older than 4 hours), so a meeting happening right
-- now is never touched.
-- =====================================================================

-- ------------------------- PART 1: LOOK FIRST -------------------------
-- How many stale JOINED allocations are there?
select count(*) as stale_joined_participants
from public.participants
where status = 'JOINED'
  and updated_at < now() - interval '4 hours';

-- How many rooms are still active for meetings that already ended?
select count(*) as active_rooms_for_completed_meetings
from public.rooms r
join public.meetings m on m.id = split_part(r.slug, 'meet-', 2)::uuid
where r.is_active = true
  and r.slug ~ '^meet-[0-9a-f-]{36}$'
  and m.status = 'Completed';

-- Which meetings are stuck "In Progress" for more than 4 hours?
select id, title, time, status
from public.meetings
where status = 'In Progress'
  and time < now() - interval '4 hours'
order by time desc;

-- ------------------------- PART 2: CLEAN UP ---------------------------
-- 1. Free every stale capacity slot: JOINED rows older than 4h -> LEFT.
update public.participants
set status = 'LEFT'
where status = 'JOINED'
  and updated_at < now() - interval '4 hours';

-- 2. Deactivate rooms whose meeting already ended.
update public.rooms r
set is_active = false
from public.meetings m
where r.is_active = true
  and r.slug ~ '^meet-[0-9a-f-]{36}$'
  and m.id = split_part(r.slug, 'meet-', 2)::uuid
  and m.status = 'Completed';

-- 3. Close out meetings stuck "In Progress" for more than 4 hours.
-- (Notes are NOT touched — only the status changes.)
update public.meetings
set status = 'Completed'
where status = 'In Progress'
  and time < now() - interval '4 hours';

-- 4. Waiting-room rows for meetings that are now Completed can never be
-- admitted — close them out so nobody waits forever.
update public.meeting_participants mp
set status = 'Declined'
from public.meetings m
where mp.meeting_id = m.id
  and mp.status = 'Waiting'
  and m.status = 'Completed';
