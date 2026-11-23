import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin, writeAudit } from '../lib';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// The only settings the portal may write. Anything else is refused —
// a settings table must never become a free-form write surface.
const ALLOWED_KEYS = [
  'guests_can_chat',
  'tier_limits',
  'tier_max_duration_minutes',
  'default_accent',
  'default_theme',
  'default_font',
  'announcement_banner',
  'default_meeting_duration_minutes',
  'default_require_waiting_room',
] as const;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

function isValidValue(key: AllowedKey, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'The value must be a JSON object.';
  }
  const v = value as Record<string, unknown>;
  if (key === 'guests_can_chat') {
    if (typeof v.enabled !== 'boolean') return 'guests_can_chat needs { enabled: boolean }.';
  }
  if (key === 'tier_limits' || key === 'tier_max_duration_minutes') {
    for (const t of ['free', 'pro', 'enterprise']) {
      const n = v[t];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 10000) {
        return `${key} needs a number between 1 and 10000 for ${t}.`;
      }
    }
    if (key === 'tier_limits') {
      if ((v.free as number) > (v.pro as number) || (v.pro as number) > (v.enterprise as number)) {
        return 'Tier limits must grow with the tier: Free ≤ Pro ≤ Enterprise.';
      }
    }
  }
  if (key === 'default_accent') {
    if (typeof v.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.color)) {
      return 'default_accent needs { color: "#rrggbb" }.';
    }
  }
  if (key === 'default_theme') {
    if (typeof v.ui_style !== 'string' || v.ui_style.length === 0) {
      return 'default_theme needs { ui_style: string }.';
    }
  }
  if (key === 'default_font') {
    if (typeof v.heading !== 'string' || typeof v.body !== 'string') {
      return 'default_font needs { heading: string, body: string }.';
    }
  }
  if (key === 'announcement_banner') {
    if (typeof v.enabled !== 'boolean' || typeof v.message !== 'string') {
      return 'announcement_banner needs { enabled: boolean, message: string }.';
    }
    if (v.message.length > 300) return 'The banner message must be 300 characters or fewer.';
  }
  if (key === 'default_meeting_duration_minutes') {
    if (typeof v.minutes !== 'number' || !Number.isFinite(v.minutes) || v.minutes < 5 || v.minutes > 1440) {
      return 'default_meeting_duration_minutes needs { minutes: 5–1440 }.';
    }
  }
  if (key === 'default_require_waiting_room') {
    if (typeof v.enabled !== 'boolean') return 'default_require_waiting_room needs { enabled: boolean }.';
  }
  return null;
}

// POST /api/superadmin/settings
//   { accessToken }                          -> read all settings (nulls when the SQL has not run)
//   { accessToken, action: 'set', key, value } -> write one setting (validated, audited)
export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'superadmin-settings', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin, user: actor } = checked.caller;

    if (!body?.action || body.action === 'get') {
      const { data, error } = await admin
        .from('system_settings')
        .select('key,value,updated_at')
        .order('key', { ascending: true });
      if (error) {
        const msg = String(error.message || '');
        if (/system_settings/i.test(msg) && /relation|does not exist/i.test(msg)) {
          return NextResponse.json({
            ok: true,
            settings: {},
            notSetUp: true,
            message: 'System settings are not set up yet — run giinmeet_superadmin.sql in the Supabase SQL Editor once, then try again.',
          });
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not read settings: ${msg}` }, { status: 500 });
      }
      const settings: Record<string, unknown> = {};
      for (const row of (data || []) as any[]) settings[row.key] = row.value;
      return NextResponse.json({ ok: true, settings, notSetUp: false });
    }

    if (body.action === 'set') {
      const key = body?.key as string | undefined;
      if (!key || !(ALLOWED_KEYS as readonly string[]).includes(key)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: `key must be one of: ${ALLOWED_KEYS.join(', ')}.` }, { status: 400 });
      }
      const problem = isValidValue(key as AllowedKey, body?.value);
      if (problem) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: problem }, { status: 400 });
      }
      const { error } = await admin.from('system_settings').upsert(
        [{ key, value: body.value, updated_at: new Date().toISOString(), updated_by: actor.id }],
        { onConflict: 'key' }
      );
      if (error) {
        const msg = String(error.message || '');
        if (/system_settings/i.test(msg) && /relation|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'SETTINGS_NOT_SET_UP', message: 'System settings are not set up yet — run giinmeet_superadmin.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not save the setting: ${msg}` }, { status: 500 });
      }
      await writeAudit(admin, actor, 'update-setting', 'setting', key, { value: body.value });
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'clear') {
      const key = body?.key as string | undefined;
      if (!key || !(ALLOWED_KEYS as readonly string[]).includes(key)) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: `key must be one of: ${ALLOWED_KEYS.join(', ')}.` }, { status: 400 });
      }
      const { error } = await admin.from('system_settings').delete().eq('key', key);
      if (error) {
        const msg = String(error.message || '');
        if (/system_settings/i.test(msg) && /relation|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'SETTINGS_NOT_SET_UP', message: 'System settings are not set up yet — run giinmeet_superadmin.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not clear the setting: ${msg}` }, { status: 500 });
      }
      await writeAudit(admin, actor, 'clear-setting', 'setting', key, {});
      return NextResponse.json({ ok: true });
    }


    return NextResponse.json({ error: 'BAD_REQUEST', message: `Unknown action: ${body?.action}` }, { status: 400 });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Superadmin Settings] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
