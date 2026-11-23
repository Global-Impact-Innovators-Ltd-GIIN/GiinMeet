import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { requireSuperadmin } from '../lib';
import { checkRateLimit, readJsonBody } from '../../_lib/security';

// POST /api/superadmin/livekit { accessToken }
// Live rooms right now, straight from the LiveKit server: room name
// plus the live participant identities in each room. No stored or
// guessed numbers — an empty list means no room is live.
export async function POST(req: NextRequest) {
  try {
  const limited = checkRateLimit(req, 'superadmin-livekit', 30, 60 * 1000);
  if (limited) return limited;
    const body = await readJsonBody(req);
    const checked = await requireSuperadmin(body?.accessToken);
    if ('response' in checked) return checked.response;

    const lkUrl = process.env.LIVEKIT_URL;
    const lkKey = process.env.LIVEKIT_API_KEY;
    const lkSecret = process.env.LIVEKIT_API_SECRET;
    if (!lkUrl || !lkKey || !lkSecret) {
      return NextResponse.json({
        ok: false,
        configured: false,
        rooms: [],
        message: 'LiveKit is not configured on this server (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing).',
      });
    }
    const roomService = new RoomServiceClient(lkUrl, lkKey, lkSecret);
    const rooms = await roomService.listRooms();
    const out: { name: string; participants: { identity: string; name: string }[] }[] = [];
    for (const r of rooms || []) {
      let participants: { identity: string; name: string }[] = [];
      try {
        const parts = await roomService.listParticipants(r.name);
        participants = (parts || []).map((p: any) => ({
          identity: p.identity || '',
          name: p.name || p.identity || '',
        }));
      } catch (e) {
    if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
        participants = [];
      }
      out.push({ name: r.name, participants });
    }
    return NextResponse.json({ ok: true, configured: true, rooms: out });
  } catch (err: any) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' }, { status: 413 });
    }
    console.error('[Superadmin LiveKit] Internal Exception:', err);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
