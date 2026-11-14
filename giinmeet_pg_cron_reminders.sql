-- GiinMeet — Supabase pg_cron scheduler for the email outbox (Phase 1)
-- =====================================================================
-- Purpose: call GET https://giinmeet.nimdaukus.com/api/cron/due-emails
-- every 5 minutes, instead of Vercel Cron (Hobby only allows daily crons).
-- That endpoint queues due meeting reminders and sends up to 20 queued
-- emails per run via Resend. It is idempotent: reminders queue once
-- (unique index + reminder_sent_at) and sent rows are marked sent, so an
-- extra run (e.g. Vercel's daily cron, if it fires) cannot double-send.
--
-- RUN THIS ONLY AFTER:
--   1. `git push origin main` and Vercel has deployed Phase 1, AND
--   2. giinmeet_phase1.sql has run in the Supabase SQL Editor (the
--      endpoint refuses honestly without the pending_emails table), AND
--   3. CRON_SECRET (same value as below) is set in Vercel env vars.
--      The secret value lives ONLY in this file — copy it from here into
--      Vercel (Project -> Settings -> Environment Variables, Production).
--      Do not paste it in chat.
--
-- Run this whole file in the Supabase SQL Editor (SQL Editor -> New query).
-- It is safe to re-run: it replaces the job if one with the same name exists.
-- To stop it later:  select cron.unschedule('giinmeet-due-emails');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'giinmeet-due-emails',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://giinmeet.nimdaukus.com/api/cron/due-emails',
    headers := '{"Authorization": "Bearer aac9b0bdf8f5d4b8b925cb3285e81138b4e63456c9fb1a3948af825a11769372"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Verify the job exists:
--   select jobname, schedule, active from cron.job where jobname = 'giinmeet-due-emails';
-- Check what the last calls returned (200 = ran, 401 = wrong secret,
-- 500 + EMAIL_TABLES_NOT_CONFIGURED = run giinmeet_phase1.sql first):
--   select status_code, created, content::text from net._http_response order by created desc limit 5;
-- See recent runs (pg_cron keeps job history):
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'giinmeet-due-emails') order by start_time desc limit 5;
