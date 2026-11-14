-- GiinMeet Phase 2 (#11) — chat-files Storage bucket for file sharing
-- in meeting chat.
--
-- Run in the Supabase dashboard: SQL Editor > New query, paste, Run.
-- Idempotent: safe to run twice (bucket upsert + drop/create policies).
--
-- What it creates:
--   * bucket 'chat-files' (public read) — files are stored under
--     <meetingId>/<timestamp>-<filename>, so they are scoped per meeting.
--   * public SELECT policy — anyone with the link can download a file
--     shared in a meeting (same design as the in-app upload helper,
--     which returns a public URL and posts it as a chat message).
--   * authenticated INSERT policy — only signed-in users can upload,
--     and only under a folder named after a real meeting id. Guests
--     cannot upload (the app also blocks them before uploading, same
--     rule as text chat: guests can read chat but cannot send).
-- The app enforces the rest: 25 MB size limit + blocked executable /
-- script types, in giinApi.uploadChatFile (src/supabaseClient.ts).
-- No DELETE / UPDATE policy is created on purpose: chat files are
-- never edited or removed by the app.

insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do update set public = true;

drop policy if exists "chat-files public read" on storage.objects;
create policy "chat-files public read"
  on storage.objects for select
  using (bucket_id = 'chat-files');

drop policy if exists "chat-files authenticated upload" on storage.objects;
create policy "chat-files authenticated upload"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-files'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] in (select id::text from public.meetings)
  );
