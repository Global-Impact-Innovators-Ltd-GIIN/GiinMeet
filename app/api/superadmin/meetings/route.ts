import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { requireSuperadmin, writeAudit } from '../lib';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// POST /api/superadmin/meetings
//   { accessToken }                              -> list ALL meetings + host names + participant counts
//   { accessToken, action: 'end', meetingId }    -> end a live meeting for everyone (same steps as /api/meetings/end)
//   { accessToken, action: 'delete', meetingId } -> soft-delete (Completed or expired Scheduled only, same scope as /api/meetings/delete)
export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'superadmin-meetings', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;
    const { admin, user: actor } = checked.caller;
    const action = body?.action as string | undefined;

    // ---- List -------------------------------------------------------
    if (!action || action === 'list') {
      const { data, error } = await admin
        .from('meetings')
        .select('id,user_id,admin_id,title,time,duration,status,host,created_at,deleted_at')
        .order('time', { ascending: false })
        .limit(500);
      if (error) {
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not list meetings: ${error.message}` }, { status: 500 });
      }
      const meetings = (data || []) as any[];
      // Host names from the public profiles directory.
      const hostIds = [...new Set(meetings.map((m) => m.admin_id || m.user_id).filter(Boolean))];
      const nameById = new Map<string, string>();
      if (hostIds.length > 0) {
        const { data: profiles } = await admin.from('profiles').select('id,name,email').in('id', hostIds);
        for (const p of (profiles || []) as any[]) {
          nameById.set(p.id, p.name || p.email || p.id);
        }
      }
      // Participant counts per meeting (one query, grouped client-side).
      const countByMeeting = new Map<string, number>();
      const meetingIds = meetings.map((m) => m.id);
      if (meetingIds.length > 0) {
        const { data: parts } = await admin
          .from('meeting_participants')
          .select('meeting_id')
          .in('meeting_id', meetingIds);
        for (const row of (parts || []) as any[]) {
          countByMeeting.set(row.meeting_id, (countByMeeting.get(row.meeting_id) || 0) + 1);
        }
      }
      return NextResponse.json({
        ok: true,
        meetings: meetings.map((m) => ({
          ...m,
          host_name: nameById.get(m.admin_id || m.user_id) || m.host || null,
          participant_count: countByMeeting.get(m.id) || 0,
        })),
      });
    }

    const meetingId = body?.meetingId as string | undefined;
    if (!meetingId || typeof meetingId !== 'string') {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'meetingId is required.' }, { status: 400 });
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id,title,status,time,duration,host,created_at,deleted_at,admin_id,user_id,require_waiting_room,is_locked')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'This meeting could not be found.' }, { status: 404 });
    }

    // ---- Diagnose a meeting ---------------------------------------------
    // Room row, waiting-room/admitted participants, and whether the
    // LiveKit room is actually live on the video server right now.
    if (action === 'diagnose') {
      const slug = `meet-${meetingId}`;
      const { data: room } = await admin
        .from('rooms')
        .select('id,slug,room_name,is_active,max_capacity,current_engine,created_at')
        .eq('slug', slug)
        .maybeSingle();
      const { data: participants } = await admin
        .from('meeting_participants')
        .select('id,name,user_id,status,role,updated_at')
        .eq('meeting_id', meetingId)
        .order('updated_at', { ascending: true });
      let livekitLive = false;
      let livekitParticipants: string[] = [];
      const lkUrl = process.env.LIVEKIT_URL;
      const lkKey = process.env.LIVEKIT_API_KEY;
      const lkSecret = process.env.LIVEKIT_API_SECRET;
      if (lkUrl && lkKey && lkSecret) {
        try {
          const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
          const parts = await roomService.listParticipants(slug);
          livekitLive = true;
          livekitParticipants = (parts || []).map((p: any) => p.identity || p.name || '');
        } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
          // Room not live on the video server (or LiveKit unreachable).
          livekitLive = false;
        }
      }
      return NextResponse.json({
        ok: true,
        meeting,
        room: room || null,
        participants: participants || [],
        livekit: { live: livekitLive, participants: livekitParticipants },
      });
    }

    // ---- End a live meeting -------------------------------------------
    if (action === 'end') {
      if ((meeting as any).status === 'Completed') {
        return NextResponse.json({ ok: true, alreadyEnded: true });
      }
      const { error: meetingError } = await admin
        .from('meetings')
        .update({ status: 'Completed' })
        .eq('id', meetingId);
      if (meetingError) {
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not end the meeting: ${meetingError.message}` }, { status: 500 });
      }
      const slug = `meet-${meetingId}`;
      const { data: rooms } = await admin.from('rooms').select('id').eq('slug', slug);
      const roomIds = (rooms || []).map((r: any) => r.id);
      if (roomIds.length > 0) {
        await admin.from('rooms').update({ is_active: false }).in('id', roomIds);
        await admin.from('participants').update({ status: 'LEFT' }).in('room_id', roomIds).eq('status', 'JOINED');
      }
      await admin.from('meeting_participants').update({ status: 'Declined' }).eq('meeting_id', meetingId).eq('status', 'Waiting');
      let livekitRoomDeleted = false;
      let livekitWarning: string | undefined;
      const lkUrl = process.env.LIVEKIT_URL;
      const lkKey = process.env.LIVEKIT_API_KEY;
      const lkSecret = process.env.LIVEKIT_API_SECRET;
      if (!lkUrl || !lkKey || !lkSecret) {
        livekitWarning = 'The video server room could not be torn down automatically (the video service is not configured on this server). The meeting is still ended — participants are removed by the app.';
      } else {
        try {
          const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
          await roomService.deleteRoom(slug);
          livekitRoomDeleted = true;
        } catch (e: any) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
          const msg = String(e?.message || e);
          if (/not found/i.test(msg)) livekitRoomDeleted = true;
          else livekitWarning = 'The video server room could not be torn down automatically. The meeting is still ended — participants are removed by the app within seconds.';
        }
      }
      let chatFilesDeleted = 0;
      try {
        let offset = 0;
        for (;;) {
          const { data: objects, error: listError } = await admin.storage
            .from('chat-files')
            .list(meetingId, { limit: 100, offset });
          if (listError || !objects || objects.length === 0) break;
          const paths = objects.map((o: any) => `${meetingId}/${o.name}`);
          const { error: removeError } = await admin.storage.from('chat-files').remove(paths);
          if (removeError) break;
          chatFilesDeleted += paths.length;
          if (objects.length < 100) break;
          offset += 100;
        }
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        console.error('[Superadmin Meetings] Could not delete meeting chat files:', (e as any)?.message);
      }
      await writeAudit(admin, actor, 'end-meeting', 'meeting', meetingId, {
        title: (meeting as any).title || null,
        livekitRoomDeleted,
        chatFilesDeleted,
      });
      return NextResponse.json({ ok: true, livekitRoomDeleted, chatFilesDeleted, ...(livekitWarning ? { livekitWarning } : {}) });
    }

    // ---- Delete from history (soft delete) ------------------------------
    if (action === 'delete') {
      const isDeletable = (m: { status?: string | null; time?: string | null }): boolean => {
        if (m.status === 'Completed') return true;
        if (m.status !== 'Scheduled') return false;
        if (!m.time) return false;
        return new Date(m.time).getTime() < Date.now();
      };
      if (!isDeletable(meeting as any)) {
        return NextResponse.json(
          { error: 'NOT_DELETABLE', message: 'Only completed meetings and expired scheduled meetings can be deleted. End a live meeting first, or cancel an upcoming one.' },
          { status: 403 }
        );
      }
      try {
        const { data: delRow } = await admin
          .from('meetings')
          .select('deleted_at')
          .eq('id', meetingId)
          .maybeSingle();
        if ((delRow as any)?.deleted_at) {
          return NextResponse.json({ ok: true, alreadyDeleted: true });
        }
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        /* deleted_at column not set up yet: not deleted */
      }
      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from('meetings')
        .update({ deleted_at: now, deleted_by: actor.id })
        .eq('id', meetingId);
      if (updateError) {
        const msg = String((updateError as any)?.message || updateError);
        if (/deleted_at/i.test(msg) && /column|does not exist/i.test(msg)) {
          return NextResponse.json(
            { error: 'DELETE_NOT_SET_UP', message: 'Deleting from history is not set up yet — run giinmeet_delete_history.sql in the Supabase SQL Editor once, then try again.' },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: 'DB_ERROR', message: `Could not delete the meeting: ${msg}` }, { status: 500 });
      }
      try {
        await admin.from('meeting_deletions').insert({
          meeting_id: meetingId,
          meeting_title: (meeting as any).title || null,
          meeting_time: (meeting as any).time || null,
          deleted_by: actor.id,
          deleted_at: now,
        });
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        console.error('[Superadmin Meetings] Audit row not written:', (e as any)?.message);
      }
      await writeAudit(admin, actor, 'delete-meeting', 'meeting', meetingId, {
        title: (meeting as any).title || null,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'BAD_REQUEST', message: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Superadmin Meetings] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
