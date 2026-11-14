import React, { useState, useEffect, useRef } from 'react';
import { Video, UserPlus, Calendar, ArrowRight, Clock, CheckCircle2, Play, AlertCircle, Copy, Check, RefreshCw, Link2 } from 'lucide-react';
import { buildJoinLink, buildPersonalRoomLink, generateMeetingPasscode, downloadICS, giinApi, LINK_EXPIRY_OPTIONS, computeLinkExpiry, formatLinkExpiry, buildWhatsAppInviteUrl, buildGoogleCalendarUrl, supabase } from '../supabaseClient';

interface Meeting {
  id: string;
  title: string;
  time: string;
  duration: string;
  // Round 9 (9A/9B/9C): 'Cancelled' is a real status (Round 8 cancel);
  // link expiry is read lazily (the columns only exist once
  // giinmeet_link_expiry.sql runs), so both fields are optional.
  status: 'Completed' | 'In Progress' | 'Scheduled' | 'Cancelled';
  host: string;
  passcode?: string | null;
  link_expires_at?: string | null;
  link_expiry_mode?: string | null;
  // Phase 1 — all optional: the columns only exist once
  // giinmeet_phase1.sql runs, so every reader must tolerate absence.
  reminder_enabled?: boolean;
  reminder_minutes_before?: number;
  series_id?: string | null;
  recurrence_rule?: string | null;
  recurrence_count?: number | null;
  personal_room_slug?: string | null;
}

