import { createClient } from '@supabase/supabase-js';

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

export const MEETING_PUBLIC_COLUMNS =
  'id,user_id,title,time,duration,status,host,notes,action_items_count,created_at,admin_id,require_waiting_room';

// Build a calendar (.ics) file for a meeting, for download or import into
// Google/Outlook/Apple Calendar. Pure client-side generation — no provider.
export const buildICS = (meeting: { id: string; title: string; time: string; duration?: string | null; passcode?: string | null }): string => {
  const start = new Date(meeting.time);
  const mins = parseInt(String(meeting.duration || '60').replace(/\D/g, ''), 10) || 60;
  const end = new Date(start.getTime() + mins * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const link = buildJoinLink(meeting.id, meeting.passcode);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GIIN MEET//EN',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@giinmeet`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(meeting.title)}`,
    `DESCRIPTION:${esc(`GIIN Meet video meeting. Join: ${link}`)}`,
    `LOCATION:${esc(link)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
};

export const downloadICS = (meeting: { id: string; title: string; time: string; duration?: string | null; passcode?: string | null }) => {
  const blob = new Blob([buildICS(meeting)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `giinmeet-${meeting.id.slice(0, 8)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
      is_superadmin: email.toLowerCase() === 'nimdaukus@gmail.com',
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
      is_superadmin: email.toLowerCase() === 'nimdaukus@gmail.com',
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
    const { data, error } = await supabase
      .from('meetings')
      .select(MEETING_PUBLIC_COLUMNS)
      .eq('user_id', userId)
      .order('time', { ascending: false });
    if (error) throw new Error(`Could not load your meetings: ${error.message}`);
    return data || [];
  },

  // Save a new meeting with a random stored passcode, and create the LiveKit
  // room the meeting's video call will use. Throws when the meeting itself
  // cannot be saved — a meeting is never faked locally. The rooms row is
  // best-effort here (it is retried when the meeting is joined); if it
  // fails, a clear warning is logged and the video call will surface the
  // missing room instead of silently dropping to a peer-to-peer call.
  createMeeting: async (meeting: { user_id: string; title: string; time: string; duration: string; status: string; host: string; require_waiting_room?: boolean; passcode?: string | null; link_expiry_mode?: string; link_expires_at?: string | null; reminder_enabled?: boolean; reminder_minutes_before?: number; series_id?: string; recurrence_rule?: string; recurrence_count?: number }) => {
    // Generate UUID on the client side to avoid race conditions and mismatches
    const meetingId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);

    // A passcode is generated by default. Passing passcode: null creates an
    // open meeting with no passcode at all (guests join without a code);
    // passing an explicit code uses it.
    const passcode = meeting.passcode === null ? null : (meeting.passcode || generateMeetingPasscode());
    const requireWaitingRoom = meeting.require_waiting_room ?? true;
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
  // co-host, for mutes) and broadcasts the event with a server marker -
  // receivers ignore these events without it. A guest co-host proves
  // themselves with their participant row id, like the token route.
  // Throws with the server's honest message on any failure.
  controlMeeting: async (meetingId: string, action: string, opts?: { targetUserId?: string; targetRowId?: string; settings?: Record<string, boolean> }) => {
    const { data: { session } } = await supabase.auth.getSession();
    let participantRowId: string | null = null;
    try { participantRowId = localStorage.getItem(`giin_participant_row_${meetingId}`); } catch (e) { /* storage unavailable */ }
    if (!session?.access_token && !participantRowId) {
      throw new Error('Only the host or a co-host can control the room.');
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
  requestPasswordReset: async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/#/reset-password`,
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
      throw new Error('Sign in to send messages. Guests can read and join, but messaging requires an account.');
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
      return data || [];
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

  // Grant or revoke the co-host role on a meeting_participants row.
  // Only 'CoHost' / 'Participant' are settable here; host transfer stays
  // in changeMeetingAdmin.
  setParticipantRole: async (participantRowId: string, role: 'CoHost' | 'Participant') => {
    const { data, error } = await supabase
      .from('meeting_participants')
      .update({ role, updated_at: new Date() })
      .eq('id', participantRowId);
    return { data, error };
  },

  // Co-host rows for a meeting (role 'CoHost', any status).
  getCoHosts: async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('meeting_participants')
        .select('id, user_id, name')
        .eq('meeting_id', meetingId)
        .eq('role', 'CoHost');
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  },

  // Upload a file shared in meeting chat. Uses the 'chat-files' storage
  // bucket (public read, authenticated upload). The bucket must exist —
  // create it in the Supabase dashboard (Storage > New bucket
  // 'chat-files', public) — until then this throws an honest error and
  // the UI says file sharing is not set up yet instead of faking it.
  uploadChatFile: async (meetingId: string, file: File) => {
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
    return { url: publicUrlData.publicUrl, name: file.name };
  },

  // Get all users in the system (for Superadmin)
  getAllProfiles: async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('name', { ascending: true });
    return data || [];
  },

  // Update profile superadmin designation
  updateProfileSuperadmin: async (userId: string, isSuperadmin: boolean) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_superadmin: isSuperadmin })
      .eq('id', userId);
    return { data, error };
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
  }
};

// Helper to remove white background from the logo and return a transparent base64 URL
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




