// Phase D (47), organisations: white-label brands (41: roles per
// organisation). An organisation is a client or school that sees its
// own name, logo and colours across its rooms, waiting room and
// invites, with a small "powered by GiinMeet" mark. Branding is set
// by the organisation's admin, never by guests.
//
// POST { action, ... }:
//   create       { accessToken, name, slug } -> the caller owns it and
//     becomes its first admin. Slug: lowercase letters, digits and
//     hyphens, 3 to 30 chars.
//   mine         { accessToken } -> organisations the caller owns or
//     belongs to, with their role.
//   public       { slug } -> brand fields only, no sign-in. This is
//     what the waiting room and invites read.
//   update-brand { accessToken, orgId, name?, logoUrl?, accentColor?,
//     accentHover?, slogan? } -> owner or org admin only.
//   members      { accessToken, orgId } -> owner or admin only.
//   add-member   { accessToken, orgId, email, role? } -> owner or
//     admin only. The person must already have a GiinMeet account.
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

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function brandFields(row: any) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url || null,
    accentColor: row.accent_color || null,
    accentHover: row.accent_hover || null,
    slogan: row.slogan || null,
  };
}

async function callerRole(
  admin: any,
  orgId: string,
  userId: string,
): Promise<'owner' | 'admin' | 'member' | null> {
  const { data: org } = await admin
    .from('organisations')
    .select('owner_id')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return null;
  if ((org as any).owner_id === userId) return 'owner';
  const { data: member } = await admin
    .from('organisation_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) return null;
  return (member as any).role === 'admin' ? 'admin' : 'member';
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'organisations', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const action = typeof body.action === 'string' ? body.action : '';

    // ---- public brand: no sign-in, brand fields only. ----
    if (action === 'public') {
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      if (!SLUG_RE.test(slug)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid organisation name is required.', 400);
      }
      const { data, error } = await admin
        .from('organisations')
        .select('id,name,slug,logo_url,accent_color,accent_hover,slogan')
        .eq('slug', slug)
        .maybeSingle();
      if (error || !data) {
        return errorWithSecurity('NOT_FOUND', 'This organisation could not be found.', 404);
      }
      return jsonWithSecurity({ ok: true, organisation: brandFields(data) });
    }

    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage organisations.', 401);
    }

    if (action === 'create') {
      const name = cleanText(body.name, 120);
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      if (!name) {
        return errorWithSecurity('BAD_REQUEST', 'An organisation name is required.', 400);
      }
      if (!SLUG_RE.test(slug)) {
        return errorWithSecurity('BAD_REQUEST', 'The short name must be 3 to 30 lowercase letters, digits or hyphens.', 400);
      }
      const { data, error } = await admin
        .from('organisations')
        .insert({ name, slug, owner_id: user.id })
        .select('id,name,slug,logo_url,accent_color,accent_hover,slogan')
        .maybeSingle();
      if (error) {
        if (/duplicate|unique/i.test(String((error as any)?.message || ''))) {
          return errorWithSecurity('BAD_REQUEST', 'That short name is already taken. Choose another.', 400);
        }
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Organisations need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      await admin.from('organisation_members').insert({
        org_id: (data as any).id,
        user_id: user.id,
        role: 'admin',
      });
      return jsonWithSecurity({ ok: true, organisation: brandFields(data) });
    }

    if (action === 'mine') {
      const { data: owned } = await admin
        .from('organisations')
        .select('id,name,slug,logo_url,accent_color,accent_hover,slogan')
        .eq('owner_id', user.id);
      const { data: memberships } = await admin
        .from('organisation_members')
        .select('org_id,role')
        .eq('user_id', user.id);
      const memberOrgIds = ((memberships || []) as any[])
        .map((m) => m.org_id)
        .filter((id) => !(owned || []).some((o: any) => o.id === id));
      let memberOrgs: any[] = [];
      if (memberOrgIds.length > 0) {
        const { data } = await admin
          .from('organisations')
          .select('id,name,slug,logo_url,accent_color,accent_hover,slogan')
          .in('id', memberOrgIds);
        memberOrgs = data || [];
      }
      const roleById = new Map(
        ((memberships || []) as any[]).map((m) => [m.org_id, m.role]),
      );
      return jsonWithSecurity({
        ok: true,
        organisations: [
          ...((owned || []) as any[]).map((o) => ({ ...brandFields(o), role: 'owner' })),
          ...memberOrgs.map((o) => ({ ...brandFields(o), role: roleById.get(o.id) || 'member' })),
        ],
      });
    }

    const orgId = typeof body.orgId === 'string' ? body.orgId : '';
    if (!isUuid(orgId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid organisation is required.', 400);
    }
    const role = await callerRole(admin, orgId, user.id);
    if (!role) {
      return errorWithSecurity('FORBIDDEN', 'You do not belong to this organisation.', 403);
    }

    if (action === 'update-brand') {
      if (role !== 'owner' && role !== 'admin') {
        return errorWithSecurity('FORBIDDEN', 'Only the organisation admin can change its brand.', 403);
      }
      const patch: Record<string, unknown> = {};
      const name = cleanText(body.name, 120);
      if (name) patch.name = name;
      if (typeof body.logoUrl === 'string') patch.logo_url = body.logoUrl.trim().slice(0, 2000) || null;
      if (typeof body.accentColor === 'string' && HEX_RE.test(body.accentColor.trim())) {
        patch.accent_color = body.accentColor.trim();
      }
      if (typeof body.accentHover === 'string' && HEX_RE.test(body.accentHover.trim())) {
        patch.accent_hover = body.accentHover.trim();
      }
      if (typeof body.slogan === 'string') patch.slogan = cleanText(body.slogan, 160) || null;
      if (Object.keys(patch).length === 0) {
        return errorWithSecurity('BAD_REQUEST', 'Nothing to change.', 400);
      }
      const { data, error } = await admin
        .from('organisations')
        .update(patch)
        .eq('id', orgId)
        .select('id,name,slug,logo_url,accent_color,accent_hover,slogan')
        .maybeSingle();
      if (error || !data) {
        return errorWithSecurity('DB_ERROR', 'Could not save the brand.', 500);
      }
      return jsonWithSecurity({ ok: true, organisation: brandFields(data) });
    }

    if (action === 'members') {
      if (role !== 'owner' && role !== 'admin') {
        return errorWithSecurity('FORBIDDEN', 'Only the organisation admin can see its members.', 403);
      }
      const { data } = await admin
        .from('organisation_members')
        .select('user_id,role,created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true });
      const rows = (data || []) as any[];
      const emails = new Map<string, string>();
      if (rows.length > 0) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('id,email,name')
          .in('id', rows.map((r) => r.user_id));
        for (const p of (profiles || []) as any[]) emails.set(p.id, p.email);
      }
      return jsonWithSecurity({
        ok: true,
        members: rows.map((r) => ({
          userId: r.user_id,
          email: emails.get(r.user_id) || null,
          role: r.role,
          joinedAt: r.created_at,
        })),
      });
    }

    if (action === 'add-member') {
      if (role !== 'owner' && role !== 'admin') {
        return errorWithSecurity('FORBIDDEN', 'Only the organisation admin can add members.', 403);
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(email)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid email address is required.', 400);
      }
      const memberRole = body.role === 'admin' ? 'admin' : 'member';
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      if (!profile) {
        return errorWithSecurity('NOT_FOUND', 'No GiinMeet account uses that email. The person must sign up first.', 404);
      }
      const { error } = await admin.from('organisation_members').upsert(
        { org_id: orgId, user_id: (profile as any).id, role: memberRole },
        { onConflict: 'org_id,user_id' },
      );
      if (error) {
        return errorWithSecurity('DB_ERROR', 'Could not add the member.', 500);
      }
      return jsonWithSecurity({ ok: true });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown organisation action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Organisations API', err);
  }
}
