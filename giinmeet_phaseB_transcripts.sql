-- GiinMeet Phase B (features 9 + 10): meeting transcripts and AI summaries.
--
-- Run this in the Supabase SQL editor (project giinmeet) AFTER the
-- Phase A SQL is in place. It only ADDS two tables; it changes nothing
-- that already exists, and it is safe to run twice (IF NOT EXISTS).
--
--   1. giinmeet_phaseB_transcripts.sql  <- THIS FILE
--
-- What it stores:
--   * meeting_transcripts — one row per meeting, the full caption log
--     (JSON lines: [{ name, text, time }]) saved by the host when the
--     meeting ends. Feeds the transcript library (Phase C, feature 28).
--   * meeting_summaries — one row per meeting, the AI summary generated
--     from that transcript (short summary + decisions + action items
--     with owners). Feeds the post-meeting email (Phase C, feature 29).
--
-- No key is stored here: the summary LLM key lives only in the Vercel
-- environment (GIINMEET_LLM_API_KEY). With no key configured, no summary
-- row is ever written and the app says so plainly.

-- 1. TRANSCRIPTS -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  line_count INTEGER NOT NULL DEFAULT 0,
  saved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (meeting_id)
);

ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;

-- Same read shape as meetings/messages: anyone with the link can read the
-- record of a meeting they attended; writes go through the server routes
-- (service role), never directly from a client.
CREATE POLICY "Allow public read access to meeting transcripts"
  ON public.meeting_transcripts FOR SELECT USING (true);

CREATE POLICY "Allow service-role write access to meeting transcripts"
  ON public.meeting_transcripts FOR ALL USING (false);

-- 2. SUMMARIES -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT,
  model TEXT,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (meeting_id)
);

ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to meeting summaries"
  ON public.meeting_summaries FOR SELECT USING (true);

CREATE POLICY "Allow service-role write access to meeting summaries"
  ON public.meeting_summaries FOR ALL USING (false);
