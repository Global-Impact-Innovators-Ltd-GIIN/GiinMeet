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
--      SECURITY AUDIT 2026-11-23: a real secret used to live in this
--      file, committed in git. NEVER put a real secret here again.
--      The value below is a placeholder: put the NEW secret in
--      Vercel (Project -> Settings -> Environment Variables,
--      Production) and in giinmeet_security_audit.sql section 3,
--      which re-schedules the job. Rotate it now: see the
--      "CRON_SECRET rotation" section in KEY_ROTATION_STEPS.md.
--      Do not paste a secret in chat, email or a ticket.
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
    headers := '{"Authorization": "Bearer PASTE_NEW_CRON_SECRET_HERE"}'::jsonb,
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
