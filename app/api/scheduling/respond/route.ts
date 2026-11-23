// Phase C1 (33), vote on a scheduling poll.
//
// POST { token, voterName, votes: { "<slot ISO>": "yes" | "no" | "maybe" } }
//   No account needed: the unguessable poll link is the key. The voter
//   name and the votes are validated server-side (only slots the poll
//   actually offered, only yes/no/maybe), and voting is rate limited per
//   IP and per poll. Accepts JSON, or a form post from the poll page
//   (which is then sent back to the poll page with ?voted=1).
import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '../../_lib/security';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  internalError,
  jsonWithSecurity,
} from '../../_lib/security';

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'scheduling-respond', 10, 60 * 1000);
    if (limited) return limited;
    const contentType = req.headers.get('content-type') || '';
    let token = '';
    let voterName = '';
    let votes: Record<string, string> = {};
    let fromForm = false;
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      fromForm = true;
      const form = await req.formData();
      token = String(form.get('token') || '').trim();
      voterName = String(form.get('voterName') || '').trim();
      for (const [key, value] of form.entries()) {
        if (key.startsWith('vote:')) {
          votes[key.slice(5)] = String(value);
        }
      }
    } else {
      const body = await readJsonBody(req);
      token = String((body as any).token || '').trim();
      voterName = String((body as any).voterName || '').trim();
      votes = ((body as any).votes || {}) as Record<string, string>;
    }
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      return errorWithSecurity('BAD_REQUEST', 'That poll link is not valid.', 400);
    }
    const name = cleanText(voterName, 80);
    if (!name) {
      return errorWithSecurity('BAD_REQUEST', 'Tell us your name so the host knows who voted.', 400);
    }
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const { data: poll } = await admin
      .from('scheduling_polls')
      .select('id, slots, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (!poll) {
      return errorWithSecurity('NOT_FOUND', 'That poll does not exist. Check the link and try again.', 404);
    }
    if (new Date((poll as any).expires_at).getTime() < Date.now()) {
      return errorWithSecurity('NOT_FOUND', 'That poll has expired.', 404);
    }
    const offered = new Set(((poll as any).slots || []) as string[]);
    const cleanVotes: Record<string, string> = {};
    for (const [slot, answer] of Object.entries(votes)) {
      if (!offered.has(slot)) continue;
      if (answer !== 'yes' && answer !== 'no' && answer !== 'maybe') continue;
      cleanVotes[slot] = answer;
    }
    if (Object.keys(cleanVotes).length === 0) {
      return errorWithSecurity('BAD_REQUEST', 'Vote on at least one time.', 400);
    }
    const { error } = await admin.from('scheduling_poll_votes').insert([
      { poll_id: (poll as any).id, voter_name: name, votes: cleanVotes },
    ]);
    if (error) {
      return errorWithSecurity('DB_ERROR', 'Your vote could not be saved. Please try again.', 500);
    }
    if (fromForm) {
      return NextResponse.redirect(new URL(`/poll/${token}?voted=1`, req.nextUrl.origin));
    }
    return jsonWithSecurity({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    return internalError('Scheduling Respond API', err);
  }
}
