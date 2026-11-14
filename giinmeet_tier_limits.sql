-- GiinMeet — Round 3: participant limits by tier (Free 50 / Pro 100 / Enterprise 250)
-- RUN BY SUKU in the Supabase SQL Editor (GIIN org, giinmeet project).
-- Safe to run once; re-running is harmless.
--
-- WHY: rooms were created with max_capacity 8 (schema default + room
-- creation). The token route now resolves the limit from the host's
-- tier at request time (profiles.is_premium: Pro 100, otherwise Free
-- 50), so this file is NOT required for the new limits to take
-- effect — it only fixes the stored default and the old rows so the
-- database agrees with the tier config (src/utils/tiers.ts).
--
-- NOTE: there is no plan_tier column yet; hosts resolve to Free or Pro
-- from profiles.is_premium. Enterprise (250) needs that column plus a
-- decision on how it is assigned (Superadmin toggle, like is_premium,
-- is the natural fit).

ALTER TABLE public.rooms ALTER COLUMN max_capacity SET DEFAULT 50;
UPDATE public.rooms SET max_capacity = 50 WHERE max_capacity < 50;
