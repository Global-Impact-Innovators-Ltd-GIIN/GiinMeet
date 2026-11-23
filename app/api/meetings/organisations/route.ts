// Phase C2b (11), organisation badges.
//
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   A map of room key -> organisation for everyone admitted to the
//   meeting. The badge text comes from the person's profile
//   (profiles.organisation, set in Settings) or, for guests, from the
//   organisation they gave when they joined. Empty means no badge:
//   the client shows nothing rather than inventing one.
// Host or admitted participant only; the map is meeting-scoped, so
// nobody can use it to enumerate organisations outside the room.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  internalError,
  isUuid,
  jsonWithSecurity,
} from '../../_lib/security';
import { resolveC2bCaller } from '../../_lib/c2b';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'organisations', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to see organisations.', 401);
    }
    const { data: rows } = await admin
      .from('meeting_participants')
      .select('id, user_id, name, organisation')
      .eq('meeting_id', meetingId)
      .eq('status', 'Admitted');
    const badges: Record<string, string> = {};
    const userIds = ((rows || []) as any[])
      .map((r) => r.user_id)
      .filter((u): u is string => typeof u === 'string' && !!u);
    let profileOrg: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, organisation, workspace_name')
        .in('id', userIds);
      for (const p of (profiles || []) as any[]) {
        const org = (p.organisation || '').trim();
        // Fall back to the team workspace name, unless it is the
        // generic personal workspace, which is not an organisation.
        const workspace = (p.workspace_name || '').trim();
        const badge = org || (workspace && workspace !== 'Personal Workspace' ? workspace : '');
        if (badge) profileOrg[p.id] = badge;
      }
    }
    for (const r of (rows || []) as any[]) {
      const guestOrg = (r.organisation || '').trim();
      const badge = guestOrg || (r.user_id ? profileOrg[r.user_id] || '' : '');
      if (!badge) continue;
      // Keyed by both the row id (guests) and the user id (signed-in),
      // because the room uses either key depending on the person.
      badges[r.id] = badge;
      if (r.user_id) badges[r.user_id] = badge;
    }
    return jsonWithSecurity({ ok: true, badges });
  } catch (err) {
    return internalError('Organisations API', err);
  }
}
