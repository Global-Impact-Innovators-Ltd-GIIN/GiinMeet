// Phase D (38), waiting-room upgrades, server-side.
//
// POST { action, ... }:
//   preview      { meetingId }
//     No sign-in needed: the join link itself is the invitation, so a
//     guest waiting to be let in may see the meeting title, start
//     time, saved agenda, and the host or organisation brand. Never
//     returns a passcode, an email, or any participant list.
//   knock        { meetingId, participantRowId, message }
//     A waiting guest sends one line (why they are there). The row
//     must belong to this meeting and be Waiting, and the message is
//     capped at 140 characters.
//   message      { meetingId, participantRowId, message, accessToken }
//     Host or co-host writes a line to one waiting guest. It is stored
//     on the guest row (so a missed broadcast still shows) and
//     broadcast with a server marker.
//   admit-all    { meetingId, accessToken }
//     Host or co-host admits everyone currently waiting, up to the
//     host tier capacity. Returns how many were admitted.
//   check-regular { meetingId, accessToken }
//     Signed-in caller: true when the meeting host listed this email
//     as a regular, so the client may bypass the lobby.
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
import { isHost } from '../../_lib/meetingAccess';
import { tierForProfile, TIER_LIMITS } from '../../../../src/utils/tiers';

async function broadcastToRoom(admin: any, meetingId: string, event: string, payload: any) {
  const channelName = 'sig-webrtc-' + meetingId;
  const ch = admin.channel(channelName, { config: { broadcast: { self: false } } });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out joining the room channel.')), 8000);
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Could not join the room channel (' + status + ').')); }
      });
    });
    const result = await ch.send({ type: 'broadcast', event, payload });
    if (result && result !== 'ok') throw new Error('The room did not accept the broadcast.');
  } finally {
    try { await admin.removeChannel(ch); } catch { /* already gone */ }
  }
}

