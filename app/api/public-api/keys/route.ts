// Phase D (42), public API keys: create, list, revoke.
//
// A key is `giin_live_` plus 48 random hex characters. Only its
// SHA-256 hash and its first 12 characters (the prefix) are stored;
// the full key is returned ONCE, at creation, and can never be read
// back. A leaked key is revoked here, and revocation takes effect
// immediately because every API call re-reads the key row.
//
// POST { accessToken, action: 'create' | 'list' | 'revoke', name?, keyId? }
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  canCallerUseDeveloperApi,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { hashApiKey } from '../../_lib/phaseD';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'public-api-keys', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage API keys.', 401);
    }
    const action = typeof body.action === 'string' ? body.action : 'list';

    if (action === 'list') {
      const { data, error } = await admin
        .from('api_keys')
        .select('id,name,key_prefix,created_at,last_used_at,revoked_at')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'API keys need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true, keys: data || [] });
    }

    if (action === 'create') {
      // Developer API is a paid feature: Free cannot create keys or
      // webhooks. The check is server-side, on the caller's profile
      // tier, so hiding the button is never the only defence.
      const allowed = await canCallerUseDeveloperApi(admin, user.id);
      if (!allowed) {
        return errorWithSecurity('UPGRADE_REQUIRED', 'API keys are a Pro feature. Upgrade your plan to create API keys.', 403);
      }
      const name = cleanText(body.name, 60) || 'GiinMeet API key';
      const rawKey = 'giin_live_' + randomBytes(24).toString('hex');
      const { data, error } = await admin
        .from('api_keys')
        .insert({
          owner_id: user.id,
          name,
          key_hash: hashApiKey(rawKey),
          key_prefix: rawKey.slice(0, 12),
        })
        .select('id,name,key_prefix,created_at')
        .maybeSingle();
      if (error || !data) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'API keys need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      // The full key is returned exactly once. It is never stored and
      // can never be read back: copy it now.
      return jsonWithSecurity({ ok: true, key: rawKey, record: data });
    }

    if (action === 'revoke') {
      const keyId = typeof body.keyId === 'string' ? body.keyId : '';
      if (!isUuid(keyId)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid key is required.', 400);
      }
      const { data: row } = await admin
        .from('api_keys')
        .select('id')
        .eq('id', keyId)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (!row) {
        return errorWithSecurity('NOT_FOUND', 'This key could not be found.', 404);
      }
      await admin
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', keyId);
      return jsonWithSecurity({ ok: true });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown API key action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Public API Keys', err);
  }
}
