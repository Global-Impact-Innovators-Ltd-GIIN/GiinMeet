// GiinMeet Live Interview Mode — server API.
//
// POST { action, ... } — one route, action dispatch, same pattern as
// POST /api/meetings/waiting-room.
//
// Actions:
//   create           { accessToken, title, roleTitle, description,
//                      durationMinutes, scheduledAt, candidate,
//                      interviewers, questions, criteria }
//     Signed-in host only. Creates a normal meeting (no passcode,
//     waiting room required) plus the interview rows, then emails the
//     invite links. An email only counts as sent when Resend accepts
//     it; the reply says plainly which emails went out and which did
//     not, so the host can copy the link instead.
//   list             { accessToken } — the host's interviews.
//   get              { accessToken, interviewId } — host or interviewer.
//   verify-token     { interviewId, token } — no sign-in needed, the
//     token IS the credential. Returns the interview title, role,
//     length and meeting id, never other participants' emails.
//   status           { interviewId, token } — the candidate's view of
//     the interview status (scheduled / live / paused / ended).
//   end              { accessToken, interviewId } — host only. Marks
//     the interview ended and the meeting Completed.
//   pause            { accessToken, interviewId, paused } — lead only.
//   resend-link      { accessToken, interviewId, participantId }
//   otp-request      { interviewId, token } — emails a 6-digit code.
//     Returns sent:false with reason NO_EMAIL when Resend is not
//     configured, so the setup screen can say so plainly.
//   otp-verify       { interviewId, token, code }
//   id-shown         { interviewId, token } — candidate held ID to camera.
//   confirm-identity { accessToken, interviewId, participantId }
//   ask-question     { accessToken, interviewId, questionId } — lead
//     only. Writes a question-asked event into the timeline.
//   notes-save       { accessToken | token, interviewId, questionId,
//                      text } — interviewer only, private.
//   scores-save      { accessToken | token, interviewId, criterion,
//                      score } — interviewer only, 1 to 5.
//   questions-save   { accessToken, interviewId, questions } — host only.
//   feedback-submit  { interviewId, token, rating, comment }
//   templates-list   { accessToken } / templates-save { accessToken,
//                      name, roleTitle, questions, criteria,
//                      defaultTimeLimitSeconds }
//   recording-link   { accessToken, interviewId } — signed URL, 1 hour.
//
// Every interview table has RLS enabled with NO public policy: only
// this service-role client reads or writes them. Client-supplied roles
// are never trusted; the role comes from the verified token or the
// signed-in caller's interview_participants row.
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
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
  secretsEqual,
} from '../_lib/security';
import { sendMail, mailerConfigured } from '../../../src/utils/mailer';

const TAG = 'interviews';

type ParticipantRow = {
  id: string;
  interview_id: string;
  role: string;
  name: string;
  email: string;
  phone: string;
  token: string;
  user_id: string | null;
  identity_confirmed: boolean;
};

