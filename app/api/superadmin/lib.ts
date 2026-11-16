import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Shared server-side helpers for the Superadmin portal routes.
// Every route verifies the caller's session token AND the database
// superadmin role here — a client-side hide alone is never the gate.
// The service-role key bypasses RLS, so this file must NEVER be
// imported by client code and the key must NEVER appear in a bundle
// or a committed file. It is set as a Vercel env var (Production +
// Preview), like the other /api/meetings/* routes.

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface SuperadminCaller {
  admin: SupabaseClient;
  user: { id: string; email?: string };
  profile: { id: string; email?: string | null; is_superadmin: boolean };
}

/** Verify a session token and the DB superadmin role. Returns the
 * caller on success, or a NextResponse error to return directly. */
export async function requireSuperadmin(
  accessToken?: string | null
): Promise<{ caller: SuperadminCaller } | { response: NextResponse }> {
  const admin = getAdminClient();
  if (!admin) {
    return {
      response: NextResponse.json(
        {
          error: 'SERVER_MISCONFIGURED',
          message: 'The server is not configured for administration (service key missing).',
        },
        { status: 500 }
      ),
    };
  }
  if (!accessToken) {
    return {
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Sign in as the superadmin to use this portal.' },
        { status: 401 }
      ),
    };
  }
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(accessToken);
  if (userError || !user) {
    return {
      response: NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Your session is invalid or has expired. Please sign in again.' },
        { status: 401 }
      ),
    };
  }
  const { data: profile } = await admin
    .from('profiles')
    .select('id,email,is_superadmin,is_suspended')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || (profile as any).is_superadmin !== true) {
    return {
      response: NextResponse.json(
        { error: 'FORBIDDEN', message: 'This account is not a superadmin.' },
        { status: 403 }
      ),
    };
  }
  if ((profile as any).is_suspended) {
    return {
      response: NextResponse.json(
        { error: 'FORBIDDEN', message: 'This superadmin account is suspended.' },
        { status: 403 }
      ),
    };
  }
  return {
    caller: {
      admin,
      user: { id: user.id, email: user.email },
      profile: profile as SuperadminCaller['profile'],
    },
  };
}

/** Verify a token and report the role without failing closed on a
 * non-superadmin — used by the portal gate (verify route), which
 * needs to tell "signed in but not superadmin" apart from "signed
 * out". Returns null only when the token itself is invalid. */
export async function checkSuperadminRole(
  accessToken?: string | null
): Promise<{ admin: SupabaseClient; user: { id: string; email?: string }; isSuperadmin: boolean } | null> {
  const admin = getAdminClient();
  if (!admin || !accessToken) return null;
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(accessToken);
  if (error || !user) return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('is_superadmin,is_suspended')
    .eq('id', user.id)
    .maybeSingle();
  const isSuperadmin =
    (profile as any)?.is_superadmin === true && (profile as any)?.is_suspended !== true;
  return { admin, user: { id: user.id, email: user.email }, isSuperadmin };
}

/** Write one audit row. Best-effort: a missing audit table (SQL not
 * run yet) must never turn an action that already succeeded into a
 * failure — the failure is only logged server-side. */
export async function writeAudit(
  admin: SupabaseClient,
  actor: { id: string; email?: string | null },
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { error } = await admin.from('superadmin_audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email || null,
      action,
      target_type: targetType,
      target_id: targetId,
      detail,
    });
    if (error) console.error('[Superadmin Audit] Audit row not written:', error.message);
  } catch (e: any) {
    console.error('[Superadmin Audit] Audit row not written:', e?.message || e);
  }
}

/** Read a system_settings row (or null when the table/key is missing —
 * the SQL has not run yet). Never throws. */
export async function readSetting(
  admin: SupabaseClient,
  key: string
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    return (data as any).value as Record<string, unknown>;
  } catch (e) {
    return null;
  }
}
