// Phase D (42), the public API: other apps create GiinMeet meetings.
//
// Auth: the `x-api-key` header, verified server-side against the
// stored SHA-256 hash (see app/api/_lib/phaseD.ts). The key is never
// in client code: it lives in the calling app's server, and this
// route never returns one. Rate limit: 30 requests per minute per
// calling IP, plus the key itself is the account, so a leaked key can
// be revoked and stops working at once.
//
// POST /api/public-api/meetings { title, time, duration?, require_waiting_room?, passcode? }
//   -> 201 { meeting } with the join link. Fires the meeting.created
//      webhook for the key owner.
// GET /api/public-api/meetings
//   -> the key owner's meetings, newest first (50 max).
// Full documentation: docs/API.md.
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  internalError,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import { deliverMeetingEvent, verifyApiKey } from '../../_lib/phaseD';
import { tierForProfile, TIER_LIMITS } from '../../../../src/utils/tiers';

const PASSCODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generatePasscode(): string {
  let out = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += PASSCODE_CHARS[b % PASSCODE_CHARS.length];
  return out;
}

async function authenticate(req: NextRequest, admin: any) {
  const rawKey = req.headers.get('x-api-key') || '';
  if (!rawKey) {
    return { error: errorWithSecurity('UNAUTHORIZED', 'An API key is required. Send it as the x-api-key header.', 401) };
  }
  const verified = await verifyApiKey(admin, rawKey);
  if (!verified) {
    return { error: errorWithSecurity('UNAUTHORIZED', 'That API key is not valid, or it has been revoked.', 401) };
  }
  return { ownerId: verified.ownerId };
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'public-api-meetings', 60, 60 * 1000);
    if (limited) return limited;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const auth = await authenticate(req, admin);
    if ('error' in auth) return auth.error;
    const { data, error } = await admin
      .from('meetings')
      .select('id,title,time,duration,status,host,require_waiting_room,created_at')
      .eq('user_id', auth.ownerId)
      .order('time', { ascending: false })
      .limit(50);
    if (error) {
      return errorWithSecurity('DB_ERROR', 'Could not list meetings.', 500);
    }
    const origin = req.nextUrl.origin;
    return jsonWithSecurity({
      ok: true,
      meetings: (data || []).map((m: any) => ({
        ...m,
        join_url: `${origin}/#/join?id=${m.id}`,
      })),
    });
  } catch (err) {
    return internalError('Public API Meetings', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'public-api-meetings', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const auth = await authenticate(req, admin);
    if ('error' in auth) return auth.error;
    const ownerId = auth.ownerId;

    const title = cleanText(body.title, 200);
    if (!title) {
      return errorWithSecurity('BAD_REQUEST', 'title is required (up to 200 characters).', 400);
    }
    const time = typeof body.time === 'string' ? body.time : '';
    const when = new Date(time);
    if (!time || Number.isNaN(when.getTime())) {
      return errorWithSecurity('BAD_REQUEST', 'time is required, as an ISO 8601 date and time.', 400);
    }
    const duration = cleanText(body.duration, 40) || '40m limit';
    const requireWaitingRoom =
      typeof body.require_waiting_room === 'boolean' ? body.require_waiting_room : true;
    const passcode =
      body.passcode === null
        ? null
        : typeof body.passcode === 'string' && body.passcode.trim()
          ? body.passcode.trim().slice(0, 20)
          : generatePasscode();

    // Owner tier decides the LiveKit room capacity, same as the app.
    let hostIsPremium = false;
    let hostPlanTier: string | null = null;
    let ownerName = 'You';
    try {
      const { data: profile } = await admin
        .from('profiles')
        .select('is_premium, plan_tier, name')
        .eq('id', ownerId)
        .maybeSingle();
      hostIsPremium = !!(profile as any)?.is_premium;
      hostPlanTier = (profile as any)?.plan_tier ?? null;
      ownerName = (profile as any)?.name || 'You';
    } catch {
      /* profile unreadable: Free tier, name "You" */
    }
    const tier = tierForProfile({ is_premium: hostIsPremium, plan_tier: hostPlanTier });

    const meetingId = randomUUID();
    const { error } = await admin.from('meetings').insert({
      id: meetingId,
      user_id: ownerId,
      admin_id: ownerId,
      title,
      time: when.toISOString(),
      duration,
      status: 'Scheduled',
      host: ownerName,
      require_waiting_room: requireWaitingRoom,
      passcode,
    });
    if (error) {
      console.error('[Public API Meetings] Insert failed:', error.message);
      return errorWithSecurity('DB_ERROR', 'Could not create the meeting.', 500);
    }
    // The LiveKit room row, best-effort: the join flow retries it,
    // so a failure here must not fail the meeting creation.
    try {
      await admin.from('rooms').insert({
        room_name: title,
        slug: `meet-${meetingId}`,
        organization_id: ownerId,
        host_id: ownerId,
        is_active: true,
        max_capacity: TIER_LIMITS[tier],
        current_engine: 'LIVEKIT',
      });
    } catch {
      /* retried on join */
    }

    const origin = req.nextUrl.origin;
    const meeting = {
      id: meetingId,
      title,
      time: when.toISOString(),
      duration,
      status: 'Scheduled',
      host: ownerName,
      require_waiting_room: requireWaitingRoom,
      passcode,
      join_url: `${origin}/#/join?id=${meetingId}`,
    };
    await deliverMeetingEvent(admin, ownerId, 'meeting.created', {
      id: meetingId,
      title,
      time: when.toISOString(),
    });
    return jsonWithSecurity({ ok: true, meeting }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Public API Meetings', err);
  }
}
