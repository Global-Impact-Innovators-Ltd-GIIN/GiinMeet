// Phase C1 (25) — personal room handle.
//
// POST { accessToken, slug } — signed-in user only. Sets (or renames)
// the caller's personal-room handle: one permanent, memorable link per
// user. The handle is validated server-side (lowercase letters, digits
// and hyphens, 3-30 chars), checked against every other user's handle,
// and stored under the unique slug constraint, so a collision can never
// silently take someone else's link. If the user has no room yet, one is
// created with the chosen handle. Passcode and waiting-room rules are
// untouched: the room still enforces them through the normal join flow.
// Rate limited per IP and per user.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isValidHandle,
  jsonWithSecurity,
  readJsonBody,
} from '../_lib/security';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'personal-room', 10, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    if (!isValidHandle(slug)) {
      return errorWithSecurity(
        'BAD_REQUEST',
        'Pick a handle of 3 to 30 letters, numbers or hyphens (for example suku).',
        400,
      );
    }
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to choose your room handle.', 401);
    }
    // Taken by someone else?
    const { data: taken } = await admin
      .from('personal_rooms')
      .select('user_id')
      .eq('slug', slug)
      .maybeSingle();
    if (taken && (taken as any).user_id !== user.id) {
      return errorWithSecurity(
        'HANDLE_TAKEN',
        'That handle is already taken. Try another one.',
        409,
      );
    }
    const { data: existing } = await admin
      .from('personal_rooms')
      .select('id, slug, title')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) {
      const { data, error } = await admin
        .from('personal_rooms')
        .update({ slug, updated_at: new Date().toISOString() })
        .eq('id', (existing as any).id)
        .select('id, user_id, slug, title, passcode, require_waiting_room')
        .maybeSingle();
      if (error || !data) {
        return errorWithSecurity('DB_ERROR', 'Your handle could not be saved.', 500);
      }
      return jsonWithSecurity({ ok: true, room: data });
    }
    // No room yet: create one with the chosen handle.
    let displayName = 'My Room';
    try {
      const { data: prof } = await admin
        .from('profiles')
        .select('name, email')
        .eq('id', user.id)
        .maybeSingle();
      if ((prof as any)?.name) displayName = (prof as any).name;
      else if ((prof as any)?.email) displayName = String((prof as any).email).split('@')[0];
    } catch {
      // Fall back to the default title.
    }
    const { data, error } = await admin
      .from('personal_rooms')
      .insert([
        {
          user_id: user.id,
          slug,
          title: `${displayName}'s Room`,
          passcode: null,
          require_waiting_room: true,
        },
      ])
      .select('id, user_id, slug, title, passcode, require_waiting_room')
      .maybeSingle();
    if (error || !data) {
      return errorWithSecurity(
        'DB_ERROR',
        'Your personal room could not be created. Personal rooms need the Phase 1 database setup (giinmeet_phase1.sql).',
        500,
      );
    }
    return jsonWithSecurity({ ok: true, room: data });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Personal Room API', err);
  }
}
