// Phase D (44), team rooms and team branding.
//
// POST { accessToken, teamId, action: 'get-or-create' | 'brand',
//        logoUrl?, accentColor?, accentHover? }
//   get-or-create: any team member gets the team's persistent room:
//     one meeting row the whole team joins in one tap. When the room
//     already exists and has not ended, it is returned as-is, never
//     duplicated. A room whose meeting ended gets a fresh one.
//   brand: a team admin sets the team's logo and accent colours,
//     which the waiting room and the room then carry. Members only
//     see, never set.
// Team meeting history itself needs no new route: the client already
// lists a team's meetings (getMeetingsForTeam), and the history view
// in Teams.tsx groups that list into upcoming and past.
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'teams-room', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity('SERVER_MISCONFIGURED', 'The video service is not configured on this server.', 500);
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to use team rooms.', 401);
    }
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    if (!isUuid(teamId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid team is required.', 400);
    }
    const { data: member } = await admin
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) {
      return errorWithSecurity('FORBIDDEN', 'Only team members can use this team room.', 403);
    }
    const isAdmin = (member as any).role === 'admin';
    const action = typeof body.action === 'string' ? body.action : 'get-or-create';

    if (action === 'brand') {
      if (!isAdmin) {
        return errorWithSecurity('FORBIDDEN', 'Only a team admin can change the team brand.', 403);
      }
      const patch: Record<string, unknown> = {};
      if (typeof body.logoUrl === 'string') patch.logo_url = body.logoUrl.trim().slice(0, 2000) || null;
      if (typeof body.accentColor === 'string' && HEX_RE.test(body.accentColor.trim())) {
        patch.accent_color = body.accentColor.trim();
      }
      if (typeof body.accentHover === 'string' && HEX_RE.test(body.accentHover.trim())) {
        patch.accent_hover = body.accentHover.trim();
      }
      if (Object.keys(patch).length === 0) {
        return errorWithSecurity('BAD_REQUEST', 'Nothing to change.', 400);
      }
      const { data, error } = await admin
        .from('teams')
        .update(patch)
        .eq('id', teamId)
        .select('id,name,logo_url,accent_color,accent_hover')
        .maybeSingle();
      if (error || !data) {
        return jsonWithSecurity({
          ok: false,
          reason: 'NOT_CONFIGURED',
          message: 'Team branding needs the Phase D database setup first (run giinmeet_phaseD.sql).',
        });
      }
      return jsonWithSecurity({
        ok: true,
        team: {
          id: (data as any).id,
          name: (data as any).name,
          logoUrl: (data as any).logo_url || null,
          accentColor: (data as any).accent_color || null,
          accentHover: (data as any).accent_hover || null,
        },
      });
    }

    if (action !== 'get-or-create') {
      return errorWithSecurity('BAD_REQUEST', 'Unknown team room action.', 400);
    }

    const { data: team, error: teamError } = await admin
      .from('teams')
      .select('id,name,room_meeting_id')
      .eq('id', teamId)
      .maybeSingle();
    if (teamError || !team) {
      return errorWithSecurity('NOT_FOUND', 'This team could not be found.', 404);
    }
    const roomMeetingId = (team as any).room_meeting_id as string | null;
    if (roomMeetingId) {
      const { data: existing } = await admin
        .from('meetings')
        .select('id,title,status')
        .eq('id', roomMeetingId)
        .maybeSingle();
      if (existing && (existing as any).status !== 'Completed') {
        return jsonWithSecurity({
          ok: true,
          meetingId: (existing as any).id,
          title: (existing as any).title,
          created: false,
        });
      }
    }

    // Fresh room: a team meeting, members only, that lives until the
    // host ends it. The waiting-room rule follows the team's shared
    // settings when they exist, and defaults to on.
    let requireWaitingRoom = true;
    try {
      const { data: settings } = await admin
        .from('team_settings')
        .select('default_require_waiting_room')
        .eq('team_id', teamId)
        .maybeSingle();
      if (settings && typeof (settings as any).default_require_waiting_room === 'boolean') {
        requireWaitingRoom = (settings as any).default_require_waiting_room;
      }
    } catch { /* default stands */ }
    const meetingId = randomUUID();
    const title = `${(team as any).name} team room`;
    const { error: insertError } = await admin.from('meetings').insert({
      id: meetingId,
      user_id: user.id,
      admin_id: user.id,
      title,
      time: new Date().toISOString(),
      duration: 'up to 24h',
      status: 'Scheduled',
      host: user.user_metadata?.name || user.email || 'Team',
      require_waiting_room: requireWaitingRoom,
      passcode: null,
      team_id: teamId,
    });
    if (insertError) {
      console.error('[Team Room API] Insert failed:', insertError.message);
      return errorWithSecurity('DB_ERROR', 'Could not create the team room.', 500);
    }
    try {
      await admin.from('rooms').insert({
        room_name: title,
        slug: `meet-${meetingId}`,
        organization_id: user.id,
        host_id: user.id,
        is_active: true,
        max_capacity: 50,
        current_engine: 'LIVEKIT',
      });
    } catch { /* retried on join */ }
    await admin.from('teams').update({ room_meeting_id: meetingId }).eq('id', teamId);
    return jsonWithSecurity({ ok: true, meetingId, title, created: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Team Room API', err);
  }
}
