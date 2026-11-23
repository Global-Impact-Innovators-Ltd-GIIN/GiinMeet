// Phase D, shared server helpers for blocks, API keys and webhooks.
//
//   * isUserBlocked: a host's block list, checked by the token, admit
//     and rejoin routes. Best-effort: when giinmeet_phaseD.sql has not
//     run yet the table does not exist, and that reads as "not
//     blocked", never as a failure. A blocked user cannot rejoin by
//     refreshing: every entry point re-checks.
//   * API keys: only a SHA-256 hash is ever stored. The full key is
//     shown once, at creation, and never again. Comparison is
//     timing-safe (see security.ts secretsEqual).
//   * Webhooks: meeting.created / meeting.started / meeting.ended are
//     delivered to the meeting owner's active webhooks with an
//     HMAC-SHA256 signature, so a receiver can verify the payload
//     really came from GiinMeet. Delivery is always best-effort and
//     never fails the meeting action that triggered it.
import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { secretsEqual } from './security';

export const WEBHOOK_EVENTS = [
  'meeting.created',
  'meeting.started',
  'meeting.ended',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

export function hashApiKey(rawKey: string): string {
  return createHmac('sha256', 'giinmeet-api-key').update(rawKey).digest('hex');
}

/** True when the host blocked this user (by id) or this email. */
export async function isUserBlocked(
  admin: SupabaseClient,
  hostId: string | null | undefined,
  userId: string | null | undefined,
  email: string | null | undefined,
): Promise<boolean> {
  if (!hostId) return false;
  if (!userId && !email) return false;
  try {
    let query = admin
      .from('user_blocks')
      .select('id')
      .eq('blocker_id', hostId)
      .limit(1);
    if (userId && email) {
      query = query.or(
        `blocked_user_id.eq.${userId},blocked_email.eq.${email.toLowerCase()}`,
      );
    } else if (userId) {
      query = query.eq('blocked_user_id', userId);
    } else if (email) {
      query = query.eq('blocked_email', email.toLowerCase());
    }
    const { data, error } = await query.maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/** Verify a raw API key. Returns the owner's user id, or null. The
 *  full key is never logged and never stored, only its hash. */
export async function verifyApiKey(
  admin: SupabaseClient,
  rawKey: string,
): Promise<{ ownerId: string; keyId: string } | null> {
  if (!rawKey || typeof rawKey !== 'string' || rawKey.length < 20) return null;
  const prefix = rawKey.slice(0, 12);
  try {
    const { data, error } = await admin
      .from('api_keys')
      .select('id,owner_id,key_hash,revoked_at')
      .eq('key_prefix', prefix)
      .is('revoked_at', null)
      .limit(10);
    if (error || !data) return null;
    const wanted = hashApiKey(rawKey);
    for (const row of data as any[]) {
      if (typeof row.key_hash === 'string' && secretsEqual(row.key_hash, wanted)) {
        // Last-used stamp, best-effort, never blocks the call.
        try {
          await admin
            .from('api_keys')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', row.id);
        } catch {
          /* stamp is informational only */
        }
        return { ownerId: row.owner_id as string, keyId: row.id as string };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function signWebhookPayload(secret: string, body: string): string {
  return (
    'sha256=' +
    createHmac('sha256', secret).update(body).digest('hex')
  );
}

/** Deliver one meeting event to the owner's active webhooks. Never
 *  throws and never fails the caller: a dead receiver must not break
 *  ending a meeting. Each attempt is recorded in webhook_deliveries. */
export async function deliverMeetingEvent(
  admin: SupabaseClient,
  ownerId: string,
  event: WebhookEvent,
  meeting: { id: string; title?: string | null; time?: string | null },
): Promise<void> {
  try {
    const { data: hooks, error } = await admin
      .from('webhooks')
      .select('id,url,secret,events,active')
      .eq('owner_id', ownerId)
      .eq('active', true);
    if (error || !hooks || hooks.length === 0) return;
    const payload = JSON.stringify({
      event,
      meeting_id: meeting.id,
      meeting_title: meeting.title || null,
      meeting_time: meeting.time || null,
      sent_at: new Date().toISOString(),
    });
    for (const hook of hooks as any[]) {
      const events: string[] = Array.isArray(hook.events) ? hook.events : [];
      if (!events.includes(event)) continue;
      let statusCode: number | null = null;
      let ok = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(hook.url as string, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-GiinMeet-Event': event,
              'X-GiinMeet-Signature': signWebhookPayload(
                hook.secret as string,
                payload,
              ),
            },
            body: payload,
            signal: controller.signal,
          });
          statusCode = res.status;
          ok = res.ok;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        ok = false;
      }
      try {
        await admin.from('webhook_deliveries').insert({
          webhook_id: hook.id,
          meeting_id: meeting.id,
          event,
          status_code: statusCode,
          ok,
        });
      } catch {
        /* delivery record is informational only */
      }
    }
  } catch {
    /* webhooks never break the meeting action */
  }
}

/** The superadmin's email, for health alerts. Falls back to the
 *  known superadmin address when the table is not set up yet. */
export async function superadminEmail(admin: SupabaseClient): Promise<string> {
  try {
    const { data } = await admin
      .from('profiles')
      .select('email')
      .eq('is_superadmin', true)
      .limit(1)
      .maybeSingle();
    const email = (data as any)?.email as string | undefined;
    if (email) return email;
  } catch {
    /* fall through to the known address */
  }
  return 'nimdaukus@gmail.com';
}

export { timingSafeEqual };
