-- GiinMeet — Fix Round 9 (9B): reconcile stale "In Progress" rows.
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org project, the
-- giinmeet project). Read-only preview first, then the update.
-- Run this ONCE to clean up rows left over from before the Round 9
-- leave route (which completes a meeting when its last participant
-- leaves). New stale rows should not appear after the Round 9 deploy.
--
-- RULE: a meeting is stale when it is still 'In Progress', its
-- scheduled time was more than 24 hours ago, and NOBODY is currently
-- admitted to it (no 'Admitted' participant rows). A live meeting
-- always has at least one Admitted row, so a live meeting is never
-- touched. A scheduled meeting is never touched (status filter).
-- SQL cannot see the LiveKit room, so the admitted-row check is the
-- proxy for "nobody is in the room" — that is why the 24-hour guard
-- is there as well.
--
-- 1. PREVIEW (run this first, check the list looks right):
SELECT id, title, time, status
FROM public.meetings
WHERE status = 'In Progress'
  AND time < now() - interval '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM public.meeting_participants p
    WHERE p.meeting_id = meetings.id AND p.status = 'Admitted'
  )
ORDER BY time DESC;

-- 2. RECONCILE (only after the preview looks right — uncomment to run):
-- UPDATE public.meetings SET status = 'Completed'
-- WHERE status = 'In Progress'
--   AND time < now() - interval '24 hours'
--   AND NOT EXISTS (
--     SELECT 1 FROM public.meeting_participants p
--     WHERE p.meeting_id = meetings.id AND p.status = 'Admitted'
--   );
