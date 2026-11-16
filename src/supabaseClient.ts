import { createClient } from '@supabase/supabase-js';
import { parseDurationMinutes } from './utils/tiers';

// Supabase configuration. No credentials are hardcoded here: the app fails
// loudly at startup when NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are
// missing, instead of silently pointing at a stale or deleted project.
// NOTE: Next.js only inlines env vars into the browser bundle when they are
// read with STATIC process.env.NEXT_PUBLIC_* access. A dynamic lookup such as
// process.env[key] is NOT inlined, so the browser would see undefined and the
// app would fail to start. VITE_* is kept as a fallback for local tooling.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[GiinMeet] Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) in .env. ' +
    'The app will not start with missing credentials.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isSupabaseConfigured =
  supabaseUrl !== undefined &&
  supabaseAnonKey !== undefined;

export interface GiinUser {
  id: string;
  email: string;
  name: string;
  domain: string;
  workspaceName: string;
  is_premium?: boolean;
  is_superadmin?: boolean;
  avatar_url?: string;
}

// Random 6-character meeting passcode, generated with crypto randomness and
// stored on the meeting row — never derived from the meeting ID, so it cannot
// be guessed by anyone who knows the meeting ID.
export const generateMeetingPasscode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

// The LiveKit room for a meeting is addressed by a stable slug derived from
// the meeting ID, so no extra column is needed on the meetings table.
export const getMeetingRoomSlug = (meetingId: string): string => `meet-${meetingId}`;

// Find the LiveKit room for a meeting, creating it when it does not exist yet.
// Returns the room row, or null when it cannot be ensured (for example a
// guest with no signed-in session, or the rooms INSERT policy has not been
// applied yet — see rooms_insert_policy_patch.sql). Never throws: callers
// surface the missing room through the token error UI instead.
// Build the shareable invite link for a meeting. The passcode is only
// included when the meeting actually has one - an open meeting (no
// passcode) gets a clean link with no passcode parameter, so guests are
// never asked for a code that does not exist.
export const buildJoinLink = (meetingId: string, passcode?: string | null): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = `${origin}/#/join?id=${meetingId}`;
  return passcode ? `${base}&passcode=${passcode}` : base;
};

// Personal rooms (Phase 1): one permanent room per user, addressed by a
// stable slug under the user's name — the link never changes, so it can be
// printed on a card, put in an email signature, or shared once in a group.
// The slug is URL-safe, lowercase, and unique across all users.
export const slugifyPersonalRoom = (source: string): string => {
  const slug = (source || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return slug || 'room';
};

export const buildPersonalRoomLink = (slug: string): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/#/room/${slug}`;
};

export interface PersonalRoom {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  passcode?: string | null;
  require_waiting_room?: boolean;
}

// Columns of `meetings` the browser is allowed to read. The `passcode`
// column is deliberately NOT in this list: it is hidden from anon reads
// by giinmeet_passcode_lockdown.sql, so every client-side meetings query
// must use this list instead of select('*') — a select('*') would fail
// once the column is revoked. The passcode is only ever read server-side
// (verify-passcode route, host-only passcode route).
// Round 9 (9C): meeting link expiry. Modes: 'on-end' (the link dies when
// the meeting ends — the default for instant meetings) or '1m' / '2m' /
// '3m' / '6m' / '12m' (the link lives that many months from the
// meeting's scheduled time). The columns only exist once
// giinmeet_link_expiry.sql has been run — the probe below keeps every
// read/write working until then.
export const LINK_EXPIRY_OPTIONS = [
  { mode: 'on-end', label: 'Expires when the meeting ends' },
  { mode: '1m', label: '1 month' },
  { mode: '2m', label: '2 months' },
  { mode: '3m', label: '3 months' },
  { mode: '6m', label: '6 months' },
  { mode: '12m', label: '12 months' },
];

export const computeLinkExpiry = (mode: string, fromTime: string): string | null => {
  if (!mode || mode === 'on-end') return null;
  const months = parseInt(mode, 10) || 1;
  const d = new Date(fromTime);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};

export const formatLinkExpiry = (mode?: string | null, expiresAt?: string | null): string => {
  if (!mode || mode === 'on-end') return 'Expires when the meeting ends';
  if (expiresAt) return 'Link expires ' + new Date(expiresAt).toLocaleDateString();
  return 'Link expires in ' + mode;
};

// Probe once per session whether the link-expiry columns exist. A missing
// column errors the select, which is the signal — never a failure.
let linkExpirySupportedCache: boolean | null = null;
export async function probeLinkExpirySupport(): Promise<boolean> {
  if (linkExpirySupportedCache !== null) return linkExpirySupportedCache;
  try {
    const { error } = await supabase.from('meetings').select('link_expires_at').limit(1);
    linkExpirySupportedCache = !error;
  } catch (e) {
    linkExpirySupportedCache = false;
  }
  return linkExpirySupportedCache;
}

// Phase 1 — same probe for the reminder columns (giinmeet_phase1.sql):
// reminder_enabled / reminder_minutes_before / reminder_sent_at.
let reminderSupportedCache: boolean | null = null;
export async function probeReminderSupport(): Promise<boolean> {
  if (reminderSupportedCache !== null) return reminderSupportedCache;
  try {
    const { error } = await supabase.from('meetings').select('reminder_sent_at').limit(1);
    reminderSupportedCache = !error;
  } catch (e) {
    reminderSupportedCache = false;
  }
  return reminderSupportedCache;
}

// Phase 1 — same probe for the recurring-series columns
// (series_id / recurrence_rule / recurrence_count).
let seriesSupportedCache: boolean | null = null;
export async function probeSeriesSupport(): Promise<boolean> {
  if (seriesSupportedCache !== null) return seriesSupportedCache;
  try {
    const { error } = await supabase.from('meetings').select('series_id').limit(1);
    seriesSupportedCache = !error;
  } catch (e) {
    seriesSupportedCache = false;
  }
  return seriesSupportedCache;
}

// Phase 3 (Feature 3) — team workspaces: same probe for the teams
// tables (giinmeet_phase3_teams.sql) and for the meetings.team_id
// column. A missing table/column is "not set up yet", never a crash —
// every team read returns an empty list and every team write throws
// an honest error until the SQL runs.
let teamsSupportedCache: boolean | null = null;
export async function probeTeamsSupport(): Promise<boolean> {
  if (teamsSupportedCache !== null) return teamsSupportedCache;
  try {
    const { error } = await supabase.from('teams').select('id').limit(1);
    teamsSupportedCache = !error;
  } catch (e) {
    teamsSupportedCache = false;
  }
  return teamsSupportedCache;
}

let teamMeetingSupportedCache: boolean | null = null;
export async function probeTeamMeetingSupport(): Promise<boolean> {
  if (teamMeetingSupportedCache !== null) return teamMeetingSupportedCache;
  try {
    const { error } = await supabase.from('meetings').select('team_id').limit(1);
    teamMeetingSupportedCache = !error;
  } catch (e) {
    teamMeetingSupportedCache = false;
  }
  return teamMeetingSupportedCache;
}

export const TEAMS_NOT_SET_UP_MESSAGE =
  'Team workspaces are not set up yet — run giinmeet_phase3_teams.sql in the Supabase SQL Editor first.';

// ---- System settings (Superadmin portal) ---------------------------
// Public read of the system_settings table (giinmeet_superadmin.sql).
// Every field falls back to the built-in default when the table or
// the key is missing — the app then behaves exactly as before, and
// the portal reports "not set up yet" instead of crashing.
export interface SystemSettings {
  guestsCanChat: boolean;
  tierLimits: Record<string, number> | null;
  tierMaxDurationMinutes: Record<string, number> | null;
  defaultAccent: string | null;
  defaultTheme: { ui_style: string; glass_opacity: string } | null;
  defaultFont: { heading: string; body: string } | null;
  banner: { enabled: boolean; message: string } | null;
  defaultMeetingDurationMinutes: number | null;
  defaultRequireWaitingRoom: boolean | null;
}

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  guestsCanChat: false,
  tierLimits: null,
  tierMaxDurationMinutes: null,
  defaultAccent: null,
  defaultTheme: null,
  defaultFont: null,
  banner: null,
  defaultMeetingDurationMinutes: null,
  defaultRequireWaitingRoom: null,
};

let systemSettingsCache: { at: number; value: SystemSettings } | null = null;

export async function getSystemSettings(): Promise<SystemSettings> {
  if (systemSettingsCache && Date.now() - systemSettingsCache.at < 60000) {
    return systemSettingsCache.value;
  }
  const value: SystemSettings = { ...DEFAULT_SYSTEM_SETTINGS };
  try {
    const { data, error } = await supabase.from('system_settings').select('key,value');
    if (!error && data) {
      for (const row of data as any[]) {
        const v = (row as any).value || {};
        if (row.key === 'guests_can_chat') value.guestsCanChat = v.enabled === true;
        else if (row.key === 'tier_limits') value.tierLimits = v;
        else if (row.key === 'tier_max_duration_minutes') value.tierMaxDurationMinutes = v;
        else if (row.key === 'default_accent') value.defaultAccent = typeof v.color === 'string' ? v.color : null;
        else if (row.key === 'default_theme') value.defaultTheme = v;
        else if (row.key === 'default_font') value.defaultFont = v;
        else if (row.key === 'announcement_banner') value.banner = v;
        else if (row.key === 'default_meeting_duration_minutes') value.defaultMeetingDurationMinutes = typeof v.minutes === 'number' ? v.minutes : null;
        else if (row.key === 'default_require_waiting_room') value.defaultRequireWaitingRoom = typeof v.enabled === 'boolean' ? v.enabled : null;
      }
    }
  } catch (e) {
    /* table missing (SQL not run) — defaults stand */
  }
  systemSettingsCache = { at: Date.now(), value };
  return value;
}

export function clearSystemSettingsCache(): void {
  systemSettingsCache = null;
}

