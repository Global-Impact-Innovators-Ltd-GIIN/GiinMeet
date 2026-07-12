import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { supabase } from '../../../../src/supabaseClient';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { roomId, roomSlug, userId, userName, role } = body;

    if ((!roomId && !roomSlug) || !userId || !userName) {
      return NextResponse.json({
        error: 'BAD_REQUEST',
        message: 'Missing required parameters: (roomId or roomSlug), userId, userName'
      }, { status: 400 });
    }

    // 1. Fetch the active target room
    let roomQuery = supabase.from('rooms').select('*').eq('is_active', true);
    if (roomId) {
      roomQuery = roomQuery.eq('id', roomId);
    } else {
      roomQuery = roomQuery.eq('slug', roomSlug);
    }

    const { data: room, error: roomError } = await roomQuery.maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({
        error: 'ROOM_NOT_FOUND',
        message: 'The requested room does not exist or has been deactivated.'
      }, { status: 404 });
    }

    // 2. Perform transactional capacity checking (joined participants count)
    const { count, error: countError } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .eq('status', 'JOINED');

    if (countError) {
      console.error('[Token API] Failed to count room participants:', countError);
      return NextResponse.json({
        error: 'DB_ERROR',
        message: 'Unable to check room capacity.'
      }, { status: 500 });
    }

    const maxCapacity = room.max_capacity || 8;
    
    // Check if the current user is already counted as JOINED to avoid double-blocking them
    const { data: existingParticipant } = await supabase
      .from('participants')
      .select('status')
      .eq('room_id', room.id)
      .eq('user_id', userId)
      .maybeSingle();

    const isAlreadyJoined = existingParticipant?.status === 'JOINED';

    if (!isAlreadyJoined && count !== null && count >= maxCapacity) {
      return NextResponse.json({
        error: 'MAX_CAPACITY_REACHED',
        message: `The meeting room is full. Maximum capacity is ${maxCapacity} participants.`
      }, { status: 403 });
    }

    // 3. Upsert the participant allocation row inside Supabase
    const { error: participantError } = await supabase
      .from('participants')
      .upsert({
        room_id: room.id,
        user_id: userId,
        user_name: userName,
        role: role || 'GUEST',
        status: 'JOINED'
      }, { onConflict: 'room_id,user_id' });

    if (participantError) {
      console.error('[Token API] Failed to allocate participant:', participantError);
      return NextResponse.json({
        error: 'DB_ERROR',
        message: 'Could not register participant session.'
      }, { status: 500 });
    }

    // 4. Generate the LiveKit Access Token
    const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
    const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
    
    // Default expiration: 2 hours (7200 seconds)
    const expireSeconds = 7200;
    const expiresAt = new Date(Date.now() + expireSeconds * 1000).toISOString();

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: userName,
      ttl: expireSeconds
    });

    at.addGrant({
      room: room.slug,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      expiresAt,
      engine: room.current_engine || 'LIVEKIT',
      roomSlug: room.slug
    });

  } catch (err: any) {
    console.error('[Token API] Internal Exception:', err);
    return NextResponse.json({
      error: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred.'
    }, { status: 500 });
  }
}
