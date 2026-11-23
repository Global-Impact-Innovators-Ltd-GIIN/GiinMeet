// Phase C1 (33), smart scheduling assistant: find a time.
//
// POST { accessToken, title?, durationMinutes?, dateFrom?, dateTo?,
//        attendeeEmails?, hostAvailability?: [{ day, start, end }] }
//   Signed-in host only. Proposes up to 5 times that work:
//     * inside the host's stated availability (default: weekdays 09:00
//       to 17:00) and inside the requested window (default: next 7 days),
//     * free on every connected calendar (feature 23: Google/Outlook
//       free/busy), when one is connected,
//     * with no clash against the host's own GiinMeet meetings.
//   Without a connected calendar it still works from the stated hours
//   and the GiinMeet meetings, and says so plainly. Attendee emails are
//   accepted for the poll step (feature 33 polls); this route does not
//   contact attendees and does not assume their calendars.
//   Every value is validated server-side. Rate limited.
import { NextRequest } from 'next/server';
import {
  checkRateLimit,
  cleanText,
  errorWithSecurity,
  getAdminClient,
  getCaller,
  internalError,
  isEmail,
  jsonWithSecurity,
  readJsonBody,
} from '../../_lib/security';
import {
  getCalendarConnection,
  getUsableAccessToken,
  listBusyWindows,
  type CalendarProvider,
} from '../../_lib/calendar';

interface AvailabilityBlock {
  day: number;
  start: string;
  end: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function parseDurationLabel(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value || '');
  const num = parseInt(s, 10);
  if (!Number.isFinite(num)) return 60;
  if (/h/i.test(s) && !/m/i.test(s)) return num * 60;
  return num;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'scheduling-suggest', 20, 60 * 1000);
    if (limited) return limited;
    const body = await readJsonBody(req);
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
      return errorWithSecurity('UNAUTHORIZED', 'Sign in to find a time.', 401);
    }
    const durationMinutes =
      typeof body.durationMinutes === 'number'
        ? Math.floor(body.durationMinutes)
        : parseInt(String(body.durationMinutes || '60'), 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
      return errorWithSecurity('BAD_REQUEST', 'Pick a duration between 15 minutes and 8 hours.', 400);
    }
    const now = new Date();
    const from = typeof body.dateFrom === 'string' && !Number.isNaN(new Date(body.dateFrom).getTime())
      ? new Date(body.dateFrom)
      : now;
    const to = typeof body.dateTo === 'string' && !Number.isNaN(new Date(body.dateTo).getTime())
      ? new Date(body.dateTo)
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000 || to <= from) {
      return errorWithSecurity('BAD_REQUEST', 'Pick a window of up to 31 days.', 400);
    }
    const title = cleanText(body.title, 200);
    const attendeeEmails = Array.isArray(body.attendeeEmails)
      ? (body.attendeeEmails as unknown[]).filter((e) => isEmail(e)).map((e) => String(e).trim().toLowerCase()).slice(0, 20)
      : [];
    // Stated availability: [{ day: 0-6, start: 'HH:MM', end: 'HH:MM' }].
    // Default: weekdays 09:00 to 17:00.
    let availability: AvailabilityBlock[] = [];
    if (Array.isArray(body.hostAvailability)) {
      for (const block of body.hostAvailability.slice(0, 14)) {
        const day = (block as any)?.day;
        const start = parseTimeOfDay((block as any)?.start);
        const end = parseTimeOfDay((block as any)?.end);
        if (typeof day === 'number' && day >= 0 && day <= 6 && start !== null && end !== null && end > start) {
          availability.push({ day, start: (block as any).start, end: (block as any).end });
        }
      }
    }
    if (availability.length === 0) {
      availability = [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' }));
    }
    // Busy windows from connected calendars.
    const busy: { start: number; end: number }[] = [];
    const usedCalendars: CalendarProvider[] = [];
    for (const provider of ['google', 'outlook'] as CalendarProvider[]) {
      const connection = await getCalendarConnection(admin, user.id, provider).catch(() => null);
      if (!connection) continue;
      const token = await getUsableAccessToken(admin, connection);
      if (!token) continue;
      const windows = await listBusyWindows(provider, token, from.toISOString(), to.toISOString());
      for (const w of windows) {
        const s = new Date(w.start).getTime();
        const e = new Date(w.end).getTime();
        if (Number.isFinite(s) && Number.isFinite(e) && e > s) busy.push({ start: s, end: e });
      }
      usedCalendars.push(provider);
    }
    // The host's own GiinMeet meetings in the window.
    const { data: ownMeetings } = await admin
      .from('meetings')
      .select('time, duration')
      .or(`user_id.eq.${user.id},admin_id.eq.${user.id}`)
      .in('status', ['Scheduled', 'In Progress'])
      .gte('time', from.toISOString())
      .lte('time', to.toISOString());
    for (const m of ownMeetings || []) {
      const s = new Date((m as any).time).getTime();
      if (!Number.isFinite(s)) continue;
      const mins = Math.max(1, parseDurationLabel((m as any).duration));
      busy.push({ start: s, end: s + mins * 60 * 1000 });
    }
    // Candidate slots: every 30 minutes inside stated availability.
    const slots: { start: string; end: string; reasons: string[] }[] = [];
    const dayCursor = new Date(from);
    dayCursor.setHours(0, 0, 0, 0);
    const endDay = new Date(to);
    endDay.setHours(0, 0, 0, 0);
    const windowStartMs = Math.max(from.getTime(), now.getTime() + 15 * 60 * 1000);
    while (dayCursor <= endDay && slots.length < 5) {
      const dow = dayCursor.getDay();
      const blocks = availability.filter((b) => b.day === dow);
      for (const block of blocks) {
        const startMin = parseTimeOfDay(block.start) || 0;
        const endMin = parseTimeOfDay(block.end) || 0;
        for (let min = startMin; min + durationMinutes <= endMin; min += 30) {
          const slotStart = new Date(dayCursor);
          slotStart.setHours(Math.floor(min / 60), min % 60, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
          if (slotStart.getTime() < windowStartMs) continue;
          if (slotEnd.getTime() > to.getTime()) continue;
          const clash = busy.some((b) =>
            overlaps(slotStart.getTime(), slotEnd.getTime(), b.start, b.end),
          );
          if (clash) continue;
          const reasons = [`Within your stated hours (${DAY_NAMES[dow]} ${block.start} to ${block.end})`];
          if (usedCalendars.length > 0) {
            reasons.push(
              `Free on ${usedCalendars.map((p) => (p === 'google' ? 'Google Calendar' : 'Outlook')).join(' and ')}`,
            );
          } else {
            reasons.push('No calendar connected, checked against your GiinMeet meetings only');
          }
          reasons.push('No clash with your meetings');
          slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString(), reasons });
          if (slots.length >= 5) break;
        }
        if (slots.length >= 5) break;
      }
      dayCursor.setDate(dayCursor.getDate() + 1);
    }
    return jsonWithSecurity({
      ok: true,
      title: title || undefined,
      durationMinutes,
      attendeeEmails,
      usedCalendars,
      slots,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return errorWithSecurity('PAYLOAD_TOO_LARGE', 'That request is too large.', 413);
    }
    return internalError('Scheduling Suggest API', err);
  }
}
