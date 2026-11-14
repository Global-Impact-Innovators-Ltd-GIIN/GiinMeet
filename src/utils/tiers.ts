// GiinMeet participant limits by plan tier. Single source of truth:
// the token route (server) enforces these, the admit route checks
// them, and Billing + the room UI display them.
//
// Free 50 / Pro 100 / Enterprise 250 (Suku, 2026-11-14).
//
// Enterprise has no stored flag yet — profiles only carry the
// is_premium boolean (Pro or not) — so today a host resolves to Free
// or Pro. Enterprise needs a plan_tier column on profiles plus a
// decision on how it is assigned (Superadmin toggle, like is_premium,
// is the natural fit); until then the 250 limit is defined here but
// unreachable.
export type PlanTier = 'free' | 'pro' | 'enterprise';

export const TIER_LIMITS: Record<PlanTier, number> = {
  free: 50,
  pro: 100,
  enterprise: 250,
};

export const TIER_LABELS: Record<PlanTier, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export const DEFAULT_TIER_LIMIT = TIER_LIMITS.free;

/** Map the stored profile flag to a tier. Until a plan_tier column exists, premium == Pro. */
export const tierForPremium = (isPremium: boolean | null | undefined): PlanTier =>
  isPremium ? 'pro' : 'free';

/** Participant limit for a host, from the stored profile flag. */
export const tierLimitForPremium = (isPremium: boolean | null | undefined): number =>
  TIER_LIMITS[tierForPremium(isPremium)];
