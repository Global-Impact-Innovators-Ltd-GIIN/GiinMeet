// Phase 3 (Feature 4) — custom branding: the SHARED workspace brand.
//
// Until now branding was localStorage-only: Settings wrote
// giin_custom_logo / giin_brand_name / giin_brand_slogan on ONE device
// and App / MeetingRoom read them back on THAT device only. A second
// user — or the same user on a fresh device — always saw the default
// GiinMeet brand, and the sign-in screen, waiting room and lobby never
// read the local keys at all, so they never showed a custom brand even
// on the device that set it.
//
// This module is the missing shared half. One row in the
// `workspace_brand` table (giinmeet_phase3_brand.sql) holds the logo,
// name, slogan and accent the workspace admin set. Every client loads
// it on app start (signed in or not — guests need it for the sign-in,
// waiting-room and lobby screens) and syncs it INTO the same
// localStorage keys Settings already writes, firing the same
// giin_logo_changed / giin_branding_changed events. Every existing
// reader — App header, MeetingRoom watermark, Settings inputs — then
// shows the shared brand with no change to those readers. If the table
// does not exist yet (SQL not run) or no brand row is set, everything
// falls back honestly to the default GiinMeet brand; nothing ever
// renders a broken image or an empty name.
//
// The logo is stored as a data URL in the workspace_brand.logo_url
// column — the same base64 string Settings already produces from the
// file picker — so no Storage bucket is needed and no bucket has to be
// created for this feature. (The existing chat-files bucket is NOT
// reused: it is chat-scoped and its policies do not fit a public brand
// asset.)
//
// Writes are superadmin-only, enforced server-side by RLS on the
// DB role (profiles.is_superadmin — giinmeet_superadmin.sql replaced
// the old hardcoded-email policy). The client also gates the publish
// UI to the superadmin; the RLS policy is the real enforcement, the
// UI gate is display only.
//
// The DB client is passed in (browser `supabase` from supabaseClient,
// or a service-role admin client from a Next.js route) so this module
// never imports a client itself and stays safe to import from both
// the SPA and the server routes.
import { applyAccentColor } from './theme';

export interface WorkspaceBrand {
  brand_name: string;
  slogan: string;
  logo_url: string | null;
  accent_color: string;
  accent_hover: string;
  updated_at?: string;
  updated_by?: string | null;
}

export const DEFAULT_BRAND_NAME = 'GiinMeet';
export const DEFAULT_BRAND_SLOGAN = 'Connect, Collaborate, Virtualize';
export const DEFAULT_BRAND_LOGO = '/logo.png';
export const DEFAULT_BRAND_ACCENT = '#3B82F6';
export const DEFAULT_BRAND_ACCENT_HOVER = '#2563EB';

/** Minimal shape of the Supabase client this module needs. */
export type BrandDbClient = {
  from: (table: string) => any;
};

export const BRAND_NOT_SET_UP_MESSAGE =
  'Shared branding is not set up yet — run giinmeet_phase3_brand.sql in the Supabase SQL Editor first.';

// ---- Local readers -----------------------------------------------------
// Single source of truth for components that cannot take brand props
// (Dashboard, Chats, MeetingRoom invite copy). They read the synced
// localStorage keys, so once App has loaded the shared brand they
// automatically use the shared name; before that they use the default.
// Same normalisation as App.tsx ('GIIN MEET' is the old stored value
// for the default name, 'VIRTUALIZATION HUB' the old default slogan).
export function getLocalBrandName(): string {
  try {
    const v = localStorage.getItem('giin_brand_name');
    return !v || v === 'GIIN MEET' ? DEFAULT_BRAND_NAME : v;
  } catch {
    return DEFAULT_BRAND_NAME;
  }
}

export function getLocalBrandSlogan(): string {
  try {
    const v = localStorage.getItem('giin_brand_slogan');
    return !v || v === 'VIRTUALIZATION HUB' ? DEFAULT_BRAND_SLOGAN : v;
  } catch {
    return DEFAULT_BRAND_SLOGAN;
  }
}

export function getLocalLogoUrl(): string {
  try {
    return localStorage.getItem('giin_custom_logo') || DEFAULT_BRAND_LOGO;
  } catch {
    return DEFAULT_BRAND_LOGO;
  }
}

