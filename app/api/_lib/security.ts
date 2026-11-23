// Phase C1, shared server-side security helpers for every new API route.
//
// Layered defence, applied the same way on each route:
//   * Rate limiting (per IP, and per user where the caller is signed in)
//     with a 429 + Retry-After answer, this is the brute-force / DoS
//     control. It is in-memory per server instance: on Vercel each
//     instance keeps its own counters, so this blunts an attack but is
//     NOT a durable cross-instance lockout. A durable lockout (DB-backed)
//     belongs to the post-Phase-C security audit pass.
//   * Payload size limits, the body is read as text first and refused
//     above the cap, before any JSON parsing or DB work.
//   * Server-side input validation, UUIDs, emails and short text are
//     checked here; nothing trusts a client-supplied value.
//   * No secrets in responses, no sensitive data in logs, no stack traces
//     to callers: errors are short, plain-words messages.
//   * Security headers on every JSON answer from the helper.
//   * Auth is always re-verified server-side (access token -> Supabase
//     auth.getUser, then the DB role / host check in the route itself).
//     Nothing in the client is ever trusted for a permission decision.
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'SAMEORIGIN',
};

export function jsonWithSecurity(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function errorWithSecurity(
  error: string,
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return jsonWithSecurity({ error, message }, status, extraHeaders);
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per server instance, see the header note).
// ---------------------------------------------------------------------------
interface Bucket {
  count: number;
  windowStart: number;
  // Failed-attempt tracking for lockouts (passcodes): separate counters so
  // a lockout is driven by failures, not by total requests.
  failures: number;
  lockedUntil: number;
}

const buckets = new Map<string, Bucket>();

function sweepBuckets(now: number) {
  for (const [key, b] of buckets) {
    if (now - b.windowStart > 60 * 60 * 1000 && now > b.lockedUntil) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 5000 && Math.random() < 0.1) sweepBuckets(now);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now, failures: 0, lockedUntil: 0 };
    buckets.set(key, bucket);
  }
  if (now < bucket.lockedUntil) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000)),
    };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** True while the key is inside a failure lockout window. */
export function isLockedOut(key: string): { locked: boolean; retryAfterSeconds: number } {
  const bucket = buckets.get(key);
  if (!bucket) return { locked: false, retryAfterSeconds: 0 };
  const now = Date.now();
  if (now < bucket.lockedUntil) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000)),
    };
  }
  return { locked: false, retryAfterSeconds: 0 };
}

/** Record a failed sensitive attempt (e.g. a wrong passcode). After
 *  `maxFailures` failures inside `windowMs`, the key is locked out for
 *  `lockoutMs`. Returns true while the key is currently locked out. */
export function recordFailureAndCheckLockout(
  key: string,
  maxFailures: number,
  windowMs: number,
  lockoutMs: number,
): { locked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now, failures: 0, lockedUntil: 0 };
    buckets.set(key, bucket);
  }
  if (now < bucket.lockedUntil) {
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000)),
    };
  }
  bucket.failures += 1;
  if (bucket.failures >= maxFailures) {
    bucket.lockedUntil = now + lockoutMs;
    bucket.failures = 0;
    return { locked: true, retryAfterSeconds: Math.ceil(lockoutMs / 1000) };
  }
  return { locked: false, retryAfterSeconds: 0 };
}

/** Clear the failure counter after a success (a right passcode resets it). */
export function clearFailures(key: string) {
  const bucket = buckets.get(key);
  if (bucket) bucket.failures = 0;
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // Security audit: take the LAST entry, not the first. Vercel's edge
    // appends the real connecting IP at the end; any earlier entries are
    // client-supplied and can be spoofed, which let an attacker rotate
    // fake IPs to walk around the per-IP rate limits. The last entry is
    // the address that actually connected to our edge (or that caller's
    // proxy), which is the stable identifier for limiting.
    const parts = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1].slice(0, 64);
  }
  return (req.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}

/** Constant-time string comparison for secrets and passcodes, so the
 *  comparison time does not leak how many leading characters matched.
 *  Returns false when the lengths differ. */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Standard per-route gate: `limit` requests per `windowMs` for this
 *  scope (usually `ip:<route>` or `user:<id>:<route>`). Returns a 429
 *  response when the caller is over the limit, otherwise null. */
export function checkRateLimit(
  req: NextRequest,
  scope: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const key = `${scope}:${getClientIp(req)}`;
  const result = rateLimit(key, limit, windowMs);
  if (!result.allowed) {
    return errorWithSecurity(
      'RATE_LIMITED',
      'Too many requests, please wait a moment and try again.',
      429,
      { 'Retry-After': String(result.retryAfterSeconds) },
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Body + input validation.
// ---------------------------------------------------------------------------
/** Read the request body as JSON with a hard size cap. Refuses anything
 *  over `maxBytes` (default 64 KB) before parsing. Returns {} on an
 *  empty or unparseable body, routes validate the fields they need. */
export async function readJsonBody(
  req: NextRequest,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown>> {
  const length = req.headers.get('content-length');
  if (length && Number(length) > maxBytes) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  const text = await req.text();
  if (!text) return {};
  if (text.length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

/** Trimmed plain text, capped at `max` chars. Returns '' for anything
 *  that is not a string. Use for every free-text field before storage. */
export function cleanText(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** A URL-safe handle/slug: lowercase letters, digits and hyphens only,
 *  3 to 30 chars, no leading/trailing hyphen. Used for personal-room
 *  handles and any other public slug. */
export function isValidHandle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(value)
  );
}

// ---------------------------------------------------------------------------
// Supabase admin client + caller verification (same pattern as the
// existing routes: service-role key, server only, never in client code).
// ---------------------------------------------------------------------------
export function getAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getCaller(admin: any, accessToken: string | undefined) {
  if (!accessToken || typeof accessToken !== 'string') return null;
  const { data: { user }, error } = await admin.auth.getUser(accessToken);
  if (error || !user) return null;
  return user;
}

/** Host check used by the meeting-scoped routes: the meeting's admin_id
 *  (falling back to user_id) must be the caller. */
export function isCurrentHost(
  meeting: { admin_id?: string | null; user_id?: string | null } | null,
  userId: string,
): boolean {
  if (!meeting) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
}

/** Generic "an unexpected error happened" answer: short, no stack, no
 *  internals, and the detail goes to the server log only. */
export function internalError(tag: string, err: unknown): NextResponse {
  console.error(`[${tag}]`, err instanceof Error ? err.message : 'unknown error');
  return errorWithSecurity(
    'INTERNAL_SERVER_ERROR',
    'Something went wrong on our side. Please try again.',
    500,
  );
}