// Phase 3 (Feature 3) — team workspaces. A team has members, its own
// meetings (meetings.team_id), and shared settings. `myRole` is the
// signed-in user's role in that team ('admin' | 'member' | null).
export interface Team {
  id: string;
  name: string;
  created_by: string;
  created_at?: string;
  myRole?: 'admin' | 'member' | null;
}

export interface TeamMember {
  user_id: string;
  name?: string;
  email?: string;
  role: 'admin' | 'member';
  joined_at?: string;
}

export interface TeamSettings {
  team_id: string;
  who_can_start: 'any_member' | 'admin_only';
  default_require_waiting_room: boolean;
  default_duration: string;
}

// Series columns are part of the public read: the history list needs
// series_id to group a recurring series into one row (without them the
// dashboard could only group via the same-device localStorage
// fallback). They are not sensitive — the meetings RLS still governs
// which rows a caller can see.
export const MEETING_PUBLIC_COLUMNS =
  'id,user_id,title,time,duration,status,host,notes,action_items_count,created_at,admin_id,require_waiting_room,series_id,recurrence_rule,recurrence_count';

// Delete-from-history: the deleted_at column only exists once
// giinmeet_delete_history.sql has run. A query that asks for it
// before then fails with "column meetings.deleted_at does not
// exist" — the history readers below catch exactly that and retry
// without the column, so the app keeps working before the SQL runs.
const isMissingDeletedAtColumn = (err: any): boolean => {
  const msg = String(err?.message || err || '');
  return /deleted_at/i.test(msg) && (/does not exist/i.test(msg) || /42703/.test(msg));
};

// The delete scope, shared by the history UI and the server route:
// a Completed meeting, or a Scheduled meeting whose start time has
// already passed ("expired"). In Progress and upcoming Scheduled
// meetings are never deletable here — an upcoming meeting is
// cancelled, not deleted.
export const isDeletableFromHistory = (m: { status?: string | null; time?: string | null }): boolean => {
  if (m.status === 'Completed') return true;
  if (m.status !== 'Scheduled') return false;
  if (!m.time) return false;
  return new Date(m.time).getTime() < Date.now();
};

