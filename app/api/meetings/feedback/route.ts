// Phase D (46), feedback after every meeting: one tap, nothing more.
//
// POST { action: 'submit', meetingId, rating, comment?, accessToken?, participantRowId?, guestName? }
//   rating 1 to 5, optional one-line comment (280 chars). The caller
//   must be the host, an admitted participant, or a guest holding
//   their participant row id, so a stranger cannot stuff the ratings
//   of a meeting they never joined. One rating per signed-in user per
//   meeting; a second submit updates the first.
// POST { action: 'summary', meetingId, accessToken }
//   Host only: average, count, distribution, and recent comments
//   (names only, never emails). The superadmin analytics route reads
//   the same table for the whole product.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { isHost, isHostOrAdmitted } from '../../_lib/meetingAccess';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-feedback', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
    }
    const action = typeof body.action === 'string' ? body.action : 'submit';
    const user = await getCaller(admin, body.accessToken as string | undefined);
    const participantRowId =
      typeof body.participantRowId === 'string' ? body.participantRowId : undefined;

    if (action === 'summary') {
      if (!user) {
        return errorWithSecurity('UNAUTHORIZED', 'Sign in to see meeting feedback.', 401);
      }
      if (!(await isHost(admin, meetingId, user.id))) {
        return errorWithSecurity('FORBIDDEN', 'Only the meeting host can see its feedback.', 403);
      }
      const { data, error } = await admin
        .from('meeting_feedback')
        .select('rating,comment,guest_name,created_at')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Feedback needs the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      const rows = (data || []) as any[];
      const count = rows.length;
      const average =
        count > 0
          ? Math.round((rows.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count) * 10) / 10
          : null;
      const distribution = [1, 2, 3, 4, 5].map(
        (stars) => rows.filter((r) => Number(r.rating) === stars).length,
      );
      return jsonWithSecurity({
        ok: true,
        count,
        average,
        distribution,
        comments: rows
          .filter((r) => r.comment)
          .slice(0, 20)
          .map((r) => ({ comment: r.comment, guestName: r.guest_name || null, createdAt: r.created_at })),
      });
    }

    if (action !== 'submit') {
      return errorWithSecurity('BAD_REQUEST', 'Unknown feedback action.', 400);
    }
    const rating =
      typeof body.rating === 'number' ? Math.floor(body.rating) : 0;
    if (rating < 1 || rating > 5) {
      return errorWithSecurity('BAD_REQUEST', 'Give a rating from 1 to 5 stars.', 400);
    }
    // The rater must belong to this meeting.
    let allowed = false;
    if (user && (await isHostOrAdmitted(admin, meetingId, user.id))) allowed = true;
    if (!allowed && participantRowId) {
      const { data: grow } = await admin
        .from('meeting_participants')
        .select('id')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      allowed = !!grow;
    }
    if (!allowed) {
      return errorWithSecurity('FORBIDDEN', 'Only people who joined this meeting can rate it.', 403);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return errorWithSecurity('NOT_FOUND', 'This meeting could not be found.', 404);
    }
    const comment = cleanText(body.comment, 280) || null;
    const guestName = cleanText(body.guestName, 120) || null;
    if (user) {
      const { data: existing } = await admin
        .from('meeting_feedback')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing) {
        const { error } = await admin
          .from('meeting_feedback')
          .update({ rating, comment, guest_name: guestName })
          .eq('id', (existing as any).id);
        if (error) {
          return errorWithSecurity('DB_ERROR', 'Could not save your rating.', 500);
        }
        return jsonWithSecurity({ ok: true, updated: true });
      }
    }
    const { error } = await admin.from('meeting_feedback').insert({
      meeting_id: meetingId,
      user_id: user?.id || null,
      guest_name: guestName,
      rating,
      comment,
    });
    if (error) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NOT_CONFIGURED',
        message: 'Feedback needs the Phase D database setup first (run giinmeet_phaseD.sql).',
      });
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Feedback API', err);
  }
}
