import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Resolve a personal-room slug to the current session meeting (Phase 1).
// A personal room is a permanent link (giinmeet.../#/room/<slug>) that
// belongs to one host. Opening it must never make the opener the host, so
// the session meeting is found or created HERE, server-side, for the ROOM'S
// host — never by the guest's browser:
//   - An open session already exists (Scheduled / In Progress) -> join it.
//   - Otherwise a fresh session meeting is created for the host (title =
//     the room's title, passcode + waiting-room settings from the room)
//     and its LiveKit room row is created alongside it.
// The caller then opens #/join?id=<meetingId> and the normal join flow
// takes over: the signed-in host goes straight in (host bypass), a guest
// goes through the passcode gate + waiting room as usual.
// Needs giinmeet_phase1.sql (personal_rooms table + the
// meetings.personal_room_slug column); without it the route refuses
// honestly instead of creating a broken meeting.
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getHostName(admin: any, userId: string): Promise<string> {
  try {
    const { data: prof } = await admin.from('profiles').select('name').eq('id', userId).maybeSingle();
    if ((prof as any)?.name) return (prof as any).name as string;
  } catch (e) { /* fall through to the default */ }
  return 'Host';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    if (!slug) {
      return NextResponse.json({ error: 'BAD_REQUEST', message: 'A room link is required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ error: 'SERVER_MISCONFIGURED', message: 'The video service is not configured on this server.' }, { status: 500 });
    }

    const { data: room, error: roomError } = await admin
      .from('personal_rooms')
      .select('id,user_id,slug,title,passcode,require_waiting_room')
      .eq('slug', slug)
      .maybeSingle();
    if (roomError) {
      // The table does not exist until giinmeet_phase1.sql runs.
      return NextResponse.json({ error: 'PERSONAL_ROOMS_NOT_CONFIGURED', message: 'Personal rooms are not set up yet — run giinmeet_phase1.sql in the Supabase SQL Editor first.' }, { status: 500 });
    }
    if (!room) {
      return NextResponse.json({ error: 'NOT_FOUND', message: 'This personal room does not exist. Check the link and try again.' }, { status: 404 });
    }

    // An open session already exists for this room — reuse it.
    const { data: sessions } = await admin
      .from('meetings')
      .select('id,title,status')
      .eq('personal_room_slug', slug)
      .in('status', ['Scheduled', 'In Progress'])
      .order('created_at', { ascending: false })
      .limit(1);
    const openSession = (sessions || [])[0] as any;
    if (openSession?.id) {
      return NextResponse.json({
        meetingId: openSession.id,
        title: openSession.title || room.title,
        hasPasscode: !!room.passcode,
        hostName: await getHostName(admin, room.user_id),
      });
    }

    // No open session: create one for the room's host.
    const hostName = await getHostName(admin, room.user_id);
    const meetingId = crypto.randomUUID();
    const { error: insertError } = await admin.from('meetings').insert([{
      id: meetingId,
      user_id: room.user_id,
      admin_id: room.user_id,
      title: room.title,
      time: new Date().toISOString(),
      duration: '60',
      status: 'Scheduled',
      host: hostName,
      passcode: room.passcode ?? null,
      require_waiting_room: room.require_waiting_room ?? true,
      personal_room_slug: slug,
    }]);
    if (insertError) {
      const msg = String((insertError as any)?.message || insertError);
      if (/personal_room_slug|column/i.test(msg)) {
        return NextResponse.json({ error: 'PERSONAL_ROOMS_NOT_CONFIGURED', message: 'Personal rooms are not set up yet — run giinmeet_phase1.sql in the Supabase SQL Editor first.' }, { status: 500 });
      }
      console.error('[Resolve Room API] Could not create the session meeting:', msg);
      return NextResponse.json({ error: 'DB_ERROR', message: 'Could not open this personal room. Please try again.' }, { status: 500 });
    }
    // The LiveKit room for the session (same shape as ensureMeetingRoom).
    // Best-effort: the join flow retries room creation if this fails.
    try {
      await admin.from('rooms').insert([{
        room_name: room.title,
        slug: `meet-${meetingId}`,
        organization_id: room.user_id,
        host_id: room.user_id,
        is_active: true,
        max_capacity: 50,
        current_engine: 'LIVEKIT',
      }]);
    } catch (e) { /* retried on join */ }

    return NextResponse.json({ meetingId, title: room.title, hasPasscode: !!room.passcode, hostName });
  } catch (err: any) {
    console.error('[Resolve Room API] Internal Exception:', err);
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR', message: err.message || 'An unexpected error occurred.' }, { status: 500 });
  }
}
