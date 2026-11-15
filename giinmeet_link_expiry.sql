-- GiinMeet — Fix Round 9 (9C): meeting link expiry columns.
--
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org project, the
-- giinmeet project). Safe to run once; re-running is harmless
-- (IF NOT EXISTS).
--
-- WHAT: two columns on public.meetings.
--   link_expiry_mode text — 'on-end' (the link dies when the meeting
--     ends; the default for instant meetings) or '1m' / '2m' / '3m' /
--     '6m' / '12m' (the link lives that many months from the meeting's
--     scheduled time).
--   link_expires_at timestamptz — the absolute expiry for a duration
--     mode; NULL for 'on-end'.
-- Enforcement is server-side in POST /api/livekit/token (a token is
-- refused with LINK_EXPIRED once the date passes) and the waitroom
-- shows a friendly "This meeting link has expired" screen. Until this
-- file runs, the app probes for the columns, finds them missing, and
-- treats every link as live — nothing breaks, the expiry feature is
-- simply dormant.
-- Existing meetings have NULL in both columns, which the app reads as
-- 'on-end' (their links die when the meeting ends, as before).

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS link_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_expiry_mode text;