interface DashboardProps {
  isPremium: boolean;
  onNavigate: (view: string) => void;
  onStartMeeting: (title?: string, dmThreadId?: string, isVideo?: boolean, existingMeetingId?: string, requireWaitingRoom?: boolean, passcode?: string | null) => void;
  meetingHistory: Meeting[];
  onAddMeeting: (meeting: { title: string; time: string; duration: string; requireWaitingRoom?: boolean; passcode?: string | null; linkExpiry?: { mode: string; expiresAt: string | null }; reminder?: { enabled: boolean; minutesBefore: number }; series?: { id: string; rule: string; count: number } }) => Promise<Meeting | null>;
  onCancelMeeting?: (meetingId: string, title: string) => void;
  // Phase 1 — cancel every upcoming meeting in a recurring series.
  onCancelSeries?: (seriesId: string, title: string) => void;
  userName: string;
  userDomain?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  isPremium,
  onNavigate,
  onStartMeeting,
  meetingHistory,
  onAddMeeting,
  onCancelMeeting,
  onCancelSeries,
  userName,
  userDomain,
}) => {
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showInstantModal, setShowInstantModal] = useState(false);
  const [instantTitle, setInstantTitle] = useState('Instant Meeting');
  const [instantRequireWaitingRoom, setInstantRequireWaitingRoom] = useState(true);
  const [instantPasscodeEnabled, setInstantPasscodeEnabled] = useState(true);
  const [instantPasscode, setInstantPasscode] = useState('');
  const [requireWaitingRoom, setRequireWaitingRoom] = useState(true);
  const [schedulePasscodeEnabled, setSchedulePasscodeEnabled] = useState(true);
  const [schedulePasscode, setSchedulePasscode] = useState('');
  const [scheduledMeetingDetails, setScheduledMeetingDetails] = useState<Meeting | null>(null);
  const [copiedSuccessId, setCopiedSuccessId] = useState<'link' | 'details' | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<'link' | 'details' | null>(null);
  const joinLinkInputRef = useRef<HTMLInputElement>(null);

  // Honest copy: the 'Copied' state only shows when the clipboard write
  // really succeeds. On failure the button says so, and the join-link
  // input is selected so the user can copy it manually instead.
  const copyTextHonest = async (id: 'link' | 'details', text: string) => {
    setCopyFailedId(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSuccessId(id);
      setTimeout(() => setCopiedSuccessId(null), 2000);
    } catch (e) {
      setCopiedSuccessId((prev) => (prev === id ? null : prev));
      setCopyFailedId(id);
      joinLinkInputRef.current?.focus();
      joinLinkInputRef.current?.select();
      setTimeout(() => setCopyFailedId(null), 3000);
    }
  };
  
  // Track copying in history list
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null);

  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingTime, setMeetingTime] = useState('');

  // Round 9 (9C/9D): link expiry + meeting templates.
  const [scheduleLinkExpiry, setScheduleLinkExpiry] = useState('1m');
  const [templateDuration, setTemplateDuration] = useState('40m limit');
  const [linkExpiries, setLinkExpiries] = useState<Record<string, { mode: string; expiresAt: string | null }>>({});
  const linkExpiryFetchedRef = useRef<Record<string, boolean>>({});

  // Lazy expiry read for live/scheduled rows (best-effort — null
  // until giinmeet_link_expiry.sql runs; the creation intent in
  // localStorage is the fallback so the row still shows something).
  useEffect(() => {
    meetingHistory.filter((m) => m.status !== 'Completed').forEach(async (m) => {
      if (linkExpiryFetchedRef.current[m.id]) return;
      linkExpiryFetchedRef.current[m.id] = true;
      const exp = await giinApi.getMeetingLinkExpiry(m.id);
      if (exp) setLinkExpiries((prev) => ({ ...prev, [m.id]: exp }));
    });
  }, [meetingHistory]);

  const linkExpiryFor = (meeting: Meeting) => {
    const fromDb = linkExpiries[meeting.id];
    if (fromDb) return fromDb;
    try {
      const raw = localStorage.getItem(`giin_link_expiry_${meeting.id}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { mode: meeting.link_expiry_mode || (meeting.status === 'Scheduled' ? '1m' : 'on-end'), expiresAt: meeting.link_expires_at || null };
  };
  const linkExpiryLabel = (meeting: Meeting) => {
    const e = linkExpiryFor(meeting);
    return formatLinkExpiry(e.mode, e.expiresAt);
  };
  const linkExpiryMode = (meeting: Meeting) => linkExpiryFor(meeting).mode;

  const handleLinkExpiryChange = async (meeting: Meeting, mode: string) => {
    const expiresAt = computeLinkExpiry(mode, meeting.time);
    try {
      await giinApi.updateMeetingExpiry(meeting.id, mode, expiresAt);
      setLinkExpiries((prev) => ({ ...prev, [meeting.id]: { mode, expiresAt } }));
    } catch (err: any) {
      window.alert('Could not save the link expiry — run giinmeet_link_expiry.sql in Supabase first, then try again.');
    }
  };

  const applyScheduleTemplate = (kind: 'standup' | 'client' | 'interview') => {
    if (kind === 'standup') {
      setMeetingTitle('Team standup');
      setTemplateDuration('30m');
      setRequireWaitingRoom(true);
      setSchedulePasscodeEnabled(false);
    } else if (kind === 'client') {
      setMeetingTitle('Client call');
      setTemplateDuration('60m');
      setRequireWaitingRoom(true);
      if (!schedulePasscode) setSchedulePasscode(generateMeetingPasscode());
      setSchedulePasscodeEnabled(true);
    } else {
      setMeetingTitle('Interview');
      setTemplateDuration('60m');
      setRequireWaitingRoom(true);
      if (!schedulePasscode) setSchedulePasscode(generateMeetingPasscode());
      setSchedulePasscodeEnabled(true);
    }
  };

  const applyInstantTemplate = (kind: 'standup' | 'client' | 'interview') => {
    if (kind === 'standup') {
      setInstantTitle('Team standup');
      setInstantRequireWaitingRoom(true);
      setInstantPasscodeEnabled(false);
    } else if (kind === 'client') {
      setInstantTitle('Client call');
      setInstantRequireWaitingRoom(true);
      if (!instantPasscode) setInstantPasscode(generateMeetingPasscode());
      setInstantPasscodeEnabled(true);
    } else {
      setInstantTitle('Interview');
      setInstantRequireWaitingRoom(true);
      if (!instantPasscode) setInstantPasscode(generateMeetingPasscode());
      setInstantPasscodeEnabled(true);
    }
  };

  const downloadAttendanceCsv = (meeting: Meeting, rows: { name: string; joinedAt: number; leftAt: number | null }[]) => {
    const esc = (v: string) => '"' + String(v).replace(/"/g, '""') + '"';
    const fmt = (t: number) => new Date(t).toLocaleString();
    const dur = (a: number, b: number | null) => {
      const mins = Math.max(0, Math.round(((b || Date.now()) - a) / 60000));
      return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    };
    const lines = ['Name,Joined,Left,Duration'];
    rows.forEach((r) => lines.push([esc(r.name), esc(fmt(r.joinedAt)), esc(r.leftAt ? fmt(r.leftAt) : 'Still in room at end'), esc(dur(r.joinedAt, r.leftAt))].join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${meeting.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${meeting.id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const [meetingCode, setMeetingCode] = useState('');
  const [joinError, setJoinError] = useState('');
  // Recurring meetings: a series is real separate meetings (one per
  // occurrence), all sharing the same passcode, so each occurrence has
  // its own join link and waiting room.
  const [scheduleRecurrence, setScheduleRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [scheduleRecurrenceCount, setScheduleRecurrenceCount] = useState(4);
  // Phase 1 — recurring series end: after N meetings (count) or on a date.
  const [scheduleEndMode, setScheduleEndMode] = useState<'count' | 'date'>('count');
  const [scheduleEndDate, setScheduleEndDate] = useState('');

  // Phase 1 — how many instances the current Repeat settings create
  // (cap 12, so a daily series can never run away).
  const countRecurrences = (base: Date): number => {
    if (scheduleRecurrence === 'none') return 1;
    if (scheduleEndMode === 'date' && scheduleEndDate) {
      const endAt = new Date(scheduleEndDate + 'T23:59:59');
      let n = 0;
      for (let i = 0; i < 12; i++) {
        const t = new Date(base);
        if (scheduleRecurrence === 'daily') t.setDate(t.getDate() + i);
        else if (scheduleRecurrence === 'weekly') t.setDate(t.getDate() + 7 * i);
        else t.setMonth(t.getMonth() + i);
        if (t.getTime() > endAt.getTime()) break;
        n++;
      }
      return Math.max(1, n);
    }
    return Math.max(2, Math.min(12, scheduleRecurrenceCount));
  };

  // Phase 1 — series info for one meeting: from the row when present, else
  // the localStorage fallback kept at creation time. Returns the series id,
  // rule label, position (1-based, by start time) and total, or null.
  const seriesInfoFor = (meeting: Meeting): { seriesId: string; rule: string; position: number; total: number } | null => {
    const raw = (meeting as any).series_id
      ? { seriesId: (meeting as any).series_id, rule: (meeting as any).recurrence_rule || 'weekly', count: (meeting as any).recurrence_count ?? null }
      : (() => { try { const r = localStorage.getItem(`giin_series_${meeting.id}`); return r ? JSON.parse(r) : null; } catch (e) { return null; } })();
    if (!raw || !raw.seriesId) return null;
    const siblings = meetingHistory
      .filter((m) => {
        const s = (m as any).series_id
          ? (m as any).series_id
          : (() => { try { const r = localStorage.getItem(`giin_series_${m.id}`); return r ? JSON.parse(r).seriesId : null; } catch (e) { return null; } })();
        return s === raw.seriesId;
      })
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const position = siblings.findIndex((m) => m.id === meeting.id) + 1;
    return { seriesId: raw.seriesId, rule: raw.rule || 'weekly', position: position || 1, total: raw.count || siblings.length };
  };
  // Phase 1 — meeting reminder: emailed to the host before the meeting.
  // Default on, 15 minutes before (the reminder itself only sends once
  // the Resend API key is configured — see src/utils/mailer.ts).
  const [scheduleReminderEnabled, setScheduleReminderEnabled] = useState(true);
  const [scheduleReminderMinutes, setScheduleReminderMinutes] = useState(15);
  const [seriesCreated, setSeriesCreated] = useState(0);
  // Invite by contact / email from the dashboard (copy link + mailto;
  // no mail provider is configured, so nothing is ever "sent" silently).
  const [inviteMeeting, setInviteMeeting] = useState<Meeting | null>(null);
  const [inviteContacts, setInviteContacts] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  // Phase 2 (#2) — WhatsApp + SMS invites from the same modal.
  const [invitePhone, setInvitePhone] = useState('');
  const [smsConfigured, setSmsConfigured] = useState<boolean | null>(null);
  const [smsNote, setSmsNote] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  // Attendance (recorded in this browser during the meeting).
  const [attendanceMeetingId, setAttendanceMeetingId] = useState<string | null>(null);

  // Phase 1 — personal room: one permanent link for this user. Fetched on
  // mount (never auto-created — the user creates it with one click).
  const [personalRoom, setPersonalRoom] = useState<{ slug: string; title: string } | null>(null);
  const [personalRoomLoading, setPersonalRoomLoading] = useState(true);
  const [personalRoomCreating, setPersonalRoomCreating] = useState(false);
  const [personalRoomUnavailable, setPersonalRoomUnavailable] = useState(false);
  const [copiedPersonalLink, setCopiedPersonalLink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    giinApi.getMyPersonalRoom().then((room) => {
      if (cancelled) return;
      setPersonalRoom(room ? { slug: room.slug, title: room.title } : null);
      setPersonalRoomLoading(false);
    }).catch(() => {
      if (!cancelled) setPersonalRoomLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleCreatePersonalRoom = async () => {
    setPersonalRoomCreating(true);
    setPersonalRoomUnavailable(false);
    const room = await giinApi.createPersonalRoom();
    setPersonalRoomCreating(false);
    if (room) setPersonalRoom({ slug: room.slug, title: room.title });
    else setPersonalRoomUnavailable(true);
  };

  const handleCopyPersonalLink = async () => {
    if (!personalRoom) return;
    try {
      await navigator.clipboard.writeText(buildPersonalRoomLink(personalRoom.slug));
      setCopiedPersonalLink(true);
      setTimeout(() => setCopiedPersonalLink(false), 2000);
    } catch (e) {
      window.alert(buildPersonalRoomLink(personalRoom.slug));
    }
  };

  const handleStartPersonalRoom = async () => {
    if (!personalRoom) return;
    try {
      const resolved = await giinApi.resolvePersonalRoom(personalRoom.slug);
      window.location.hash = `#/join?id=${resolved.meetingId}`;
    } catch (e: any) {
      window.alert(e?.message || 'Could not open your personal room.');
    }
  };

  // Fetch the host-only passcode for a meeting (the passcode column is
  // hidden from anon reads), then run the callback with the full link.
  const withHostPasscode = async (meeting: Meeting) => {
    const passcode = meeting.passcode ?? (await giinApi.getMeetingPasscode(meeting.id));
    return { ...meeting, passcode: passcode ?? null };
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingTitle || !meetingTime) return;

    const baseTime = new Date(meetingTime);
    const passcode = schedulePasscodeEnabled ? schedulePasscode : null;
    const occurrences = countRecurrences(baseTime);
    // Phase 1 — one series id links every instance (client-generated UUID;
    // the series columns only exist once giinmeet_phase1.sql runs, and
    // createMeeting keeps the link in localStorage until then).
    const seriesId = scheduleRecurrence === 'none'
      ? null
      : (typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `series-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    let firstSaved: Meeting | null = null;
    let created = 0;
    for (let i = 0; i < occurrences; i++) {
      const t = new Date(baseTime);
      if (scheduleRecurrence === 'daily') t.setDate(t.getDate() + i);
      if (scheduleRecurrence === 'weekly') t.setDate(t.getDate() + 7 * i);
      if (scheduleRecurrence === 'monthly') t.setMonth(t.getMonth() + i);
      const saved = await onAddMeeting({
        title: meetingTitle,
        time: t.toISOString(),
        duration: templateDuration,
        requireWaitingRoom,
        passcode,
        linkExpiry: { mode: scheduleLinkExpiry, expiresAt: computeLinkExpiry(scheduleLinkExpiry, t.toISOString()) },
        reminder: { enabled: scheduleReminderEnabled, minutesBefore: scheduleReminderMinutes },
        series: seriesId ? { id: seriesId, rule: scheduleRecurrence, count: occurrences } : undefined
      });
      if (saved) {
        created++;
        if (!firstSaved) firstSaved = saved;
      }
    }

    if (firstSaved) {
      setScheduledMeetingDetails(firstSaved);
      setSeriesCreated(created);
      setMeetingTitle('');
      setMeetingTime('');
      setRequireWaitingRoom(true);
      setSchedulePasscodeEnabled(true);
      setSchedulePasscode('');
      setScheduleRecurrence('none');
      setScheduleRecurrenceCount(4);
      setShowScheduleModal(false);
      setShowSuccessModal(true);
    }
  };

  const openInviteModal = async (meeting: Meeting) => {
    setInviteMeeting(meeting);
    setInviteEmail('');
    setInviteNote('');
    setInvitePhone('');
    setSmsNote('');
    setSmsSending(false);
    if (userDomain) {
      const contacts = await giinApi.getContacts(userDomain);
      setInviteContacts(contacts || []);
    }
    // Phase 2 (#2) — is SMS wired up? The server answers from env vars
    // only (no secrets cross the wire); the SMS button stays off until
    // a Twilio account is connected.
    try {
      const res = await fetch('/api/invites/sms');
      const data = await res.json().catch(() => ({}));
      setSmsConfigured(data.configured === true);
    } catch (e) { setSmsConfigured(null); }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingCode.trim()) {
      setJoinError('Please enter a valid meeting code.');
      return;
    }
    // Join the existing meeting by code
    onStartMeeting(undefined, undefined, true, meetingCode.trim());
    setShowJoinModal(false);
    setMeetingCode('');
  };

  return (
    <div className="dashboard-container" style={{ 
      animation: 'slide-in var(--transition-normal)',
      flex: 1,
      overflowY: 'auto',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Welcome Banner — animated backdrop: generated still with slow
          cinematic CSS motion (a video replaces the <img> layer later;
          the account video budget is exhausted for now). The welcome
          text scrolls very slowly in yellow on top. */}
      <div className="welcome-banner" style={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', marginBottom: '1.5rem', minHeight: '190px', display: 'flex', alignItems: 'center', boxShadow: '0 12px 30px rgba(0,0,0,0.35)' }}>
        <img src="/welcome-banner-bg.webp" alt="" aria-hidden="true" className="welcome-banner-bg" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(2,6,23,0.85) 0%, rgba(2,6,23,0.5) 55%, rgba(2,6,23,0.3) 100%)' }} />
        <span className="welcome-particle" style={{ left: '12%', top: '24%', width: '10px', height: '10px', animationDelay: '0s' }} />
        <span className="welcome-particle" style={{ left: '32%', top: '62%', width: '7px', height: '7px', animationDelay: '2.2s' }} />
        <span className="welcome-particle" style={{ left: '58%', top: '30%', width: '12px', height: '12px', animationDelay: '4.1s' }} />
        <span className="welcome-particle" style={{ left: '76%', top: '58%', width: '8px', height: '8px', animationDelay: '1.4s' }} />
        <span className="welcome-particle" style={{ left: '88%', top: '22%', width: '6px', height: '6px', animationDelay: '5.6s' }} />
        <div style={{ position: 'relative', zIndex: 2, overflow: 'hidden', width: '100%', padding: '1.75rem 0' }}>
          <div className="welcome-marquee" style={{ display: 'inline-flex', whiteSpace: 'nowrap', willChange: 'transform', alignItems: 'baseline' }}>
            <span style={{ fontSize: '2.1rem', fontWeight: 800, fontFamily: 'var(--font-heading)', lineHeight: 1.2, color: 'var(--color-accent)', textShadow: '0 2px 18px rgba(0,0,0,0.65)' }}>Welcome back, {userName}&nbsp;&nbsp;<span style={{ color: 'white', fontWeight: 600, fontSize: '1.15rem' }}>— Connect, collaborate, and virtualize with HD audio and video.</span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
            <span aria-hidden="true" style={{ fontSize: '2.1rem', fontWeight: 800, fontFamily: 'var(--font-heading)', lineHeight: 1.2, color: 'var(--color-accent)', textShadow: '0 2px 18px rgba(0,0,0,0.65)' }}>Welcome back, {userName}&nbsp;&nbsp;<span style={{ color: 'white', fontWeight: 600, fontSize: '1.15rem' }}>— Connect, collaborate, and virtualize with HD audio and video.</span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
          </div>
        </div>
      </div>

      {/* Phase 1 — Your personal room: one permanent link. */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Link2 size={18} color="var(--color-accent)" />
          <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>Your personal room</h3>
        </div>
        {personalRoomLoading ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading your room…</p>
        ) : personalRoom ? (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>One link, always the same. Share it once — anyone with it can join your room.</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <code style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0 }}>{buildPersonalRoomLink(personalRoom.slug)}</code>
              <button className="premium-btn premium-btn-secondary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }} onClick={handleCopyPersonalLink}>{copiedPersonalLink ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
              <button className="premium-btn premium-btn-primary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }} onClick={handleStartPersonalRoom}><Video size={14} /> Start my room</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Get one permanent link for your room — it never changes, so you only ever share it once.</p>
            <div>
              <button className="premium-btn premium-btn-primary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }} onClick={handleCreatePersonalRoom} disabled={personalRoomCreating}>{personalRoomCreating ? 'Creating…' : 'Create my personal room'}</button>
            </div>
            {personalRoomUnavailable && (
              <p style={{ fontSize: '0.8rem', color: '#F59E0B' }}>Personal rooms need the Phase 1 database setup — run giinmeet_phase1.sql in the Supabase SQL Editor first.</p>
            )}
          </>
        )}
      </div>

      {/* Quick Action Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2.5rem'
      }}>
        {/* New Meeting */}
        <div 
          onClick={() => { if (!instantPasscode) setInstantPasscode(generateMeetingPasscode()); setShowInstantModal(true); }}
          className="glass-panel" 
          style={{
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            background: 'linear-gradient(135deg, var(--color-primary) 0%, #001A4C 100%)',
            color: 'white',
            border: 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 12px 20px rgba(0,32,91,0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-premium)';
          }}
        >
          <div 
            className="dashboard-card-icon"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Video size={24} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ color: 'white', fontSize: '1.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>New Meeting</h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>Start an instant virtualization hub</p>
          </div>
        </div>

        {/* Join Meeting */}
        <div 
          onClick={() => setShowJoinModal(true)}
          className="glass-panel" 
          style={{
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div 
            className="dashboard-card-icon"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(112, 130, 190, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <UserPlus size={24} color="var(--color-primary)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>Join Meeting</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Enter a code or invitation link</p>
          </div>
        </div>

        {/* Schedule Meeting */}
        <div 
          onClick={() => { if (!schedulePasscode) setSchedulePasscode(generateMeetingPasscode()); setShowScheduleModal(true); }}
          className="glass-panel" 
          style={{
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div 
            className="dashboard-card-icon"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(250, 189, 2, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Calendar size={24} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>Schedule</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Plan your future team sync</p>
          </div>
        </div>
      </div>

      {/* Main Content Split: History & Upgrade Promo */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '2rem'
      }} className="grid-2">
        {/* Left Side: Meeting History */}
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="flex-between">
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)' }}>Meeting Logs & History</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{meetingHistory.length} total meetings</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.5rem' }}>
            {meetingHistory.map((meeting) => (
              <React.Fragment key={meeting.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card)',
                  transition: 'border-color var(--transition-fast)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                  <div 
                    className="history-icon-wrapper"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: meeting.status === 'In Progress' ? 'rgba(16, 185, 129, 0.15)' : 
                                      meeting.status === 'Scheduled' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(100, 116, 139, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {meeting.status === 'Completed' && <CheckCircle2 size={20} color="#64748B" />}
                    {meeting.status === 'In Progress' && <Play size={18} className="mic-indicator" style={{ color: '#10B981', animation: 'pulse-ring 2s infinite' }} />}
                    {meeting.status === 'Scheduled' && <Clock size={20} color="#3B82F6" />}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{meeting.title}</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {(() => {
                        try {
                          return new Date(meeting.time).toLocaleString();
                        } catch (e) {
                          return meeting.time;
                        }
                      })()} &bull; {meeting.duration}
                    </p>
                    {meeting.status !== 'Completed' && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span>{linkExpiryLabel(meeting)}</span>
                        {(() => {
                          // Phase 1 — reminder, from the row when present, else
                          // the localStorage fallback kept at creation time.
                          let rem: { enabled: boolean; minutesBefore: number } | null = null;
                          if (meeting.reminder_enabled !== undefined) {
                            rem = { enabled: meeting.reminder_enabled, minutesBefore: meeting.reminder_minutes_before ?? 15 };
                          } else {
                            try {
                              const raw = localStorage.getItem(`giin_reminder_${meeting.id}`);
                              rem = raw ? JSON.parse(raw) : null;
                            } catch (e) { rem = null; }
                          }
                          if (!rem || !rem.enabled) return null;
                          return <span>🔔 Reminder {rem.minutesBefore} min before</span>;
                        })()}
                        {(() => {
                          // Phase 1 — series badge (e.g. "🔁 Weekly • 2 of 5").
                          const info = seriesInfoFor(meeting);
                          if (!info) return null;
                          const label = info.rule === 'daily' ? 'Daily' : info.rule === 'weekly' ? 'Weekly' : 'Monthly';
                          return <span>🔁 {label} • {info.position} of {info.total}</span>;
                        })()}
                        <select
                          value={linkExpiryMode(meeting)}
                          onChange={(e) => handleLinkExpiryChange(meeting, e.target.value)}
                          title="Change when this meeting link expires"
                          style={{ fontSize: '0.75rem', padding: '0.15rem 0.3rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                        >
                          {LINK_EXPIRY_OPTIONS.map((o) => (
                            <option key={o.mode} value={o.mode}>{o.label}</option>
                          ))}
                        </select>
                      </p>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`badge ${
                    meeting.status === 'Completed' ? 'badge-success' :
                    meeting.status === 'In Progress' ? 'badge-premium' : 'badge-info'
                  }`}>
                    {meeting.status}
                  </span>
                  
                  {meeting.status === 'In Progress' ? (
                    <button 
                      onClick={() => { try { localStorage.removeItem(`giin_left_meeting_${meeting.id}`); } catch (e) {} onStartMeeting(meeting.title, undefined, true, meeting.id); }}
                      className="premium-btn premium-btn-accent" 
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                    >
                      {(() => { try { return localStorage.getItem(`giin_left_meeting_${meeting.id}`) ? 'Rejoin' : 'Join Now'; } catch (e) { return 'Join Now'; } })()}
                    </button>
                  ) : meeting.status === 'Scheduled' ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        onClick={async () => {
                          const full = await withHostPasscode(meeting);
                          downloadICS(full);
                        }}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Download a calendar file (.ics) for this meeting"
                      >
                        <Calendar size={14} />
                        <span>.ics</span>
                      </button>
                      <button
                        onClick={async () => {
                          const full = await withHostPasscode(meeting);
                          window.open(buildGoogleCalendarUrl(full), '_blank', 'noopener,noreferrer');
                        }}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Add this meeting to Google Calendar (opens Google Calendar with the details pre-filled)"
                      >
                        <Calendar size={14} />
                        <span>Google</span>
                      </button>
                      <button
                        onClick={() => openInviteModal(meeting)}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Invite someone by email or from your contacts"
                      >
                        <UserPlus size={14} />
                        <span>Invite</span>
                      </button>
                      <button
                        onClick={async () => {
                          const full = await withHostPasscode(meeting);
                          const shareableLink = buildJoinLink(full.id, full.passcode);
                          navigator.clipboard.writeText(shareableLink);
                          setCopiedHistoryId(meeting.id);
                          setTimeout(() => setCopiedHistoryId(null), 2000);
                        }}
                        className={`premium-btn ${copiedHistoryId === meeting.id ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Copy Join Link"
                      >
                        {copiedHistoryId === meeting.id ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedHistoryId === meeting.id ? 'Copied' : 'Copy Link'}</span>
                      </button>
                      <button 
                        onClick={() => onStartMeeting(meeting.title, undefined, true, meeting.id)}
                        className="premium-btn premium-btn-primary" 
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                      >
                        Start Call
                      </button>
                      <button
                        onClick={() => onCancelMeeting?.(meeting.id, meeting.title)}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444' }}
                        title="Cancel this scheduled meeting"
                      >
                        Cancel
                      </button>
                      {(() => {
                        // Phase 1 — cancel the whole series from one button.
                        const info = seriesInfoFor(meeting);
                        if (!info) return null;
                        return (
                          <button
                            onClick={() => onCancelSeries?.(info.seriesId, meeting.title)}
                            className="premium-btn premium-btn-secondary"
                            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444' }}
                            title="Cancel every upcoming meeting in this series"
                          >
                            Cancel series
                          </button>
                        );
                      })()}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Host: {meeting.host}
                      </span>
                      <button
                        onClick={() => setAttendanceMeetingId(attendanceMeetingId === meeting.id ? null : meeting.id)}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px' }}
                        title="Who joined, when, and how long they stayed (recorded in this browser during the meeting)"
                      >
                        Attendance
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {attendanceMeetingId === meeting.id && (
                <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Attendance — {meeting.title}</h4>
                  {(() => {
                    try {
                      const raw = localStorage.getItem(`giin_attendance_${meeting.id}`);
                      if (!raw) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>No attendance was recorded for this meeting in this browser.</p>;
                      const map = JSON.parse(raw);
                      const rows = Object.values(map) as { name: string; joinedAt: number; leftAt: number | null }[];
                      if (rows.length === 0) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>No attendance was recorded for this meeting in this browser.</p>;
                      const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const dur = (a: number, b: number | null) => {
                        const mins = Math.max(0, Math.round(((b || Date.now()) - a) / 60000));
                        return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                      };
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {rows.map((r, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', gap: '0.5rem' }}>
                              <span style={{ fontWeight: 600 }}>{r.name}</span>
                              <span style={{ color: 'var(--text-muted)' }}>joined {fmt(r.joinedAt)} · {r.leftAt ? `left ${fmt(r.leftAt)}` : 'still in room at end'} · {dur(r.joinedAt, r.leftAt)}</span>
                            </div>
                          ))}
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Recorded in this browser during the meeting, not a server log.</span>
                          <button
                            type="button"
                            className="premium-btn premium-btn-secondary"
                            style={{ alignSelf: 'flex-start', padding: '0.35rem 0.75rem', fontSize: '0.75rem', marginTop: '0.25rem' }}
                            onClick={() => downloadAttendanceCsv(meeting, rows)}
                          >
                            Download CSV
                          </button>
                        </div>
                      );
                    } catch (e) {
                      return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Attendance could not be read.</p>;
                    }
                  })()}
                </div>
              )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Right Side: Pro Promotion Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!isPremium ? (
            <div 
              className="glass-panel" 
              style={{
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--bg-app) 150%)',
                color: 'white',
                padding: '2rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: 'none',
                position: 'relative',
                overflow: 'hidden',
                minHeight: '340px'
              }}
            >
              {/* Gold sparkle background simulation */}
              <div style={{
                position: 'absolute',
                top: '-40px',
                right: '-40px',
                width: '150px',
                height: '150px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)',
                opacity: 0.15,
                pointerEvents: 'none'
              }} />
              
              <div style={{ zIndex: 1 }}>
                <span className="badge badge-premium" style={{ color: '#000', backgroundColor: 'var(--color-accent)', border: 'none', marginBottom: '1rem' }}>
                  GO PRO
                </span>
                <h3 style={{ color: 'white', fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.75rem', fontFamily: 'var(--font-heading)' }}>
                  Upgrade to Pro Tiers
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.4, marginBottom: '1.5rem' }}>
                  Unlock 24h meeting limits, customized backgrounds, virtualization overlays, interactive whiteboards, and priority support.
                </p>
                
                <ul style={{ color: 'white', fontSize: '0.85rem', paddingLeft: '1.25rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>Unlimited meeting durations (up to 24h)</li>
                  <li>Up to 100 participants per room</li>
                  <li>Pro customization virtualization tools</li>
                  <li>Direct AI chat assistant response</li>
                </ul>
              </div>

              <button 
                onClick={() => onNavigate('billing')}
                className="premium-btn premium-btn-accent" 
                style={{ width: '100%', justifyContent: 'space-between', padding: '0.85rem 1.25rem', zIndex: 1 }}
              >
                <span>Upgrade for $9.99/mo</span>
                <ArrowRight size={18} />
              </button>
            </div>
          ) : (
            <div 
              className="glass-panel" 
              style={{
                background: 'linear-gradient(135deg, #1E293B 0%, var(--bg-card) 100%)',
                border: '1px solid var(--color-accent)',
                padding: '2rem',
                minHeight: '340px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span className="badge badge-premium">PRO MEMBER</span>
                </div>
                <h3 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.75rem' }}>
                  You are a GIIN MEET Pro
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                  Thank you for subscribing! Your account has unlocked all next-generation virtualization platforms and meeting tools.
                </p>
              </div>

              <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
                <div className="flex-between" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status</span>
                  <span style={{ fontWeight: 600, color: '#10B981' }}>Active</span>
                </div>
                <div className="flex-between" style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Next billing date</span>
                  <span>July 21, 2026</span>
                </div>
                
                <button 
                  onClick={() => onNavigate('billing')}
                  className="premium-btn premium-btn-secondary" 
                  style={{ width: '100%' }}
                >
                  Manage Subscription
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '450px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)',
            maxHeight: '90dvh',
            overflowY: 'auto'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Schedule a Meeting</h3>
            
            <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Round 9 (9D): one-click templates. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>Start from a template</span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyScheduleTemplate('standup')}>Team standup</button>
                  <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyScheduleTemplate('client')}>Client call</button>
                  <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyScheduleTemplate('interview')}>Interview</button>
                </div>
              </div>
              {/* Round 9 (9C): link expiry — a duration counts from the meeting date. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Meeting link expires</label>
                <select value={scheduleLinkExpiry} onChange={(e) => setScheduleLinkExpiry(e.target.value)} className="premium-input" style={{ height: '44px' }}>
                  {LINK_EXPIRY_OPTIONS.map((o) => (
                    <option key={o.mode} value={o.mode}>{o.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>A duration counts from the meeting date. "Expires when the meeting ends" is the default for instant meetings.</span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Meeting Title</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder="e.g. Weekly Operations Sync"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Date & Time</label>
                <input 
                  type="datetime-local" 
                  className="premium-input" 
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Repeat</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select
                    className="premium-input"
                    value={scheduleRecurrence}
                    onChange={(e) => setScheduleRecurrence(e.target.value as 'none' | 'daily' | 'weekly' | 'monthly')}
                    style={{ flex: 1 }}
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {scheduleRecurrence !== 'none' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="radio" checked={scheduleEndMode === 'count'} onChange={() => setScheduleEndMode('count')} />
                      After
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      className="premium-input"
                      value={scheduleRecurrenceCount}
                      disabled={scheduleEndMode !== 'count'}
                      onChange={(e) => setScheduleRecurrenceCount(parseInt(e.target.value) || 4)}
                      title="Number of occurrences"
                      style={{ width: '70px', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '0.85rem' }}>meetings</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="radio" checked={scheduleEndMode === 'date'} onChange={() => setScheduleEndMode('date')} />
                      Ends on
                    </label>
                    <input
                      type="date"
                      className="premium-input"
                      value={scheduleEndDate}
                      disabled={scheduleEndMode !== 'date'}
                      onChange={(e) => setScheduleEndDate(e.target.value)}
                      style={{ flex: 1, minWidth: '140px' }}
                    />
                  </div>
                )}
                {scheduleRecurrence !== 'none' && (
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    Creates {meetingTime ? countRecurrences(new Date(meetingTime)) : scheduleRecurrenceCount} linked meetings ({scheduleRecurrence}), each with its own join link. They share one passcode, and the whole series can be cancelled together from the list below.
                  </span>
                )}
              </div>

              {/* Phase 1 — meeting reminder (emailed to the host). */}
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={scheduleReminderEnabled}
                    onChange={(e) => setScheduleReminderEnabled(e.target.checked)}
                  />
                  Email me a reminder before the meeting
                </label>
                {scheduleReminderEnabled && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                    <select
                      className="premium-input"
                      value={scheduleReminderMinutes}
                      onChange={(e) => setScheduleReminderMinutes(parseInt(e.target.value, 10) || 15)}
                      style={{ height: '44px', flex: 1 }}
                    >
                      <option value={5}>5 minutes before</option>
                      <option value={15}>15 minutes before</option>
                      <option value={30}>30 minutes before</option>
                      <option value={60}>1 hour before</option>
                    </select>
                  </div>
                )}
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  The reminder goes to your email. Sending starts once email is configured for the app (Resend API key) — until then the reminder is saved and queued.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Security & Admission</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="requireWaitingRoom" 
                      checked={requireWaitingRoom} 
                      onChange={() => setRequireWaitingRoom(true)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Host Admission (Waiting Room)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Participants must wait to be admitted by the host.</span>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="requireWaitingRoom" 
                      checked={!requireWaitingRoom} 
                      onChange={() => setRequireWaitingRoom(false)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Bypass Waiting Room (Auto-Join)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Anyone with the meeting link joins automatically.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Meeting Passcode</label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                  <input
                    type="checkbox"
                    checked={schedulePasscodeEnabled}
                    onChange={() => {
                      if (!schedulePasscodeEnabled && !schedulePasscode) setSchedulePasscode(generateMeetingPasscode());
                      setSchedulePasscodeEnabled(!schedulePasscodeEnabled);
                    }}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <strong style={{ display: 'block' }}>Require a passcode to join</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Guests enter this code before joining. Turn it off for a fully open meeting link.</span>
                  </div>
                </label>
                {schedulePasscodeEnabled && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <input
                      type="text"
                      className="premium-input"
                      readOnly
                      value={schedulePasscode}
                      style={{ flex: 1, textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}
                    />
                    <button
                      type="button"
                      className="premium-btn premium-btn-secondary"
                      onClick={() => setSchedulePasscode(generateMeetingPasscode())}
                      title="Generate a new passcode"
                      style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <RefreshCw size={14} />
                      <span>New code</span>
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => setShowScheduleModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="premium-btn premium-btn-primary">
                  Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Modal — by email or from workspace contacts. The invite
          itself is a shareable link plus a pre-filled email in the user's
          own mail app (mailto:); no email is ever sent automatically,
          because no mail provider is configured. */}
      {inviteMeeting && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '450px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            maxHeight: '90dvh',
            overflowY: 'auto'
          }}>
            <h3 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-heading)', margin: 0 }}>Invite to “{inviteMeeting.title}”</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="email"
                className="premium-input"
                placeholder="person@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="premium-btn premium-btn-secondary"
                onClick={async () => {
                  if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
                    setInviteNote('Enter a valid email address first.');
                    return;
                  }
                  const full = await withHostPasscode(inviteMeeting);
                  const link = buildJoinLink(full.id, full.passcode);
                  const subject = encodeURIComponent(`Invitation: ${full.title} — GIIN Meet`);
                  const body = encodeURIComponent(`Please join my GIIN Meet video meeting:\nTopic: ${full.title}\nTime: ${new Date(full.time).toLocaleString()}\nJoin link: ${link}\nMeeting ID: ${full.id}\nPasscode: ${full.passcode || 'none - open link'}\n\nMedia encrypted in transit (DTLS-SRTP).`);
                  window.location.href = `mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`;
                  setInviteNote('Your mail app opened with the invitation ready to send. No email is sent automatically — GIIN Meet has no mail provider configured yet.');
                }}
              >
                Email Invite
              </button>
            </div>
            {inviteContacts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Or pick a workspace contact</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {inviteContacts.map((c: any) => (
                    <button
                      key={c.id}
                      type="button"
                      className="premium-btn premium-btn-secondary"
                      style={{ justifyContent: 'flex-start', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                      onClick={() => {
                        if (c.email) setInviteEmail(c.email);
                        else setInviteNote(`${c.name || 'This contact'} has no email on their profile — copy the link instead.`);
                      }}
                    >
                      {c.name || c.email} {c.email ? `(${c.email})` : '(no email)'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              className="premium-btn premium-btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={async () => {
                const full = await withHostPasscode(inviteMeeting);
                navigator.clipboard.writeText(buildJoinLink(full.id, full.passcode));
                setInviteNote('Invite link copied — paste it anywhere (WhatsApp, chat, email).');
              }}
            >
              <Copy size={14} /> Copy Invite Link
            </button>
            {/* Phase 2 (#2) — WhatsApp + SMS invites. WhatsApp is a wa.me
                share link and works now with no provider. SMS goes through
                Twilio on the server; until Suku connects a Twilio account
                the SMS button stays off and says so — nothing is ever
                pretended sent. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Invite by WhatsApp or SMS</span>
              <input
                type="tel"
                className="premium-input"
                placeholder="Phone with country code, e.g. +250788123456"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="premium-btn premium-btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={async () => {
                    const full = await withHostPasscode(inviteMeeting);
                    const link = buildJoinLink(full.id, full.passcode);
                    window.open(buildWhatsAppInviteUrl(full, link, invitePhone), '_blank', 'noopener,noreferrer');
                    setInviteNote('WhatsApp opened with the invitation ready to send.');
                  }}
                >
                  WhatsApp Invite
                </button>
                <button
                  className="premium-btn premium-btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={smsConfigured !== true || smsSending}
                  title={smsConfigured === false ? 'SMS needs a Twilio account — see docs/phase2-setup.md' : undefined}
                  onClick={async () => {
                    const phone = invitePhone.trim();
                    if (!/^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s\-()]/g, ''))) {
                      setSmsNote('Enter a phone number with country code, e.g. +250788123456.');
                      return;
                    }
                    setSmsSending(true);
                    setSmsNote('');
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      const full = await withHostPasscode(inviteMeeting);
                      const res = await fetch('/api/invites/sms', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          meetingId: full.id,
                          phone,
                          accessToken: session?.access_token,
                          link: buildJoinLink(full.id, full.passcode),
                          title: full.title,
                          time: full.time,
                        }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setSmsNote(data.message || 'Could not send the SMS invite.');
                      } else {
                        setSmsNote(`SMS invite sent to ${phone}.`);
                      }
                    } catch (e: any) {
                      setSmsNote(e?.message || 'Could not send the SMS invite.');
                    } finally {
                      setSmsSending(false);
                    }
                  }}
                >
                  {smsSending ? 'Sending…' : 'Send SMS Invite'}
                </button>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {smsConfigured === false
                  ? 'SMS is not connected yet — it needs a Twilio account (see docs/phase2-setup.md). WhatsApp works now, no account needed.'
                  : 'WhatsApp opens with the invitation ready to send. SMS sends a text straight to the number above.'}
              </span>
              {smsNote && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{smsNote}</span>}
            </div>
            {inviteNote && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{inviteNote}</span>}
            {inviteMeeting.status === 'Scheduled' && (
              <button
                className="premium-btn premium-btn-secondary"
                style={{ width: '100%', justifyContent: 'center', color: '#EF4444' }}
                onClick={() => {
                  const m = inviteMeeting;
                  setInviteMeeting(null);
                  onCancelMeeting?.(m.id, m.title);
                }}
              >
                Cancel this meeting
              </button>
            )}
            <button
              className="premium-btn premium-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setInviteMeeting(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {showJoinModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '400px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)',
            maxHeight: '90dvh',
            overflowY: 'auto'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Join a Meeting</h3>
            
            <form onSubmit={handleJoinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Meeting Code or Link</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder="Paste the full invite link or the meeting ID"
                  value={meetingCode}
                  onChange={(e) => {
                    setMeetingCode(e.target.value);
                    setJoinError('');
                  }}
                  required
                />
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  Paste the invite link from the host, or the meeting ID (the long code with dashes). A 6-character passcode alone cannot find a meeting — you enter that in the waiting room.
                </span>
                {joinError && (
                  <div style={{ color: '#EF4444', fontSize: '0.8rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <AlertCircle size={14} />
                    <span>{joinError}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => {
                    setShowJoinModal(false);
                    setJoinError('');
                    setMeetingCode('');
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="premium-btn premium-btn-accent">
                  Join Meeting
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && scheduledMeetingDetails && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '500px',
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <CheckCircle2 size={32} color="#10B981" />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
                Meeting Scheduled Successfully
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                Your professional GIIN Meet room is ready.
                {seriesCreated > 1 && ` This is a recurring series — ${seriesCreated} meetings were created (details below are for the first one).`}
              </p>
            </div>

            <div style={{
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Topic</span>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>{scheduledMeetingDetails.title}</div>
              </div>

              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Time</span>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  {(() => {
                    try {
                      return new Date(scheduledMeetingDetails.time).toLocaleString();
                    } catch (e) {
                      return scheduledMeetingDetails.time;
                    }
                  })()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Meeting ID</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-secondary)' }}>
                    {scheduledMeetingDetails.id}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Passcode</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                    {scheduledMeetingDetails.passcode || 'No passcode'}
                  </div>
                </div>
              </div>
            </div>

            {/* Sharing Link Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Meeting Join Link</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  ref={joinLinkInputRef}
                  type="text"
                  readOnly
                  className="premium-input"
                  style={{ fontSize: '0.8rem', backgroundColor: 'rgba(0,0,0,0.1)', flex: 1 }}
                  value={buildJoinLink(scheduledMeetingDetails.id, scheduledMeetingDetails.passcode)}
                />
                <button
                  onClick={() => {
                    const link = buildJoinLink(scheduledMeetingDetails.id, scheduledMeetingDetails.passcode);
                    void copyTextHonest('link', link);
                  }}
                  className={`premium-btn ${copiedSuccessId === 'link' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                  style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
                >
                  {copiedSuccessId === 'link' ? <Check size={14} /> : copyFailedId === 'link' ? <AlertCircle size={14} /> : <Copy size={14} />}
                  <span>{copiedSuccessId === 'link' ? 'Copied' : copyFailedId === 'link' ? 'Copy failed — tap to retry' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Copy Invitation Details Button */}
            <button
              onClick={() => {
                const link = buildJoinLink(scheduledMeetingDetails.id, scheduledMeetingDetails.passcode);
                const timeStr = (() => {
                  try {
                    return new Date(scheduledMeetingDetails.time).toLocaleString();
                  } catch (e) {
                    return scheduledMeetingDetails.time;
                  }
                })();
                const invitation = `Please join my GIIN Meet video conference:
Topic: ${scheduledMeetingDetails.title}
Time: ${timeStr}

Join Meeting Link: ${link}

Meeting ID: ${scheduledMeetingDetails.id}
Passcode: ${scheduledMeetingDetails.passcode || 'none - open link'}

Media encrypted in transit (DTLS-SRTP).`;
                void copyTextHonest('details', invitation);
              }}
              className={`premium-btn ${copiedSuccessId === 'details' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              {copiedSuccessId === 'details' ? <Check size={16} /> : copyFailedId === 'details' ? <AlertCircle size={16} /> : <Copy size={16} />}
              <span>{copiedSuccessId === 'details' ? 'Invitation Copied' : copyFailedId === 'details' ? 'Copy failed — tap to retry' : 'Copy Invitation'}</span>
            </button>

            <button
              onClick={async () => {
                const full = await withHostPasscode(scheduledMeetingDetails);
                downloadICS(full);
              }}
              className="premium-btn premium-btn-secondary"
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              <Calendar size={16} />
              <span>Add to Calendar (.ics)</span>
            </button>
            <button
              onClick={async () => {
                const full = await withHostPasscode(scheduledMeetingDetails);
                window.open(buildGoogleCalendarUrl(full), '_blank', 'noopener,noreferrer');
              }}
              className="premium-btn premium-btn-secondary"
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              <Calendar size={16} />
              <span>Add to Google Calendar</span>
            </button>

            <button
              onClick={() => {
                setShowSuccessModal(false);
                setScheduledMeetingDetails(null);
              }}
              className="premium-btn premium-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', marginTop: '0.5rem' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* Instant Meeting Modal */}
      {showInstantModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(8px)'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '450px',
            width: '100%',
            padding: '2.5rem',
            maxHeight: '90dvh',
            overflowY: 'auto',
            animation: 'pop-in 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            border: '1px solid var(--border-color)'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)', color: 'white' }}>Start a New Meeting</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Configure your instant meeting preferences before launching.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Meeting Title</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  value={instantTitle}
                  onChange={(e) => setInstantTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Security & Admission</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="instantRequireWaitingRoom" 
                      checked={instantRequireWaitingRoom} 
                      onChange={() => setInstantRequireWaitingRoom(true)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Host Admission (Waiting Room)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Participants must wait to be admitted by the host.</span>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="instantRequireWaitingRoom" 
                      checked={!instantRequireWaitingRoom} 
                      onChange={() => setInstantRequireWaitingRoom(false)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Bypass Waiting Room (Auto-Join)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Anyone with the meeting link joins automatically.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => setShowInstantModal(false)}
                >
                  Cancel
                </button>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Meeting Passcode</label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                  <input
                    type="checkbox"
                    checked={instantPasscodeEnabled}
                    onChange={() => {
                      if (!instantPasscodeEnabled && !instantPasscode) setInstantPasscode(generateMeetingPasscode());
                      setInstantPasscodeEnabled(!instantPasscodeEnabled);
                    }}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <strong style={{ display: 'block' }}>Require a passcode to join</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Guests enter this code before joining. Turn it off for a fully open meeting link.</span>
                  </div>
                </label>
                {instantPasscodeEnabled && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <input
                      type="text"
                      className="premium-input"
                      readOnly
                      value={instantPasscode}
                      style={{ flex: 1, textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700 }}
                    />
                    <button
                      type="button"
                      className="premium-btn premium-btn-secondary"
                      onClick={() => setInstantPasscode(generateMeetingPasscode())}
                      title="Generate a new passcode"
                      style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <RefreshCw size={14} />
                      <span>New code</span>
                    </button>
                  </div>
                )}
              </div>

                {/* Round 9 (9D): one-click templates (instant meetings always expire when they end). */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>Start from a template</span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyInstantTemplate('standup')}>Team standup</button>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyInstantTemplate('client')}>Client call</button>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyInstantTemplate('interview')}>Interview</button>
                  </div>
                </div>

                <button 
                  onClick={() => {
                    onStartMeeting(instantTitle, undefined, true, undefined, instantRequireWaitingRoom, instantPasscodeEnabled ? instantPasscode : null);
                    setInstantPasscode('');
                    setInstantPasscodeEnabled(true);
                    setShowInstantModal(false);
                  }}
                  className="premium-btn premium-btn-primary"
                >
                  Start Meeting
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
