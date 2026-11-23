// Phase C1 (24) — meeting templates, saved per user.
//
// GET ?accessToken=... — list the caller's templates (newest first).
// POST { accessToken, name, title, durationMinutes, requireWaitingRoom,
//        passcode?, attendeeEmails? } — save a new template (max 20 per
//        user, so one account cannot flood the table).
// DELETE ?accessToken=...&id=... — delete the caller's own template.
//
// Every field is validated server-side; the caller is re-verified from
// the session token on every call, and a template can only ever be read,
// created or deleted by its owner. Rate limited per IP and per user.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isEmail,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../_lib/security';

const MAX_TEMPLATES_PER_USER = 20;

function validTemplateBody(body: Record<string, unknown>): {
  ok: boolean;
  message?: string;
  values?: {
    name: string;
    title: string;
    durationMinutes: number;
    requireWaitingRoom: boolean;
    passcode: string | null;
    attendeeEmails: string[];
  };
} {
  const name = cleanText(body.name, 80);
  const title = cleanText(body.title, 200);
  if (!name) return { ok: false, message: 'Give the template a name.' };
  if (!title) return { ok: false, message: 'Give the template a meeting title.' };
  const durationMinutes =
    typeof body.durationMinutes === 'number'
      ? Math.floor(body.durationMinutes)
      : parseInt(String(body.durationMinutes || ''), 10);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    return { ok: false, message: 'Pick a duration between 1 minute and 24 hours.' };
  }
  const passcodeRaw = typeof body.passcode === 'string' ? body.passcode.trim() : '';
  if (passcodeRaw && (passcodeRaw.length < 4 || passcodeRaw.length > 20)) {
    return { ok: false, message: 'A passcode is 4 to 20 characters.' };
  }
  const attendeeEmails = Array.isArray(body.attendeeEmails)
    ? (body.attendeeEmails as unknown[])
        .filter((e) => isEmail(e))
        .map((e) => String(e).trim().toLowerCase())
        .slice(0, 20)
    : [];
  return {
    ok: true,
    values: {
      name,
      title,
      durationMinutes,
      requireWaitingRoom: body.requireWaitingRoom !== false,
      passcode: passcodeRaw || null,
      attendeeEmails,
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'templates', 60, 60 * 1000);
    if (limited) return limited;
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to see your templates.', 401);
    }
    const { data, error } = await admin
      .from('meeting_templates')
      .select('id, name, title, duration_minutes, require_waiting_room, passcode, attendee_emails, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Templates need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, templates: data || [] });
  } catch (err) {
    return internalError('Templates API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'templates', 30, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to save a template.', 401);
    }
    const checked = validTemplateBody(body);
    if (!checked.ok || !checked.values) {
      return errorWithSecurity('BAD_REQUEST', checked.message || 'That template is not valid.', 400);
    }
    const { count } = await admin
      .from('meeting_templates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if ((count || 0) >= MAX_TEMPLATES_PER_USER) {
      return errorWithSecurity(
        'BAD_REQUEST',
        `You already have ${MAX_TEMPLATES_PER_USER} templates. Delete one to save another.`,
        400,
      );
    }
    const { data, error } = await admin
      .from('meeting_templates')
      .insert([
        {
          user_id: user.id,
          name: checked.values.name,
          title: checked.values.title,
          duration_minutes: checked.values.durationMinutes,
          require_waiting_room: checked.values.requireWaitingRoom,
          passcode: checked.values.passcode,
          attendee_emails: checked.values.attendeeEmails,
        },
      ])
      .select('id, name, title, duration_minutes, require_waiting_room, passcode, attendee_emails, created_at')
      .maybeSingle();
    if (error || !data) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Templates need the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      });
    }
    return jsonWithSecurity({ ok: true, template: data });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Templates API', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'templates', 30, 60 * 1000);
    if (limited) return limited;
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const id = req.nextUrl.searchParams.get('id') || '';
    if (!isUuid(id)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid template is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to delete a template.', 401);
    }
    const { error } = await admin
      .from('meeting_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) {
      return errorWithSecurity('DB_ERROR', 'That template could not be deleted.', 500);
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    return internalError('Templates API', err);
  }
}
