// Phase C1, shared meeting access check for the library, follow-up and
// insights routes.
//
// A caller may read a meeting's record when they are its host (admin_id
// or user_id) or an admitted participant (meeting_participants row with
// status 'Admitted'). Everyone else gets nothing, and the check runs
// server-side on every call. Guests prove themselves with their
// participant row id where a route accepts it; most library routes take
// a signed-in access token.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function isHostOrAdmitted(
  admin: SupabaseClient,
  meetingId: string,
  userId: string,
): Promise<boolean> {
  const { data: meeting } = await admin
    .from('meetings')
    .select('id, admin_id, user_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) return false;
  if ((meeting as any).admin_id === userId) return true;
  if ((meeting as any).user_id === userId) return true;
  const { data: row } = await admin
    .from('meeting_participants')
    .select('id')
    .eq('meeting_id', meetingId)
    .eq('user_id', userId)
    .eq('status', 'Admitted')
    .maybeSingle();
  return !!row;
}

export async function isHost(
  admin: SupabaseClient,
  meetingId: string,
  userId: string,
): Promise<boolean> {
  const { data: meeting } = await admin
    .from('meetings')
    .select('id, admin_id, user_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (!meeting) return false;
  return (meeting as any).admin_id === userId || (meeting as any).user_id === userId;
}
