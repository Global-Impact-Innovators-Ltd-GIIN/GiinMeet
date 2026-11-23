// Phase C1 (36), save the user's ONE caption language
// (profiles.caption_language), so their choice follows them across
// meetings. POST { accessToken, language: 'none' | 'en' | 'fr' | 'rw' }.
// Signed-in users only, and only their own row. Rate limited.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

const LANGS = new Set(['none', 'en', 'fr', 'rw']);

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'caption-language', 10, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to save your caption language.', 401);
    }
    const language = String(body.language || '');
    if (!LANGS.has(language)) {
      return errorWithSecurity('BAD_REQUEST', 'Pick a caption language: off, English, French or Kinyarwanda.', 400);
    }
    const { error } = await admin
      .from('profiles')
      .update({ caption_language: language })
      .eq('id', user.id);
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Saving your caption language needs the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, language });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Caption Language API', err);
  }
}
