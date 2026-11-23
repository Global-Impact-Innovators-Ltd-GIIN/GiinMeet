// Phase C1 (29), post-meeting follow-up.
//
// POST { meetingId, accessToken, extraEmails?: string[] }, host-only.
// Sends the summary, decisions and action items to everyone who was in
// the meeting (host + signed-in participants, resolved to their profile
// emails server-side) plus any extra addresses the host adds. It uses
// the feature 10 summary already stored: no second summariser is built,
// and with no summary yet the route answers NO_SUMMARY instead of
// inventing one.
//
// Anti-phishing: the only link in the email is the GiinMeet dashboard
// (https://giinmeet.nimdaukus.com), the sender is always
// GIIN Meet <noreply@mail.nimdaukus.com>, there are no attachments and
// no other links. Rate limited (5 sends per meeting per hour) so a
// follow-up cannot be used to spam anyone.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isEmail,
  isUuid,
  jsonWithSecurity,
  rateLimit,
  readJsonBody,
} from '../../_lib/security';
import { sendMail } from '../../../../src/utils/mailer';

const APP_ORIGIN = 'https://giinmeet.nimdaukus.com';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'follow-up', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const meetingId = body.meetingId as string | undefined;
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
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
      return errorWithSecurity('UNAUTHORIZED', 'Only the meeting host can send the follow-up.', 401);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, title, time')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return errorWithSecurity('NOT_FOUND', 'The meeting could not be found.', 404);
    }
    const hostId = (meeting as any).admin_id || (meeting as any).user_id;
    if (hostId !== user.id) {
      return errorWithSecurity('FORBIDDEN', 'Only the meeting host can send the follow-up.', 403);
    }
    // 5 sends per meeting per hour, so the button cannot become a spam tap.
    const sendLimit = rateLimit(`follow-up:${meetingId}`, 5, 60 * 60 * 1000);
    if (!sendLimit.allowed) {
      return errorWithSecurity(
        'RATE_LIMITED',
        'The follow-up for this meeting was already sent recently. Please wait a while before sending it again.',
        429,
      );
    }
    const { data: summary } = await admin
      .from('meeting_summaries')
      .select('summary, decisions, action_items')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (!summary || !((summary as any).summary || '').trim()) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NO_SUMMARY',
        message: 'There is no summary for this meeting yet. Generate the summary first, then send the follow-up.',
      });
    }
    // Action items: the tracked rows when they exist (feature 35),
    // otherwise the items stored on the summary itself.
    let actionItems: { text: string; owner: string }[] = [];
    try {
      const { data: rows } = await admin
        .from('action_items')
        .select('text, owner, status')
        .eq('meeting_id', meetingId)
        .order('created_at', { ascending: true });
      if (rows && rows.length > 0) {
        actionItems = (rows as any[]).map((r) => ({
          text: String(r.text || ''),
          owner: String(r.owner || 'Unassigned'),
        }));
      }
    } catch {
      // The Phase C1 SQL has not run yet: fall back to the summary.
    }
    if (actionItems.length === 0) {
      actionItems = (((summary as any).action_items || []) as any[]).map((a: any) => ({
        text: String(a.text || ''),
        owner: String(a.owner || 'Unassigned'),
      }));
    }
    const decisions = (((summary as any).decisions || []) as string[]).filter(
      (d) => typeof d === 'string' && d.trim(),
    );
    // Local recordings registered for this meeting (feature 28).
    let recordings: string[] = [];
    try {
      const { data: files } = await admin
        .from('meeting_files')
        .select('name, note')
        .eq('meeting_id', meetingId)
        .eq('kind', 'local-recording');
      recordings = ((files || []) as any[]).map(
        (f) => `${f.name}${f.note ? ` (kept: ${f.note})` : ''}`,
      );
    } catch {
      recordings = [];
    }
    // Recipients: host + signed-in participants (profile emails, looked
    // up server-side) + extra addresses the host typed in.
    const recipients = new Set<string>();
    const { data: hostProfile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', hostId)
      .maybeSingle();
    if ((hostProfile as any)?.email && isEmail((hostProfile as any).email)) {
      recipients.add(String((hostProfile as any).email).toLowerCase());
    }
    const { data: participants } = await admin
      .from('meeting_participants')
      .select('user_id')
      .eq('meeting_id', meetingId)
      .not('user_id', 'is', null);
    const participantIds = [...new Set(((participants || []) as any[]).map((p) => p.user_id))];
    if (participantIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('email')
        .in('id', participantIds);
      for (const p of profiles || []) {
        if ((p as any).email && isEmail((p as any).email)) {
          recipients.add(String((p as any).email).toLowerCase());
        }
      }
    }
    const extraEmails = Array.isArray(body.extraEmails) ? body.extraEmails : [];
    for (const e of extraEmails.slice(0, 20)) {
      if (isEmail(e)) recipients.add(String(e).trim().toLowerCase());
    }
    if (recipients.size === 0) {
      return jsonWithSecurity({
        ok: false,
        reason: 'NO_RECIPIENTS',
        message: 'Nobody to send to: no attendee email is on file. Add an email address and try again.',
      });
    }
    const title = String((meeting as any).title || 'GiinMeet meeting');
    const when = (meeting as any).time
      ? new Date((meeting as any).time).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    const subject = `Your GiinMeet follow-up: ${title}`;
    const actionLines = actionItems
      .map((a) => `- ${a.text}${a.owner && a.owner !== 'Unassigned' ? ` (${a.owner})` : ''}`)
      .join('\n');
    const decisionLines = decisions.map((d) => `- ${d}`).join('\n');
    const text = [
      `Thanks for joining "${title}"${when ? ` on ${when}` : ''}.`,
      '',
      'Summary:',
      String((summary as any).summary || '').trim(),
      '',
      ...(decisions.length > 0 ? ['Decisions:', decisionLines, ''] : []),
      ...(actionItems.length > 0
        ? ['Action items:', actionLines, '']
        : ['Action items: none recorded.', '']),
      ...(recordings.length > 0
        ? ['Recordings (kept on the host\u2019s device, not in the cloud):', ...recordings.map((r) => `- ${r}`), '']
        : []),
      `See the full meeting record in GiinMeet: ${APP_ORIGIN}/#/dashboard`,
      '',
      'You are receiving this because you attended this meeting. GiinMeet never sends links to any other website.',
    ].join('\n');
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = [
      `<p>Thanks for joining <strong>${esc(title)}</strong>${when ? ` on ${esc(when)}` : ''}.</p>`,
      `<p>${esc(String((summary as any).summary || '').trim())}</p>`,
      ...(decisions.length > 0
        ? [`<p><strong>Decisions</strong></p><ul>${decisions.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`]
        : []),
      ...(actionItems.length > 0
        ? [
            `<p><strong>Action items</strong></p><ul>${actionItems
              .map((a) => `<li>${esc(a.text)}${a.owner && a.owner !== 'Unassigned' ? ` (${esc(a.owner)})` : ''}</li>`)
              .join('')}</ul>`,
          ]
        : ['<p><strong>Action items:</strong> none recorded.</p>']),
      ...(recordings.length > 0
        ? [
            `<p><strong>Recordings</strong> (kept on the host's device, not in the cloud):</p><ul>${recordings
              .map((r) => `<li>${esc(r)}</li>`)
              .join('')}</ul>`,
          ]
        : []),
      `<p><a href="${APP_ORIGIN}/#/dashboard">See the full meeting record in GiinMeet</a></p>`,
      `<p style="color:#64748B;font-size:12px">You are receiving this because you attended this meeting. GiinMeet never sends links to any other website.</p>`,
    ].join('\n');
    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      const result = await sendMail(to, subject, text, html);
      if (result.ok) sent += 1;
      else {
        failed += 1;
        if ((result as any).reason === 'NO_RESEND_CONFIG') {
          return jsonWithSecurity({
            ok: false,
            reason: 'NO_RESEND_CONFIG',
            message: 'Follow-up emails need the email service configured (RESEND_API_KEY in Vercel). Nothing was sent.',
          });
        }
      }
    }
    if (sent === 0) {
      return jsonWithSecurity({
        ok: false,
        reason: 'SEND_FAILED',
        message: 'The follow-up could not be sent. Please try again later.',
      });
    }
    return jsonWithSecurity({ ok: true, sent, failed, recipients: [...recipients] });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Follow-up API', err);
  }
}