// ---- Server reads/writes ----------------------------------------------
// Probe once per session whether the workspace_brand table exists. A
// missing table errors the select, which is the signal — never a crash.
// Same probe pattern as the teams / link-expiry / reminder probes.
let brandSupportedCache: boolean | null = null;
export async function probeBrandSupport(client: BrandDbClient): Promise<boolean> {
  if (brandSupportedCache !== null) return brandSupportedCache;
  try {
    const { error } = await client.from('workspace_brand').select('id').limit(1);
    brandSupportedCache = !error;
  } catch {
    brandSupportedCache = false;
  }
  return brandSupportedCache;
}

export async function loadWorkspaceBrand(client: BrandDbClient): Promise<WorkspaceBrand | null> {
  try {
    const { data, error } = await client
      .from('workspace_brand')
      .select('brand_name,slogan,logo_url,accent_color,accent_hover,updated_at,updated_by')
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as WorkspaceBrand;
  } catch {
    return null;
  }
}

// Server routes (reminder / attendance emails) only need the name.
export async function loadWorkspaceBrandName(client: BrandDbClient): Promise<string> {
  const brand = await loadWorkspaceBrand(client);
  const name = brand?.brand_name?.trim();
  return name ? name : DEFAULT_BRAND_NAME;
}

export type BrandSaveResult = { ok: true } | { ok: false; reason: string };

function mapBrandWriteError(error: any): string {
  const msg = String(error?.message || error || 'unknown error');
  if (/workspace_brand|relation .* does not exist|Could not find the table/i.test(msg)) {
    return BRAND_NOT_SET_UP_MESSAGE;
  }
  if (/row-level security|permission denied|not authorized|JWT/i.test(msg)) {
    return 'Only the workspace admin (superadmin) can change the shared brand.';
  }
  return msg;
}

export async function saveWorkspaceBrand(
  client: BrandDbClient,
  brand: Omit<WorkspaceBrand, 'updated_at' | 'updated_by'>,
  userId?: string | null,
): Promise<BrandSaveResult> {
  try {
    const { error } = await client.from('workspace_brand').upsert(
      {
        id: 1,
        brand_name: brand.brand_name?.trim() || DEFAULT_BRAND_NAME,
        slogan: brand.slogan ?? DEFAULT_BRAND_SLOGAN,
        logo_url: brand.logo_url || null,
        accent_color: brand.accent_color || DEFAULT_BRAND_ACCENT,
        accent_hover: brand.accent_hover || DEFAULT_BRAND_ACCENT_HOVER,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      },
      { onConflict: 'id' },
    );
    if (error) return { ok: false, reason: mapBrandWriteError(error) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: mapBrandWriteError(e) };
  }
}

export async function resetWorkspaceBrand(client: BrandDbClient): Promise<BrandSaveResult> {
  try {
    const { error } = await client.from('workspace_brand').delete().eq('id', 1);
    if (error) return { ok: false, reason: mapBrandWriteError(error) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: mapBrandWriteError(e) };
  }
}

// ---- Apply a shared brand locally --------------------------------------
// Write the server brand into the localStorage keys every existing
// reader uses, apply its accent through the b230f62 theme system (no
// second theme system), and fire the same events Settings fires, so
// App header state, the MeetingRoom watermark and the Settings inputs
// all update live. Safe to call when no brand is set: it is never
// called then (loadAndApplySharedBrand only calls it with a row).
export function applySharedBrand(brand: WorkspaceBrand): void {
  try {
    localStorage.setItem('giin_brand_name', brand.brand_name?.trim() || DEFAULT_BRAND_NAME);
    localStorage.setItem('giin_brand_slogan', brand.slogan || DEFAULT_BRAND_SLOGAN);
    if (brand.logo_url) {
      localStorage.setItem('giin_custom_logo', brand.logo_url);
    } else {
      localStorage.removeItem('giin_custom_logo');
    }
    if (brand.accent_color) {
      const hover = brand.accent_hover || brand.accent_color;
      localStorage.setItem('giin_accent_color', brand.accent_color);
      localStorage.setItem('giin_accent_hover', hover);
      applyAccentColor(brand.accent_color, hover);
    }
  } catch {
    // Storage unavailable (private mode): the in-memory state below
    // still updates via the events; the brand just will not persist.
  }
  window.dispatchEvent(new Event('giin_logo_changed'));
  window.dispatchEvent(new Event('giin_branding_changed'));
}

// Load the shared brand once (app start, signed in or not) and apply
// it. Returns the brand, or null when the table is missing / no brand
// is set — in both cases the caller keeps the default brand.
export async function loadAndApplySharedBrand(client: BrandDbClient): Promise<WorkspaceBrand | null> {
  if (!(await probeBrandSupport(client))) return null;
  const brand = await loadWorkspaceBrand(client);
  if (brand) applySharedBrand(brand);
  return brand;
}
