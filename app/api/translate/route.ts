// Phase C1 (36), real-time translation of captions (English, French,
// Kinyarwanda). Each user chooses ONE caption language (or none), never
// all three at once.
// Phase C2b (4): the same route now powers chat auto-translation too,
// and it tries GiinMeet's own self-hosted Ollama server FIRST
// (GIINMEET_OLLAMA_URL, GIINMEET_OLLAMA_MODEL), so translation costs
// nothing per minute. The LibreTranslate provider from C1 stays as a
// fallback when its key is configured. No paid cloud translation
// service is wired in. When neither is available the route says so
// plainly and the client shows the original language.
//
// POST { accessToken?, meetingId?, participantRowId?, text, sourceLang,
//        targetLang }
//   The caller is a signed-in user (access token) or an admitted guest
//   (participant row id for this meeting). Final caption lines only:
//   interim lines are shown untranslated by the client and never sent
//   here. sourceLang/targetLang are 'en', 'fr' or 'rw'.
//   When source and target match, the text comes back unchanged and no
//   provider call is made. When no translation key is configured, the
//   route says so plainly ({ok:false, reason:'NO_TRANSLATE_KEY'}) and
//   the client shows the original language.
//   The provider is env-configurable and server-side only:
//     GIINMEET_TRANSLATE_API_URL, default https://libretranslate.com/translate
//     GIINMEET_TRANSLATE_API_KEY, the provider key (never in the client)
//   Honest technical note: Kinyarwanda speech recognition is weak, so
//   Kinyarwanda captions work by translating English text into
//   Kinyarwanda, not by recognising Kinyarwanda speech.
//   Rate limited per IP, payload capped, no caption text is logged.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../_lib/security';

const LANGS = new Set(['en', 'fr', 'rw']);
const SOURCE_LANGS = new Set(['en', 'fr', 'rw', 'auto']);
const LANG_NAMES: Record<string, string> = { en: 'English', fr: 'French', rw: 'Kinyarwanda' };

async function translateWithOllama(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
  const base = (process.env.GIINMEET_OLLAMA_URL || '').trim().replace(/\/$/, '');
  if (!base) return null;
  const model = (process.env.GIINMEET_OLLAMA_MODEL || 'qwen2.5:7b').trim();
  const sourceName = sourceLang === 'auto' ? 'the language this text is written in (English, French, or Kinyarwanda, detect it)' : LANG_NAMES[sourceLang];
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: `You are a translator. Translate the user's text from ${sourceName} into ${LANG_NAMES[targetLang]}. Reply with ONLY the translation, no explanation, no quotes, no extra words.` },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const out = typeof data?.message?.content === 'string' ? data.message.content.trim() : '';
  return out || null;
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'translate', 30, 60 * 1000);
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
    // Caller: signed-in user, or admitted guest by participant row.
    let authed = false;
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (user) {
      authed = true;
    } else if (
      typeof body.meetingId === 'string' &&
      isUuid(body.meetingId) &&
      typeof body.participantRowId === 'string' &&
      isUuid(body.participantRowId)
    ) {
      const { data: row } = await admin
        .from('meeting_participants')
        .select('id')
        .eq('id', body.participantRowId)
        .eq('meeting_id', body.meetingId)
        .eq('status', 'Admitted')
        .maybeSingle();
      authed = !!row;
    }
    if (!authed) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in or join the meeting to translate captions.', 401);
    }
    const text = cleanText(body.text, 500);
    const sourceLang = String(body.sourceLang || 'en');
    const targetLang = String(body.targetLang || 'en');
    if (!text || !SOURCE_LANGS.has(sourceLang) || !LANGS.has(targetLang)) {
      return errorWithSecurity('BAD_REQUEST', 'Send caption text and a valid language (English, French or Kinyarwanda).', 400);
    }
    if (sourceLang === targetLang) {
      return jsonWithSecurity({ ok: true, translatedText: text, sameLanguage: true });
    }
    // Phase C2b (4): self-hosted Ollama first, it costs nothing per
    // minute. A null return means Ollama is not configured (no URL)
    // or did not answer; the LibreTranslate fallback below runs then.
    try {
      const ollamaText = await translateWithOllama(text, sourceLang, targetLang);
      if (ollamaText) {
        return jsonWithSecurity({ ok: true, translatedText: ollamaText, provider: 'ollama' });
      }
    } catch (e) {
      // Ollama unreachable: fall through to the configured provider,
      // or the graceful no-translation answer below.
    }
    const apiUrl = (process.env.GIINMEET_TRANSLATE_API_URL || 'https://libretranslate.com/translate').trim();
    const apiKey = (process.env.GIINMEET_TRANSLATE_API_KEY || '').trim();
    if (!apiKey) {
      const ollamaConfigured = !!(process.env.GIINMEET_OLLAMA_URL || '').trim();
      return jsonWithSecurity({
        ok: false,
        reason: ollamaConfigured ? 'OLLAMA_UNREACHABLE' : 'NO_TRANSLATE_KEY',
        message: ollamaConfigured
          ? 'The GiinMeet translation server (Ollama) could not be reached. Messages show in the language they were written for now.'
          : 'Translated captions are not set up yet. Captions show in the language spoken.',
      });
    }
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: sourceLang,
        target: targetLang,
        format: 'text',
        api_key: apiKey,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return jsonWithSecurity({
        ok: false,
        reason: 'TRANSLATE_UNREACHABLE',
        message: 'The translation service could not be reached. Captions show in the language spoken for now.',
      });
    }
    const data = await res.json().catch(() => ({}));
    const translatedText = typeof data?.translatedText === 'string' ? data.translatedText : '';
    if (!translatedText) {
      return jsonWithSecurity({
        ok: false,
        reason: 'TRANSLATE_EMPTY',
        message: 'The translation service returned nothing. Captions show in the language spoken for now.',
      });
    }
    return jsonWithSecurity({ ok: true, translatedText });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Translate API', err);
  }
}
