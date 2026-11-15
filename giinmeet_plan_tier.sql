-- GiinMeet — plan tiers (Issue 2, 2026-11-15).
-- Adds profiles.plan_tier ('free' | 'pro' | 'enterprise') and upgrades
-- Suku's account to the maximum tier, Enterprise (250 participants,
-- meetings up to 24 hours, scheduling defaults to 2 hours).
--
-- Run in the Supabase SQL Editor (GIIN org, giinmeet project).
-- Run order: independent of the other pending SQL files — this file
-- only touches profiles.plan_tier. It is safe to run BEFORE or AFTER
-- the deploy that carries the plan_tier code: the app reads plan_tier
-- when the column exists and falls back to the stored is_premium
-- boolean while it does not, so neither order breaks sign-in, the
-- room, or the participant limits.
--
-- No other account is upgraded here. Every further tier change is
-- done from the Superadmin view in the app (Users table, Plan column).

-- 1. Add the column (idempotent — safe to run twice).
alter table public.profiles
  add column if not exists plan_tier text not null default 'free'
  check (plan_tier in ('free', 'pro', 'enterprise'));

-- 2. Backfill: everyone who was already Pro keeps Pro.
update public.profiles
  set plan_tier = 'pro'
  where is_premium = true
    and plan_tier = 'free';

-- 3. Upgrade Suku's account to the maximum tier, Enterprise.
update public.profiles
  set plan_tier = 'enterprise', is_premium = true
  where lower(email) = 'mensahqsukujr@gmail.com';

-- Verification — run these after the three statements above.
-- Expect exactly 1 row, plan_tier = enterprise, is_premium = true:
-- select email, plan_tier, is_premium from public.profiles
--   where lower(email) = 'mensahqsukujr@gmail.com';
-- How many accounts sit on each tier:
-- select plan_tier, count(*) from public.profiles group by plan_tier;
