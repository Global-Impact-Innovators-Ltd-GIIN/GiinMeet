// Phase C2a (9), shared helper for the library list routes.
// Host-scoped reads over the caller's own meetings only.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  jsonWithSecurity,
} from './security';

export async function listLibraryFilesForUser(
  req: NextRequest,
  scope: string,
  kindFilter: string | null,
  limit: number,
) {
  const limited = checkRateLimit(req, scope, 60, 60 * 1000);
  if (limited) return limited;
  const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
  const admin = getAdminClient();
  if (!admin) {
    return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
  }
  const user = await getCaller(admin, accessToken);
  if (!user) {
    return errorWithSecurity('UNAUTHORIZED', 'Sign in to see your library.', 401);
  }
  const { data: meetings } = await admin
    .from('meetings')
    .select('id, title')
    .or(`user_id.eq.${user.id},admin_id.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(200);
  const ids = (meetings || []).map((m: any) => m.id);
  if (ids.length === 0) {
    return jsonWithSecurity({ ok: true, files: [], certificates: [] });
  }
  let query = admin
    .from('meeting_files')
    .select('id, meeting_id, kind, name, created_at')
    .in('meeting_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kindFilter) query = query.eq('kind', kindFilter);
  const { data, error } = await query;
  if (error) {
    return jsonWithSecurity({
      ok: false,
      reason: 'NOT_CONFIGURED',
      message: 'The library needs the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
    });
  }
  const titles = new Map((meetings || []).map((m: any) => [m.id, m.title || 'Meeting']));
  const files = (data || []).map((f: any) => ({
    id: f.id,
    kind: f.kind,
    name: f.name,
    meetingTitle: titles.get(f.meeting_id) || 'Meeting',
    created_at: f.created_at,
  }));
  if (kindFilter === 'certificate') {
    return jsonWithSecurity({ ok: true, certificates: files });
  }
  return jsonWithSecurity({ ok: true, files });
}
