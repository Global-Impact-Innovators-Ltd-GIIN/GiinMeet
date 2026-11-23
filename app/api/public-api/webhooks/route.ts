// Phase D (42), webhooks: register, list, delete, and see deliveries.
//
// A webhook is an HTTPS URL the owner's server exposes. GiinMeet
// POSTs a signed JSON payload to it for meeting.created,
// meeting.started and meeting.ended (only the events the owner
// chose). The signature header X-GiinMeet-Signature is
// `sha256=` plus HMAC-SHA256 of the raw body with the webhook
// secret, so the receiver can verify the payload really came from
// GiinMeet. The secret is returned ONCE, at creation, and never
// again, and it is never sent to any client except in that one
// response.
//
// POST { accessToken, action: 'create' | 'list' | 'delete' | 'deliveries',
//        url?, events?, webhookId? }
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  canCallerUseDeveloperApi,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { WEBHOOK_EVENTS, isWebhookEvent } from '../../_lib/phaseD';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'public-api-webhooks', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage webhooks.', 401);
    }
    const action = typeof body.action === 'string' ? body.action : 'list';

    if (action === 'list') {
      const { data, error } = await admin
        .from('webhooks')
        .select('id,url,events,active,created_at')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Webhooks need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true, webhooks: data || [] });
    }

    if (action === 'create') {
      // Developer API is a paid feature: Free cannot create keys or
      // webhooks. The check is server-side, on the caller's profile
      // tier, so hiding the button is never the only defence.
      const allowed = await canCallerUseDeveloperApi(admin, user.id);
      if (!allowed) {
        return errorWithSecurity('UPGRADE_REQUIRED', 'Webhooks are a Pro feature. Upgrade your plan to create webhooks.', 403);
      }
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      let parsed: URL | null = null;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.protocol !== 'https:' || url.length > 500) {
        return errorWithSecurity('BAD_REQUEST', 'A valid https URL is required for a webhook.', 400);
      }
      const events = Array.isArray(body.events)
        ? (body.events as unknown[]).filter(isWebhookEvent)
        : [];
      const chosen = events.length > 0 ? [...new Set(events)] : [...WEBHOOK_EVENTS];
      const secret = randomBytes(32).toString('hex');
      const { data, error } = await admin
        .from('webhooks')
        .insert({
          owner_id: user.id,
          url,
          secret,
          events: chosen,
          active: true,
        })
        .select('id,url,events,active,created_at')
        .maybeSingle();
      if (error || !data) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Webhooks need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      // The secret is returned exactly once. Copy it now: it is never
      // shown again, and the receiver needs it to verify signatures.
      return jsonWithSecurity({ ok: true, secret, webhook: data });
    }

    if (action === 'delete') {
      const webhookId = typeof body.webhookId === 'string' ? body.webhookId : '';
      if (!isUuid(webhookId)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid webhook is required.', 400);
      }
      const { data: row } = await admin
        .from('webhooks')
        .select('id')
        .eq('id', webhookId)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (!row) {
        return errorWithSecurity('NOT_FOUND', 'This webhook could not be found.', 404);
      }
      await admin.from('webhooks').delete().eq('id', webhookId);
      return jsonWithSecurity({ ok: true });
    }

    if (action === 'deliveries') {
      const webhookId = typeof body.webhookId === 'string' ? body.webhookId : '';
      if (!isUuid(webhookId)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid webhook is required.', 400);
      }
      const { data: row } = await admin
        .from('webhooks')
        .select('id')
        .eq('id', webhookId)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (!row) {
        return errorWithSecurity('NOT_FOUND', 'This webhook could not be found.', 404);
      }
      const { data, error } = await admin
        .from('webhook_deliveries')
        .select('id,meeting_id,event,status_code,ok,attempted_at')
        .eq('webhook_id', webhookId)
        .order('attempted_at', { ascending: false })
        .limit(20);
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Webhook deliveries need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true, deliveries: data || [] });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown webhook action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Public API Webhooks', err);
  }
}