// Build a calendar (.ics) file for a meeting, for download or import into
// Google/Outlook/Apple Calendar. Pure client-side generation — no provider.
export const buildICS = (meeting: { id: string; title: string; time: string; duration?: string | null; passcode?: string | null }, brandName: string = 'GiinMeet'): string => {
  const start = new Date(meeting.time);
  // parseDurationMinutes understands hours ("2 hours" is 120, not 2).
  const mins = parseDurationMinutes(meeting.duration);
  const end = new Date(start.getTime() + mins * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const link = buildJoinLink(meeting.id, meeting.passcode);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${brandName}//EN`,
    'BEGIN:VEVENT',
    `UID:${meeting.id}@giinmeet`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(meeting.title)}`,
    `DESCRIPTION:${esc(`${brandName} video meeting. Join: ${link}`)}`,
    `LOCATION:${esc(link)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

export const downloadICS = (meeting: { id: string; title: string; time: string; duration?: string | null; passcode?: string | null }, brandName?: string) => {
  const blob = new Blob([buildICS(meeting, brandName)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `giinmeet-${meeting.id.slice(0, 8)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// Phase 2 (#2) — WhatsApp / SMS invites. The invite words are built
// once here so the copy button, the mailto: invite, the WhatsApp share
// and the SMS invite all send the same text; only the channel differs.
export const buildInviteText = (meeting: { id: string; title: string; time?: string | null; passcode?: string | null }, link: string, brandName: string = 'GiinMeet'): string => {
  const timeStr = meeting.time ? new Date(meeting.time).toLocaleString() : '';
  return [
    `Please join my ${brandName} video meeting:`,
    `Topic: ${meeting.title}`,
    ...(timeStr ? [`Time: ${timeStr}`] : []),
    `Join link: ${link}`,
    `Meeting ID: ${meeting.id}`,
    `Passcode: ${meeting.passcode || 'none - open link'}`,
    '',
    'Media encrypted in transit (DTLS-SRTP).',
  ].join('\n');
};

// WhatsApp invite: a wa.me / api.whatsapp.com share link — no provider,
// no account, no cost. With a phone number it opens a chat with that
// person; without one it opens WhatsApp's share sheet so the host picks
// the contact there. The number is digits only (country code + number);
// anything else is dropped rather than guessed at.
export const buildWhatsAppInviteUrl = (meeting: { id: string; title: string; time?: string | null; passcode?: string | null }, link: string, phone?: string | null, brandName?: string): string => {
  const text = encodeURIComponent(buildInviteText(meeting, link, brandName));
  const digits = (phone || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
};

// Phase 2 (#5) — Google Calendar booking, no-OAuth path: a
// calendar.google.com template link with the meeting pre-filled
// (title, start/end, join link as details + location). The host or
// guest just saves it in their own Google Calendar — no OAuth client,
// no keys, no account needed. The full two-way sync (creating the
// event in the host's calendar from GiinMeet) still needs a Google
// Cloud OAuth client — see docs/phase2-setup.md.
export const buildGoogleCalendarUrl = (meeting: { id: string; title: string; time: string; duration?: string | null; passcode?: string | null }, brandName: string = 'GiinMeet'): string => {
  const start = new Date(meeting.time);
  // parseDurationMinutes understands hours ("2 hours" is 120, not 2).
  const mins = parseDurationMinutes(meeting.duration);
  const end = new Date(start.getTime() + mins * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const link = buildJoinLink(meeting.id, meeting.passcode);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: meeting.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `${brandName} video meeting. Join: ${link}`,
    location: link,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};
// The CURRENT host is meetings.admin_id (it moves on transfer). The
// creator (user_id) only counts when admin_id was never set (old rows).
// (Fix Round 6 / Phase 6: the old OR meant a transferred-away host
// still counted as host everywhere, so a transfer never really moved
// the host role.)
export const isMeetingHost = (
  meeting: { admin_id?: string | null; user_id?: string | null } | null | undefined,
  userId?: string | null
): boolean => {
  if (!meeting || !userId) return false;
  if (meeting.admin_id) return meeting.admin_id === userId;
  return meeting.user_id === userId;
};

// Host check that survives a split identity: Supabase does not link a
// Google sign-in to an existing email/password user, so the same person
// (same email) can hold TWO auth UUIDs. A meeting created under one UUID
// is then invisible to, and unjoinable as host by, the other — the host
// lands in their own waiting room and the meeting is missing from their
// log (seen live 2026-11-14, meeting af6e9313). The verified account
// email is the same human either way (only the email owner can hold a
// live session for it), so a host match falls back to the meeting
// creator's profile email. Profiles are publicly readable (directory
// discovery). Cached per meeting+user: the join path calls this on
// every hash change and waitroom mount.
const hostEmailMatchCache = new Map<string, boolean>();
export const isMeetingHostForUser = async (
  meeting: { admin_id?: string | null; user_id?: string | null } | null | undefined,
  user: { id?: string | null; email?: string | null } | null | undefined
): Promise<boolean> => {
  if (!meeting || !user?.id) return false;
  if (isMeetingHost(meeting, user.id)) return true;
  const email = (user.email || '').trim().toLowerCase();
  if (!email) return false;
  const creatorId = meeting.admin_id || meeting.user_id;
  if (!creatorId) return false;
  const key = `${creatorId}|${email}`;
  const cached = hostEmailMatchCache.get(key);
  if (cached !== undefined) return cached;
  let match = false;
  try {
    const { data } = await giinApi.getProfile(creatorId);
    match = !!data && String((data as any).email || '').trim().toLowerCase() === email;
  } catch (e) { match = false; }
  hostEmailMatchCache.set(key, match);
  return match;
};

export const ensureMeetingRoom = async (
  meetingId: string,
  roomName: string,
  hostId?: string | null
): Promise<{ id: string; slug: string } | null> => {
  const slug = getMeetingRoomSlug(meetingId);
  try {
    const { data: existing } = await supabase
      .from('rooms')
      .select('id, slug')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();
    if (existing) return existing as { id: string; slug: string };
    // Fix Round 6 (Phase 6): never resurrect a room for an ended
    // meeting. After an end, rooms.is_active is false, so this used to
    // INSERT a fresh active room on the next reconnect attempt — the
    // token route still refused (meeting Completed), but the dead
    // meeting's room row came back to life.
    try {
      const { data: mrow } = await supabase
        .from('meetings')
        .select('status')
        .eq('id', meetingId)
        .maybeSingle();
      if ((mrow as any)?.status === 'Completed') {
        console.warn('[GiinMeet] Refusing to create a video room for an ended meeting.');
        return null;
      }
    } catch (e) { /* status check failed: fall through to the insert */ }
    if (!hostId) {
      console.warn('[GiinMeet] Cannot create a video room for a meeting without a signed-in host.');
      return null;
    }
    const { data: created, error } = await supabase
      .from('rooms')
      .insert([{
        room_name: roomName || 'GiinMeet Meeting',
        slug,
        organization_id: hostId,
        host_id: hostId,
        is_active: true,
        max_capacity: 50,
        current_engine: 'LIVEKIT'
      }])
      .select('id, slug')
      .maybeSingle();
    if (error || !created) {
      console.error('[GiinMeet] Could not create the video room for this meeting. Run the rooms INSERT policy patch in the Supabase SQL Editor (rooms_insert_policy_patch.sql).', error?.message);
      return null;
    }
    return created as { id: string; slug: string };
  } catch (err: any) {
    console.error('[GiinMeet] Could not ensure the video room for this meeting:', err?.message);
    return null;
  }
};

// Wrapper object for direct auth and database operations
export const giinApi = {
  // Sign up using email & password
  signUp: async (email: string, password: string, name?: string, customWorkspaceName?: string) => {
    if (!password) throw new Error('A password is required to create an account.');
    const domain = email.split('@')[1] || 'personal';
    const workspaceName = customWorkspaceName?.trim() || (
      !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase())
        ? `${domain.split('.')[0].toUpperCase()} Enterprise Workspace` 
        : 'Personal Workspace'
    );

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name || email.split('@')[0],
          workspace_name: workspaceName,
          domain: domain,
          phone: '',
          is_premium: false
        }
      }
    });

    if (error) throw error;

    const user: GiinUser = {
      id: data.user?.id || '',
      email: data.user?.email || email,
      name: name || email.split('@')[0],
      workspaceName,
      domain,
      is_superadmin: false,
      avatar_url: ''
    };

    return { data: { user }, error: null };
  },

  // Sign in using email & password
  signIn: async (email: string, password: string, customWorkspaceName?: string) => {
    if (!password) throw new Error('A password is required to sign in.');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Fetch profile from public.profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user?.id)
      .maybeSingle();

    const domain = email.split('@')[1] || 'personal';
    const user: GiinUser = {
      id: data.user?.id || '',
      email: data.user?.email || email,
      name: profile?.name || email.split('@')[0].split('.').map((n: string) => n.charAt(0).toUpperCase() + n.slice(1)).join(' '),
      domain: profile?.domain || domain,
      workspaceName: profile?.workspace_name || customWorkspaceName || 'Personal Workspace',
      is_premium: profile?.is_premium || false,
      is_superadmin: profile?.is_superadmin === true,
      avatar_url: profile?.avatar_url || ''
    };

    return { data: { user }, error: null };
  },

  // Passwordless OTP Phone Sign-In — real Supabase SMS OTP only. Phone auth
  // must be enabled in the Supabase dashboard; when it is not, this throws
  // with a clear message instead of pretending a sign-in succeeded.
  signInWithPhone: async (phone: string, customWorkspaceName?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      phone: phone.replace(/\s+/g, ''),
      options: {
        data: {
          workspace_name: customWorkspaceName || 'Personal Workspace',
          name: `Phone User (${phone})`
        }
      }
    });
    if (error) throw error;
    return { data: { success: true }, error: null };
  },

  // Validate Phone OTP — real Supabase verification only. Any code is never
  // accepted: an invalid or expired code throws and the user stays signed out.
  verifyOTP: async (phone: string, code: string, name?: string, customWorkspaceName?: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phone.replace(/\s+/g, ''),
      token: code,
      type: 'sms'
    });

    if (error) throw error;

    // Fetch or insert profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user?.id)
      .maybeSingle();

    const user: GiinUser = {
      id: data.user?.id || '',
      email: data.user?.email || `${phone.replace(/\D/g, '')}@phone.giinmeet.com`,
      name: profile?.name || name || `Phone User (${phone})`,
      workspaceName: profile?.workspace_name || customWorkspaceName || 'Personal Workspace',
      domain: profile?.domain || 'phone.giinmeet.com',
      is_premium: profile?.is_premium || false,
      is_superadmin: false,
      avatar_url: profile?.avatar_url || ''
    };

    return { data: { user }, error: null };
  },

  // Passwordless OTP Email Sign-In — real Supabase email OTP only. The code
  // is generated and verified by Supabase and delivered by the project's
  // configured email sender (Resend SMTP once configured in the Supabase
  // dashboard; until then Supabase's built-in mailer). It is never
  // generated here and never shown on screen.
  // shouldCreateUser: false — email codes are a sign-in method for
  // EXISTING accounts only (for example when the password is forgotten).
  // Supabase would otherwise silently create a passwordless account for
  // any email that can receive a code; a new user must register through
  // the normal sign-up flow instead.
  signInWithEmailCode: async (email: string, customWorkspaceName?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        data: {
          workspace_name: customWorkspaceName || 'Personal Workspace',
        }
      }
    });
    if (error) throw error;
    return { data: { success: true }, error: null };
  },

  // Validate Email OTP — real Supabase verification only. Any code is never
  // accepted: an invalid or expired code throws and the user stays signed out.
  verifyEmailCode: async (email: string, code: string, name?: string, customWorkspaceName?: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email'
    });

    if (error) throw error;

    // Fetch or insert profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user?.id)
      .maybeSingle();

    const user: GiinUser = {
      id: data.user?.id || '',
      email: data.user?.email || email,
      name: profile?.name || name || email.split('@')[0].split('.').map((n: string) => n.charAt(0).toUpperCase() + n.slice(1)).join(' '),
      workspaceName: profile?.workspace_name || customWorkspaceName || 'Personal Workspace',
      domain: profile?.domain || (email.split('@')[1] || 'personal'),
      is_premium: profile?.is_premium || false,
      is_superadmin: profile?.is_superadmin === true,
      avatar_url: profile?.avatar_url || ''
    };

    return { data: { user }, error: null };
  },

  // Fetch user profile from database
  getProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    return { data, error };
  },

  // Update profile details
  updateProfile: async (
    userId: string, 
    name: string, 
    email: string, 
    avatarUrl?: string,
    role?: string,
    timezone?: string,
    location?: string,
    skills?: string[],
    phone?: string,
    workspaceName?: string,
    domain?: string,
    socialHandles?: any
  ) => {
    const payload: any = { name, email, updated_at: new Date() };
    if (avatarUrl) {
      if (avatarUrl.startsWith('data:image')) {
        const uploadRes = await giinApi.uploadAvatar(userId, avatarUrl);
        payload.avatar_url = uploadRes.data || avatarUrl;
      } else {
        payload.avatar_url = avatarUrl;
      }
    }
    if (role !== undefined) payload.role = role;
    if (timezone !== undefined) payload.timezone = timezone;
    if (location !== undefined) payload.location = location;
    if (skills !== undefined) payload.skills = skills;
    if (phone !== undefined) payload.phone = phone;
    if (workspaceName !== undefined) payload.workspace_name = workspaceName;
    if (domain !== undefined) payload.domain = domain;
    if (socialHandles !== undefined) payload.social_handles = socialHandles;

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId);
    return { data, error };
  },

  // Fetch all meetings linked to user_id. Throws when the database cannot be
  // reached — the caller keeps any previously loaded list and shows the error
  // instead of silently inventing meetings.
  // Round 9 (9B): leave a meeting server-side (marks the row 'Left' and
  // completes the meeting when the last person leaves). Best-effort and
  // never throws — the tab may be closing when this runs.
  leaveMeeting: async (meetingId: string, participantRowId?: string) => {
    try {
      let accessToken: string | undefined;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token;
      } catch (e) { /* guests have no session */ }
      await fetch('/api/meetings/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, participantRowId, accessToken }),
        keepalive: true,
      });
    } catch (e) { /* leaving must never fail loudly */ }
  },

  // Round 9 (9A): participants the host removed, so the host can
  // re-invite them. Empty when the statuses SQL has not run yet (no
  // row can hold 'Removed' until then).
  getRemovedParticipants: async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('*')
        .eq('meeting_id', meetingId)
        .eq('status', 'Removed')
        .order('updated_at', { ascending: false });
      if (error) return [];
      return data || [];
    } catch (err: any) {
      return [];
    }
  },

  // Round 9 (9C): a meeting's link expiry, best-effort. Null when the
  // columns do not exist yet (giinmeet_link_expiry.sql not run) — the
  // link is then treated as 'on-end' (live until the meeting ends).
  getMeetingLinkExpiry: async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('link_expires_at,link_expiry_mode')
        .eq('id', meetingId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        mode: (data as any).link_expiry_mode || 'on-end',
        expiresAt: (data as any).link_expires_at || null,
      };
    } catch (e) {
      return null;
    }
  },

  // Round 9 (9C): change a meeting's link expiry (host only — RLS
  // requires the caller to own the meeting). Throws when the columns
  // do not exist yet, so the caller can say so honestly.
  updateMeetingExpiry: async (meetingId: string, mode: string, expiresAt: string | null) => {
    const { error } = await supabase
      .from('meetings')
      .update({ link_expiry_mode: mode, link_expires_at: expiresAt })
      .eq('id', meetingId);
    if (error) throw new Error(`Could not save the link expiry: ${error.message}`);
  },

  getMeetings: async (userId: string) => {
    // Read deleted_at when the column exists (giinmeet_delete_history.sql
    // run) so history can hide soft-deleted rows; fall back to the
    // plain columns when it does not exist yet.
    let { data, error } = await supabase
      .from('meetings')
      .select(MEETING_PUBLIC_COLUMNS + ',deleted_at')
      .eq('user_id', userId)
      .order('time', { ascending: false });
    if (error && isMissingDeletedAtColumn(error)) {
      ({ data, error } = await supabase
        .from('meetings')
        .select(MEETING_PUBLIC_COLUMNS)
        .eq('user_id', userId)
        .order('time', { ascending: false }));
    }
    if (error) throw new Error(`Could not load your meetings: ${error.message}`);
    return data || [];
  },

  // Meetings created by ANY auth account sharing one email (see
  // isMeetingHostForUser): profiles are publicly readable, so look up
  // every profile id for the email and fetch those meetings too.
  getMeetingsForEmail: async (email: string) => {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) return [];
    const { data: profiles, error: pErr } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', clean);
    if (pErr || !profiles || profiles.length === 0) return [];
    const ids = profiles.map((p: any) => p.id);
    let { data, error } = await supabase
      .from('meetings')
      .select(MEETING_PUBLIC_COLUMNS + ',deleted_at')
      .in('user_id', ids)
      .order('time', { ascending: false });
    if (error && isMissingDeletedAtColumn(error)) {
      ({ data, error } = await supabase
        .from('meetings')
        .select(MEETING_PUBLIC_COLUMNS)
        .in('user_id', ids)
        .order('time', { ascending: false }));
    }
    if (error) throw new Error(`Could not load your meetings: ${error.message}`);
    return data || [];
  },

  // History for one human: their own meetings plus any created under a
  // second auth account sharing their email, deduplicated by id.
  getMeetingsForUser: async (userId: string, email?: string | null) => {
    const own = await giinApi.getMeetings(userId);
    if (!email) return own;
    const others = await giinApi.getMeetingsForEmail(email);
    const seen = new Set((own as any[]).map((m: any) => m.id));
    return [...(own as any[]), ...(others as any[]).filter((m: any) => !seen.has(m.id))];
  },

  // Save a new meeting with a random stored passcode, and create the LiveKit
  // room the meeting's video call will use. Throws when the meeting itself
  // cannot be saved — a meeting is never faked locally. The rooms row is
  // best-effort here (it is retried when the meeting is joined); if it
  // fails, a clear warning is logged and the video call will surface the
  // missing room instead of silently dropping to a peer-to-peer call.
  createMeeting: async (meeting: { user_id: string; title: string; time: string; duration: string; status: string; host: string; require_waiting_room?: boolean; passcode?: string | null; link_expiry_mode?: string; link_expires_at?: string | null; reminder_enabled?: boolean; reminder_minutes_before?: number; series_id?: string; recurrence_rule?: string; recurrence_count?: number; team_id?: string | null }) => {
    // Generate UUID on the client side to avoid race conditions and mismatches
    const meetingId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);

    // A passcode is generated by default. Passing passcode: null creates an
    // open meeting with no passcode at all (guests join without a code);
    // passing an explicit code uses it.
    const passcode = meeting.passcode === null ? null : (meeting.passcode || generateMeetingPasscode());
    // System waiting-room default (Superadmin portal): callers that do
    // not say otherwise inherit it; the built-in default is on.
    const requireWaitingRoom = meeting.require_waiting_room ?? (await getSystemSettings()).defaultRequireWaitingRoom ?? true;
    localStorage.setItem(`giin_meeting_settings_${meetingId}`, JSON.stringify({ require_waiting_room: requireWaitingRoom }));

    const payload: any = {
      id: meetingId,
      ...meeting,
      passcode,
      admin_id: meeting.user_id,
      require_waiting_room: requireWaitingRoom
    };

    // Round 9 (9C): link expiry. The spread above may have carried the
    // expiry fields in — strip them, then re-add only when the probe
    // says the columns exist, so the insert never fails on an unknown
    // column. When the columns do not exist yet, the chosen expiry is
    // kept in localStorage so the dashboard can still show it.
    delete payload.link_expiry_mode;
    delete payload.link_expires_at;
    const linkMode = (meeting as any).link_expiry_mode as string | undefined;
    const linkAt = (meeting as any).link_expires_at as string | null | undefined;
    if (linkMode) {
      if (await probeLinkExpirySupport()) {
        payload.link_expiry_mode = linkMode;
        payload.link_expires_at = linkAt || null;
      } else {
        try { localStorage.setItem(`giin_link_expiry_${meetingId}`, JSON.stringify({ mode: linkMode, expiresAt: linkAt || null })); } catch (e) {}
      }
    }

    // Phase 1 — meeting reminder (same probe pattern as link expiry):
    // the reminder settings ride in the spread, so strip them and re-add
    // only when the columns exist. Until giinmeet_phase1.sql runs, the
    // choice is kept in localStorage so the dashboard can still show it.
    delete payload.reminder_enabled;
    delete payload.reminder_minutes_before;
    const remEnabled = (meeting as any).reminder_enabled as boolean | undefined;
    const remMinutes = (meeting as any).reminder_minutes_before as number | undefined;
    if (remEnabled !== undefined || remMinutes !== undefined) {
      if (await probeReminderSupport()) {
        payload.reminder_enabled = remEnabled ?? true;
        payload.reminder_minutes_before = remMinutes ?? 15;
      } else {
        try { localStorage.setItem(`giin_reminder_${meetingId}`, JSON.stringify({ enabled: remEnabled ?? true, minutesBefore: remMinutes ?? 15 })); } catch (e) {}
      }
    }

    // Phase 1 — recurring series (same probe pattern): the series id,
    // rule and count ride in the spread, so strip them and re-add only
    // when the columns exist. Until giinmeet_phase1.sql runs, the series
    // link is kept in localStorage so the dashboard can still group and
    // cancel the series.
    delete payload.series_id;
    delete payload.recurrence_rule;
    delete payload.recurrence_count;
    const serId = (meeting as any).series_id as string | undefined;
    const serRule = (meeting as any).recurrence_rule as string | undefined;
    const serCount = (meeting as any).recurrence_count as number | undefined;
    if (serId) {
      if (await probeSeriesSupport()) {
        payload.series_id = serId;
        payload.recurrence_rule = serRule || null;
        payload.recurrence_count = serCount ?? null;
      } else {
        try { localStorage.setItem(`giin_series_${meetingId}`, JSON.stringify({ seriesId: serId, rule: serRule || null, count: serCount ?? null })); } catch (e) {}
      }
    }

    // Phase 3 (Feature 3) — team meeting (same probe pattern): the
    // team_id rides in the spread, so strip it and re-add only when
    // the column exists. When it does not exist, NEVER silently save
    // the meeting as a personal one — throw honestly instead.
    delete payload.team_id;
    const teamId = (meeting as any).team_id as string | undefined;
    if (teamId) {
      if (await probeTeamMeetingSupport()) {
        payload.team_id = teamId;
      } else {
        throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
      }
    }

    const { error } = await supabase
      .from('meetings')
      .insert([payload]);

    if (error) {
      throw new Error(`Could not save the meeting: ${error.message}`);
    }

    // The created row is returned from the local payload, not re-read from
    // the database: the passcode column is hidden from anon reads, so a
    // re-read would come back without it (and the passcode is already
    // known here — it was generated just above).
    const data: any = { ...payload, created_at: new Date().toISOString() };

    // Set fields so the frontend code handles permissions and waitroom checks correctly
    if (!data.passcode) data.passcode = passcode;
    if (!data.admin_id) data.admin_id = meeting.user_id;

    // Create the LiveKit room for this meeting (best-effort: retried on join).
    await ensureMeetingRoom(meetingId, meeting.title, meeting.user_id);

    return data;
  },

  // Sync meeting workspace notes. Never overwrites notes with a canned
  // string: ending a meeting only sets status (see updateMeetingStatus /
  // endMeeting) and leaves notes alone.
  updateMeetingNotes: async (meetingId: string, notes: string, actionItemsCount: number, status?: string) => {
    const updatePayload: any = { notes, action_items_count: actionItemsCount };
    if (status) {
      updatePayload.status = status;
    }
    // No .select() here: the passcode column is hidden from anon reads,
    // so re-reading the row would fail. Callers do not need the row back.
    const { error } = await supabase
      .from('meetings')
      .update(updatePayload)
      .eq('id', meetingId);
    return { data: null, error };
  },

  // Set only the meeting status (e.g. 'Completed'), preserving notes.
  updateMeetingStatus: async (meetingId: string, status: string) => {
    const { error } = await supabase
      .from('meetings')
      .update({ status })
      .eq('id', meetingId);
    return { error };
  },

  // Delete a meeting from Meeting Logs & History (soft delete, owner
  // only, completed/expired only). Server-verified via POST
  // /api/meetings/delete — the route marks the row deleted_at and
  // writes the audit row. Throws with the server's plain message.
  deleteMeetingFromHistory: async (meetingId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Sign in again to delete this meeting from your history.');
    }
    const res = await fetch('/api/meetings/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, accessToken: session.access_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not delete the meeting from your history.');
    }
    return data;
  },

  // Phase 1 — cancel a whole recurring series: every still-Scheduled
  // instance in the series becomes Cancelled (past and completed
  // instances are untouched). Returns how many were cancelled. Uses the
  // same "update own meetings" RLS policy as updateMeetingStatus, so
  // only the host's own series can be cancelled. When the series columns
  // do not exist yet (giinmeet_phase1.sql not run) there is no series to
  // find in the database, so the caller falls back to cancelling the
  // instances it knows about one by one.
  cancelSeries: async (seriesId: string) => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('meetings')
      .update({ status: 'Cancelled' })
      .eq('series_id', seriesId)
      .eq('status', 'Scheduled')
      .gt('time', now)
      .select('id');
    if (error) return { count: 0, error };
    return { count: (data || []).length, error: null };
  },

  // End a meeting for everyone, server-side (host only): marks the
  // meeting Completed WITHOUT touching notes, deactivates the video room,
  // deletes the LiveKit room and frees every capacity slot. Returns the
  // server payload ({ ok, livekitRoomDeleted, livekitWarning? }). Throws
  // when the server cannot end it — there is NO client-side fallback
  // that marks the meeting ended, because that was a silent partial end
  // (Fix Round 6 / Phase 6).
  endMeeting: async (meetingId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Only the signed-in host can end the meeting for everyone.');
    }
    const res = await fetch('/api/meetings/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, accessToken: session.access_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not end the meeting on the server.');
    }
    return data;
  },

  // Phase 1 — attendance auto-report: store the local attendance record
  // server-side and queue the report email to the host. The route is
  // host-verified (same check as endMeeting). Never throws — the caller
  // (MeetingRoom end-for-all) is fire-and-forget, so a report failure
  // must never look like an end failure. Returns the route's answer so
  // the caller can log it.
  sendAttendanceReport: async (meetingId: string, rows: { key: string; name: string; joinedAt: number; leftAt: number | null }[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { ok: false, reason: 'NO_SESSION' };
      const res = await fetch('/api/meetings/attendance-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, accessToken: session.access_token, rows }),
      });
      const data = await res.json().catch(() => ({}));
      return data || { ok: false, reason: 'BAD_RESPONSE' };
    } catch (e: any) {
      return { ok: false, reason: String(e?.message || e) };
    }
  },

  // Transfer the host role, server-verified (Fix Round 6 / Phase 6).
  // POST /api/meetings/transfer-host checks the caller is the current
  // host and the new host is a signed-in participant in the meeting.
  // Throws with the server's honest message on any failure — callers
  // must NOT leave on failure.
  transferHost: async (meetingId: string, newHostUserId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Only the signed-in host can transfer the host role.');
    }
    const res = await fetch('/api/meetings/transfer-host', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, newHostUserId, accessToken: session.access_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not transfer the host role.');
    }
    return data;
  },

  // Room controls, host-verified server-side (Fix Round 7, #1 + #3).
  // POST /api/meetings/control verifies the caller is the host (or a
  // co-host / moderator, for moderation actions) and broadcasts the
  // event with a server marker - receivers ignore these events without
  // it. A guest role-holder proves themselves with their participant
  // row id, like the token route. Throws with the server's honest
  // message on any failure.
  controlMeeting: async (meetingId: string, action: string, opts?: { targetUserId?: string; targetRowId?: string; settings?: Record<string, boolean> }) => {
    const { data: { session } } = await supabase.auth.getSession();
    let participantRowId: string | null = null;
    try { participantRowId = localStorage.getItem(`giin_participant_row_${meetingId}`); } catch (e) { /* storage unavailable */ }
    if (!session?.access_token && !participantRowId) {
      throw new Error('Only the host, a co-host or a moderator can control the room.');
    }
    // Fix Round 8 (#10): a control call (mute/kick) must never hang
    // forever on a degraded connection — 15 s, then an honest error
    // the button can report instead of a frozen tab.
    const controller = new AbortController();
    const controlTimer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch('/api/meetings/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, action, accessToken: session?.access_token || undefined, participantRowId: participantRowId || undefined, targetUserId: opts?.targetUserId, targetRowId: opts?.targetRowId, settings: opts?.settings }),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('The room did not answer in time — check your connection and try again.');
      throw e;
    } finally {
      clearTimeout(controlTimer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not control the room.');
    }
    return data;
  },

  // Breakout-room control, host-verified server-side (Phase 3,
  // Feature 2). POST /api/meetings/breakout verifies the caller is the
  // host, a co-host or a moderator and the SERVER broadcasts the event
  // with a server marker on the meeting-events channel — receivers
  // ignore breakout events without it. Same dual credential and 15 s
  // timeout as controlMeeting. Throws with the server's honest message.
  breakoutControl: async (meetingId: string, event: string, payload?: { assignments?: Record<string, number>; durationSeconds?: number; peerKey?: string; roomNumber?: number | null; message?: string; roomsCount?: number }) => {
    const { data: { session } } = await supabase.auth.getSession();
    let participantRowId: string | null = null;
    try { participantRowId = localStorage.getItem(`giin_participant_row_${meetingId}`); } catch (e) { /* storage unavailable */ }
    if (!session?.access_token && !participantRowId) {
      throw new Error('Only the host, a co-host or a moderator can manage breakout rooms.');
    }
    const controller = new AbortController();
    const controlTimer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch('/api/meetings/breakout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, event, accessToken: session?.access_token || undefined, participantRowId: participantRowId || undefined, ...(payload || {}) }),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('The rooms did not answer in time — check your connection and try again.');
      throw e;
    } finally {
      clearTimeout(controlTimer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not manage the breakout rooms.');
    }
    return data;
  },

  // Admit or decline a waiting-room participant, host-verified
  // server-side (Fix Round 7, #4). The route flips the row and
  // broadcasts the decision; the old direct client-side row update is
  // gone. `settings` (the room's current settings) are broadcast with
  // the decision so the new participant syncs immediately.
  admitParticipant: async (meetingId: string, participantId: string, status: 'Admitted' | 'Declined', settings?: Record<string, boolean>) => {
    const { data: { session } } = await supabase.auth.getSession();
    let participantRowId: string | null = null;
    try { participantRowId = localStorage.getItem(`giin_participant_row_${meetingId}`); } catch (e) { /* storage unavailable */ }
    if (!session?.access_token && !participantRowId) {
      throw new Error('Only the host or a co-host can admit people.');
    }
    const res = await fetch('/api/meetings/admit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, participantId, status, accessToken: session?.access_token || undefined, participantRowId: participantRowId || undefined, settings }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not admit the participant.');
    }
    return data as { ok: boolean; status: string; rowUpdated: boolean };
  },

  // Persist the meeting lock on the meeting row, host-only (Fix Round
  // 7, #6). Throws with the server's honest message - including when
  // the one-time giinmeet_meeting_lock.sql has not been run yet.
  setMeetingLock: async (meetingId: string, locked: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Only the signed-in host can lock the meeting.');
    }
    const res = await fetch('/api/meetings/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, locked, accessToken: session.access_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not change the meeting lock.');
    }
    return data;
  },

  // Read the persisted meeting lock (best-effort). Returns false when
  // the lock column does not exist yet (giinmeet_meeting_lock.sql not
  // run) or the read fails - callers treat that as unlocked.
  getMeetingLock: async (meetingId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select('is_locked')
        .eq('id', meetingId)
        .maybeSingle();
      if (error || !data) return false;
      return !!(data as any).is_locked;
    } catch (e) {
      return false;
    }
  },

  // Verify a meeting passcode server-side. Returns { hasPasscode, valid }.
  // The passcode itself is never sent to the browser.
  verifyPasscode: async (meetingId: string, passcode: string) => {
    const res = await fetch('/api/meetings/verify-passcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, passcode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.message || data.error || 'Could not verify the passcode. Please check your connection and try again.');
    }
    return data as { hasPasscode: boolean; valid: boolean };
  },

  // Fetch a meeting's passcode — host only, server-verified. Used for the
  // in-room invite panel and the dashboard Copy Link, now that the
  // passcode column is hidden from anon reads.
  getMeetingPasscode: async (meetingId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const res = await fetch('/api/meetings/passcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, accessToken: session.access_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return null;
    return (data.passcode as string | null) ?? null;
  },

  // Send a password-reset email (Supabase). The user gets a link; the
  // reset itself happens on the recovery screen in Auth.tsx. Email
  // delivery depends on Supabase SMTP being configured in the dashboard.
  //
  // redirectTo MUST be the plain site origin — NOT a hash route such as
  // /#/reset-password. Supabase appends the recovery tokens as a hash
  // fragment (#access_token=...&type=recovery); with a hash route in the
  // URL the tokens land after a SECOND '#', and supabase-js parses only
  // the first fragment segment, so access_token is lost, no recovery
  // session is ever established, and setting the new password fails with
  // "Auth session missing!". The app detects recovery from type=recovery
  // in the hash, so no route is needed here (same pattern as Google
  // sign-in, which already uses the plain origin).
  requestPasswordReset: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    return { data: { success: true }, error: null };
  },

  // Set a new password from the recovery flow (user arrives via the email link).
  updatePassword: async (newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return { data, error: null };
  },

  // Fetch chat messages with local cache fallback
  getMessages: async (threadId: string) => {
    let localMsgs: any[] = [];
    try {
      const localMsgsRaw = localStorage.getItem(`giin_chat_messages_${threadId}`);
      localMsgs = localMsgsRaw ? JSON.parse(localMsgsRaw) : [];
    } catch (e) {
      console.warn('[Supabase Client] Failed to parse local messages:', e);
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });
        
      if (error) {
        console.warn('[Supabase Client] Failed to fetch messages from DB. Using local fallback.', error.message);
        return localMsgs;
      }
      
      // Merge and deduplicate DB messages with local messages
      const dbMsgs = data || [];
      const merged = [...dbMsgs];
      localMsgs.forEach((lm: any) => {
        const isDuplicate = merged.some(dm => 
          dm.id === lm.id || 
          (dm.text === lm.text && dm.sender_name === lm.sender_name && Math.abs(new Date(dm.created_at).getTime() - new Date(lm.created_at).getTime()) < 10000)
        );
        if (!isDuplicate) {
          merged.push(lm);
        }
      });
      
      // Sort by created_at
      merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return merged;
    } catch (err: any) {
      console.warn('[Supabase Client] Exception in getMessages. Using local fallback.', err.message);
      return localMsgs;
    }
  },

  // Send a message. Requires a signed-in user: guests cannot send messages,
  // and a message is never faked locally. Throws when the database insert
  // fails so the UI can show the failure instead of a phantom message.
  sendMessage: async (message: { thread_id: string; sender_name: string; text: string; user_id?: string }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      // Guests may send only when the superadmin turned the flag on
      // (system_settings.guests_can_chat). Default off — guests can
      // read chat but cannot send, exactly as before. The matching
      // RLS policy enforces the same rule in the database.
      const settings = await getSystemSettings();
      if (!settings.guestsCanChat) {
        throw new Error('Sign in to send messages. Guests can read and join, but messaging requires an account.');
      }
    }

    const { data, error } = await supabase
      .from('messages')
      .insert([message])
      .select()
      .single();

    if (error) {
      throw new Error(`Could not send the message: ${error.message}`);
    }
    if (!data) {
      throw new Error('Could not send the message: the database returned no message row.');
    }

    // Keep a local copy as a read cache (it never pretends to be the message itself).
    try {
      const localMsgsRaw = localStorage.getItem(`giin_chat_messages_${message.thread_id}`);
      const localMsgs = localMsgsRaw ? JSON.parse(localMsgsRaw) : [];
      localMsgs.push(data);
      localStorage.setItem(`giin_chat_messages_${message.thread_id}`, JSON.stringify(localMsgs));
    } catch (e) {
      console.warn('[Supabase Client] Failed to cache the sent message locally:', e);
    }
    return data;
  },

  // Fetch directory contacts belonging to the same workspace domain
  getContacts: async (domain: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('domain', domain);
    if (error) {
      console.warn('[Supabase Client] Failed to fetch workspace contacts.', error.message);
      return [];
    }
    return data || [];
  },

  // Fetch meeting details. Unknown or malformed meeting IDs return an error —
  // never a virtual meeting — so the waitroom and the call can tell the user
  // the meeting does not exist.
  getMeetingDetails: async (meetingId: string) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!meetingId || !uuidRegex.test(meetingId)) {
      return { data: null, error: { message: 'This meeting link is not valid. The meeting may have been deleted.' } };
    }

    const { data, error } = await supabase
      .from('meetings')
      .select(MEETING_PUBLIC_COLUMNS)
      .eq('id', meetingId)
      .maybeSingle();

    if (error) {
      return { data: null, error };
    }
    if (!data) {
      return { data: null, error: { message: 'Meeting does not exist or has been deleted.' } };
    }
    // The passcode is never read here any more (hidden from anon reads):
    // callers verify it via giinApi.verifyPasscode (server-side) and the
    // host fetches it via giinApi.getMeetingPasscode. `data.passcode` is
    // therefore always undefined for client callers — never rely on it.
    (data as any).passcode = undefined;

    if (!data.admin_id) {
      data.admin_id = data.user_id; // Default host is the creator
    }
    const localSettingsRaw = localStorage.getItem(`giin_meeting_settings_${meetingId}`);
    if (localSettingsRaw) {
      try {
        data.require_waiting_room = JSON.parse(localSettingsRaw).require_waiting_room;
      } catch (e) { /* keep the database value */ }
    } else {
      data.require_waiting_room = data.require_waiting_room ?? true;
    }
    return { data, error: null };
  },

  // ---- Personal rooms (Phase 1) -------------------------------------------
  // Fetch the signed-in user's personal room row, or null when there is
  // none yet (or when the Phase 1 SQL has not been run — the table simply
  // does not exist, and that is a null, never a crash).
  getMyPersonalRoom: async (): Promise<PersonalRoom | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('personal_rooms')
        .select('id,user_id,slug,title,passcode,require_waiting_room')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) return null;
      return data as PersonalRoom;
    } catch (e) {
      return null;
    }
  },

  // Create the signed-in user's personal room. The slug comes from their
  // name (email prefix as fallback); on a collision the next free suffix
  // wins (name-2, name-3, ...). Returns the row, or null when it cannot be
  // created — for example the Phase 1 SQL has not been run yet.
  createPersonalRoom: async (): Promise<PersonalRoom | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const existing = await giinApi.getMyPersonalRoom();
      if (existing) return existing;
      let displayName: string | undefined = (user.user_metadata as any)?.name;
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('name,email')
          .eq('id', user.id)
          .maybeSingle();
        if ((prof as any)?.name) displayName = (prof as any).name;
        else if ((prof as any)?.email) displayName = String((prof as any).email).split('@')[0];
      } catch (e) { /* fall back to the auth record */ }
      if (!displayName) displayName = (user.email || 'room').split('@')[0];
      const base = slugifyPersonalRoom(displayName);
      for (let attempt = 0; attempt < 6; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const { data, error } = await supabase
          .from('personal_rooms')
          .insert([{
            user_id: user.id,
            slug,
            title: `${displayName}'s Room`,
            passcode: null,
            require_waiting_room: true,
          }])
          .select('id,user_id,slug,title,passcode,require_waiting_room')
          .maybeSingle();
        if (!error && data) return data as PersonalRoom;
        if (error && !/duplicate|unique/i.test((error as any)?.message || '')) return null;
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  // Resolve a personal-room slug to the current session meeting. The
  // session row is created server-side (/api/rooms/resolve) for the ROOM'S
  // host, so a guest opening the link first never becomes the host.
  // Returns { meetingId, title, hasPasscode, hostName } or throws with the
  // server's message.
  resolvePersonalRoom: async (slug: string): Promise<{ meetingId: string; title: string; hasPasscode: boolean; hostName: string }> => {
    const res = await fetch('/api/rooms/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as any).error) {
      throw new Error((data as any).message || 'Could not open this personal room.');
    }
    return data as { meetingId: string; title: string; hasPasscode: boolean; hostName: string };
  },

  // Add a participant to the waiting room. Always writes the real
  // meeting_participants row — guests included (the table allows public
  // inserts) — and throws when the write fails, so a join is never faked.
  joinMeetingRoom: async (meetingId: string, name: string, userId?: string, role: string = 'Participant', status?: 'Waiting' | 'Admitted' | 'Declined') => {
    const finalStatus = status || (role === 'Admin' ? 'Admitted' : 'Waiting');

    // Round 9 (9A): rejoin reactivates the existing row instead of
    // inserting a duplicate. The rejoin route is server-side (the
    // admission lockdown blocks client status writes); it refuses
    // removed participants and only re-admits someone who proves they
    // were in the room before. When the route is unreachable the old
    // insert runs instead — the token route still refuses anyone who
    // is not Admitted, so a removed guest can never get media.
    try {
      const rowId = (() => { try { return localStorage.getItem(`giin_participant_row_${meetingId}`); } catch (e) { return null; } })();
      let accessToken: string | undefined;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token;
      } catch (e) { /* guests have no session */ }
      const res = await fetch('/api/meetings/rejoin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, participantRowId: rowId, userId, accessToken, name, role, status: finalStatus }),
      });
      const rej: any = await res.json().catch(() => ({}));
      if (res.status === 403 && rej?.error === 'REMOVED') {
        throw new Error('REMOVED:You were removed from this meeting by the host.');
      }
      if (res.ok && rej?.found && rej?.row) {
        return rej.row;
      }
      // found: false (or an unexpected response) -> fall through to insert.
    } catch (e: any) {
      if (String(e?.message || '').startsWith('REMOVED')) throw e;
      console.warn('[Supabase Client] Rejoin check failed, inserting a fresh participant row:', e?.message);
    }

    const { data, error } = await supabase
      .from('meeting_participants')
      .insert([{
        meeting_id: meetingId,
        user_id: userId || null,
        name: name,
        status: finalStatus,
        role: role
      }])
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Could not join the meeting: ${error.message}`);
    }
    if (!data) {
      throw new Error('Could not join the meeting: the database returned no participant row.');
    }
    return data;
  },

  // Check waiting status for a participant. On any database error the
  // participant stays 'Waiting' (fail closed) — never auto-admitted.
  checkParticipantStatus: async (participantId: string) => {
    try {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('status')
        .eq('id', participantId)
        .maybeSingle();
      if (error) throw error;
      return data?.status || 'Waiting';
    } catch (err: any) {
      console.warn('[Supabase Client] Error checking participant status:', err.message);
      return 'Waiting';
    }
  },

  // Get waiting participants for Host approval
  getWaitingParticipants: async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('*')
        .eq('meeting_id', meetingId)
        .eq('status', 'Waiting')
        .order('updated_at', { ascending: true });
      if (error) {
        console.warn('[Supabase Client] Error getting waiting list:', error.message);
        return [];
      }
      // Expose the row id as participantRowId too: the meeting room
      // keys waiting guests by row id once known, and the broadcast
      // handler can only match a database row if the row carries it.
      return (data || []).map((row: any) => ({ ...row, participantRowId: row.id }));
    } catch (err: any) {
      console.warn('[Supabase Client] Error getting waiting list:', err.message);
      return [];
    }
  },

  // DEPRECATED (Fix Round 7, #4): admission goes through
  // giinApi.admitParticipant (host-verified server route) now. Kept
  // only so older call sites fail loudly instead of silently - do not
  // call it for admission: the public UPDATE on
  // meeting_participants.status is restricted once
  // giinmeet_admission_lockdown.sql runs.
  updateParticipantStatus: async (participantId: string, status: 'Admitted' | 'Declined') => {
    const { data, error } = await supabase
      .from('meeting_participants')
      .update({ status, updated_at: new Date() })
      .eq('id', participantId);
    return { data, error };
  },

  // Get active admitted participants in the call room
  getAdmittedParticipants: async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('*')
        .eq('meeting_id', meetingId)
        .eq('status', 'Admitted');
      if (error) {
        console.warn('[Supabase Client] Error getting admitted list:', error.message);
        return [];
      }
      return data || [];
    } catch (err: any) {
      console.warn('[Supabase Client] Error getting admitted list:', err.message);
      return [];
    }
  },

  // Change meeting admin / designate new host
  changeMeetingAdmin: async (meetingId: string, newAdminId: string) => {
    const { data, error } = await supabase
      .from('meetings')
      .update({ admin_id: newAdminId })
      .eq('id', meetingId);
    return { data, error };
  },

  // Remove a participant from the meeting (resilient to database errors).
  // The key may be the meeting_participants row id (this is the only form
  // that works for guests, whose user_id is NULL) or a user id (signed-in
  // participants). Callers should prefer the row id.
  removeParticipant: async (meetingId: string, participantKey: string) => {
    try {
      const { error } = await supabase
        .from('meeting_participants')
        .delete()
        .eq('meeting_id', meetingId)
        .or(`id.eq.${participantKey},user_id.eq.${participantKey}`);
      return { success: !error };
    } catch (err: any) {
      console.warn('[Supabase Client] Failed to delete participant from database:', err.message);
      return { success: false };
    }
  },

  // Mark a participant's LiveKit allocation row LEFT. This is what stops
  // the capacity leak: without it, every drop/rejoin leaves a JOINED row
  // behind and the room fills with ghosts. Uses fetch with keepalive so
  // it can still land when the tab is closing (best-effort).
  markParticipantLeft: async (roomId: string, identity: string) => {
    try {
      const url = `${supabaseUrl}/rest/v1/participants?room_id=eq.${encodeURIComponent(roomId)}&user_id=eq.${encodeURIComponent(identity)}`;
      await fetch(url, {
        method: 'PATCH',
        headers: {
          apikey: supabaseAnonKey || '',
          Authorization: `Bearer ${supabaseAnonKey || ''}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ status: 'LEFT' }),
        keepalive: true,
      });
    } catch (e) {
      console.warn('[Supabase Client] Could not mark participant LEFT:', (e as any)?.message);
    }
  },

  // Grant or revoke a role on a meeting_participants row — host-only,
  // server-side (Phase 3, Feature 2). POST /api/meetings/role verifies
  // the caller is the current host and writes with the service-role
  // key. The old direct client-side update is gone on purpose: the
  // admission-lockdown SQL kept UPDATE (role) granted to anon, so any
  // guest could grant THEMSELVES CoHost and then admit/mute through
  // the server routes. Only 'CoHost' / 'Moderator' / 'Participant'
  // (revoke) are settable here; host transfer stays in transferHost.
  // Returns the { data, error } shape the participants panel checks.
  setParticipantRole: async (meetingId: string, participantRowId: string, role: 'CoHost' | 'Moderator' | 'Participant') => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { data: null, error: { message: 'Only the signed-in host can change roles.' } };
    }
    try {
      const res = await fetch('/api/meetings/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, participantRowId, role, accessToken: session.access_token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        return { data: null, error: { message: data.message || data.error || 'Could not change the role.' } };
      }
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message || 'Could not change the role.' } };
    }
  },

  // Role-holder rows for a meeting (role 'CoHost' or 'Moderator', any
  // status). The room polls this so a granted role lights up on the
  // holder's own device within seconds, before their next token mint.
  getMeetingRoles: async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('id, user_id, name, role')
        .eq('meeting_id', meetingId)
        .in('role', ['CoHost', 'Moderator']);
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  },

  // Co-host rows for a meeting (role 'CoHost', any status).
  getCoHosts: async (meetingId: string) => {
    const rows = await giinApi.getMeetingRoles(meetingId);
    return (rows || []).filter((r: any) => r.role === 'CoHost');
  },

  // Moderator rows for a meeting (role 'Moderator', any status).
  getModerators: async (meetingId: string) => {
    const rows = await giinApi.getMeetingRoles(meetingId);
    return (rows || []).filter((r: any) => r.role === 'Moderator');
  },

  // Upload a file shared in meeting chat. Uses the 'chat-files' storage
  // bucket (public read, authenticated upload). The bucket is created by
  // giinmeet_phase2_chat_files_bucket.sql (run once in the Supabase SQL
  // Editor) — until then this throws an honest error and the UI says
  // file sharing is not set up yet instead of faking it.
  uploadChatFile: async (meetingId: string, file: File) => {
    // Executable / script types are never shared in chat — a download
    // link in a meeting must not become a malware drop. (Size is
    // checked by the caller: 25 MB, in handleAttachFile.)
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['exe', 'bat', 'sh', 'js', 'mjs', 'msi', 'ps1', 'vbs', 'apk', 'dmg', 'cmd', 'com', 'scr', 'jar', 'app', 'deb', 'rpm'].includes(ext)) {
      throw new Error(`Files of type .${ext} cannot be shared in chat.`);
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${meetingId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from('chat-files')
      .upload(filePath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) {
      throw new Error(`Could not upload the file: ${error.message}. The 'chat-files' storage bucket may not be set up yet.`);
    }
    const { data: publicUrlData } = supabase.storage.from('chat-files').getPublicUrl(filePath);
    if (!publicUrlData?.publicUrl) {
      throw new Error('Could not get a shareable link for the uploaded file.');
    }
    return { url: publicUrlData.publicUrl, name: file.name, path: filePath };
  },

  // Public view URL for a chat file stored under <meetingId>/<file>.
  // Viewing only: the app never renders this as a download link — the
  // file opens in the in-app viewer, and the server deletes it when
  // the host ends the meeting.
  getChatFileUrl: (storagePath: string) => {
    const { data } = supabase.storage.from('chat-files').getPublicUrl(storagePath);
    return data?.publicUrl || '';
  },

  // Get all users in the system (for Superadmin)
  getAllProfiles: async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true });
    return data || [];
  },


  // Delete a user profile/account
  deleteProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    return { data, error };
  },

  // Toggle user Pro/Premium plan limits
  toggleProfilePremium: async (userId: string, isPremium: boolean) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_premium: isPremium })
      .eq('id', userId);
    return { data, error };
  },

  // Set a user's plan tier (Superadmin assigns tiers — there is no
  // payment processor yet, so assignment is manual). is_premium is
  // kept in sync: Pro and Enterprise are premium, Free is not, so
  // every older is_premium-only reader keeps agreeing with the tier.
  // Throws when profiles.plan_tier does not exist yet — run
  // giinmeet_plan_tier.sql in Supabase first.
  setProfileTier: async (userId: string, tier: 'free' | 'pro' | 'enterprise') => {
    const { data, error } = await supabase
      .from('profiles')
      .update({ plan_tier: tier, is_premium: tier !== 'free' })
      .eq('id', userId);
    if (error) throw new Error(`Could not set the plan tier: ${error.message}`);
    return { data, error };
  },

  // Get all meetings (for Superadmin stats)
  getAllMeetings: async () => {
    const { data } = await supabase
      .from('meetings')
      .select(MEETING_PUBLIC_COLUMNS);
    return data || [];
  },

  // Search profiles by name, email, or phone number dynamically
  searchProfile: async (query: string) => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return { data: [], error: null };

    const cleanPhone = cleanQuery.replace(/\D/g, '');
    let dbQuery = supabase
      .from('profiles')
      .select('*')
      .or(`email.ilike.%${cleanQuery}%,name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%`);

    if (cleanPhone) {
      dbQuery = supabase
        .from('profiles')
        .select('*')
        .or(`email.ilike.%${cleanQuery}%,name.ilike.%${cleanQuery}%,phone.ilike.%${cleanQuery}%,phone.ilike.%${cleanPhone}%`);
    }

    const { data, error } = await dbQuery.limit(10);
    return { data: data || [], error };
  },

  // Upload profile photo
  uploadAvatar: async (userId: string, base64Data: string) => {
    try {
      const matches = base64Data.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const rawData = matches[2];
        const byteCharacters = atob(rawData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });
        
        const filePath = `${userId}/avatar.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, blob, {
            contentType: mimeType,
            upsert: true
          });
        
        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath);
          
          if (publicUrlData?.publicUrl) {
            const { error } = await supabase
              .from('profiles')
              .update({ avatar_url: publicUrlData.publicUrl, updated_at: new Date() })
              .eq('id', userId);
            return { data: publicUrlData.publicUrl, error };
          }
        } else {
          console.warn('[Supabase Client] Storage bucket upload failed, using base64 database fallback.', uploadError.message);
        }
      }
    } catch (err: any) {
      console.warn('[Supabase Client] Storage bucket upload failed, using base64 database fallback.', err.message);
    }

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: base64Data, updated_at: new Date() })
      .eq('id', userId);
    return { data: base64Data, error };
  },

  // ---- Team workspaces (Phase 3, Feature 3) ---------------------------
  // A team has members, its own meetings (meetings.team_id) and shared
  // settings. Every method below fails honestly when the teams SQL has
  // not been run yet (probeTeamsSupport / probeTeamMeetingSupport) —
  // never a silent personal meeting, never a faked team.
  // Membership truth lives in team_members; RLS (see
  // giinmeet_phase3_teams.sql) only lets a team admin add/remove
  // members, so these client-side role checks are for honest error
  // messages, not the security boundary.

  // Signed-in user's own membership row in a team, or null.
  getMyTeamMembership: async (teamId: string): Promise<{ role: 'admin' | 'member' } | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error || !data) return null;
      return { role: (data as any).role as 'admin' | 'member' };
    } catch (e) {
      return null;
    }
  },

  // All teams the signed-in user belongs to, each with their role.
  // Returns [] when the teams SQL has not been run yet.
  getMyTeams: async (): Promise<Team[]> => {
    try {
      if (!(await probeTeamsSupport())) return [];
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: memberships, error: mErr } = await supabase
        .from('team_members')
        .select('team_id,role')
        .eq('user_id', user.id);
      if (mErr || !memberships || memberships.length === 0) return [];
      const roleByTeam = new Map((memberships as any[]).map((m: any) => [m.team_id, m.role]));
      const { data: teams, error: tErr } = await supabase
        .from('teams')
        .select('id,name,created_by,created_at')
        .in('id', [...roleByTeam.keys()])
        .order('created_at', { ascending: true });
      if (tErr || !teams) return [];
      return (teams as any[]).map((t: any) => ({ ...t, myRole: roleByTeam.get(t.id) ?? null }));
    } catch (e) {
      return [];
    }
  },

  // Create a team; the creator becomes its admin and gets the default
  // settings row. Throws honestly when the teams SQL has not run.
  createTeam: async (name: string): Promise<Team> => {
    const clean = (name || '').trim();
    if (!clean) throw new Error('Give the team a name first.');
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in to create a team.');
    const { data: team, error } = await supabase
      .from('teams')
      .insert([{ name: clean, created_by: user.id }])
      .select('id,name,created_by,created_at')
      .single();
    if (error || !team) throw new Error(`Could not create the team: ${error?.message || 'the team could not be saved.'}`);
    // Creator is the team's admin. RLS lets the creator insert this
    // row (is_team_admin counts the creator as admin).
    const { error: mErr } = await supabase
      .from('team_members')
      .insert([{ team_id: (team as any).id, user_id: user.id, role: 'admin' }]);
    if (mErr) throw new Error(`The team was created but you could not be made its admin: ${mErr.message}`);
    // Default settings row (best-effort: the team works without it —
    // getTeamSettings falls back to the same defaults).
    try {
      await supabase.from('team_settings').insert([{ team_id: (team as any).id }]);
    } catch (e) { /* defaults apply from getTeamSettings */ }
    return { ...(team as any), myRole: 'admin' };
  },

  // Delete a team (creator only). Memberships and settings cascade;
  // past meetings keep their rows with team_id cleared (ON DELETE SET
  // NULL), so they become ordinary personal meetings of their hosts.
  deleteTeam: async (teamId: string): Promise<void> => {
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in to delete a team.');
    const { data: team } = await supabase.from('teams').select('created_by').eq('id', teamId).maybeSingle();
    if (!team) throw new Error('That team no longer exists.');
    if ((team as any).created_by !== user.id) throw new Error('Only the team creator can delete the team.');
    const { error } = await supabase.from('teams').delete().eq('id', teamId);
    if (error) throw new Error(`Could not delete the team: ${error.message}`);
  },

  // Members of one team, with names/emails from the public profiles
  // directory. Returns [] when the teams SQL has not been run yet.
  getTeamMembers: async (teamId: string): Promise<TeamMember[]> => {
    try {
      if (!(await probeTeamsSupport())) return [];
      const { data: rows, error } = await supabase
        .from('team_members')
        .select('user_id,role,joined_at')
        .eq('team_id', teamId)
        .order('joined_at', { ascending: true });
      if (error || !rows || rows.length === 0) return [];
      const ids = (rows as any[]).map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from('profiles').select('id,name,email').in('id', ids);
      const byId = new Map(((profiles as any[]) || []).map((p: any) => [p.id, p]));
      return (rows as any[]).map((r: any) => ({
        user_id: r.user_id,
        role: r.role as 'admin' | 'member',
        joined_at: r.joined_at,
        name: (byId.get(r.user_id) as any)?.name,
        email: (byId.get(r.user_id) as any)?.email,
      }));
    } catch (e) {
      return [];
    }
  },

  // Find a GiinMeet account by email (profiles are publicly readable).
  // Returns null when no account uses that email — the caller must say
  // so honestly, never pretend the invite went through.
  findProfileByEmail: async (email: string): Promise<{ id: string; name?: string; email?: string } | null> => {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('id,name,email')
      .ilike('email', clean)
      .maybeSingle();
    if (error || !data) return null;
    return data as any;
  },

  // Add a member by email. The person MUST already have a GiinMeet
  // account — inviting a non-user fails honestly ("no account uses
  // that email yet"), it never silently drops the invite. Only a team
  // admin can add members (checked here for the message, enforced by
  // RLS in giinmeet_phase3_teams.sql).
  addTeamMember: async (teamId: string, email: string): Promise<TeamMember> => {
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const me = await giinApi.getMyTeamMembership(teamId);
    if (!me) throw new Error('You are not a member of this team.');
    if (me.role !== 'admin') throw new Error('Only a team admin can add members.');
    const profile = await giinApi.findProfileByEmail(email);
    if (!profile) throw new Error(`No GiinMeet account uses ${email.trim()} yet — ask them to sign up first, then add them.`);
    const existing = await supabase.from('team_members').select('user_id').eq('team_id', teamId).eq('user_id', profile.id).maybeSingle();
    if (existing.data) throw new Error(`${profile.name || profile.email} is already a member of this team.`);
    const { error } = await supabase
      .from('team_members')
      .insert([{ team_id: teamId, user_id: profile.id, role: 'member' }]);
    if (error) throw new Error(`Could not add the member: ${error.message}`);
    return { user_id: profile.id, name: profile.name, email: profile.email, role: 'member' };
  },

  // Remove a member (admin only). The creator cannot be removed and
  // nobody removes themselves this way — leaving is leaveTeam.
  removeTeamMember: async (teamId: string, userId: string): Promise<void> => {
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const me = await giinApi.getMyTeamMembership(teamId);
    if (!me) throw new Error('You are not a member of this team.');
    if (me.role !== 'admin') throw new Error('Only a team admin can remove members.');
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.id === userId) throw new Error('To leave a team yourself, use Leave team instead.');
    const { data: team } = await supabase.from('teams').select('created_by').eq('id', teamId).maybeSingle();
    if (team && (team as any).created_by === userId) throw new Error('The team creator cannot be removed from their own team.');
    const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
    if (error) throw new Error(`Could not remove the member: ${error.message}`);
  },

  // Leave a team. The creator cannot leave their own team (they own
  // it — delete it instead); any other member, admin included, can.
  leaveTeam: async (teamId: string): Promise<void> => {
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in to leave a team.');
    const { data: team } = await supabase.from('teams').select('created_by').eq('id', teamId).maybeSingle();
    if (!team) throw new Error('That team no longer exists.');
    if ((team as any).created_by === user.id) throw new Error('The team creator cannot leave the team — delete the team instead.');
    const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', user.id);
    if (error) throw new Error(`Could not leave the team: ${error.message}`);
  },

  // Shared settings for a team. Falls back to the defaults when no row
  // exists yet (e.g. the team was created before the settings insert
  // landed) or when the teams SQL has not been run.
  getTeamSettings: async (teamId: string): Promise<TeamSettings> => {
    const fallback: TeamSettings = { team_id: teamId, who_can_start: 'any_member', default_require_waiting_room: true, default_duration: '40m limit' };
    try {
      if (!(await probeTeamsSupport())) return fallback;
      const { data, error } = await supabase
        .from('team_settings')
        .select('team_id,who_can_start,default_require_waiting_room,default_duration')
        .eq('team_id', teamId)
        .maybeSingle();
      if (error || !data) return fallback;
      return data as TeamSettings;
    } catch (e) {
      return fallback;
    }
  },

  // Save shared settings (admin only). Upserts so a team created
  // before its settings row existed still saves cleanly.
  updateTeamSettings: async (teamId: string, patch: Partial<Pick<TeamSettings, 'who_can_start' | 'default_require_waiting_room' | 'default_duration'>>): Promise<TeamSettings> => {
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const me = await giinApi.getMyTeamMembership(teamId);
    if (!me) throw new Error('You are not a member of this team.');
    if (me.role !== 'admin') throw new Error('Only a team admin can change team settings.');
    const current = await giinApi.getTeamSettings(teamId);
    const next: TeamSettings = { ...current, ...patch, team_id: teamId };
    const { error } = await supabase
      .from('team_settings')
      .upsert([{ team_id: teamId, who_can_start: next.who_can_start, default_require_waiting_room: next.default_require_waiting_room, default_duration: next.default_duration }], { onConflict: 'team_id' });
    if (error) throw new Error(`Could not save the team settings: ${error.message}`);
    return next;
  },

  // Meetings of ONE team, newest first. Only returns rows for teams
  // the signed-in user belongs to — the caller checks membership
  // first, and the list the user sees comes from getMyTeamMeetings.
  getMeetingsForTeam: async (teamId: string): Promise<any[]> => {
    try {
      if (!(await probeTeamMeetingSupport())) return [];
      const me = await giinApi.getMyTeamMembership(teamId);
      if (!me) return [];
      let { data, error } = await supabase
        .from('meetings')
        .select(MEETING_PUBLIC_COLUMNS + ',team_id,deleted_at')
        .eq('team_id', teamId)
        .order('time', { ascending: false });
      if (error && isMissingDeletedAtColumn(error)) {
        ({ data, error } = await supabase
          .from('meetings')
          .select(MEETING_PUBLIC_COLUMNS + ',team_id')
          .eq('team_id', teamId)
          .order('time', { ascending: false }));
      }
      if (error || !data) return [];
      return data;
    } catch (e) {
      return [];
    }
  },

  // Every team meeting the signed-in user may see: meetings whose
  // team_id is one of their teams, including meetings scheduled by
  // other members. Returns [] when the teams SQL has not been run.
  getMyTeamMeetings: async (): Promise<any[]> => {
    try {
      if (!(await probeTeamMeetingSupport())) return [];
      const myTeams = await giinApi.getMyTeams();
      if (myTeams.length === 0) return [];
      const teamIds = myTeams.map((t) => t.id);
      let { data, error } = await supabase
        .from('meetings')
        .select(MEETING_PUBLIC_COLUMNS + ',team_id,deleted_at')
        .in('team_id', teamIds)
        .order('time', { ascending: false });
      if (error && isMissingDeletedAtColumn(error)) {
        ({ data, error } = await supabase
          .from('meetings')
          .select(MEETING_PUBLIC_COLUMNS + ',team_id')
          .in('team_id', teamIds)
          .order('time', { ascending: false }));
      }
      if (error || !data) return [];
      const nameById = new Map(myTeams.map((t) => [t.id, t.name]));
      return (data as any[]).map((m: any) => ({ ...m, team_name: nameById.get(m.team_id) || null }));
    } catch (e) {
      return [];
    }
  },

  // Schedule a meeting inside a team. The team's shared settings
  // apply: who_can_start is enforced (an 'admin_only' team refuses a
  // plain member honestly), and the team's defaults fill in the
  // waiting-room and duration choices the caller did not set. The
  // meeting itself is created by the same createMeeting engine as a
  // personal meeting — same LiveKit room, same passcode rules.
  createTeamMeeting: async (teamId: string, meeting: { user_id: string; title: string; time: string; duration: string; status: string; host: string; require_waiting_room?: boolean; passcode?: string | null; link_expiry_mode?: string; link_expires_at?: string | null; reminder_enabled?: boolean; reminder_minutes_before?: number; series_id?: string; recurrence_rule?: string; recurrence_count?: number }) => {
    if (!(await probeTeamsSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    if (!(await probeTeamMeetingSupport())) throw new Error(TEAMS_NOT_SET_UP_MESSAGE);
    const me = await giinApi.getMyTeamMembership(teamId);
    if (!me) throw new Error('You are not a member of this team, so you cannot schedule its meetings.');
    const settings = await giinApi.getTeamSettings(teamId);
    if (settings.who_can_start === 'admin_only' && me.role !== 'admin') {
      throw new Error('Only a team admin can start meetings in this team.');
    }
    const saved = await giinApi.createMeeting({
      ...meeting,
      duration: meeting.duration || settings.default_duration,
      require_waiting_room: meeting.require_waiting_room ?? settings.default_require_waiting_room,
      team_id: teamId,
    });
    return { ...saved, team_id: teamId };
  }
};

// Helper to remove a white background from an opaque logo and return a transparent base64 URL.
// Images that already carry real transparency (like the new GIIN logo PNG) are returned untouched.
export const getTransparentLogo = (src: string): Promise<string> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(src);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      // If the image already has real transparency, leave it exactly as it is:
      // stripping near-white would punch holes in the new logo's silver highlights.
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          resolve(src);
          return;
        }
      }
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        // If the pixel is white or very close to white (RGB > 240)
        if (r > 240 && g > 240 && b > 240) {
          data[i+3] = 0; // set alpha to 0
        }
      }
      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL());
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
};




