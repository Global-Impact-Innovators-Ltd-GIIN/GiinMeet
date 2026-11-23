// Phase C2b (3), live interpretation channel (HUMAN interpreter only).
//
// One interpreter per meeting, speaking on a second audio channel in
// Kinyarwanda, French or English. Each listener picks which voice
// they hear: the original room, or the interpreter. The interpreter
// speaks on their normal microphone; listeners who pick the
// interpreter hear the interpreter only, because the app mutes the
// other voices for them. The interpreter themself always hears the
// original room, so they can keep interpreting.
//
// No AI translation service is wired in here, and no paid service:
// this is a human being interpreting, chosen by the host.
//
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   The live interpretation state (or active: false when none).
// POST { meetingId, accessToken?, participantRowId?, action, ... }
//   action 'set'   { interpreterKey, lang } .. host picks the
//          interpreter and the language they interpret into.
//   action 'stop' ............................ host stops the channel.
// Only the host may set or stop it. Rate limited per IP.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { isAdmittedKey, nameForKey, resolveC2bCaller } from '../../_lib/c2b';

const TABLE_MISSING = 'Interpretation needs the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';
const LANGS = new Set(['en', 'fr', 'rw']);

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'interpretation', 60, 60 * 1000);
    if (limited) return limited;
    const meetingId = req.nextUrl.searchParams.get('meetingId') || '';
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const participantRowId = req.nextUrl.searchParams.get('participantRowId') || undefined;
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const caller = await resolveC2bCaller(admin, meetingId, { accessToken, participantRowId });
    if (!caller) {
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to use interpretation.', 401);
    }
    const { data, error } = await admin
      .from('meeting_interpretation')
      .select('interpreter_key, interpreter_name, interpreter_lang, active')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
    }
    if (!data || !(data as any).active) {
      return jsonWithSecurity({ ok: true, active: false });
    }
    return jsonWithSecurity({
      ok: true,
      active: true,
      interpreterKey: (data as any).interpreter_key,
      interpreterName: (data as any).interpreter_name,
      interpreterLang: (data as any).interpreter_lang,
    });
  } catch (err) {
    return internalError('Interpretation API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'interpretation', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const meetingId = body.meetingId as string | undefined;
    const action = cleanText(body.action, 20);
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const caller = await resolveC2bCaller(admin, meetingId, body);
    if (!caller || !caller.isHost) {
      return errorWithSecurity('FORBIDDEN', 'Only the host can set the interpreter.', 403);
    }

    if (action === 'stop') {
      await admin
        .from('meeting_interpretation')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('meeting_id', meetingId);
      return jsonWithSecurity({ ok: true, active: false });
    }

    if (action === 'set') {
      const interpreterKey = cleanText(body.interpreterKey, 64);
      const lang = cleanText(body.interpreterLang, 4);
      if (!interpreterKey || interpreterKey === caller.key) {
        return errorWithSecurity('BAD_REQUEST', 'Pick someone else in the meeting to interpret.', 400);
      }
      if (!LANGS.has(lang)) {
        return errorWithSecurity('BAD_REQUEST', 'Pick a language: English, French or Kinyarwanda.', 400);
      }
      if (!(await isAdmittedKey(admin, meetingId!, interpreterKey))) {
        return errorWithSecurity('NOT_FOUND', 'That person is not in this meeting.', 404);
      }
      const name = (await nameForKey(admin, meetingId!, interpreterKey)) || 'Interpreter';
      const { error } = await admin.from('meeting_interpretation').upsert(
        [
          {
            meeting_id: meetingId,
            interpreter_key: interpreterKey,
            interpreter_name: name,
            interpreter_lang: lang,
            active: true,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'meeting_id' },
      );
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, active: true, interpreterKey, interpreterName: name, interpreterLang: lang });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown interpretation action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Interpretation API', err);
  }
}