async function isHostOrCoHost(
  admin: any,
  meeting: { admin_id?: string | null; user_id?: string | null },
  userId: string,
): Promise<boolean> {
  if (meeting.admin_id ? meeting.admin_id === userId : meeting.user_id === userId) return true;
  const { data: coRow } = await admin
    .from('meeting_participants')
    .select('id')
    .eq('meeting_id', (meeting as any).id)
    .eq('user_id', userId)
    .eq('role', 'CoHost')
    .eq('status', 'Admitted')
    .maybeSingle();
  return !!coRow;
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'meetings-waiting-room', 30, 60 * 1000);
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
    const action = typeof body.action === 'string' ? body.action : '';

    // ---- preview: agenda, countdown source, brand. No auth. ----
    if (action === 'preview') {
      const { data: meeting, error } = await admin
        .from('meetings')
        .select('id,title,time,status,agenda_items,team_id,organisation_id,e2ee_enabled,require_waiting_room')
        .eq('id', meetingId)
        .maybeSingle();
      if (error || !meeting) {
        return errorWithSecurity('NOT_FOUND', 'This meeting could not be found.', 404);
      }
      // Brand, most specific first: organisation, then team, then the
      // shared workspace brand. Each read is best-effort, a missing
      // table (SQL not run) means "no brand", never a failure.
      let brand: { name: string; logoUrl: string | null; accent: string | null; slogan: string | null } | null = null;
      try {
        if ((meeting as any).organisation_id) {
          const { data: org } = await admin
            .from('organisations')
            .select('name,logo_url,accent_color,slogan')
            .eq('id', (meeting as any).organisation_id)
            .maybeSingle();
          if (org) {
            brand = {
              name: (org as any).name,
              logoUrl: (org as any).logo_url || null,
              accent: (org as any).accent_color || null,
              slogan: (org as any).slogan || null,
            };
          }
        }
      } catch { /* no organisation brand */ }
      if (!brand) {
        try {
          if ((meeting as any).team_id) {
            const { data: team } = await admin
              .from('teams')
              .select('name,logo_url,accent_color')
              .eq('id', (meeting as any).team_id)
              .maybeSingle();
            if (team && ((team as any).logo_url || (team as any).accent_color)) {
              brand = {
                name: (team as any).name,
                logoUrl: (team as any).logo_url || null,
                accent: (team as any).accent_color || null,
                slogan: null,
              };
            }
          }
        } catch { /* no team brand */ }
      }
      if (!brand) {
        try {
          const { data: ws } = await admin
            .from('workspace_brand')
            .select('brand_name,logo_url,accent_color,slogan')
            .limit(1)
            .maybeSingle();
          if (ws) {
            brand = {
              name: (ws as any).brand_name || 'GiinMeet',
              logoUrl: (ws as any).logo_url || null,
              accent: (ws as any).accent_color || null,
              slogan: (ws as any).slogan || null,
            };
          }
        } catch { /* no workspace brand */ }
      }
      return jsonWithSecurity({
        ok: true,
        title: (meeting as any).title || 'GiinMeet meeting',
        time: (meeting as any).time || null,
        status: (meeting as any).status || null,
        agenda: Array.isArray((meeting as any).agenda_items) ? (meeting as any).agenda_items : [],
        e2eeEnabled: !!(meeting as any).e2ee_enabled,
        requireWaitingRoom: (meeting as any).require_waiting_room !== false,
        brand,
      });
    }

    // ---- knock: a waiting guest sends one line to the host. ----
    if (action === 'knock') {
      const participantRowId = typeof body.participantRowId === 'string' ? body.participantRowId : '';
      const message = cleanText(body.message, 140);
      if (!participantRowId || !message) {
        return errorWithSecurity('BAD_REQUEST', 'A knock needs your waiting-room place and one short line.', 400);
      }
      const { data: row } = await admin
        .from('meeting_participants')
        .select('id,status')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      if (!row || (row as any).status !== 'Waiting') {
        return errorWithSecurity('FORBIDDEN', 'Only someone waiting in the lobby can knock.', 403);
      }
      const { error } = await admin
        .from('meeting_participants')
        .update({ knock_message: message, updated_at: new Date().toISOString() })
        .eq('id', participantRowId);
      if (error) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Knocking needs the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({ ok: true });
    }

    // ---- the rest need a signed-in host or co-host. ----
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to manage the waiting room.', 401);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id,admin_id,user_id,status')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return errorWithSecurity('NOT_FOUND', 'This meeting could not be found.', 404);
    }
    if ((meeting as any).status === 'Completed') {
      return errorWithSecurity('MEETING_ENDED', 'This meeting has ended.', 403);
    }

    if (action === 'check-regular') {
      const hostId = (meeting as any).admin_id || (meeting as any).user_id;
      let regular = false;
      try {
        const { data } = await admin
          .from('host_regulars')
          .select('id')
          .eq('host_id', hostId)
          .eq('email', (user.email || '').toLowerCase())
          .maybeSingle();
        regular = !!data;
      } catch { regular = false; }
      return jsonWithSecurity({ ok: true, regular });
    }

    if (!(await isHostOrCoHost(admin, meeting as any, user.id))) {
      return errorWithSecurity('FORBIDDEN', 'Only the host or a co-host can manage the waiting room.', 403);
    }

    // ---- message: host writes one line to a waiting guest. ----
    if (action === 'message') {
      const participantRowId = typeof body.participantRowId === 'string' ? body.participantRowId : '';
      const message = cleanText(body.message, 280);
      if (!participantRowId || !message) {
        return errorWithSecurity('BAD_REQUEST', 'Choose a waiting guest and write a short message.', 400);
      }
      const { data: row } = await admin
        .from('meeting_participants')
        .select('id,status')
        .eq('id', participantRowId)
        .eq('meeting_id', meetingId)
        .maybeSingle();
      if (!row || (row as any).status !== 'Waiting') {
        return errorWithSecurity('NOT_FOUND', 'That guest is no longer waiting.', 404);
      }
      await admin
        .from('meeting_participants')
        .update({ lobby_message: message, updated_at: new Date().toISOString() })
        .eq('id', participantRowId);
      try {
        await broadcastToRoom(admin, meetingId, 'waitroom-message', {
          server: true,
          targetKey: participantRowId,
          message,
        });
      } catch (e) {
        // The stored row is the source of truth, the guest sees the
        // message on their next check even if the broadcast missed.
        console.error('[Waiting Room API] Lobby message broadcast failed:', (e as any)?.message || e);
      }
      return jsonWithSecurity({ ok: true });
    }

    // ---- admit-all: everyone waiting, up to tier capacity. ----
    if (action === 'admit-all') {
      const hostUserId = (meeting as any).admin_id || (meeting as any).user_id;
      let hostIsPremium = false;
      let hostPlanTier: string | null = null;
      if (hostUserId) {
        try {
          const { data: hostProfile } = await admin
            .from('profiles')
            .select('is_premium, plan_tier')
            .eq('id', hostUserId)
            .maybeSingle();
          hostIsPremium = !!(hostProfile as any)?.is_premium;
          hostPlanTier = (hostProfile as any)?.plan_tier ?? null;
        } catch { /* Free tier */ }
      }
      const hostTier = tierForProfile({ is_premium: hostIsPremium, plan_tier: hostPlanTier });
      const maxCapacity = TIER_LIMITS[hostTier];
      const { count: admittedCount } = await admin
        .from('meeting_participants')
        .select('*', { count: 'exact', head: true })
        .eq('meeting_id', meetingId)
        .eq('status', 'Admitted');
      let seatsLeft = maxCapacity - ((admittedCount ?? 0) + 1);
      const { data: waiting } = await admin
        .from('meeting_participants')
        .select('id')
        .eq('meeting_id', meetingId)
        .eq('status', 'Waiting')
        .order('updated_at', { ascending: true });
      const rows = (waiting || []) as any[];
      let admitted = 0;
      const admittedIds: string[] = [];
      for (const row of rows) {
        if (seatsLeft <= 0) break;
        const { error } = await admin
          .from('meeting_participants')
          .update({ status: 'Admitted', updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('meeting_id', meetingId);
        if (!error) {
          admitted += 1;
          seatsLeft -= 1;
          admittedIds.push(row.id);
        }
      }
      // One targeted broadcast per guest: the guest client only reacts
      // to a waitroom-response whose targetKey is its own row id, and
      // the database row is the source of truth if a broadcast misses.
      for (const id of admittedIds) {
        try {
          await broadcastToRoom(admin, meetingId, 'waitroom-response', {
            server: true,
            targetKey: id,
            status: 'Admitted',
          });
        } catch (e) {
          console.error('[Waiting Room API] Admit-all broadcast failed:', (e as any)?.message || e);
        }
      }
      return jsonWithSecurity({
        ok: true,
        admitted,
        waitingLeft: rows.length - admitted,
        full: seatsLeft <= 0 && rows.length - admitted > 0,
      });
    }

    return errorWithSecurity('BAD_REQUEST', 'Unknown waiting-room action.', 400);
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Waiting Room API', err);
  }
}
