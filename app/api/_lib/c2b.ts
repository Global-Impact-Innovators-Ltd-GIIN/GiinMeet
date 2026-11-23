// Phase C2b, shared caller resolution for the meeting-feature routes.
//
// Every C2b route accepts the same two credentials the rest of the app
// already uses: a signed-in user's session token, or an admitted
// guest's participant row id. This helper resolves either one to a
// single caller shape, so no route trusts a client-supplied name, key
// or role for a permission decision.
//
//   key ........ the room key used everywhere else (auth user id, or
//                the participant row id for guests). This is what
//                whispers, votes, grants and interpreter rows store.
//   name ....... the caller's verified display name, from their own
//                participant row or auth metadata, never the body.
//   isHost ..... true when the caller is the meeting host.
//   isAdmitted . true when the caller is host or an admitted
//                participant of this meeting.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCaller, isUuid } from './security';

export interface C2bCaller {
  key: string;
  name: string;
  userId: string | null;
  participantRowId: string | null;
  isHost: boolean;
  isAdmitted: boolean;
}

function meetingHostId(meeting: { admin_id?: string | null; user_id?: string | null } | null): string | null {
  if (!meeting) return null;
  return (meeting as any).admin_id || (meeting as any).user_id || null;
}

export async function resolveC2bCaller(
  admin: SupabaseClient,
  meetingId: string,
  body: Record<string, unknown>,
): Promise<C2bCaller | null> {
  if (!isUuid(meetingId)) return null;
  const { data: meeting } = await admin
    .from('meetings')
    .select('id, admin_id, user_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) return null;
  const hostId = meetingHostId(meeting as any);

  const accessToken = body.accessToken as string | undefined;
  const participantRowId = body.participantRowId as string | undefined;

  if (accessToken) {
    const user = await getCaller(admin, accessToken);
    if (!user) return null;
    const isHost = !!hostId && hostId === user.id;
    let name =
      (user.user_metadata?.name as string) ||
      (user.user_metadata?.full_name as string) ||
      user.email ||
      'Participant';
    let rowId: string | null = null;
    let admitted = isHost;
    const { data: row } = await admin
      .from('meeting_participants')
      .select('id, name, status')
      .eq('meeting_id', meetingId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (row) {
      rowId = (row as any).id;
      if ((row as any).name) name = (row as any).name;
      if ((row as any).status === 'Admitted') admitted = true;
    }
    if (!admitted) return null;
    return { key: user.id, name, userId: user.id, participantRowId: rowId, isHost, isAdmitted: true };
  }

  if (participantRowId && isUuid(participantRowId)) {
    const { data: row } = await admin
      .from('meeting_participants')
      .select('id, user_id, name, status')
      .eq('id', participantRowId)
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (!row || (row as any).status !== 'Admitted') return null;
    const isHost = !!hostId && !!(row as any).user_id && hostId === (row as any).user_id;
    return {
      key: (row as any).id,
      name: (row as any).name || 'Guest',
      userId: (row as any).user_id || null,
      participantRowId: (row as any).id,
      isHost,
      isAdmitted: true,
    };
  }
  return null;
}

/** True when the key belongs to an admitted participant of the meeting. */
export async function isAdmittedKey(
  admin: SupabaseClient,
  meetingId: string,
  key: string,
): Promise<boolean> {
  if (!key) return false;
  const { data: byRow } = await admin
    .from('meeting_participants')
    .select('id')
    .eq('meeting_id', meetingId)
    .eq('id', key)
    .eq('status', 'Admitted')
    .maybeSingle();
  if (byRow) return true;
  const { data: byUser } = await admin
    .from('meeting_participants')
    .select('id')
    .eq('meeting_id', meetingId)
    .eq('user_id', key)
    .eq('status', 'Admitted')
    .maybeSingle();
  return !!byUser;
}

/** Verified display name for a room key, for messages addressed to someone. */
export async function nameForKey(
  admin: SupabaseClient,
  meetingId: string,
  key: string,
): Promise<string | null> {
  const { data: byRow } = await admin
    .from('meeting_participants')
    .select('name')
    .eq('meeting_id', meetingId)
    .eq('id', key)
    .maybeSingle();
  if ((byRow as any)?.name) return (byRow as any).name;
  const { data: byUser } = await admin
    .from('meeting_participants')
    .select('name')
    .eq('meeting_id', meetingId)
    .eq('user_id', key)
    .maybeSingle();
  return (byUser as any)?.name || null;
}
