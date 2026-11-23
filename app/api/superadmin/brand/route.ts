import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin, writeAudit } from '../lib';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// The shared workspace brand (workspace_brand, id 1) — the name,
// slogan, logo and accent every user sees on the sign-in screen, in
// meetings and in the app header. The app (src/utils/brand.ts) loads
// this row on start and applies it everywhere; this route is the only
// way the Superadmin portal changes it, and every change is audited.
// The logo is a data URL, like the Settings brand flow already
// produces — no Storage bucket is needed. No SQL is required: the
// table already exists (giinmeet_phase3_brand.sql).
const MAX_LOGO_CHARS = 1400000; // ~1 MB image as a data URL

function isValidBrand(b: unknown): string | null {
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return 'The brand must be a JSON object.';
  }
  const v = b as Record<string, unknown>;
  if (typeof v.brand_name !== 'string' || v.brand_name.trim().length === 0 || v.brand_name.trim().length > 80) {
    return 'Brand name must be 1–80 characters.';
  }
  if (typeof v.slogan !== 'string' || v.slogan.length > 120) {
    return 'Slogan must be 120 characters or fewer.';
  }
  if (
    v.logo_url !== null &&
    (typeof v.logo_url !== 'string' ||
      !v.logo_url.startsWith('data:image/') ||
      v.logo_url.length > MAX_LOGO_CHARS)
  ) {
    return 'Logo must be an image data URL under ~1 MB, or null.';
  }
  if (typeof v.accent_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.accent_color)) {
    return 'Accent colour must be #rrggbb.';
  }
  if (typeof v.accent_hover !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v.accent_hover)) {
    return 'Accent hover colour must be #rrggbb.';
  }
  return null;
}

function notSetUpResponse() {
  return NextResponse.json({
    ok: true,
    brand: null,
    notSetUp: true,
    message: 'Shared branding is not set up yet — run giinmeet_phase3_brand.sql in the Supabase SQL Editor once, then try again.',
  });
}

// POST /api/superadmin/brand
//   { accessToken }                        -> read the shared brand (null when none is set)
//   { accessToken, action: 'set', brand }  -> save the shared brand (validated, audited)
//   { accessToken, action: 'reset' }       -> delete the brand row (the default GiinMeet brand returns)
export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'superadmin-brand', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin, user: actor } = checked.caller;

    if (!body?.action || body.action === 'get') {
      const { data, error } = await admin
        .from('workspace_brand')
        .select('brand_name,slogan,logo_url,accent_color,accent_hover,updated_at,updated_by')
        .eq('id', 1)
        .maybeSingle();
      if (error) {
        const msg = String(error.message || '');
        if (/workspace_brand/i.test(msg) && /relation|does not exist/i.test(msg)) {
          return notSetUpResponse();
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not read the brand: ${msg}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, brand: data || null, notSetUp: false });
    }

    if (body.action === 'set') {
      const problem = isValidBrand(body?.brand);
      if (problem) {
        return NextResponse.json({ error: 'BAD_REQUEST', message: problem }, { status: 400 });
      }
      const b = body.brand as {
        brand_name: string;
        slogan: string;
        logo_url: string | null;
        accent_color: string;
        accent_hover: string;
      };
      const { error } = await admin.from('workspace_brand').upsert(
        [
          {
            id: 1,
            brand_name: b.brand_name.trim(),
            slogan: b.slogan,
            logo_url: b.logo_url,
            accent_color: b.accent_color,
            accent_hover: b.accent_hover,
            updated_at: new Date().toISOString(),
            updated_by: actor.id,
          },
        ],
        { onConflict: 'id' }
      );
      if (error) {
        const msg = String(error.message || '');
        if (/workspace_brand/i.test(msg) && /relation|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'BRAND_NOT_SET_UP', message: 'Shared branding is not set up yet — run giinmeet_phase3_brand.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not save the brand: ${msg}` }, { status: 500 });
      }
      await writeAudit(admin, actor, 'update-brand', 'brand', '1', { brand_name: b.brand_name.trim() });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'reset') {
      const { error } = await admin.from('workspace_brand').delete().eq('id', 1);
      if (error) {
        const msg = String(error.message || '');
        if (/workspace_brand/i.test(msg) && /relation|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'BRAND_NOT_SET_UP', message: 'Shared branding is not set up yet — run giinmeet_phase3_brand.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not reset the brand: ${msg}` }, { status: 500 });
      }
      await writeAudit(admin, actor, 'reset-brand', 'brand', '1', {});
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'BAD_REQUEST', message: `Unknown action: ${body?.action}` }, { status: 400 });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Superadmin Brand] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
