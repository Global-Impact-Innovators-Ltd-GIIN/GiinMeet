// Phase C1 (23) — calendar sync, two-way.
//
// POST { accessToken, meetingId, action: 'push' | 'delete' }
//   Host-only. Pushes the meeting to every connected calendar (create or
//   update, matched by the provider event id stored on the meeting), or
//   deletes the provider events when the meeting is cancelled.
// POST { accessToken, action: 'pull-apply', updates: [{ meetingId, newTime }] }
//   Host-only. Applies time changes that were made in Google/Outlook back
//   to GiinMeet (Scheduled meetings the caller hosts, nothing else).
// GET ?accessToken=...&from=...&to=...
//   Signed-in user. Lists upcoming provider events with their matched
//   GiinMeet meeting id, so the dashboard can show what changed out there.
//
// All calls are rate limited; every meeting id is validated as a UUID
// and every meeting is re-checked as the caller's own before it is
// touched. Provider failures are reported per provider in plain words,
// never as a crash, and a failure on one calendar never blocks the other.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isCurrentHost,
  isUuid,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import {
  createProviderEvent,
  deleteProviderEvent,
  getCalendarConnection,
  getUsableAccessToken,
  listCalendarConnections,
  listProviderEvents,
  updateProviderEvent,
  type CalendarProvider,
} from '../../_lib/calendar';

const PROVIDERS: CalendarProvider[] = ['google', 'outlook'];

function meetingEndIso(meeting: { time: string; duration?: string | null }): string {
  const start = new Date(meeting.time).getTime();
  const mins = Math.max(1, Math.min(1440, parseInt(String(meeting.duration || '60'), 10) || 60));
  return new Date(start + mins * 60 * 1000).toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'calendar-sync', 30, 60 * 1000);
    if (limited) return limited;
    const accessToken = req.nextUrl.searchParams.get('accessToken') || undefined;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, accessToken);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to sync your calendar.', 401);
    }
    const from = req.nextUrl.searchParams.get('from') || new Date().toISOString();
    const to =
      req.nextUrl.searchParams.get('to') ||
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const events: unknown[] = [];
    const providers: { provider: string; ok: boolean; reason?: string }[] = [];
    for (const provider of PROVIDERS) {
      const connection = await getCalendarConnection(admin, user.id, provider).catch(
        () => null,
      );
      if (!connection) continue;
      const token = await getUsableAccessToken(admin, connection);
      if (!token) {
        providers.push({ provider, ok: false, reason: 'RECONNECT' });
        continue;
      }
      const listed = await listProviderEvents(provider, token, from, to);
      events.push(...listed);
      providers.push({ provider, ok: true });
    }
    return jsonWithSecurity({ ok: true, events, providers });
  } catch (err) {
    return internalError('Calendar Sync API', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'calendar-sync', 30, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
    const action = body.action as string | undefined;
    const admin = getAdminClient();
    if (!admin) {
      return errorWithSecurity(
        'SERVER_MISCONFIGURED',
        'The video service is not configured on this server.',
        500,
      );
    }
    const user = await getCaller(admin, body.accessToken as string | undefined);
    if (!user) {
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to sync your calendar.', 401);
    }

    // ---- Apply provider-side time changes back to GiinMeet. ----
    if (action === 'pull-apply') {
      const updates = Array.isArray(body.updates) ? body.updates : [];
      if (updates.length === 0 || updates.length > 50) {
        return errorWithSecurity('BAD_REQUEST', 'No changes to apply.', 400);
      }
      const applied: string[] = [];
      const skipped: string[] = [];
      for (const update of updates) {
        const meetingId = (update as any)?.meetingId;
        const newTime = (update as any)?.newTime;
        if (!isUuid(meetingId) || typeof newTime !== 'string') {
          skipped.push(String(meetingId || 'unknown'));
          continue;
        }
        const parsed = new Date(newTime);
        if (Number.isNaN(parsed.getTime())) {
          skipped.push(meetingId);
          continue;
        }
        const { data: meeting } = await admin
          .from('meetings')
          .select('id, admin_id, user_id, status')
          .eq('id', meetingId)
          .maybeSingle();
        if (!meeting || !isCurrentHost(meeting, user.id) || meeting.status !== 'Scheduled') {
          skipped.push(meetingId);
          continue;
        }
        const { error } = await admin
          .from('meetings')
          .update({ time: parsed.toISOString() })
          .eq('id', meetingId);
        if (error) skipped.push(meetingId);
        else applied.push(meetingId);
      }
      return jsonWithSecurity({ ok: true, applied, skipped });
    }

    // ---- Push one meeting to the connected calendars. ----
    const meetingId = body.meetingId as string | undefined;
    if (!isUuid(meetingId)) {
      return errorWithSecurity('BAD_REQUEST', 'A valid meeting is required.', 400);
    }
    const { data: meeting } = await admin
      .from('meetings')
      .select('id, admin_id, user_id, title, time, duration, status, calendar_sync')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meeting || !isCurrentHost(meeting, user.id)) {
      return errorWithSecurity(
        'FORBIDDEN',
        'Only the meeting host can sync it to a calendar.',
        403,
      );
    }
    const origin = req.nextUrl.origin;
    const joinUrl = `${origin}/#/join?id=${meetingId}`;
    const syncMap: Record<string, string> = (meeting.calendar_sync || {}) as Record<string, string>;
    const results: { provider: string; ok: boolean; reason?: string }[] = [];
    const connections = await listCalendarConnections(admin, user.id).catch(() => []);
    for (const connection of connections) {
      const provider = connection.provider as CalendarProvider;
      const token = await getUsableAccessToken(admin, connection);
      if (!token) {
        results.push({
          provider,
          ok: false,
          reason: 'RECONNECT',
        });
        continue;
      }
      try {
        if (action === 'delete') {
          const eventId = syncMap[provider];
          if (eventId) await deleteProviderEvent(provider, token, eventId);
          delete syncMap[provider];
          results.push({ provider, ok: true });
          continue;
        }
        const input = {
          title: cleanText(meeting.title, 200) || 'GiinMeet meeting',
          startIso: new Date(meeting.time).toISOString(),
          endIso: meetingEndIso(meeting),
          description: 'A GiinMeet video meeting.',
          meetingId,
          joinUrl,
        };
        const existingId = syncMap[provider];
        if (existingId) {
          const updated = await updateProviderEvent(provider, token, existingId, input);
          if (!updated) {
            const created = await createProviderEvent(provider, token, input);
            if (created) syncMap[provider] = created;
            else results.push({ provider, ok: false, reason: 'PROVIDER_ERROR' });
          } else {
            results.push({ provider, ok: true });
          }
        } else {
          const created = await createProviderEvent(provider, token, input);
          if (created) {
            syncMap[provider] = created;
            results.push({ provider, ok: true });
          } else {
            results.push({ provider, ok: false, reason: 'PROVIDER_ERROR' });
          }
        }
      } catch {
        results.push({ provider, ok: false, reason: 'PROVIDER_ERROR' });
      }
    }
    await admin
      .from('meetings')
      .update({ calendar_sync: syncMap })
      .eq('id', meetingId);
    return jsonWithSecurity({ ok: true, results });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Calendar Sync API', err);
  }
}
