// Phase D (39), superadmin view of meeting reports.
//
// POST /api/superadmin/reports { accessToken, action: 'list' }
//   -> open and recent reports, each with its meeting title and the
//      meeting host (the person a block would apply to).
// POST { accessToken, action: 'set-status', reportId, status }
//   -> status open, reviewed, or dismissed.
// POST { accessToken, action: 'block-host', reportId }
//   -> blocks the reported meeting's host for the superadmin's own
//      meetings (a user_blocks row with the superadmin as blocker),
//      and marks the report reviewed. Suspension of the account is a
//      separate superadmin action, in the Users section.
import { NextRequest } from 'next/server';
import { requireSuperadmin } from '../lib';
import {
  checkRateLimit,
  errorWithSecurity,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'superadmin-reports', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin, user } = checked.caller;
    const action = typeof body.action === 'string' ? body.action : 'list';

    if (action === 'list') {
      const { data, error } = await admin
        .from('meeting_reports')
        .select('id,meeting_id,reporter_id,reporter_email,reason,detail,status,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Reports need the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      const rows = (data || []) as any[];
      const meetingIds = [...new Set(rows.map((r) => r.meeting_id))];
      const meetingById = new Map<string, any>();
      if (meetingIds.length > 0) {
        const { data: meets } = await admin
          .from('meetings')
          .select('id,title,admin_id,user_id,time')
          .in('id', meetingIds);
        for (const m of (meets || []) as any[]) meetingById.set(m.id, m);
      }
      const hostIds = [
        ...new Set(
          [...meetingById.values()]
            .map((m) => m.admin_id || m.user_id)
            .filter(Boolean),
        ),
      ];
      const hostEmailById = new Map<string, string>();
      if (hostIds.length > 0) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('id,email')
          .in('id', hostIds);
        for (const p of (profiles || []) as any[]) hostEmailById.set(p.id, p.email);
      }
      return jsonWithSecurity({
        ok: true,
        reports: rows.map((r) => {
          const m = meetingById.get(r.meeting_id);
          const hostId = m ? m.admin_id || m.user_id : null;
          return {
            id: r.id,
            meetingId: r.meeting_id,
            meetingTitle: m?.title || null,
            meetingTime: m?.time || null,
            hostId,
            hostEmail: hostId ? hostEmailById.get(hostId) || null : null,
            reporterEmail: r.reporter_email || null,
            reason: r.reason,
            detail: r.detail || null,
            status: r.status,
            createdAt: r.created_at,
          };
        }),
      });
    }

    if (action === 'set-status') {
      const reportId = typeof body.reportId === 'string' ? body.reportId : '';
      const status = typeof body.status === 'string' ? body.status : '';
      if (!isUuid(reportId) || !['open', 'reviewed', 'dismissed'].includes(status)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid report and a status of open, reviewed or dismissed are required.', 400);
      }
      const { error } = await admin
        .from('meeting_reports')
        .update({ status })
        .eq('id', reportId);
      if (error) {
        return errorWithSecurity('DB_ERROR', 'Could not update the report.', 500);
      }
      return jsonWithSecurity({ ok: true });
    }

    if (action === 'block-host') {
      const reportId = typeof body.reportId === 'string' ? body.reportId : '';
      if (!isUuid(reportId)) {
        return errorWithSecurity('BAD_REQUEST', 'A valid report is required.', 400);
      }
      const { data: report } = await admin
        .from('meeting_reports')
        .select('meeting_id')
        .eq('id', reportId)
        .maybeSingle();
      if (!report) {
        return errorWithSecurity('NOT_FOUND', 'This report could not be found.', 404);
      }
      const { data: meeting } = await admin
        .from('meetings')
        .select('admin_id,user_id')
        .eq('id', (report as any).meeting_id)
        .maybeSingle();
      const hostId = (meeting as any)?.admin_id || (meeting as any)?.user_id;
      if (!hostId) {
        return errorWithSecurity('BAD_REQUEST', 'This meeting has no host to block.', 400);
      }
      let hostEmail: string | null = null;
      const { data: profile } = await admin
        .from('profiles')
        .select('email')
        .eq('id', hostId)
        .maybeSingle();
      hostEmail = (profile as any)?.email || null;
      const { data: existing } = await admin
        .from('user_blocks')
        .select('id')
        .eq('blocker_id', user.id)
        .eq('blocked_user_id', hostId)
        .maybeSingle();
      if (!existing) {
        await admin.from('user_blocks').insert({
          blocker_id: user.id,
          blocked_user_id: hostId,
          blocked_email: hostEmail,
          reason: 'Blocked from a meeting report by the superadmin.',
        });
      }
      await admin
        .from('meeting_reports')
        .update({ status: 'reviewed' })
        .eq('id', reportId);
      return jsonWithSecurity({ ok: true, blockedUserId: hostId });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown reports action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Superadmin Reports API', err);
  }
}
