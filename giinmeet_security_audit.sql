-- =====================================================================
-- GiinMeet security audit (2026-11-23) , database hardening
-- RUN IN SUPABASE SQL EDITOR (project giinmeet, ref umeptngfntryekzxifvq)
-- =====================================================================
-- WHAT THIS FILE DOES
--   1. Closes public read of meeting transcripts and AI summaries.
--      Those two tables had "Allow public read access" policies, so
--      anyone with the anon key (which ships in the public JS bundle)
--      could read the full spoken record and AI summary of ANY
--      meeting. All reads go through server API routes (service role),
--      so dropping the public policies breaks nothing in the app.
--   2. Tightens the 'chat-files' storage bucket: uploads now require
--      the uploader to be the meeting's host or an admitted
--      participant of THAT meeting (before, any signed-in user could
--      upload into any meeting's folder, with only a client-side size
--      and type check). Also adds a host-only delete policy, so an
--      abusive file can actually be removed (before, nothing could
--      delete a chat file except the dashboard).
--   3. Re-schedules the pg_cron email job with a NEW cron secret
--      (rotation). The old secret is printed in
--      giinmeet_pg_cron_reminders.sql, which is committed in git.
--      REPLACE the placeholder below with the new secret BEFORE
--      running section 3, or the job will call with a wrong secret
--      and reminders will stop (fail closed, nothing leaks).
--
-- RUN ORDER
--   Run this AFTER giinmeet_phaseB_transcripts.sql, giinmeet_phaseC1.sql,
--   giinmeet_phaseC2a.sql and giinmeet_phaseC2b.sql. Those files create
--   the tables section 1 touches; if they have not run yet, section 1
--   is a no-op and must be re-run after them. (Audit probe 2026-11-23:
--   the Phase C1/C2a/C2b tables were NOT present in the live database,
--   so those features currently answer NOT_CONFIGURED.)
--   This file does NOT touch the meetings table grants, so it can run
--   before or after giinmeet_passcode_lockdown.sql. If the passcode
--   lockdown is ever re-run, it still goes LAST.
--   Safe to run twice (every statement is guarded or idempotent).
--
-- VERIFY (after running, see the checks at the bottom of this file).
-- =====================================================================

-- ================================================================ 1.
-- Transcripts and summaries: no public read any more.
-- RLS stays enabled; with no SELECT policy for anon/authenticated,
-- those roles read nothing. The service role bypasses RLS, so the
-- server routes (transcript, summary, follow-up, library search)
-- keep working exactly as before.
-- ================================================================
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'meeting_transcripts') then
    execute 'drop policy if exists "Allow public read access to meeting transcripts" on public.meeting_transcripts';
  end if;
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'meeting_summaries') then
    execute 'drop policy if exists "Allow public read access to meeting summaries" on public.meeting_summaries';
  end if;
end $$;

-- ================================================================ 2.
-- Chat-files bucket: uploads only by the host or an admitted
-- participant of the meeting named in the file path, plus a
-- host-only delete policy. Public read is unchanged on purpose:
-- files are shared in meeting chat as public links.
-- ================================================================
drop policy if exists "chat-files authenticated upload" on storage.objects;
create policy "chat-files authenticated upload"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-files'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] in (select id::text from public.meetings)
    and (
      exists (
        select 1 from public.meetings m
        where m.id::text = (storage.foldername(name))[1]
          and (m.admin_id = auth.uid() or m.user_id = auth.uid())
      )
      or exists (
        select 1 from public.meeting_participants p
        where p.meeting_id::text = (storage.foldername(name))[1]
          and p.user_id = auth.uid()
          and p.status = 'Admitted'
      )
    )
  );

drop policy if exists "chat-files host delete" on storage.objects;
create policy "chat-files host delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-files'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.meetings m
      where m.id::text = (storage.foldername(name))[1]
        and (m.admin_id = auth.uid() or m.user_id = auth.uid())
    )
  );

-- ================================================================ 3.
-- CRON SECRET ROTATION (pg_cron job). READ FIRST.
--   1. Pick a NEW secret: a long random string, for example from
--      `openssl rand -hex 32` (or any password generator).
--   2. Put the SAME new value in Vercel: project giinmeet ->
--      Settings -> Environment Variables -> CRON_SECRET (Production),
--      then redeploy so the live site accepts it.
--   3. Replace PASTE_NEW_CRON_SECRET_HERE below with the new secret.
--   4. Run this section. It replaces the 'giinmeet-due-emails' job,
--      so the old (committed, public) secret stops working.
--   5. The old secret is then useless. Also fix the file
--      giinmeet_pg_cron_reminders.sql in the repo: it must never hold
--      a real secret again (the audit already replaced it there with
--      this same placeholder).
-- If you run this section WITHOUT replacing the placeholder, the job
-- calls the endpoint with a wrong secret, gets 401, and no reminder
-- emails go out until you fix it. Nothing is sent wrongly.
-- ================================================================
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

-- =====================================================================
-- VERIFY (run these after the statements above):
--
--   -- 1. Transcripts/summaries must have NO public read policy left:
--   select tablename, policyname from pg_policies
--     where schemaname = 'public'
--     and tablename in ('meeting_transcripts', 'meeting_summaries');
--   -- Expected: only the "Allow service-role write access" rows (which
--   -- are USING (false) and never grant a read), or no rows at all.
--
--   -- 2. As anon (Supabase REST with the anon key, or the SQL Editor's
--   -- "Run as anon"), these must FAIL or return nothing:
--   --   select id from public.meeting_transcripts limit 1;
--   --   select id from public.meeting_summaries limit 1;
--
--   -- 3. Chat-files upload policy must be the tightened one:
--   select policyname from pg_policies
--     where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'chat-files%';
--   -- Expected: "chat-files public read", "chat-files authenticated
--   -- upload", "chat-files host delete".
--
--   -- 4. The cron job exists and the last calls return 200:
--   select jobname, schedule, active from cron.job
--     where jobname = 'giinmeet-due-emails';
--   select status_code, created from net._http_response
--     order by created desc limit 5;
--
--   -- 5. Live retest in the app: join a meeting, share a file in chat
--   -- (must still work for an admitted participant), and confirm a
--   -- signed-out browser can still open the shared file link.
-- =====================================================================

-- =====================================================================
-- NOT RUN (do not uncomment): profiles email/phone/superadmin lockdown.
-- =====================================================================
-- FINDING (audit 2026-11-23, verified live): public.profiles has a
-- SELECT policy USING (true), so anyone with the anon key can list
-- every user's email, phone number, is_superadmin flag and tier.
-- The block below would close that by granting SELECT only on the
-- directory-safe columns, but it is NOT run yet because the app
-- itself reads those columns from the browser today:
--   * src/App.tsx reads the signed-in user's own is_superadmin and
--     is_premium to show the superadmin portal link and the tier.
--   * The workspace directory (src/App.tsx) and contacts search
--     (src/supabaseClient.ts searchProfile) show other users' emails.
-- Run the block only AFTER the code is changed to read the caller's
-- own role/tier from POST /api/superadmin/verify and the server
-- routes instead of the profiles row, and Suku has decided the
-- directory may stop showing emails. Until then this stays a known,
-- accepted exposure: emails of all 12 current users are listable.
--
-- revoke select on public.profiles from anon, authenticated;
-- grant select (
--   id, name, workspace_name, domain, avatar_url, role, timezone,
--   location, skills, social_handles, caption_language, organisation,
--   updated_at
-- ) on public.profiles to anon, authenticated;
-- =====================================================================
