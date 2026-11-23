// Phase C1 (26) — recent meetings, kept on this device only.
//
// Joining a meeting records it here (id, title, time, host), newest
// first, capped at 10, so the dashboard can offer one-tap rejoin. This
// is local history, not a server log: it never leaves the browser, it
// never includes a passcode, and rejoining still goes through the normal
// join flow (passcode gate + waiting room where they apply).
export interface RecentMeeting {
  id: string;
  title: string;
  time: string;
  host: string;
}

const KEY = 'giin_recent_meetings';
const MAX_RECENT = 10;

export function recordRecentMeeting(meeting: RecentMeeting): void {
  try {
    const raw = localStorage.getItem(KEY);
    const list: RecentMeeting[] = raw ? JSON.parse(raw) : [];
    const next = [
      { ...meeting, time: meeting.time || new Date().toISOString() },
      ...list.filter((m) => m.id !== meeting.id),
    ].slice(0, MAX_RECENT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    // Recent history is a convenience, never a failure.
  }
}

export function readRecentMeetings(): RecentMeeting[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentMeeting[];
    return Array.isArray(list) ? list.filter((m) => m && m.id) : [];
  } catch (e) {
    return [];
  }
}
