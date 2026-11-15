import { NextRequest, NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../../../src/supabaseClient';
import { tierForProfile, TIER_LIMITS, TIER_LABELS } from '../../../../src/utils/tiers';

// Server-only Supabase admin client. It uses SUPABASE_SERVICE_ROLE_KEY,
// which bypasses RLS, so it must NEVER be imported by client code and the
// key must NEVER appear in a client bundle or a file committed to git.
// The key is set as a Vercel env var (Production + Preview).
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { roomId, roomSlug, userName, accessToken, participantRowId, meetingId } = body;

    if (!roomId && !roomSlug) {
      return NextResponse.json({
        error: 'BAD_REQUEST',
        message: 'Missing required parameters: (roomId or roomSlug)',
      }, { status: 400 });
    }

    // Caller credential: a signed-in user's Supabase access token, or a
    // guest's admitted participant row id. One of them is required.
    if (!accessToken && !participantRowId) {
      return NextResponse.json({
        error: 'UNAUTHORIZED',
        message: 'A session token or an admitted participant row is required.',
      }, { status: 401 });
    }

    // 0. Server-side authorisation needs the service-role key. Fail closed:
    // without it the session cannot be verified, so no token is minted.
    const admin = getAdminClient();
    if (!admin) {
      console.error('[Token API] SUPABASE_SERVICE_ROLE_KEY is not set on the server.');
      return NextResponse.json({
        error: 'SERVER_MISCONFIGURED',
        message: 'The video service is not configured on this server. Please contact the administrator.',
      }, { status: 500 });
    }

    // 1. Fetch the active target room.
    // LiveKit-native breakouts: a breakout room is its own LiveKit room,
    // `<main-slug>-breakout-<n>`, and there is NO `rooms` row for it.
    // The main room's row stays the authority for admission, meeting and
    // tier, so a `-breakout-<n>` suffix on the requested slug is stripped
    // for the lookup and re-attached for the token grant and the capacity
    // count below. A roomId lookup is only used for the main room.
    let breakoutRoomNumber: number | null = null;
    let lookupSlug = roomSlug as string | undefined;
    if (typeof roomSlug === 'string') {
      const breakoutMatch = roomSlug.match(/-breakout-([1-5])$/);
      if (breakoutMatch) {
        breakoutRoomNumber = parseInt(breakoutMatch[1], 10);
        lookupSlug = roomSlug.slice(0, breakoutMatch.index);
      }
    }
    let roomQuery = supabase.from('rooms').select('*').eq('is_active', true);
    if (roomId && breakoutRoomNumber === null) {
      roomQuery = roomQuery.eq('id', roomId);
    } else {
      roomQuery = roomQuery.eq('slug', lookupSlug);
    }

    const { data: room, error: roomError } = await roomQuery.maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({
        error: 'ROOM_NOT_FOUND',
        message: 'The requested room does not exist or has been deactivated.',
      }, { status: 404 });
    }

    // 2. Derive the meeting id: the client sends it, otherwise the room slug
    // is meet-<meetingId> (see getMeetingRoomSlug in supabaseClient.ts).
    const derivedMeetingId =
      (typeof meetingId === 'string' && meetingId) ||
      (typeof room.slug === 'string' && room.slug.startsWith('meet-') ? room.slug.slice(5) : '');
    if (!derivedMeetingId) {
      return NextResponse.json({
        error: 'ADMISSION_REQUIRED',
        message: 'This room is not linked to a meeting.',
      }, { status: 403 });
    }

    // 3. Verify the caller and derive the LiveKit identity from the session
    // (signed-in users) or from the verified participant row (guests).
    // Client-supplied userId / role are NEVER trusted for authorisation.
    let identity = '';
    let displayName = typeof userName === 'string' && userName ? userName : 'Guest';
    // Roles the token route derives (client-supplied roles are never trusted):
    // HOST = meeting creator/admin, COHOST = granted by the host (a
    // meeting_participants row with role 'CoHost'), MODERATOR = granted
    // by the host (a meeting_participants row with role 'Moderator'),
    // GUEST = everyone else. SPEAKER is never assigned.
    let derivedRole: 'HOST' | 'COHOST' | 'MODERATOR' | 'GUEST' = 'GUEST';

    // Fetch the meeting row (admin truth) once.
    const { data: meeting, error: meetingError } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, require_waiting_room, status')
      .eq('id', derivedMeetingId)
      .maybeSingle();

    if (meetingError || !meeting) {
      return NextResponse.json({
        error: 'ADMISSION_REQUIRED',
        message: 'The meeting could not be found.',
      }, { status: 403 });
    }

    // An ended meeting stays ended: no new token is ever minted for it,
    // so an old WhatsApp link cannot re-enter a finished meeting.
    if (meeting.status === 'Completed') {
      return NextResponse.json({
        error: 'MEETING_ENDED',
        message: 'This meeting has ended.',
      }, { status: 403 });
    }

    // Delete-from-history: a meeting removed from history stays
    // removed — its old join link must not mint a new token either.
    // Best-effort read — the column only exists once
    // giinmeet_delete_history.sql has been run, so a missing column
    // means "not deleted", never a failure.
    try {
      const { data: delRow } = await admin
        .from('meetings')
        .select('deleted_at')
        .eq('id', derivedMeetingId)
        .maybeSingle();
      if ((delRow as any)?.deleted_at) {
        return NextResponse.json({
          error: 'MEETING_DELETED',
          message: 'This meeting was deleted from history.',
        }, { status: 410 });
      }
    } catch (e) { /* deleted_at column not set up yet: not deleted */ }

    // Phase 3 (Feature 3) — team meetings: only team members may
    // join. Best-effort read — the column only exists once
    // giinmeet_phase3_teams.sql has been run, so a missing column
    // means "not a team meeting", never a failure. The host is the
    // one exception: they own the meeting.
    let meetingTeamId: string | null = null;
    try {
      const { data: teamRow } = await admin
        .from('meetings')
        .select('team_id')
        .eq('id', derivedMeetingId)
        .maybeSingle();
      meetingTeamId = (teamRow as any)?.team_id || null;
    } catch (e) { /* team_id column not set up yet: not a team meeting */ }

    // Round 9 (9C): link expiry, enforced server-side. Best-effort
    // read — the columns only exist once giinmeet_link_expiry.sql has
    // been run, so a missing column means "no expiry set", never a
    // failure. Mode 'on-end' has no date (the Completed check above
    // covers it); a duration mode with a past date refuses the token.
    try {
      const { data: expRow } = await admin
        .from('meetings')
        .select('link_expires_at,link_expiry_mode')
        .eq('id', derivedMeetingId)
        .maybeSingle();
      const expMode = (expRow as any)?.link_expiry_mode as string | undefined;
      const expAt = (expRow as any)?.link_expires_at as string | undefined;
      if (expMode && expMode !== 'on-end' && expAt && new Date(expAt).getTime() < Date.now()) {
        return NextResponse.json({
          error: 'LINK_EXPIRED',
          message: 'This meeting link has expired.',
        }, { status: 403 });
      }
    } catch (e) { /* link expiry not set up yet: the link is live */ }

    // Fix Round 7 (#6): the persisted meeting lock. Best-effort
    // single-column read - the column only exists once
    // giinmeet_meeting_lock.sql has been run, so a missing column
    // (or any read error) is treated as unlocked, never as a failure.
    // Hosts and already-Admitted rows can still mint while locked; the
    // two ADMISSION_REQUIRED gates below become MEETING_LOCKED instead.
    let isMeetingLocked = false;
    try {
      const { data: lockRow } = await admin
        .from('meetings')
        .select('is_locked')
        .eq('id', derivedMeetingId)
        .maybeSingle();
      isMeetingLocked = !!(lockRow as any)?.is_locked;
    } catch (e) { /* lock column not set up yet: treat as unlocked */ }

    // The CURRENT host is admin_id (it moves on transfer); user_id
    // (creator) only counts when admin_id was never set. (Phase 6: the
    // old OR let a transferred-away host keep minting HOST tokens.)
    const isHostUser = (uid: string | null | undefined) =>
      !!uid && (meeting.admin_id ? uid === meeting.admin_id : uid === meeting.user_id);

    if (accessToken) {
      // Signed-in user: verify the JWT server-side with the service key.
      const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);
      if (userError || !user) {
        return NextResponse.json({
          error: 'UNAUTHORIZED',
          message: 'Your session is invalid or has expired. Please sign in again.',
        }, { status: 401 });
      }

      identity = user.id;
      if (meetingTeamId && !isHostUser(user.id)) {
        const { data: memberRow } = await admin
          .from('team_members')
          .select('id')
          .eq('team_id', meetingTeamId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (!memberRow) {
          return NextResponse.json({
            error: 'TEAM_MEMBERS_ONLY',
            message: 'This is a team meeting — only members of the team can join. Ask a team admin to add you.',
          }, { status: 403 });
        }
      }
      if (isHostUser(user.id)) {
        derivedRole = 'HOST';
        // Host display name: prefer the participant row name if present.
        const { data: hrow } = await admin
          .from('meeting_participants')
          .select('name')
          .eq('meeting_id', derivedMeetingId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (hrow?.name) displayName = hrow.name;
        else if (user.user_metadata?.name) displayName = user.user_metadata.name;
        else if (user.user_metadata?.full_name) displayName = user.user_metadata.full_name;
        else if (user.email) displayName = user.email;
      } else {
        // Non-host: must have an Admitted meeting_participants row.
        const { data: prow, error: prowError } = await admin
          .from('meeting_participants')
          .select('id, name, status, role')
          .eq('meeting_id', derivedMeetingId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (prowError || !prow || prow.status !== 'Admitted') {
          // Fix Round 7 (#6): a locked meeting answers plainly instead
          // of sending the guest back to a waiting room that can never
          // admit them. (A row that IS Admitted passes the check above,
          // so admitted guests are never locked out.)
          if (isMeetingLocked) {
            return NextResponse.json({
              error: 'MEETING_LOCKED',
              message: 'This meeting is locked by the host - new participants cannot join right now.',
            }, { status: 403 });
          }
          return NextResponse.json({
            error: 'ADMISSION_REQUIRED',
            message: 'You have not been admitted to this meeting yet. Please wait for the host.',
          }, { status: 403 });
        }
        if (prow.name) displayName = prow.name;
        if (prow.role === 'CoHost') derivedRole = 'COHOST';
        else if (prow.role === 'Moderator') derivedRole = 'MODERATOR';
      }
    } else {
      // Guest: the admitted participant row id is the credential. It is a
      // random UUID issued when the host admitted the guest (or when the
      // guest joined an open meeting), so only an admitted guest holds it.
      const { data: grow, error: growError } = await admin
        .from('meeting_participants')
        .select('id, user_id, name, status, role')
        .eq('id', participantRowId)
        .eq('meeting_id', derivedMeetingId)
        .maybeSingle();
      if (growError || !grow || grow.status !== 'Admitted') {
        // Fix Round 7 (#6): a locked meeting answers plainly instead
        // of sending the guest back to a waiting room that can never
        // admit them. (A guest whose row IS Admitted reaches this
        // point only after the check passes, so they are never locked
        // out.)
        if (isMeetingLocked) {
          return NextResponse.json({
            error: 'MEETING_LOCKED',
            message: 'This meeting is locked by the host - new participants cannot join right now.',
          }, { status: 403 });
        }
        return NextResponse.json({
          error: 'ADMISSION_REQUIRED',
          message: 'You have not been admitted to this meeting yet. Please wait for the host.',
        }, { status: 403 });
      }
      // Phase 3 (Feature 3): a guest has no GiinMeet account, so they
      // can never be a team member — a team meeting refuses guests
      // outright, even one the host admitted by mistake.
      if (meetingTeamId) {
        return NextResponse.json({
          error: 'TEAM_MEMBERS_ONLY',
          message: 'This is a team meeting. Sign in with a team member account to join.',
        }, { status: 403 });
      }
      // Guest identity is the participant row UUID itself. It must stay a
      // plain UUID: public.participants.user_id is a UUID column, and the
      // old `guest-<uuid>` identity broke the allocation upsert below with
      // Postgres 22P02 "invalid input syntax for type uuid", so no guest
      // could ever get a token (500 DB_ERROR). The row id is still unique
      // per guest and only an admitted guest holds it.
      identity = grow.id;
      if (grow.name) displayName = grow.name;
      if (isHostUser(grow.user_id)) derivedRole = 'HOST';
      else if (grow.role === 'CoHost') derivedRole = 'COHOST';
      else if (grow.role === 'Moderator') derivedRole = 'MODERATOR';
    }

    // The LiveKit room this token actually opens: the main room, or the
    // breakout room when the request carried a `-breakout-<n>` suffix.
    // Admission, meeting and tier above were all verified against the
    // main room; the breakout room inherits them.
    const targetLivekitSlug = breakoutRoomNumber !== null
      ? `${room.slug}-breakout-${breakoutRoomNumber}`
      : room.slug;

    // 4. Capacity check — counted against LIVE LiveKit participants, not
    // stale database rows. The `participants` table never flipped rows to
    // LEFT, so a few drop/rejoins could fill all 8 slots with ghosts and
    // 403 the next real person. LiveKit's room service is the truth about
    // who is actually connected right now; the database count is only a
    // fallback when LiveKit cannot be reached.
    // Round 3: participant limit by HOST TIER (Free 50 / Pro 100 /
    // Enterprise 250 — see src/utils/tiers.ts). The tier is the
    // authority: rooms created when the cap was 8 still carry
    // max_capacity 8, so the stored value must never shrink a tier's
    // limit. A missing profile (or a host with no account) resolves
    // to Free. The stored value is updated best-effort so the room
    // row stays honest for display.
    const hostUserId = meeting.admin_id || meeting.user_id;
    // Host tier: plan_tier when the column exists, is_premium as the
    // fallback. A bad column name returns an error object (not a
    // throw), so a failed first read retries is_premium-only — a
    // deploy before giinmeet_plan_tier.sql runs must never demote a
    // Pro host to Free.
    let hostIsPremium = false;
    let hostPlanTier: string | null = null;
    if (hostUserId) {
      try {
        const { data: hostProfile, error: profileError } = await admin
          .from('profiles')
          .select('is_premium, plan_tier')
          .eq('id', hostUserId)
          .maybeSingle();
        if (profileError) {
          const { data: retryProfile } = await admin
            .from('profiles')
            .select('is_premium')
            .eq('id', hostUserId)
            .maybeSingle();
          hostIsPremium = !!(retryProfile as any)?.is_premium;
        } else if (hostProfile) {
          hostIsPremium = !!(hostProfile as any)?.is_premium;
          hostPlanTier = (hostProfile as any)?.plan_tier ?? null;
        }
      } catch (e) { /* profile unreadable: Free tier */ }
    }
    const hostTier = tierForProfile({ is_premium: hostIsPremium, plan_tier: hostPlanTier });
    const maxCapacity = TIER_LIMITS[hostTier];
    try {
      if (room.max_capacity !== maxCapacity) {
        await admin.from('rooms').update({ max_capacity: maxCapacity }).eq('id', room.id);
      }
    } catch (e) { /* stored cap is cosmetic: the tier limit above rules */ }
    let liveCount: number | null = null;
    let liveIdentities: string[] | null = null;
    const lkUrl = process.env.LIVEKIT_URL;
    const lkKey = process.env.LIVEKIT_API_KEY;
    const lkSecret = process.env.LIVEKIT_API_SECRET;
    if (lkUrl && lkKey && lkSecret) {
      try {
        const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
        const liveParticipants = await roomService.listParticipants(targetLivekitSlug);
        liveIdentities = liveParticipants.map((p: any) => p.identity);
        liveCount = liveParticipants.length;
      } catch (e) {
        console.warn('[Token API] LiveKit participant list failed, falling back to database count:', (e as any)?.message);
      }
    }

    let joinedCount: number | null = null;
    if (liveCount !== null) {
      joinedCount = liveCount;
    } else {
      const { count, error: countError } = await supabase
        .from('participants')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', room.id)
        .eq('status', 'JOINED');
      if (countError) {
        console.error('[Token API] Failed to count room participants:', countError);
        return NextResponse.json({
          error: 'DB_ERROR',
          message: 'Unable to check room capacity.',
        }, { status: 500 });
      }
      joinedCount = count;
    }

    // A caller already in the room (live, or JOINED in the DB fallback)
    // never counts against themselves on a token refresh.
    let isAlreadyJoined: boolean;
    if (liveIdentities !== null) {
      isAlreadyJoined = liveIdentities.includes(identity);
    } else {
      const { data: existingParticipant } = await supabase
        .from('participants')
        .select('status')
        .eq('room_id', room.id)
        .eq('user_id', identity)
        .maybeSingle();
      isAlreadyJoined = existingParticipant?.status === 'JOINED';
    }

    if (!isAlreadyJoined && joinedCount !== null && joinedCount >= maxCapacity) {
      return NextResponse.json({
        error: 'MAX_CAPACITY_REACHED',
        message: `This meeting room is full for the host's ${TIER_LABELS[hostTier]} plan. Maximum capacity is ${maxCapacity} participants.`,
        maxCapacity,
        tier: hostTier,
      }, { status: 403 });
    }

    // 5. Upsert the participant allocation row (derived identity/role/name).
    // Breakout tokens skip this: there is no `rooms` row for a breakout
    // room, and the caller is already allocated in the main room by
    // their main-room token. Upserting here would also double-count
    // them in the main room if the capacity check ever fell back to the
    // database count. The breakout room's own headcount is LiveKit's
    // listParticipants above, not this table.
    if (breakoutRoomNumber === null) {
      // NOTE: the participants.role CHECK only allows HOST/SPEAKER/GUEST, so
      // a co-host or moderator is stored as GUEST in this allocation row
      // (the column is cosmetic — capacity and identity never read it).
      // Role-ness lives on the meeting_participants row and in the token
      // response's `role`. See giinmeet_cohost_moderator_roles.sql: after
      // Suku runs it, COHOST / MODERATOR are allowed in both role columns,
      // but this mapping stays as a safe default.
      const storedRole = derivedRole === 'HOST' ? 'HOST' : 'GUEST';
      const { error: participantError } = await supabase
        .from('participants')
        .upsert({
          room_id: room.id,
          user_id: identity,
          user_name: displayName,
          role: storedRole,
          status: 'JOINED',
        }, { onConflict: 'room_id,user_id' });

      if (participantError) {
        console.error('[Token API] Failed to allocate participant:', participantError);
        return NextResponse.json({
          error: 'DB_ERROR',
          message: 'Could not register participant session.',
        }, { status: 500 });
      }
    }

    // 6. Generate the LiveKit Access Token. The server credentials are
    // required. There is no fallback: without them no valid token can be
    // issued, so the request fails instead of minting a token that cannot
    // connect or pointing the client at a wrong server.
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      console.error('[Token API] LiveKit is not configured: LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_URL must all be set.');
      return NextResponse.json({
        error: 'SERVER_MISCONFIGURED',
        message: 'The video service is not configured on this server. Please contact the administrator.',
      }, { status: 500 });
    }

    // 6h token: a 2-hour meeting minted a token that expired exactly as
    // the meeting ended, and the client refreshed in a 60s window that a
    // backgrounded tab could miss. 6h covers long meetings with margin;
    // the client still refreshes early (at 15 min remaining) via
    // room.updateToken(), so expiry is a backstop, not the plan.
    // LiveKit AccessToken ttl accepts any number of seconds.
    const expireSeconds = 21600;
    const expiresAt = new Date(Date.now() + expireSeconds * 1000).toISOString();

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: expireSeconds,
    });

    at.addGrant({
      room: targetLivekitSlug,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    // One info line per mint (no secrets): lets us confirm in Vercel logs
    // that a real mint happened and which room/role it was for.
    console.log('[Token API] Minted token', { room: targetLivekitSlug, breakoutRoom: breakoutRoomNumber, role: derivedRole, identityKind: accessToken ? 'user' : 'guest' });

    return NextResponse.json({
      token,
      expiresAt,
      engine: room.current_engine || 'LIVEKIT',
      roomSlug: targetLivekitSlug,
      livekitUrl,
      role: derivedRole,
      maxCapacity,
      tier: hostTier,
    });
  } catch (err: any) {
    console.error('[Token API] Internal Exception:', err);
    return NextResponse.json({
      error: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred.',
    }, { status: 500 });
  }
}
