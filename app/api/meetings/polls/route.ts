// Phase C2b (8), server-run polls, including ANONYMOUS polls.
//
// The in-room polls from Phase 1 are client broadcasts: every client
// counts votes itself, and the vote broadcast carries the voter's key,
// so a named poll can show who voted what. That is fine for named
// polls, and they keep working exactly as before.
//
// An anonymous poll is different: it runs HERE, server-side.
//   * Votes store NO voter identity: only a one-way hash of (poll id
//     + voter key + server pepper), used to stop double voting. The
//     hash is never returned to any client, so nobody, including the
//     host, can read back who answered what. Only the totals leave
//     this route.
//   * A voter may change their mind: voting again moves their vote,
//     it never counts twice.
//   * Results return totals only, plus hasVoted for the caller, so
//     their own button can show as picked.
//
// POST { meetingId, accessToken?, participantRowId?, action, ... }
//   action 'create' { question, options[2..6], isAnonymous }
//   action 'vote'   { pollId, optionIndex }
//   action 'close'  { pollId }            host (or poll creator) only
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   Open polls for the meeting, with totals. Anonymous polls never
//   include any voter data; named server polls include totals only.
// Rate limited per IP; every value validated server-side.
import { NextRequest } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  internalError,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { resolveC2bCaller } from '../../_lib/c2b';

const TABLE_MISSING = 'Polls need the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';

// Security audit: the anonymous-vote pepper must be its own secret.
// The old code fell back to the service-role key (key misuse: rotating
// that key silently broke every existing vote's hasVoted match, and a
// leaked vote table plus a leaked key de-anonymises votes) and then to
// a pepper printed in this repo, which de-anonymises votes for anyone
// who reads the code. Set GIINMEET_POLL_PEPPER in Vercel to a long
// random string for durable anonymity. Until it is set, a random
// per-process pepper keeps polls working; a voter may then be able to
// vote twice across a redeploy, and the server logs a warning.
let ephemeralPollPepper: string | null = null;
function voterHash(pollId: string, voterKey: string): string {
  const configured = (process.env.GIINMEET_POLL_PEPPER || '').trim();
  let pepper = configured;
  if (!pepper) {
    if (!ephemeralPollPepper) {
      ephemeralPollPepper = randomBytes(32).toString('hex');
      console.warn('[Polls] GIINMEET_POLL_PEPPER is not set, using a temporary pepper. Set it in Vercel for durable anonymous votes.');
    }
    pepper = ephemeralPollPepper;
  }
  return createHash('sha256').update(`${pollId}:${voterKey}:${pepper}`).digest('hex');
}

async function totalsFor(admin: any, poll: any, callerKey: string) {
  const { data: voteRows } = await admin
    .from('meeting_poll_votes')
    .select('option_index, voter_hash')
    .eq('poll_id', poll.id);
  const options = (poll.options || []) as string[];
  const votes = options.map(() => 0);
  let hasVoted: number | null = null;
  const mine = voterHash(poll.id, callerKey);
  for (const v of (voteRows as any[]) || []) {
    if (typeof v.option_index === 'number' && v.option_index >= 0 && v.option_index < votes.length) {
      votes[v.option_index] += 1;
    }
    if (v.voter_hash === mine) hasVoted = v.option_index;
  }
  return {
    id: poll.id,
    question: poll.question,
    options,
    votes,
    isAnonymous: !!poll.is_anonymous,
    isClosed: !!poll.is_closed,
    createdBy: poll.created_by,
    createdAt: poll.created_at,
    hasVoted,
  };
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meeting-polls', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to see polls.', 401);
    }
    const { data, error } = await admin
      .from('meeting_polls')
      .select('id, question, options, is_anonymous, is_closed, created_by, created_at')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING, polls: [] });
    }
    const polls = [];
    for (const p of (data || []) as any[]) {
      polls.push(await totalsFor(admin, p, caller.key));
    }
    return jsonWithSecurity({ ok: true, polls });
  } catch (err) {
    return internalError('Meeting Polls API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meeting-polls', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const meetingId = body.meetingId as string | undefined;
    const action = cleanText(body.action, 20);
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const caller = await resolveC2bCaller(admin, meetingId, body);
    if (!caller) {
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to use polls.', 401);
    }

    if (action === 'create') {
      const question = cleanText(body.question, 200);
      const rawOptions = Array.isArray(body.options) ? body.options : [];
      const options = rawOptions.map((o: unknown) => cleanText(o, 80)).filter((o: string) => o.length > 0);
      const isAnonymous = body.isAnonymous === true;
      if (!question) {
        return errorWithSecurity('BAD_REQUEST', 'Write the poll question first.', 400);
      }
      if (options.length < 2 || options.length > 6) {
        return errorWithSecurity('BAD_REQUEST', 'Give the poll between 2 and 6 answers.', 400);
      }
      const { data, error } = await admin
        .from('meeting_polls')
        .insert([
          {
            meeting_id: meetingId,
            question,
            options,
            is_anonymous: isAnonymous,
            is_closed: false,
            created_by: caller.key,
          },
        ])
        .select('id, question, options, is_anonymous, is_closed, created_by, created_at')
        .maybeSingle();
      if (error || !data) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, poll: await totalsFor(admin, data, caller.key) });
    }

    const pollId = cleanText(body.pollId, 64);
    if (!isUuid(pollId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid poll is required.', 400);
    }
    const { data: poll } = await admin
      .from('meeting_polls')
      .select('id, meeting_id, question, options, is_anonymous, is_closed, created_by')
      .eq('id', pollId)
      .maybeSingle();
    if (!poll || (poll as any).meeting_id !== meetingId) {
      return errorWithSecurity('NOT_FOUND', 'That poll is not in this meeting.', 404);
    }

    if (action === 'vote') {
      if ((poll as any).is_closed) {
        return errorWithSecurity('POLL_CLOSED', 'That poll is closed, voting has stopped.', 403);
      }
      const optionIndex = body.optionIndex;
      const options = ((poll as any).options || []) as string[];
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
        return errorWithSecurity('BAD_REQUEST', 'Pick one of the poll answers.', 400);
      }
      // One vote per voter, changeable: the hash proves they already
      // voted, it never reveals who they are.
      const hash = voterHash(pollId, caller.key);
      const { error } = await admin.from('meeting_poll_votes').upsert(
        [{ poll_id: pollId, option_index: optionIndex, voter_hash: hash }],
        { onConflict: 'poll_id,voter_hash' },
      );
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, poll: await totalsFor(admin, poll, caller.key) });
    }

    if (action === 'close') {
      if (!caller.isHost && (poll as any).created_by !== caller.key) {
        return errorWithSecurity('FORBIDDEN', 'Only the host or the person who made the poll can close it.', 403);
      }
      await admin.from('meeting_polls').update({ is_closed: true }).eq('id', pollId);
      return jsonWithSecurity({ ok: true, poll: await totalsFor(admin, { ...(poll as any), is_closed: true }, caller.key) });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown poll action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Meeting Polls API', err);
  }
}