async function loadInterview(admin: any, interviewId: string) {
  const { data, error } = await admin
    .from('interviews')
    .select('*')
    .eq('id', interviewId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function loadParticipantByToken(admin: any, interviewId: string, token: string) {
  if (!isUuid(token)) return null;
  const { data, error } = await admin
    .from('interview_participants')
    .select('*')
    .eq('interview_id', interviewId)
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  return data as ParticipantRow;
}

// The caller's interview role: signed-in user first (host, or an
// interviewer row with their user_id), then a verified invite token.
// Returns null when the caller is not part of this interview.
async function callerInterviewRole(
  admin: any,
  interview: any,
  accessToken: string | undefined,
  token: string | undefined,
): Promise<{ role: string; participant: ParticipantRow | null; userId: string | null }> {
  if (accessToken) {
    const caller = await getCaller(admin, accessToken);
    if (caller) {
      if (interview.host_id === caller.id) return { role: 'lead', participant: null, userId: caller.id };
      const { data: row } = await admin
        .from('interview_participants')
        .select('*')
        .eq('interview_id', interview.id)
        .eq('user_id', caller.id)
        .maybeSingle();
      if (row) return { role: row.role, participant: row, userId: caller.id };
    }
  }
  if (token) {
    const row = await loadParticipantByToken(admin, interview.id, token);
    if (row) return { role: row.role, participant: row, userId: row.user_id };
  }
  return { role: '', participant: null, userId: null };
}

function joinLink(interviewId: string, token: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${origin}/#/join?interview=${interviewId}&token=${token}`;
}

function inviteEmailBody(name: string, title: string, roleTitle: string, link: string, when: string, isCandidate: boolean): { subject: string; text: string; html: string } {
  const subject = isCandidate
    ? `Your interview: ${title}`
    : `Interview invite: ${title}`;
  const text = isCandidate
    ? `Hi ${name},\n\nYou are invited to a live video interview for ${roleTitle || title}.\n\nWhen: ${when}\nInterview link: ${link}\n\nThe link is yours only, do not share it. You will join from your phone or computer, no account needed. The interview is in full screen, and switching tabs or leaving full screen will be flagged to the interviewers. The session is recorded.\n\nGIIN Meet`
    : `Hi ${name},\n\nYou are invited to interview for ${roleTitle || title} as an interviewer.\n\nWhen: ${when}\nInterview link: ${link}\n\nThe link is yours only, do not share it. Open it to join the interview room.\n\nGIIN Meet`;
  const html = `<p>Hi ${name},</p><p>${isCandidate ? `You are invited to a live video interview for <strong>${roleTitle || title}</strong>.` : `You are invited to interview for <strong>${roleTitle || title}</strong> as an interviewer.`}</p><p>When: ${when}<br>Interview link: <a href="${link}">${link}</a></p><p>The link is yours only, do not share it.${isCandidate ? ' You will join from your phone or computer, no account needed. The interview is in full screen, and switching tabs or leaving full screen will be flagged to the interviewers. The session is recorded.' : ' Open it to join the interview room.'}</p><p>GIIN Meet</p>`;
  return { subject, text, html };
}

function icsContent(title: string, roleTitle: string, start: Date, minutes: number, link: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const end = new Date(start.getTime() + minutes * 60000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GIIN Meet//Interview//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@giinmeet`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${(title || 'Interview').replace(/[,;\\]/g, ' ')}`,
    `DESCRIPTION:${(roleTitle || '').replace(/[,;\\]/g, ' ')} Interview link: ${link}`,
    `LOCATION:${link}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'interviews', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req, 128 * 1024);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const action = typeof body.action === 'string' ? body.action : '';
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken : undefined;
    const interviewId = typeof body.interviewId === 'string' ? body.interviewId : '';
    const token = typeof body.token === 'string' ? body.token : undefined;

    // ---- verify-token: the invite link credential. No sign-in. ----
    if (action === 'verify-token') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      return jsonWithSecurity({
        ok: true,
        role: row.role,
        name: row.name,
        meetingParticipantId: (row as any).meeting_participant_id || null,
        interview: {
          id: interview.id,
          meetingId: interview.meeting_id,
          title: interview.title,
          roleTitle: interview.role_title,
          description: interview.description,
          durationMinutes: interview.duration_minutes,
          scheduledAt: interview.scheduled_at,
          status: interview.status,
        },
        emailConfigured: mailerConfigured(),
        identityConfirmed: !!row.identity_confirmed,
      });
    }

    // ---- status: the candidate's read-only view of the state. ----
    if (action === 'status') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      return jsonWithSecurity({ ok: true, status: interview.status });
    }

    // ---- otp-request: email a 6-digit code to the candidate. ----
    if (action === 'otp-request') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row || row.role !== 'candidate' || !isEmail(row.email)) {
        return errorWithSecurity('BAD_REQUEST', 'No email address is on file for this candidate.', 400);
      }
      if (!mailerConfigured()) {
        return jsonWithSecurity({ ok: false, sent: false, reason: 'NO_EMAIL' });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const hash = createHash('sha256').update(code).digest('hex');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await admin.from('interview_participants').update({ otp_hash: hash, otp_expires_at: expiresAt }).eq('id', row.id);
      const result = await sendMail(
        row.email,
        `Your GIIN Meet interview code: ${code}`,
        `Hi ${row.name},\n\nYour one-time code to confirm your identity for the interview "${interview.title}" is: ${code}\n\nIt expires in 10 minutes. Do not share it.\n\nGIIN Meet`,
      );
      if (!result.ok) return jsonWithSecurity({ ok: false, sent: false, reason: result.reason });
      return jsonWithSecurity({ ok: true, sent: true });
    }

    // ---- otp-verify: check the code, mark identity confirmed. ----
    if (action === 'otp-verify') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!/^\d{6}$/.test(code)) return errorWithSecurity('BAD_REQUEST', 'Enter the 6-digit code.', 400);
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row || row.role !== 'candidate') return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const hash = createHash('sha256').update(code).digest('hex');
      const stored = (row as any).otp_hash as string | undefined;
      const expiresAt = (row as any).otp_expires_at as string | undefined;
      if (!stored || !expiresAt || new Date(expiresAt).getTime() < Date.now() || !secretsEqual(hash, stored)) {
        return errorWithSecurity('INVALID_CODE', 'That code is wrong or has expired. Ask for a new one.', 400);
      }
      await admin.from('interview_participants').update({
        identity_confirmed: true,
        identity_method: 'email-code',
        identity_confirmed_at: new Date().toISOString(),
        otp_hash: null,
        otp_expires_at: null,
      }).eq('id', row.id);
      return jsonWithSecurity({ ok: true });
    }

    // ---- candidate-joined: remember the candidate's participant row ----
    // The candidate's LiveKit identity IS their meeting_participants row
    // id, so the lead interviewer uses it to find the candidate's
    // remote tracks for recording.
    if (action === 'candidate-joined') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview does not exist.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row || row.role !== 'candidate') return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const participantRowId = typeof body.participantRowId === 'string' ? body.participantRowId : '';
      if (!isUuid(participantRowId)) return errorWithSecurity('BAD_REQUEST', 'No participant row was given.', 400);
      await admin.from('interviews').update({ candidate_row_id: participantRowId, status: 'live', started_at: interview.started_at || new Date().toISOString() }).eq('id', interviewId);
      return jsonWithSecurity({ ok: true });
    }

    // ---- id-shown: candidate held their ID to the camera. ----
    if (action === 'id-shown') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row || row.role !== 'candidate') return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      await admin.from('interview_participants').update({ id_shown_at: new Date().toISOString() }).eq('id', row.id);
      return jsonWithSecurity({ ok: true });
    }

    // ---- feedback-submit: the candidate's short feedback after. ----
    if (action === 'feedback-submit') {
      if (!isUuid(interviewId) || !token) {
        return errorWithSecurity('BAD_REQUEST', 'That interview link is not valid.', 400);
      }
      const interview = await loadInterview(admin, interviewId);
      if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const row = await loadParticipantByToken(admin, interviewId, token);
      if (!row || row.role !== 'candidate') return errorWithSecurity('NOT_FOUND', 'That interview link is not valid.', 404);
      const rating = typeof body.rating === 'number' ? Math.max(1, Math.min(5, Math.round(body.rating))) : null;
      const comment = cleanText(body.comment, 1000);
      await admin.from('interview_feedback').insert([{ interview_id: interviewId, rating, comment }]);
      return jsonWithSecurity({ ok: true });
    }

    // Everything below needs a signed-in caller.
    const caller = await getCaller(admin, accessToken);
    if (!caller) return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage interviews.', 401);

    // ---- create ----
    if (action === 'create') {
      const title = cleanText(body.title, 200);
      if (!title) return errorWithSecurity('BAD_REQUEST', 'Give the interview a title.', 400);
      const roleTitle = cleanText(body.roleTitle, 200);
      const description = cleanText(body.description, 2000);
      const durationMinutes = typeof body.durationMinutes === 'number'
        ? Math.max(5, Math.min(480, Math.round(body.durationMinutes)))
        : 60;
      const scheduledAt = typeof body.scheduledAt === 'string' && body.scheduledAt
        ? new Date(body.scheduledAt).toISOString()
        : new Date().toISOString();
      const candidate = body.candidate as any;
      if (!candidate || typeof candidate.name !== 'string' || !candidate.name.trim()) {
        return errorWithSecurity('BAD_REQUEST', 'Add the candidate name.', 400);
      }
      const candidateEmail = typeof candidate.email === 'string' && isEmail(candidate.email) ? candidate.email.trim() : '';
      const interviewers = Array.isArray(body.interviewers) ? body.interviewers : [];
      const questions = Array.isArray(body.questions) ? body.questions : [];
      const criteria = Array.isArray(body.criteria) ? body.criteria : [];

      const meetingId = crypto.randomUUID();
      const { error: meetingError } = await admin.from('meetings').insert([{
        id: meetingId,
        user_id: caller.id,
        admin_id: caller.id,
        title,
        time: scheduledAt,
        duration: String(durationMinutes),
        status: 'Scheduled',
        host: caller.user_metadata?.full_name || caller.email || 'Host',
        require_waiting_room: true,
        passcode: null,
      }]);
      if (meetingError) return internalError(TAG, meetingError);

      const { data: interview, error: interviewError } = await admin.from('interviews').insert([{
        meeting_id: meetingId,
        host_id: caller.id,
        title,
        role_title: roleTitle,
        description,
        duration_minutes: durationMinutes,
        scheduled_at: scheduledAt,
        status: 'scheduled',
      }]).select().maybeSingle();
      if (interviewError || !interview) {
        await admin.from('meetings').delete().eq('id', meetingId);
        return internalError(TAG, interviewError);
      }

      const participants: any[] = [];
      const { data: candRow } = await admin.from('interview_participants').insert([{
        interview_id: interview.id,
        role: 'candidate',
        name: cleanText(candidate.name, 120),
        email: candidateEmail,
        phone: cleanText(candidate.phone, 40),
      }]).select().maybeSingle();
      if (candRow) {
        participants.push(candRow);
        // The candidate gets a meeting_participants row in Waiting, so
        // the host sees them in the waiting list and admits them through
        // the normal flow. The row id is stored here so the invite link
        // can point the candidate's browser at it (the token route
        // accepts an admitted row id as the credential).
        const { data: candMeetRow } = await admin.from('meeting_participants').insert([{
          meeting_id: meetingId,
          user_id: null,
          name: cleanText(candidate.name, 120),
          status: 'Waiting',
          role: 'Participant',
        }]).select().maybeSingle();
        if (candMeetRow) {
          await admin.from('interview_participants').update({ meeting_participant_id: (candMeetRow as any).id }).eq('id', (candRow as any).id);
          (candRow as any).meeting_participant_id = (candMeetRow as any).id;
        }
      }
      for (const iv of interviewers) {
        if (!iv || typeof iv.name !== 'string' || !iv.name.trim()) continue;
        const email = typeof iv.email === 'string' && isEmail(iv.email) ? iv.email.trim() : '';
        let userId: string | null = null;
        if (email) {
          try {
            const found = await admin.auth.admin.getUserByEmail(email);
            if (found?.data?.user) userId = found.data.user.id;
          } catch (e) { /* no account for this email: token link still works */ }
        }
        const { data: ivRow } = await admin.from('interview_participants').insert([{
          interview_id: interview.id,
          role: 'interviewer',
          name: cleanText(iv.name, 120),
          email,
          user_id: userId,
        }]).select().maybeSingle();
        if (ivRow) {
          participants.push(ivRow);
          // Interviewers are pre-admitted: their invite link opens the
          // room without waiting. Same row-id link as the candidate.
          const { data: ivMeetRow } = await admin.from('meeting_participants').insert([{
            meeting_id: meetingId,
            user_id: userId,
            name: cleanText(iv.name, 120),
            status: 'Admitted',
            role: 'Participant',
          }]).select().maybeSingle();
          if (ivMeetRow) {
            await admin.from('interview_participants').update({ meeting_participant_id: (ivMeetRow as any).id }).eq('id', (ivRow as any).id);
            (ivRow as any).meeting_participant_id = (ivMeetRow as any).id;
          }
        }
      }

      const qRows = questions
        .filter((q: any) => q && typeof q.text === 'string' && q.text.trim())
        .slice(0, 50)
        .map((q: any, i: number) => ({
          interview_id: interview.id,
          question_text: cleanText(q.text, 1000),
          sort_order: i,
          time_limit_seconds: typeof q.timeLimitSeconds === 'number' && q.timeLimitSeconds > 0
            ? Math.min(3600, Math.round(q.timeLimitSeconds)) : null,
        }));
      if (qRows.length > 0) await admin.from('interview_questions').insert(qRows);
      // The scoring rubric criteria live on the interview row, so the
      // rubric UI has them even before anyone has scored.
      const cleanCriteria = criteria.filter((c: any) => typeof c === 'string' && c.trim()).slice(0, 10).map((c: string) => c.trim());
      if (cleanCriteria.length > 0) {
        await admin.from('interviews').update({ criteria: cleanCriteria }).eq('id', interview.id);
      }

      const when = new Date(scheduledAt).toLocaleString();
      const mailResults: { candidate: boolean; interviewers: boolean[] } = { candidate: false, interviewers: [] };
      const cand = participants.find((p) => p.role === 'candidate');
      if (cand && cand.email) {
        const link = joinLink(interview.id, cand.token);
        const { subject, text, html } = inviteEmailBody(cand.name, title, roleTitle, link, when, true);
        const r = await sendMail(cand.email, subject, text, html);
        mailResults.candidate = r.ok;
      }
      for (const p of participants.filter((x) => x.role === 'interviewer')) {
        if (!p.email) { mailResults.interviewers.push(false); continue; }
        const link = joinLink(interview.id, p.token);
        const { subject, text, html } = inviteEmailBody(p.name, title, roleTitle, link, when, false);
        const r = await sendMail(p.email, subject, text, html);
        mailResults.interviewers.push(r.ok);
      }

      return jsonWithSecurity({
        ok: true,
        interview: { ...interview, criteria: cleanCriteria },
        meetingId,
        links: {
          candidate: cand ? joinLink(interview.id, cand.token) : null,
          interviewers: participants.filter((p) => p.role === 'interviewer').map((p) => ({ name: p.name, link: joinLink(interview.id, p.token) })),
        },
        mail: mailResults,
        emailConfigured: mailerConfigured(),
      });
    }

    // ---- list ----
    if (action === 'list') {
      const { data } = await admin
        .from('interviews')
        .select('id, meeting_id, title, role_title, duration_minutes, scheduled_at, status, created_at, started_at, ended_at')
        .eq('host_id', caller.id)
        .order('created_at', { ascending: false })
        .limit(50);
      const rows = data || [];
      const withCandidates = await Promise.all(rows.map(async (row: any) => {
        const { data: cand } = await admin
          .from('interview_participants')
          .select('name, identity_confirmed')
          .eq('interview_id', row.id)
          .eq('role', 'candidate')
          .maybeSingle();
        const { count } = await admin
          .from('interview_events')
          .select('id', { count: 'exact', head: true })
          .eq('interview_id', row.id);
        return { ...row, candidateName: (cand as any)?.name || '', identityConfirmed: !!(cand as any)?.identity_confirmed, eventCount: count || 0 };
      }));
      return jsonWithSecurity({ ok: true, interviews: withCandidates });
    }

    // The rest need a valid interview id.
    if (!isUuid(interviewId)) return errorWithSecurity('BAD_REQUEST', 'That interview id is not valid.', 400);
    const interview = await loadInterview(admin, interviewId);
    if (!interview) return errorWithSecurity('NOT_FOUND', 'That interview does not exist.', 404);
    const mine = await callerInterviewRole(admin, interview, accessToken, token);
    const isHost = interview.host_id === caller.id;
    const isLead = isHost || mine.role === 'lead';
    const isInterviewer = isLead || mine.role === 'interviewer';

    // ---- get: full record for host or interviewer ----
    if (action === 'get') {
      if (!isInterviewer) return errorWithSecurity('FORBIDDEN', 'You are not part of this interview.', 403);
      const { data: parts } = await admin.from('interview_participants').select('id, role, name, email, user_id, identity_confirmed, identity_method, id_shown_at').eq('interview_id', interviewId);
      const { data: qs } = await admin.from('interview_questions').select('id, question_text, sort_order, time_limit_seconds').eq('interview_id', interviewId).order('sort_order');
      const { data: notes } = await admin.from('interview_notes').select('interviewer_id, interviewer_name, question_id, note_text').eq('interview_id', interviewId);
      const { data: scores } = await admin.from('interview_scores').select('interviewer_id, interviewer_name, criterion, score').eq('interview_id', interviewId);
      const { data: feedback } = await admin.from('interview_feedback').select('rating, comment, created_at').eq('interview_id', interviewId);
      const criteria = Array.isArray((interview as any).criteria) && (interview as any).criteria.length > 0
        ? (interview as any).criteria
        : Array.from(new Set((scores || []).map((s: any) => s.criterion)));
      return jsonWithSecurity({
        ok: true,
        interview: { ...interview, criteria },
        participants: parts || [],
        questions: qs || [],
        notes: notes || [],
        scores: scores || [],
        feedback: feedback || [],
        myRole: isLead ? 'lead' : 'interviewer',
      });
    }

    // ---- for-meeting: signed-in host or interviewer entering the room ----
    if (action === 'for-meeting') {
      const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
      if (!isUuid(meetingId)) return errorWithSecurity('BAD_REQUEST', 'That meeting id is not valid.', 400);
      const { data: iv } = await admin
        .from('interviews')
        .select('id, meeting_id, title, role_title, duration_minutes, scheduled_at, status, candidate_row_id')
        .eq('meeting_id', meetingId)
        .in('status', ['scheduled', 'live', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!iv) return jsonWithSecurity({ ok: true, interview: null });
      const role = await callerInterviewRole(admin, iv, accessToken, undefined);
      if (role.role !== 'lead' && role.role !== 'interviewer') {
        return jsonWithSecurity({ ok: true, interview: null });
      }
      const { data: cand } = await admin
        .from('interview_participants')
        .select('id, name, identity_confirmed, id_shown_at')
        .eq('interview_id', (iv as any).id)
        .eq('role', 'candidate')
        .maybeSingle();
      return jsonWithSecurity({
        ok: true,
        interview: { ...(iv as any), role: role.role, candidateName: (cand as any)?.name || '', candidateRowId: (iv as any).candidate_row_id || null, candidateIdentityConfirmed: !!(cand as any)?.identity_confirmed, candidateIdShown: !!(cand as any)?.id_shown_at },
      });
    }

    // ---- send-to-waiting: lead sends the candidate back to the lobby ----
    if (action === 'send-to-waiting') {
      if (!isLead) return errorWithSecurity('FORBIDDEN', 'Only the lead interviewer can send the candidate back.', 403);
      const candidateRowId = (interview as any).candidate_row_id as string | undefined;
      if (candidateRowId) {
        await admin.from('meeting_participants').update({ status: 'Waiting' }).eq('id', candidateRowId).eq('meeting_id', interview.meeting_id);
      }
      await admin.from('interview_events').insert([{
        interview_id: interviewId,
        client_id: `stw-${Date.now()}`,
        event_type: 'candidate-sent-to-waiting',
        detail: 'Candidate sent back to the waiting room',
        severity: 'medium',
        occurred_at: new Date().toISOString(),
        actor: 'interviewer',
      }]);
      return jsonWithSecurity({ ok: true });
    }

    // ---- end ----
    if (action === 'end') {
      if (!isLead) return errorWithSecurity('FORBIDDEN', 'Only the lead interviewer can end the interview.', 403);
      await admin.from('interviews').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', interviewId);
      await admin.from('meetings').update({ status: 'Completed' }).eq('id', interview.meeting_id);
      return jsonWithSecurity({ ok: true });
    }

    // ---- pause ----
    if (action === 'pause') {
      if (!isLead) return errorWithSecurity('FORBIDDEN', 'Only the lead interviewer can pause the interview.', 403);
      const paused = body.paused === true;
      await admin.from('interviews').update({ status: paused ? 'paused' : 'live' }).eq('id', interviewId);
      return jsonWithSecurity({ ok: true, status: paused ? 'paused' : 'live' });
    }

    // ---- resend-link ----
    if (action === 'resend-link') {
      if (!isHost) return errorWithSecurity('FORBIDDEN', 'Only the host can resend links.', 403);
      const participantId = typeof body.participantId === 'string' ? body.participantId : '';
      if (!isUuid(participantId)) return errorWithSecurity('BAD_REQUEST', 'Choose a participant.', 400);
      const { data: row } = await admin.from('interview_participants').select('*').eq('id', participantId).eq('interview_id', interviewId).maybeSingle();
      if (!row || !isEmail((row as any).email)) return errorWithSecurity('BAD_REQUEST', 'That participant has no email address.', 400);
      const link = joinLink(interviewId, (row as any).token);
      const when = new Date(interview.scheduled_at || interview.created_at).toLocaleString();
      const { subject, text, html } = inviteEmailBody((row as any).name, interview.title, interview.role_title, link, when, (row as any).role === 'candidate');
      const r = await sendMail((row as any).email, subject, text, html);
      if (!r.ok) return jsonWithSecurity({ ok: false, sent: false, reason: r.reason });
      return jsonWithSecurity({ ok: true, sent: true });
    }

    // ---- confirm-identity (ID to camera) ----
    if (action === 'confirm-identity') {
      if (!isLead) return errorWithSecurity('FORBIDDEN', 'Only the lead interviewer can confirm identity.', 403);
      const participantId = typeof body.participantId === 'string' ? body.participantId : '';
      if (!isUuid(participantId)) return errorWithSecurity('BAD_REQUEST', 'Choose a participant.', 400);
      await admin.from('interview_participants').update({
        identity_confirmed: true,
        identity_method: 'id-camera',
        identity_confirmed_at: new Date().toISOString(),
      }).eq('id', participantId).eq('interview_id', interviewId).eq('role', 'candidate');
      return jsonWithSecurity({ ok: true });
    }

    // ---- ask-question: lead puts a question up, written to the timeline ----
    if (action === 'ask-question') {
      if (!isLead) return errorWithSecurity('FORBIDDEN', 'Only the lead interviewer can ask a question.', 403);
      const questionId = typeof body.questionId === 'string' ? body.questionId : '';
      const { data: q } = await admin.from('interview_questions').select('id, question_text').eq('id', questionId).eq('interview_id', interviewId).maybeSingle();
      if (!q) return errorWithSecurity('BAD_REQUEST', 'That question does not exist.', 400);
      const now = new Date().toISOString();
      await admin.from('interview_events').insert([{
        interview_id: interviewId,
        client_id: `q-${questionId}-${Date.now()}`,
        event_type: 'question-asked',
        detail: (q as any).question_text,
        severity: 'low',
        occurred_at: now,
        actor: 'interviewer',
      }]);
      return jsonWithSecurity({ ok: true, askedAt: now });
    }

    // ---- notes-save / scores-save: interviewer only ----
    if (action === 'notes-save') {
      if (!isInterviewer) return errorWithSecurity('FORBIDDEN', 'Only an interviewer can save notes.', 403);
      const questionId = typeof body.questionId === 'string' && isUuid(body.questionId) ? body.questionId : null;
      const text = cleanText(body.text, 5000);
      const who = mine.participant?.id || caller.id;
      const whoName = mine.participant?.name || caller.user_metadata?.full_name || caller.email || 'Interviewer';
      await admin.from('interview_notes').upsert([{
        interview_id: interviewId,
        interviewer_id: who,
        interviewer_name: whoName,
        question_id: questionId,
        note_text: text,
        updated_at: new Date().toISOString(),
      }], { onConflict: 'interview_id,interviewer_id,question_id' });
      return jsonWithSecurity({ ok: true });
    }

    if (action === 'scores-save') {
      if (!isInterviewer) return errorWithSecurity('FORBIDDEN', 'Only an interviewer can save scores.', 403);
      const criterion = cleanText(body.criterion, 120);
      const score = typeof body.score === 'number' ? Math.max(1, Math.min(5, Math.round(body.score))) : 0;
      if (!criterion || !score) return errorWithSecurity('BAD_REQUEST', 'Give a criterion and a score from 1 to 5.', 400);
      const who = mine.participant?.id || caller.id;
      const whoName = mine.participant?.name || caller.user_metadata?.full_name || caller.email || 'Interviewer';
      await admin.from('interview_scores').upsert([{
        interview_id: interviewId,
        interviewer_id: who,
        interviewer_name: whoName,
        criterion,
        score,
        updated_at: new Date().toISOString(),
      }], { onConflict: 'interview_id,interviewer_id,criterion' });
      return jsonWithSecurity({ ok: true });
    }

    // ---- questions-save: host only, replaces the question set ----
    if (action === 'questions-save') {
      if (!isHost) return errorWithSecurity('FORBIDDEN', 'Only the host can change the questions.', 403);
      const questions = Array.isArray(body.questions) ? body.questions : [];
      await admin.from('interview_questions').delete().eq('interview_id', interviewId);
      const qRows = questions
        .filter((q: any) => q && typeof q.text === 'string' && q.text.trim())
        .slice(0, 50)
        .map((q: any, i: number) => ({
          interview_id: interviewId,
          question_text: cleanText(q.text, 1000),
          sort_order: i,
          time_limit_seconds: typeof q.timeLimitSeconds === 'number' && q.timeLimitSeconds > 0
            ? Math.min(3600, Math.round(q.timeLimitSeconds)) : null,
        }));
      if (qRows.length > 0) await admin.from('interview_questions').insert(qRows);
      return jsonWithSecurity({ ok: true, count: qRows.length });
    }

    // ---- templates ----
    if (action === 'templates-list') {
      const { data } = await admin.from('interview_templates').select('*').eq('host_id', caller.id).order('created_at', { ascending: false }).limit(20);
      return jsonWithSecurity({ ok: true, templates: data || [] });
    }
    if (action === 'templates-save') {
      const name = cleanText(body.name, 120);
      if (!name) return errorWithSecurity('BAD_REQUEST', 'Name the template.', 400);
      const questions = Array.isArray(body.questions) ? body.questions.filter((q: any) => q && typeof q.text === 'string' && q.text.trim()).slice(0, 50) : [];
      const criteria = Array.isArray(body.criteria) ? body.criteria.filter((c: any) => typeof c === 'string' && c.trim()).slice(0, 10) : [];
      const { data, error } = await admin.from('interview_templates').insert([{
        host_id: caller.id,
        name,
        role_title: cleanText(body.roleTitle, 200),
        questions,
        criteria,
        default_time_limit_seconds: typeof body.defaultTimeLimitSeconds === 'number' ? Math.min(3600, Math.round(body.defaultTimeLimitSeconds)) : null,
      }]).select().maybeSingle();
      if (error || !data) return internalError(TAG, error);
      return jsonWithSecurity({ ok: true, template: data });
    }

    // ---- recording-link: signed URL for the stored recording ----
    if (action === 'recording-link') {
      if (!isInterviewer) return errorWithSecurity('FORBIDDEN', 'Only an interviewer can open the recording.', 403);
      if (!interview.recording_path) return errorWithSecurity('NOT_FOUND', 'No recording was uploaded for this interview yet.', 404);
      const { data, error } = await admin.storage.from('interview-recordings').createSignedUrl(interview.recording_path, 3600);
      if (error || !data?.signedUrl) return internalError(TAG, error);
      return jsonWithSecurity({ ok: true, url: data.signedUrl });
    }

    // ---- ics: calendar file for one participant ----
    if (action === 'ics') {
      if (!isInterviewer && !isHost) return errorWithSecurity('FORBIDDEN', 'Only an interviewer can download the invite.', 403);
      const participantId = typeof body.participantId === 'string' ? body.participantId : '';
      let link = '';
      if (isUuid(participantId)) {
        const { data: row } = await admin.from('interview_participants').select('token').eq('id', participantId).eq('interview_id', interviewId).maybeSingle();
        if (row) link = joinLink(interviewId, (row as any).token);
      }
      const start = new Date(interview.scheduled_at || interview.created_at);
      const ics = icsContent(interview.title, interview.role_title, start, interview.duration_minutes, link);
      return new Response(ics, {
        status: 200,
        headers: { ...{ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="interview-${interviewId.slice(0, 8)}.ics"` } },
      });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown action.', 400);
  } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError(TAG, e);
  }
}
