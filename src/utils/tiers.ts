// GiinMeet plan tiers. Single source of truth: the token route
// (server) enforces the participant limits, the admit route checks
// them, and Billing + the room UI display them.
//
// Participant limits — Free 50 / Pro 100 / Enterprise 250 (Suku,
// 2026-11-14). Meeting durations — Free 40 minutes, Pro and
// Enterprise up to 24 hours (the Billing page already promises Pro
// "up to 24h"); Pro and Enterprise meetings default to 2 hours when
// scheduled.
//
// Tiers are stored on profiles.plan_tier ('free' | 'pro' |
// 'enterprise'). Until that column exists, the stored is_premium
// boolean is the fallback (premium == Pro). The Superadmin view
// assigns tiers; there is no payment processor yet, so assignment is
// manual, never automatic.
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

/** Longest meeting a tier may schedule, in minutes. */
export const TIER_MAX_DURATION_MINUTES: Record<PlanTier, number> = {
  free: 40,
  pro: 1440,
  enterprise: 1440,
};

/** Duration shown for a freshly scheduled meeting of each tier. */
export const DEFAULT_DURATION_FOR_TIER: Record<PlanTier, string> = {
  free: '40m limit',
  pro: '2 hours',
  enterprise: '2 hours',
};

/** Duration choices offered when scheduling, per tier. Values are
 * the stored duration strings; labels are what the picker shows. */
export const DURATION_OPTIONS_FOR_TIER: Record<PlanTier, { value: string; label: string }[]> = {
  free: [
    { value: '30m', label: '30 minutes' },
    { value: '40m limit', label: '40 minutes' },
  ],
  pro: [
    { value: '30m', label: '30 minutes' },
    { value: '40m limit', label: '40 minutes' },
    { value: '60m', label: '1 hour' },
    { value: '90 minutes', label: '1.5 hours' },
    { value: '2 hours', label: '2 hours' },
  ],
  enterprise: [
    { value: '30m', label: '30 minutes' },
    { value: '40m limit', label: '40 minutes' },
    { value: '60m', label: '1 hour' },
    { value: '90 minutes', label: '1.5 hours' },
    { value: '2 hours', label: '2 hours' },
    { value: '4 hours', label: '4 hours' },
    { value: '8 hours', label: '8 hours' },
    { value: 'up to 24h', label: 'Up to 24 hours' },
  ],
};

/** Is this stored plan_tier value a real tier? */
export const isPlanTier = (v: unknown): v is PlanTier =>
  v === 'free' || v === 'pro' || v === 'enterprise';

/** Resolve a host's tier from a profile row. plan_tier wins when it
 * is set; otherwise the stored is_premium boolean decides (premium
 * == Pro), so profiles created before the plan_tier column existed
 * keep working. */
export const tierForProfile = (profile: { is_premium?: boolean | null; plan_tier?: string | null } | null | undefined): PlanTier => {
  if (profile && isPlanTier(profile.plan_tier)) return profile.plan_tier;
  return profile?.is_premium ? 'pro' : 'free';
};

/** Map the stored profile flag to a tier. Until a plan_tier column exists, premium == Pro. */
export const tierForPremium = (isPremium: boolean | null | undefined): PlanTier =>
  isPremium ? 'pro' : 'free';

/** Participant limit for a host profile row. */
export const tierLimitForProfile = (profile: { is_premium?: boolean | null; plan_tier?: string | null } | null | undefined): number =>
  TIER_LIMITS[tierForProfile(profile)];

/** Participant limit for a host, from the stored profile flag. */
export const tierLimitForPremium = (isPremium: boolean | null | undefined): number =>
  TIER_LIMITS[tierForPremium(isPremium)];

/** Filter the scheduling options for a tier by a stored maximum
 * (system_settings.tier_max_duration_minutes, set in the Superadmin
 * portal). Pass null to keep the built-in options untouched. */
export const filterDurationOptionsByMax = (
  tier: PlanTier,
  maxMinutes: number | null | undefined
): { value: string; label: string }[] => {
  const options = DURATION_OPTIONS_FOR_TIER[tier];
  if (!maxMinutes || !Number.isFinite(maxMinutes)) return options;
  const kept = options.filter((o) => parseDurationMinutes(o.value) <= maxMinutes);
  return kept.length > 0 ? kept : [options[0]];
};

/** Clamp a duration choice to what a tier may schedule. A value
 * above the tier's cap falls back to that tier's default, so a
 * stale or template-picked duration can never promise a Free host
 * a 2-hour meeting. */
export const clampDurationToTier = (duration: string, tier: PlanTier): string => {
  const minutes = parseDurationMinutes(duration);
  if (minutes <= TIER_MAX_DURATION_MINUTES[tier]) return duration;
  return DEFAULT_DURATION_FOR_TIER[tier];
};

/** Parse a stored duration string to minutes. The old code stripped
 * every non-digit ("2 hours" became 2 minutes) — this understands
 * hours. Unknown values fall back to 60. */
export const parseDurationMinutes = (duration: string | null | undefined): number => {
  if (!duration) return 60;
  const hours = String(duration).match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hours) return Math.round(parseFloat(hours[1]) * 60);
  const mins = parseInt(String(duration).replace(/\D/g, ''), 10);
  return Number.isFinite(mins) && mins > 0 ? mins : 60;
};
