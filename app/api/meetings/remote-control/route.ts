// Phase C2b (1), remote control of a shared screen.
//
// The sharer grants control explicitly and can revoke it at any time.
// Control itself travels on the LiveKit data channel, but the GRANT
// lives here, server-side: the sharer's client only honours data
// packets from a controller whose grant row says 'granted', and only
// while the sharer is still sharing. No grant row, no control.
//
// POST { meetingId, accessToken?, participantRowId?, action, ... }
//   action 'request' { sharerKey } ......... ask the sharer for control
//   action 'grant'   { controllerKey } ..... sharer allows it
//   action 'deny'    { controllerKey } ..... sharer refuses it
//   action 'revoke'  { controllerKey? } ... sharer (or the controller)
//          takes control away. No controllerKey revokes every grant
//          the caller holds or gave, e.g. when the share stops.
// GET ?meetingId=...&accessToken=...&participantRowId=...
//   The sharer's pending requests plus the live grant, if any. A
//   controller only ever sees their own rows.
// Rate limited per IP; every value validated server-side. Nothing in
// the client is trusted for a permission decision.
//
// Honest limit, stated in the UI too: a browser cannot press keys or
// click into the sharer's operating system, so control acts on the
// shared screen's visible pointer and on GiinMeet's own shared
// surfaces (the document viewer and the live notes pad). It never
// touches the sharer's OS.
import { NextRequest } from 'next/server';
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
import { isAdmittedKey, resolveC2bCaller } from '../../_lib/c2b';

const TABLE_MISSING = 'Remote control needs the Phase C2b database setup first (run giinmeet_phaseC2b.sql).';

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'remote-control', 60, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to use remote control.', 401);
    }
    const { data, error } = await admin
      .from('meeting_remote_control')
      .select('id, sharer_key, controller_key, controller_name, status, created_at')
      .eq('meeting_id', meetingId)
      .in('status', ['requested', 'granted'])
      .order('created_at', { ascending: true });
    if (error) {
      return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
    }
    const rows = (data || []) as any[];
    // The sharer sees requests made to them; everyone else sees only
    // their own rows, so nobody can enumerate who asked whom.
    const mine = rows.filter(
      (r) => r.sharer_key === caller.key || r.controller_key === caller.key,
    );
    return jsonWithSecurity({
      ok: true,
      requests: mine.filter((r) => r.status === 'requested'),
      grant: mine.find((r) => r.status === 'granted') || null,
    });
  } catch (err) {
    return internalError('Remote Control API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'remote-control', 30, 60 * 1000);
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
      return errorWithSecurity('UNAUTHORIZED', 'Join the meeting to use remote control.', 401);
    }
    const otherKey = cleanText(body.controllerKey || body.sharerKey, 64);

    if (action === 'request') {
      const sharerKey = cleanText(body.sharerKey, 64);
      if (!sharerKey || sharerKey === caller.key) {
        return errorWithSecurity('BAD_REQUEST', 'Choose someone else who is sharing their screen.', 400);
      }
      if (!(await isAdmittedKey(admin, meetingId!, sharerKey))) {
        return errorWithSecurity('NOT_FOUND', 'That person is not in this meeting.', 404);
      }
      const { data, error } = await admin
        .from('meeting_remote_control')
        .insert([
          {
            meeting_id: meetingId,
            sharer_key: sharerKey,
            controller_key: caller.key,
            controller_name: caller.name,
            status: 'requested',
          },
        ])
        .select('id, sharer_key, controller_key, controller_name, status, created_at')
        .maybeSingle();
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, request: data });
    }

    if (action === 'grant' || action === 'deny') {
      if (!otherKey) {
        return errorWithSecurity('BAD_REQUEST', 'Choose who asked for control.', 400);
      }
      // Only the sharer grants or denies, and only for a request made
      // to them. The caller's key must match the sharer_key on the row.
      const { data: row } = await admin
        .from('meeting_remote_control')
        .select('id, sharer_key, controller_key, status')
        .eq('meeting_id', meetingId)
        .eq('controller_key', otherKey)
        .eq('sharer_key', caller.key)
        .eq('status', 'requested')
        .maybeSingle();
      if (!row) {
        return errorWithSecurity('NOT_FOUND', 'There is no control request from that person.', 404);
      }
      if (action === 'grant') {
        // One controller at a time: revoke any earlier grant first.
        await admin
          .from('meeting_remote_control')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .eq('meeting_id', meetingId)
          .eq('sharer_key', caller.key)
          .eq('status', 'granted');
      }
      const { error } = await admin
        .from('meeting_remote_control')
        .update({ status: action === 'grant' ? 'granted' : 'denied', updated_at: new Date().toISOString() })
        .eq('id', (row as any).id);
      if (error) {
        return jsonWithSecurity({ ok: false, reason: 'NOT_CONFIGURED', message: TABLE_MISSING });
      }
      return jsonWithSecurity({ ok: true, action });
    }

    if (action === 'revoke') {
      // The sharer revokes a grant they gave, or the controller gives
      // their own control back. Either side can end it, at any time.
      const q = admin
        .from('meeting_remote_control')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('meeting_id', meetingId)
        .eq('status', 'granted');
      if (otherKey) {
        await q.or(`sharer_key.eq.${caller.key},controller_key.eq.${caller.key}`).eq('controller_key', otherKey);
      } else {
        await q.or(`sharer_key.eq.${caller.key},controller_key.eq.${caller.key}`);
      }
      return jsonWithSecurity({ ok: true, action: 'revoked' });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown remote control action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Remote Control API', err);
  }
}
