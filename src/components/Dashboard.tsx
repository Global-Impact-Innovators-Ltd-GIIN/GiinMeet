import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Video, UserPlus, Calendar, ArrowRight, Clock, CheckCircle2, Play, AlertCircle, Copy, Check, RefreshCw, Link2, Trash2, Download } from 'lucide-react';
import { buildJoinLink, buildShortPersonalRoomLink, generateMeetingPasscode, getSystemSettings, downloadICS, giinApi, isDeletableFromHistory, LINK_EXPIRY_OPTIONS, computeLinkExpiry, formatLinkExpiry, buildWhatsAppInviteUrl, buildGoogleCalendarUrl, supabase } from '../supabaseClient';
import { readRecentMeetings } from '../utils/recent';
import { getLocalBrandName, getLocalBrandSlogan, getLocalLogoUrl } from '../utils/brand';
import SchedulingAssistant from './SchedulingAssistant';
import MeetingInsights from './MeetingInsights';
import ActionItemsPanel from './ActionItemsPanel';
import { MeetingRecordExtras } from './MeetingRecordExtras';
import { ShortLinkBox } from './ShortLinkBox';
import { CertificatesPanel } from './CertificatesPanel';
import { NotesExport } from './NotesExport';
import { t, useUiLanguage } from '../i18n';
import { DEFAULT_DURATION_FOR_TIER, DURATION_OPTIONS_FOR_TIER, TIER_LABELS, clampDurationToTier, filterDurationOptionsByMax, parseDurationMinutes, type PlanTier } from '../utils/tiers';

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
  // Phase 1, all optional: the columns only exist once
  // giinmeet_phase1.sql runs, so every reader must tolerate absence.
  reminder_enabled?: boolean;
  reminder_minutes_before?: number;
  series_id?: string | null;
  recurrence_rule?: string | null;
  recurrence_count?: number | null;
  personal_room_slug?: string | null;
  // Phase 3 (Feature 3), team workspaces: a meeting scheduled inside
  // a team carries its team_id (and the team name for the badge).
  // Both are optional: personal meetings have neither.
  team_id?: string | null;
  team_name?: string | null;
}

interface DashboardProps {
  isPremium: boolean;
  // Host's plan tier (Free / Pro / Enterprise), drives the duration
  // picker and its default. Optional: 'free' when unknown.
  planTier?: PlanTier;
  onNavigate: (view: string) => void;
  onStartMeeting: (title?: string, dmThreadId?: string, isVideo?: boolean, existingMeetingId?: string, requireWaitingRoom?: boolean, passcode?: string | null) => void;
  meetingHistory: Meeting[];
  onAddMeeting: (meeting: { title: string; time: string; duration: string; requireWaitingRoom?: boolean; passcode?: string | null; linkExpiry?: { mode: string; expiresAt: string | null }; reminder?: { enabled: boolean; minutesBefore: number }; series?: { id: string; rule: string; count: number }; teamId?: string; teamName?: string; e2eeEnabled?: boolean; organisationId?: string | null }) => Promise<Meeting | null>;
  onCancelMeeting?: (meetingId: string, title: string) => void;
  // Delete from history (soft delete, owner only, completed/expired only).
  onDeleteMeeting?: (meetingId: string, title: string) => void;
  // Phase 1, cancel every upcoming meeting in a recurring series.
  onCancelSeries?: (seriesId: string, title: string) => void;
  userName: string;
  userDomain?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  isPremium,
  planTier = 'free',
  onNavigate,
  onStartMeeting,
  meetingHistory,
  onAddMeeting,
  onCancelMeeting,
  onDeleteMeeting,
  onCancelSeries,
  userName,
  userDomain,
}) => {
  // Phase C2a (3): re-render when the UI language changes.
  useUiLanguage();
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showInstantModal, setShowInstantModal] = useState(false);
  const [instantTitle, setInstantTitle] = useState('Instant Meeting');
  const [instantRequireWaitingRoom, setInstantRequireWaitingRoom] = useState(true);
  const [instantPasscodeEnabled, setInstantPasscodeEnabled] = useState(true);
  const [instantPasscode, setInstantPasscode] = useState('');
  const [requireWaitingRoom, setRequireWaitingRoom] = useState(true);
  // System waiting-room default (Superadmin portal) is applied once, on
  // first load, see the settings effect below. The host's own toggles
  // afterwards always win.
  const waitingRoomAppliedRef = useRef(false);
  const [schedulePasscodeEnabled, setSchedulePasscodeEnabled] = useState(true);
  const [schedulePasscode, setSchedulePasscode] = useState('');
  // Phase D (37, 47): end-to-end encryption choice for this meeting,
  // and the organisation whose brand the meeting carries.
  const [scheduleE2ee, setScheduleE2ee] = useState(false);
  const [scheduleOrganisationId, setScheduleOrganisationId] = useState('');
  const [myOrganisations, setMyOrganisations] = useState<{ id: string; name: string; slug: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    giinApi.getMyOrganisations().then((orgs) => { if (!cancelled) setMyOrganisations(orgs || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
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
  // Duration defaults to the tier's default (Free: 40 minutes; Pro and
  // Enterprise: 2 hours) once the tier is known from the profile.
  useEffect(() => {
    setTemplateDuration(DEFAULT_DURATION_FOR_TIER[planTier]);
  }, [planTier]);
  // Superadmin portal: the stored max duration
  // (system_settings.tier_max_duration_minutes) narrows the duration
  // picker. Without the settings table the built-in options stand.
  const [durationOptions, setDurationOptions] = useState(DURATION_OPTIONS_FOR_TIER[planTier]);
  useEffect(() => {
    let cancelled = false;
    getSystemSettings().then((s) => {
      if (cancelled) return;
      const max = s.tierMaxDurationMinutes?.[planTier];
      const filtered = typeof max === 'number' ? filterDurationOptionsByMax(DURATION_OPTIONS_FOR_TIER[planTier], max) : DURATION_OPTIONS_FOR_TIER[planTier];
      setDurationOptions(filtered);
      setTemplateDuration((prev) => filtered.some((o) => o.value === prev) ? prev : (filtered[filtered.length - 1]?.value || prev));
      // System default meeting duration (Superadmin portal): when set,
      // the dashboard pre-selects the matching duration option.
      if (typeof s.defaultMeetingDurationMinutes === 'number') {
        const match = filtered.find((o) => parseDurationMinutes(o.value) === s.defaultMeetingDurationMinutes);
        if (match) setTemplateDuration(match.value);
      }
      // System waiting-room default (Superadmin portal): applied once,
      // on first load, the host's own toggles afterwards always win.
      if (!waitingRoomAppliedRef.current) {
        waitingRoomAppliedRef.current = true;
        if (s.defaultRequireWaitingRoom === false) {
          setRequireWaitingRoom(false);
          setInstantRequireWaitingRoom(false);
        }
      }
    }).catch(() => { /* built-in options stand */ });
    return () => { cancelled = true; };
  }, [planTier]);
  const [linkExpiries, setLinkExpiries] = useState<Record<string, { mode: string; expiresAt: string | null }>>({});
  const linkExpiryFetchedRef = useRef<Record<string, boolean>>({});

  // Lazy expiry read for live/scheduled rows (best-effort, null
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
      window.alert(t('dash.could_not_save_the_link'));
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
      setTemplateDuration(clampDurationToTier('60m', planTier));
      setRequireWaitingRoom(true);
      if (!schedulePasscode) setSchedulePasscode(generateMeetingPasscode());
      setSchedulePasscodeEnabled(true);
    } else {
      setMeetingTitle('Interview');
      setTemplateDuration(clampDurationToTier('60m', planTier));
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
  // Phase 1, recurring series end: after N meetings (count) or on a date.
  const [scheduleEndMode, setScheduleEndMode] = useState<'count' | 'date'>('count');
  const [scheduleEndDate, setScheduleEndDate] = useState('');

  // Phase 1, how many instances the current Repeat settings create
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

  // Phase 1, the series id for one meeting: from the row when present
  // (the columns only exist once giinmeet_phase1.sql runs), else the
  // localStorage fallback kept at creation time. Used both by the
  // history grouping below and by seriesInfoFor.
  const seriesIdFor = (meeting: Meeting): string | null => {
    if ((meeting as any).series_id) return (meeting as any).series_id as string;
    try { const r = localStorage.getItem(`giin_series_${meeting.id}`); return r ? JSON.parse(r).seriesId : null; } catch (e) { return null; }
  };
  // Phase 1, series info for one meeting: rule label, position
  // (1-based, by start time) and total, or null when it is not part
  // of a series.
  const seriesInfoFor = (meeting: Meeting): { seriesId: string; rule: string; position: number; total: number } | null => {
    const sid = seriesIdFor(meeting);
    if (!sid) return null;
    const rule = (meeting as any).recurrence_rule || 'weekly';
    const siblings = meetingHistory
      .filter((m) => seriesIdFor(m) === sid)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const position = siblings.findIndex((m) => m.id === meeting.id) + 1;
    const count = (meeting as any).recurrence_count ?? null;
    return { seriesId: sid, rule, position: position || 1, total: count || siblings.length };
  };
  // A recurring series is N real meetings (one row per occurrence) that
  // share one series_id, listing them flat is why one "Weekly Executive
  // Meeting" filled the whole history. Group them: one top-level entry
  // per series, expandable to its occurrences. A meeting with no series
  // id (created before the Phase 1 columns existed, with no
  // localStorage fallback on this device) stays a single row.
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});
  type HistoryEntry =
    | { kind: 'single'; key: string; meeting: Meeting }
    | { kind: 'representative'; key: string; meeting: Meeting; seriesId: string; size: number; rule: string }
    | { kind: 'groupbar'; key: string; seriesId: string; title: string; size: number; rule: string }
    | { kind: 'occurrence'; key: string; meeting: Meeting; seriesId: string; groupIndex: number };
  // ONE history list: server history plus local recents (guest joins
  // never reach the server history, so without this merge a guest
  // rejoin would vanish from the dashboard). Deduped by id, newest first.
  const historyWithLocal = useMemo(() => {
    const byId = new Map<string, Meeting>();
    (meetingHistory || []).forEach((m) => byId.set(m.id, m));
    readRecentMeetings().forEach((m) => {
      if (!byId.has(m.id)) {
        byId.set(m.id, { id: m.id, title: m.title, time: m.time, host: m.host || '', status: 'Completed', duration: '' });
      }
    });
    return [...byId.values()].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [meetingHistory]);

  const historyEntries = useMemo((): HistoryEntry[] => {
    const groups: { seriesId: string; title: string; rule: string; meetings: Meeting[] }[] = [];
    const byId = new Map<string, (typeof groups)[number]>();
    for (const m of historyWithLocal) {
      const sid = seriesIdFor(m);
      if (!sid) { groups.push({ seriesId: '', title: m.title, rule: '', meetings: [m] }); continue; }
      let g = byId.get(sid);
      if (!g) {
        const info = seriesInfoFor(m);
        g = { seriesId: sid, title: m.title, rule: info?.rule || (m as any).recurrence_rule || 'weekly', meetings: [] };
        byId.set(sid, g);
        groups.push(g);
      }
      g.meetings.push(m);
    }
    const out: HistoryEntry[] = [];
    for (const g of groups) {
      if (!g.seriesId) { out.push({ kind: 'single', key: `single:${g.meetings[0].id}`, meeting: g.meetings[0] }); continue; }
      const sorted = [...g.meetings].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      // A series with a meeting in progress starts expanded, so the live
      // meeting is never hidden behind a collapsed row.
      const expanded = expandedSeries[`series:${g.seriesId}`] ?? sorted.some((m) => m.status === 'In Progress');
      if (!expanded) {
        const next = sorted.find((m) => m.status === 'Scheduled') || sorted[sorted.length - 1];
        out.push({ kind: 'representative', key: `series:${g.seriesId}`, meeting: next, seriesId: g.seriesId, size: sorted.length, rule: g.rule });
      } else {
        out.push({ kind: 'groupbar', key: `series:${g.seriesId}:bar`, seriesId: g.seriesId, title: g.title, size: sorted.length, rule: g.rule });
        sorted.forEach((m, i) => out.push({ kind: 'occurrence', key: `series:${g.seriesId}:${m.id}`, meeting: m, seriesId: g.seriesId, groupIndex: i }));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyWithLocal, expandedSeries]);
  // Top-level entries for the history count: one per series plus one per
  // single meeting, so the header reads "3 entries · 23 total meetings"
  // instead of pretending 23 separate meetings were scheduled.
  const historyTopLevelCount = useMemo(() => {
    const ids = new Set<string>();
    let n = 0;
    for (const m of historyWithLocal) {
      const sid = seriesIdFor(m);
      if (!sid) { n++; continue; }
      if (!ids.has(sid)) { ids.add(sid); n++; }
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyWithLocal]);
  // Phase 1, meeting reminder: emailed to the host before the meeting.
  // Default on, 15 minutes before (the reminder itself only sends once
  // the Resend API key is configured, see src/utils/mailer.ts).
  const [scheduleReminderEnabled, setScheduleReminderEnabled] = useState(true);
  const [scheduleReminderMinutes, setScheduleReminderMinutes] = useState(15);
  const [seriesCreated, setSeriesCreated] = useState(0);
  // Invite by contact / email from the dashboard (copy link + mailto;
  // no mail provider is configured, so nothing is ever "sent" silently).
  const [inviteMeeting, setInviteMeeting] = useState<Meeting | null>(null);
  const [inviteContacts, setInviteContacts] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  // Phase 2 (#2), WhatsApp + SMS invites from the same modal.
  const [invitePhone, setInvitePhone] = useState('');
  const [smsConfigured, setSmsConfigured] = useState<boolean | null>(null);
  const [smsNote, setSmsNote] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  // Attendance (recorded in this browser during the meeting).
  const [attendanceMeetingId, setAttendanceMeetingId] = useState<string | null>(null);
  // Phase B (9 + 10), meeting record: saved transcript + AI summary,
  // fetched from the server routes (host or admitted participant only).
  const [recordMeetingId, setRecordMeetingId] = useState<string | null>(null);
  const [meetingRecords, setMeetingRecords] = useState<Record<string, { transcript: any; summary: any; loading: boolean; note: string | null }>>({});
  const loadMeetingRecord = async (id: string) => {
    setMeetingRecords(prev => ({ ...prev, [id]: { transcript: prev[id]?.transcript || null, summary: prev[id]?.summary || null, loading: true, note: null } }));
    const result: any = await giinApi.getMeetingRecord(id);
    if (result?.ok) {
      setMeetingRecords(prev => ({ ...prev, [id]: { transcript: result.transcript, summary: result.summary, loading: false, note: null } }));
    } else {
      setMeetingRecords(prev => ({ ...prev, [id]: { transcript: null, summary: null, loading: false, note: result?.message || 'The meeting record could not be loaded.' } }));
    }
  };
  const regenerateSummary = async (id: string) => {
    setMeetingRecords(prev => ({ ...prev, [id]: { ...(prev[id] || { transcript: null, summary: null }), loading: true, note: null } }));
    const result: any = await giinApi.generateMeetingSummary(id);
    if (result?.ok) {
      setMeetingRecords(prev => ({ ...prev, [id]: { ...(prev[id] || { transcript: null }), summary: { summary: result.summary, decisions: result.decisions, actionItems: result.actionItems, generatedAt: new Date().toISOString() }, loading: false, note: null } }));
    } else {
      setMeetingRecords(prev => ({ ...prev, [id]: { ...(prev[id] || { transcript: null, summary: null }), loading: false, note: result?.message || 'The summary could not be generated.' } }));
    }
  };

  // Phase C1 (29), manual follow-up send from the Record panel (the
  // automatic send happens when the host ends the meeting).
  const [followUpEmails, setFollowUpEmails] = useState('');
  const [followUpStatus, setFollowUpStatus] = useState<Record<string, string>>({});
  const [followUpSending, setFollowUpSending] = useState<string | null>(null);
  const sendFollowUp = async (id: string) => {
    setFollowUpSending(id);
    const extras = followUpEmails.split(/[,\n;]+/).map((e) => e.trim()).filter(Boolean);
    const result: any = await giinApi.sendFollowUp(id, extras);
    setFollowUpSending(null);
    if (result?.ok) {
      setFollowUpStatus((prev) => ({ ...prev, [id]: t('dash.follow_up_sent_to', { v1: result.sent, v2: result.sent === 1 ? 'person' : 'people' }) }));
    } else {
      setFollowUpStatus((prev) => ({ ...prev, [id]: result?.message || 'The follow-up could not be sent.' }));
    }
  };

  // Phase C1 (32), installable PWA: the browser offers the install
  // prompt once (beforeinstallprompt); iPhones have no prompt, so they
  // get the one-line Add to Home Screen hint instead. Nothing shows
  // when the app is already installed (standalone).
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  useEffect(() => {
    try {
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
          (window.navigator as any).standalone === true,
      );
      setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));
      const handler = (e: any) => {
        e.preventDefault();
        setInstallPrompt(e);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    } catch (e) {
      // The install prompt is optional; the app works without it.
    }
  }, []);
  const handleInstallApp = async () => {
    if (!installPrompt) return;
    try {
      installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch (e) {
      // Dismissed or failed: the button simply stays available.
    }
  };

  // Phase C1 (35), carry open action items into the next meeting.
  // Loaded when the Schedule modal opens; the host ticks the ones to
  // bring along, and they are copied to the new meeting on save.
  const [openActionItems, setOpenActionItems] = useState<any[]>([]);
  const [carrySelected, setCarrySelected] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!showScheduleModal) return;
    (async () => {
      const res: any = await giinApi.getOpenActionItems();
      if (res?.ok && Array.isArray(res.items)) {
        setOpenActionItems(res.items.slice(0, 5));
        setCarrySelected({});
      }
    })();
  }, [showScheduleModal]);
  const toggleCarryItem = (id: string) => {
    setCarrySelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Phase C1 (33), smart scheduling assistant, opened from the
  // Schedule modal. Fills the schedule form when a slot is picked.
  const [showSchedulingAssistant, setShowSchedulingAssistant] = useState(false);
  const [showHandleEditor, setShowHandleEditor] = useState(false);

  // A template picked under Schedule opens pre-filled in the schedule
  // form here. Schedule stores the pick in localStorage and navigates
  // to the dashboard; this runs once on mount, applies it, then clears it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('giin_pending_template');
      if (!raw) return;
      const tpl = JSON.parse(raw);
      localStorage.removeItem('giin_pending_template');
      if (tpl?.title) setMeetingTitle(tpl.title);
      const match = durationOptions.find((o) => parseDurationMinutes(o.value) === tpl.duration_minutes);
      if (match) setTemplateDuration(match.value);
      if (typeof tpl.require_waiting_room === 'boolean') setRequireWaitingRoom(tpl.require_waiting_room);
      setSchedulePasscodeEnabled(!!tpl.passcode);
      setSchedulePasscode(tpl.passcode || '');
      setShowScheduleModal(true);
    } catch (e) { /* a bad stored template never blocks the dashboard */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleUseSuggestedSlot = (startIso: string, slotTitle: string, durationMinutes: number) => {
    const d = new Date(startIso);
    const pad = (n: number) => String(n).padStart(2, '0');
    setMeetingTime(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    if (slotTitle) setMeetingTitle(slotTitle);
    const match = durationOptions.find((o) => parseDurationMinutes(o.value) === durationMinutes);
    if (match) setTemplateDuration(match.value);
    setShowSchedulingAssistant(false);
  };

  // Phase 1, personal room: one permanent link for this user. Fetched on
  // mount (never auto-created, the user creates it with one click).
  const [personalRoom, setPersonalRoom] = useState<{ slug: string; title: string } | null>(null);
  const [personalRoomLoading, setPersonalRoomLoading] = useState(true);
  const [personalRoomCreating, setPersonalRoomCreating] = useState(false);
  const [personalRoomUnavailable, setPersonalRoomUnavailable] = useState(false);
  const [copiedPersonalLink, setCopiedPersonalLink] = useState(false);
  // Phase C1 (25), the memorable handle (the part after giinmeet.../).
  const [handleInput, setHandleInput] = useState('');
  const [handleSaving, setHandleSaving] = useState(false);
  const [handleNote, setHandleNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    giinApi.getMyPersonalRoom().then((room) => {
      if (cancelled) return;
      setPersonalRoom(room ? { slug: room.slug, title: room.title } : null);
      if (room) setHandleInput(room.slug);
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
    if (room) {
      setPersonalRoom({ slug: room.slug, title: room.title });
      setHandleInput(room.slug);
    } else setPersonalRoomUnavailable(true);
  };

  const handleCopyPersonalLink = async () => {
    if (!personalRoom) return;
    try {
      await navigator.clipboard.writeText(buildShortPersonalRoomLink(personalRoom.slug));
      setCopiedPersonalLink(true);
      setTimeout(() => setCopiedPersonalLink(false), 2000);
    } catch (e) {
      window.alert(buildShortPersonalRoomLink(personalRoom.slug));
    }
  };

  // Phase C1 (25), rename the handle. The server checks the format and
  // that nobody else already has it; the old link stops working, the new
  // one works at once. Passcode and waiting-room rules are untouched.
  const handleSaveHandle = async () => {
    const slug = handleInput.trim().toLowerCase();
    if (!slug) {
      setHandleNote('Type a handle first.');
      return;
    }
    setHandleSaving(true);
    setHandleNote(null);
    const result: any = await giinApi.updatePersonalRoomSlug(slug);
    setHandleSaving(false);
    if (result?.ok && result.room) {
      setPersonalRoom({ slug: result.room.slug, title: result.room.title });
      setHandleInput(result.room.slug);
      setHandleNote('Saved. Your new link works now.');
    } else {
      setHandleNote(result?.message || 'That handle could not be saved.');
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
    // Phase 1, one series id links every instance (client-generated UUID;
    // the series columns only exist once giinmeet_phase1.sql runs, and
    // createMeeting keeps the link in localStorage until then).
    const seriesId = scheduleRecurrence === 'none'
      ? null
      : (typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `series-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    let firstSaved: Meeting | null = null;
    let created = 0;
    const savedIds: string[] = [];
    for (let i = 0; i < occurrences; i++) {
      const t = new Date(baseTime);
      if (scheduleRecurrence === 'daily') t.setDate(t.getDate() + i);
      if (scheduleRecurrence === 'weekly') t.setDate(t.getDate() + 7 * i);
      if (scheduleRecurrence === 'monthly') t.setMonth(t.getMonth() + i);
      const saved = await onAddMeeting({
        title: meetingTitle,
        time: t.toISOString(),
        // Clamp to the tier's cap, so a stale choice can never promise
        // a Free host more than 40 minutes.
        duration: clampDurationToTier(templateDuration, planTier),
        requireWaitingRoom,
        passcode,
        e2eeEnabled: scheduleE2ee,
        organisationId: scheduleOrganisationId || null,
        linkExpiry: { mode: scheduleLinkExpiry, expiresAt: computeLinkExpiry(scheduleLinkExpiry, t.toISOString()) },
        reminder: { enabled: scheduleReminderEnabled, minutesBefore: scheduleReminderMinutes },
        series: seriesId ? { id: seriesId, rule: scheduleRecurrence, count: occurrences } : undefined
      });
      if (saved) {
        created++;
        savedIds.push(saved.id);
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
      setScheduleE2ee(false);
      setScheduleOrganisationId('');
      setScheduleRecurrence('none');
      setScheduleRecurrenceCount(4);
      setShowScheduleModal(false);
      setShowSuccessModal(true);
      // Phase C1 (23), push every created meeting to the connected
      // calendars. Fire-and-forget: a calendar failure must never look
      // like a scheduling failure, and the meeting is already saved.
      savedIds.forEach((id) => { void giinApi.syncMeetingToCalendar(id); });
      // Phase C1 (35), carry the ticked open action items into the new
      // meeting, so they appear in its prep, its record and its follow-up.
      if (firstSaved) {
        openActionItems
          .filter((item: any) => carrySelected[item.id])
          .forEach((item: any) => {
            void giinApi.createActionItem({
              meetingId: firstSaved.id,
              text: item.text,
              owner: item.owner,
              carriedFromMeetingId: item.meeting_id,
            });
          });
      }
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
    // Phase 2 (#2), is SMS wired up? The server answers from env vars
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
      {/* Quick Action Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1.25rem'
      }}>
        {/* New Meeting */}
        <div 
          onClick={() => { if (!instantPasscode) setInstantPasscode(generateMeetingPasscode()); setShowInstantModal(true); }}
          className="glass-panel" 
          style={{
            padding: '0.9rem 1rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '0.75rem',
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
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              flexShrink: 0,
              backgroundColor: 'rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Video size={20} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ color: 'white', fontSize: '1rem', margin: 0, fontFamily: 'var(--font-heading)' }}>{t('dash.newMeeting')}</h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', margin: 0 }}>{t('dash.start_now')}</p>
          </div>
        </div>

        {/* Join Meeting */}
        <div 
          onClick={() => setShowJoinModal(true)}
          className="glass-panel" 
          style={{
            padding: '0.9rem 1rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '0.75rem'
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
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              flexShrink: 0,
              backgroundColor: 'rgba(112, 130, 190, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <UserPlus size={20} color="var(--color-primary)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: 0, fontFamily: 'var(--font-heading)' }}>{t('dash.joinMeeting')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>{t('dash.enter_a_code_or_link')}</p>
          </div>
        </div>

        {/* Schedule Meeting */}
        <div 
          onClick={() => { if (!schedulePasscode) setSchedulePasscode(generateMeetingPasscode()); setShowScheduleModal(true); }}
          className="glass-panel" 
          style={{
            padding: '0.9rem 1rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '0.75rem'
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
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              flexShrink: 0,
              backgroundColor: 'rgba(250, 189, 2, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Calendar size={20} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: 0, fontFamily: 'var(--font-heading)' }}>{t('schedule.title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>{t('dash.pick_a_time')}</p>
          </div>
        </div>
      </div>


      {/* Welcome Banner, animated in code: laptop opens, a meeting plays on
          its screen, it closes, then the GiinMeet lockup displays, After Effects
          style, looping every 10s. Text stays exactly as it was (static,
          white, name gold). No video file: the video budget is exhausted,
          so this motion is pure CSS built live in the banner. */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '16px', marginBottom: '1.5rem', minHeight: '120px', display: 'flex', alignItems: 'center', boxShadow: '0 12px 30px rgba(0,0,0,0.35)', background: 'linear-gradient(115deg, #020617 0%, #001a4c 55%, #0a2a6b 100%)' }}>
        {/* Static fallback image, only shown when the user prefers reduced motion. */}
        <img className="welcome-banner-static-fallback" src="/welcome-banner-bg.webp" alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'none' }} />
        {/* Animated scene (decorative, aria-hidden) */}
        <div className="bl-anim" aria-hidden="true">
          <div className="bl-orb bl-orb-gold" />
          <div className="bl-orb bl-orb-white" />
          <div className="bl-orb bl-orb-blue" />
          <div className="bl-streak bl-streak-a" />
          <div className="bl-streak bl-streak-b" />
          <span className="bl-bokeh bl-bokeh-a" />
          <span className="bl-bokeh bl-bokeh-b" />
          <span className="bl-bokeh bl-bokeh-c" />
          <div className="bl-scene">
            <div className="bl-laptop">
              <div className="bl-screen">
                <div className="bl-screen-face">
                  <div className="bl-tile bl-tile-a"><span className="bl-person" /></div>
                  <div className="bl-tile bl-tile-b"><span className="bl-person" /></div>
                  <div className="bl-tile bl-tile-c"><span className="bl-person" /></div>
                  <div className="bl-tile bl-tile-d"><span className="bl-person" /><span className="bl-speaking" /></div>
                </div>
              </div>
              <div className="bl-base" />
            </div>
            <div className="bl-share">
              <div className="bl-share-head">{t('dash.real_time_screen_share')}</div>
              <div className="bl-share-body">
                <div className="bl-bars"><i /><i /><i /><i /><i /></div>
                <div className="bl-donut" />
              </div>
            </div>
            <div className="bl-controls"><span className="bl-ctl" /><span className="bl-ctl" /><span className="bl-ctl" /><span className="bl-ctl bl-ctl-end" /></div>
            <div className="bl-logo">
              <div className="bl-logo-panel">
                <img src={getLocalLogoUrl()} alt="" />
                <div className="bl-logo-name">{getLocalBrandName()}</div>
                <div className="bl-logo-tag">{getLocalBrandSlogan()}</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(2,6,23,0.60) 0%, rgba(2,6,23,0.38) 55%, rgba(2,6,23,0.15) 100%)' }} />
        <div style={{ position: 'relative', zIndex: 2, padding: '1.25rem 1.5rem' }}>
          <h1 className="welcome-heading" style={{ color: 'white' }}>
            {t('dash.welcome_back')} <span style={{ color: 'var(--color-accent)' }}>{userName}</span>
          </h1>
          <p className="welcome-subtext" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {t('dash.hd_audio_and_video')}
          </p>
          {/* Phase C1 (32), install GiinMeet on the home screen. Only
              shown when it can actually be installed, and hidden once it is. */}
          {!isStandalone && installPrompt && (
            <button
              type="button"
              onClick={() => void handleInstallApp()}
              style={{ marginTop: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1rem', borderRadius: '999px', border: '1px solid rgba(255,255,255,0.5)', backgroundColor: 'rgba(255,255,255,0.12)', color: 'white', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
            >
              <Download size={15} /> {t('dash.install_giinmeet_app')}
            </button>
          )}
          {!isStandalone && !installPrompt && isIos && (
            <p style={{ margin: '0.9rem 0 0', fontSize: '0.8rem', color: 'rgba(255,255,255,0.75)' }}>
              {t('dash.on_iphone_tap_share_then')}
            </p>
          )}
        </div>
      </div>

      {/* Phase 1, Your personal room: one permanent link. */}
      <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Link2 size={18} color="var(--color-accent)" />
          <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>{t('dash.personalRoom')}</h3>
        </div>
        {personalRoomLoading ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('dash.loading_your_room')}</p>
        ) : personalRoom ? (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('dash.personalRoomHint')}</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <code style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0 }}>{buildShortPersonalRoomLink(personalRoom.slug)}</code>
              <button className="premium-btn premium-btn-secondary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }} onClick={handleCopyPersonalLink}>{copiedPersonalLink ? <><Check size={14} /> {t('common.copied')}</> : <><Copy size={14} /> {t('dash.copy_link')}</>}</button>
              <button className="premium-btn premium-btn-primary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }} onClick={handleStartPersonalRoom}><Video size={14} /> {t('dash.start_room')}</button>
            </div>
            <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.45rem 0.8rem', fontSize: '0.8rem', alignSelf: 'flex-start' }} onClick={() => setShowHandleEditor((v) => !v)}>
              {showHandleEditor ? 'Hide handle' : 'Change handle'}
            </button>
            {showHandleEditor && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('dash.your_handle')}</span>
                <input
                  type="text"
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  maxLength={30}
                  aria-label={t('dash.your_personal_room_handle')}
                  style={{ flex: '0 1 180px', minWidth: 0, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                />
                <button className="premium-btn premium-btn-secondary" style={{ padding: '0.45rem 0.8rem', fontSize: '0.8rem' }} disabled={handleSaving || handleInput.trim().toLowerCase() === personalRoom.slug} onClick={() => void handleSaveHandle()}>
                  {handleSaving ? 'Saving…' : 'Save handle'}
                </button>
                {handleNote && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{handleNote}</span>}
              </div>
            )}
            {showHandleEditor && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                {t('dash.letters_numbers_and_hyphens_3')}
              </p>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('dash.one_permanent_link_for_your')}</p>
            <div>
              <button className="premium-btn premium-btn-primary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }} onClick={handleCreatePersonalRoom} disabled={personalRoomCreating}>{personalRoomCreating ? 'Creating…' : 'Create my room'}</button>
            </div>
            {personalRoomUnavailable && (
              <p style={{ fontSize: '0.8rem', color: '#F59E0B' }}>{t('dash.personal_rooms_need_the_phase')}</p>
            )}
          </>
        )}
      </div>

      {/* Main Content Split: History & Upgrade Promo */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '2rem'
      }} className="grid-2">
        {/* Left Side: Meeting History */}
        <div id="meeting-history" className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="flex-between">
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)' }}>{t('dash.recentMeetings')}</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{historyTopLevelCount === historyWithLocal.length ? t('dash.total_meetings', { v1: historyWithLocal.length }) : t('dash.entries_total_meetings', { v1: historyTopLevelCount, v2: historyWithLocal.length })}</span>
            <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => onNavigate('schedule')}>{t('dash.see_all_meetings')}</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.5rem' }}>
            {historyEntries.map((entry) => {
              if (entry.kind === 'groupbar') {
                const label = entry.rule === 'daily' ? 'Daily' : entry.rule === 'weekly' ? 'Weekly' : 'Monthly';
                return (
                  <div key={entry.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>🔁 {entry.title}, {label} series · {entry.size} meetings</span>
                    <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button onClick={() => setExpandedSeries((prev) => ({ ...prev, [`series:${entry.seriesId}`]: false }))} className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px' }} title={t('dash.collapse_this_series_back_to')}>{t('dash.hide')}</button>
                      <button onClick={() => onCancelSeries?.(entry.seriesId, entry.title)} className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444' }} title={t('dash.cancel_every_upcoming_meeting_in')}>{t('dash.cancel_series')}</button>
                    </span>
                  </div>
                );
              }
              const meeting = entry.meeting;
              const isRepresentative = entry.kind === 'representative';
              const isFirstOccurrence = entry.kind === 'occurrence' && entry.groupIndex === 0;
              const repLabel = entry.kind === 'representative' ? (entry.rule === 'daily' ? 'Daily' : entry.rule === 'weekly' ? 'Weekly' : 'Monthly') : '';
              const repSize = entry.kind === 'representative' ? entry.size : 0;
              const repSeriesId = entry.kind === 'representative' ? entry.seriesId : '';
              return (
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
                    {meeting.team_id && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-accent)', margin: '0.15rem 0 0', fontWeight: 600 }}>
                        👥 Team{meeting.team_name ? `: ${meeting.team_name}` : ''}
                      </p>
                    )}
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {(() => {
                        try {
                          return new Date(meeting.time).toLocaleString();
                        } catch (e) {
                          return meeting.time;
                        }
                      })()} &bull; {meeting.duration}
                    </p>
                    {isRepresentative && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span>🔁 {repLabel} series · {repSize} meetings, this row is the next one</span>
                        <button onClick={() => setExpandedSeries((prev) => ({ ...prev, [`series:${repSeriesId}`]: true }))} className="premium-btn premium-btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px' }} title={t('dash.show_every_meeting_in_this')}>Show all {repSize} ▾</button>
                      </p>
                    )}
                    {meeting.status !== 'Completed' && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span>{linkExpiryLabel(meeting)}</span>
                        {(() => {
                          // Phase 1, reminder, from the row when present, else
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
                          // Phase 1, series badge (e.g. "🔁 Weekly • 2 of 5").
                          // Hidden on the collapsed series row: its summary
                          // line already says how many meetings the series has.
                          const info = seriesInfoFor(meeting);
                          if (!info) return null;
                          if (isRepresentative) return null;
                          const label = info.rule === 'daily' ? 'Daily' : info.rule === 'weekly' ? 'Weekly' : 'Monthly';
                          return <span>🔁 {label} • {info.position} of {info.total}</span>;
                        })()}
                        <select
                          value={linkExpiryMode(meeting)}
                          onChange={(e) => handleLinkExpiryChange(meeting, e.target.value)}
                          title={t('dash.change_when_this_meeting_link')}
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
                          downloadICS(full, getLocalBrandName());
                        }}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title={t('dash.download_a_calendar_file_ics')}
                      >
                        <Calendar size={14} />
                        <span>.ics</span>
                      </button>
                      <button
                        onClick={async () => {
                          const full = await withHostPasscode(meeting);
                          window.open(buildGoogleCalendarUrl(full, getLocalBrandName()), '_blank', 'noopener,noreferrer');
                        }}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title={t('dash.add_this_meeting_to_google')}
                      >
                        <Calendar size={14} />
                        <span>Google</span>
                      </button>
                      <button
                        onClick={() => openInviteModal(meeting)}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title={t('dash.invite_someone_by_email_or')}
                      >
                        <UserPlus size={14} />
                        <span>{t('dash.invite')}</span>
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
                        title={t('dash.copy_join_link')}
                      >
                        {copiedHistoryId === meeting.id ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedHistoryId === meeting.id ? 'Copied' : 'Copy Link'}</span>
                      </button>
                      <button 
                        onClick={() => onStartMeeting(meeting.title, undefined, true, meeting.id)}
                        className="premium-btn premium-btn-primary" 
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                      >
                        {t('dash.start_call')}
                      </button>
                      <button
                        onClick={() => onCancelMeeting?.(meeting.id, meeting.title)}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444' }}
                        title={t('dash.cancel_this_scheduled_meeting')}
                      >
                        {t('common.cancel')}
                      </button>
                      {(() => {
                        // Phase 1, cancel the whole series from one button.
                        // Shown once per series: on the collapsed row, or on
                        // the first occurrence when the series is expanded.
                        const info = seriesInfoFor(meeting);
                        if (!info) return null;
                        if (!isRepresentative && !isFirstOccurrence) return null;
                        return (
                          <button
                            onClick={() => onCancelSeries?.(info.seriesId, meeting.title)}
                            className="premium-btn premium-btn-secondary"
                            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444' }}
                            title={t('dash.cancel_every_upcoming_meeting_in')}
                          >
                            {t('dash.cancel_series')}
                          </button>
                        );
                      })()}
                      {isDeletableFromHistory(meeting) && (
                        <button
                          onClick={() => onDeleteMeeting?.(meeting.id, meeting.title)}
                          className="premium-btn premium-btn-secondary"
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title={t('dash.delete_this_expired_meeting_from')}
                        >
                          <Trash2 size={14} />
                          <span>{t('dash.delete')}</span>
                        </button>
                      )}
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
                        title={t('dash.who_joined_when_and_how')}
                      >
                        {t('dash.attendance')}
                      </button>
                      <button
                        onClick={() => {
                          const next = recordMeetingId === meeting.id ? null : meeting.id;
                          setRecordMeetingId(next);
                          if (next) void loadMeetingRecord(meeting.id);
                        }}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px' }}
                        title={t('dash.saved_transcript_and_ai_summary')}
                      >
                        {t('dash.record')}
                      </button>
                      <button
                        onClick={() => onDeleteMeeting?.(meeting.id, meeting.title)}
                        className="premium-btn premium-btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', color: '#EF4444', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title={t('dash.delete_this_meeting_from_your')}
                      >
                        <Trash2 size={14} />
                        <span>{t('dash.delete')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {attendanceMeetingId === meeting.id && (
                <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Attendance, {meeting.title}</h4>
                  {(() => {
                    try {
                      const raw = localStorage.getItem(`giin_attendance_${meeting.id}`);
                      if (!raw) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.no_attendance_was_recorded_for')}</p>;
                      const map = JSON.parse(raw);
                      const rows = Object.values(map) as { name: string; joinedAt: number; leftAt: number | null }[];
                      if (rows.length === 0) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.no_attendance_was_recorded_for')}</p>;
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
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('dash.recorded_in_this_browser_during')}</span>
                          <button
                            type="button"
                            className="premium-btn premium-btn-secondary"
                            style={{ alignSelf: 'flex-start', padding: '0.35rem 0.75rem', fontSize: '0.75rem', marginTop: '0.25rem' }}
                            onClick={() => downloadAttendanceCsv(meeting, rows)}
                          >
                            {t('dash.download_csv')}
                          </button>
                        </div>
                      );
                    } catch (e) {
                      return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.attendance_could_not_be_read')}</p>;
                    }
                  })()}
                </div>
              )}
              {recordMeetingId === meeting.id && (
                <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Transcript & Summary, {meeting.title}</h4>
                  {(() => {
                    const rec = meetingRecords[meeting.id];
                    if (!rec || rec.loading) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.loading_the_meeting_record')}</p>;
                    if (rec.note && !rec.transcript && !rec.summary) return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{rec.note}</p>;
                    const lines = rec.transcript?.lines || [];
                    const summary = rec.summary;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {summary ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{t('dash.ai_summary')}</span>
                            <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>{summary.summary}</p>
                            {summary.decisions?.length > 0 && (
                              <div>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{t('dash.decisions')}</span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.25rem' }}>
                                  {summary.decisions.map((d: string, i: number) => (
                                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.8rem', lineHeight: 1.45 }}>
                                      <span style={{ flexShrink: 0, width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', color: 'black', fontSize: '0.6rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px' }}>✓</span>
                                      <span>{d}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Phase C1 (35), tracked action items: open until marked done. */}
                            <ActionItemsPanel meetingId={meeting.id} fallbackItems={summary.actionItems} />
                          </div>
                        ) : (
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                            No summary yet{lines.length === 0 ? ', there is no saved transcript for this meeting (captions were off or the meeting ended before transcripts were saved).' : ', the summary provider key is not configured, or generation has not run.'}
                          </p>
                        )}
                        {rec.note && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{rec.note}</p>}
                        <button type="button" className="premium-btn premium-btn-secondary" style={{ alignSelf: 'flex-start', padding: '0.35rem 0.75rem', fontSize: '0.75rem' }} onClick={() => void regenerateSummary(meeting.id)}>
                          {summary ? 'Regenerate summary' : 'Generate summary'}
                        </button>
                        {/* Phase C1 (29), post-meeting follow-up: summary, decisions
                            and action items by email. Also sent automatically when
                            the host ends the meeting. */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={followUpEmails}
                            onChange={(e) => setFollowUpEmails(e.target.value)}
                            placeholder={t('dash.extra_email_addresses_optional_comma')}
                            style={{ flex: '1 1 220px', minWidth: 0, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
                          />
                          <button
                            type="button"
                            className="premium-btn premium-btn-primary"
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                            disabled={followUpSending === meeting.id || !summary}
                            title={summary ? 'Email the summary, decisions and action items to the attendees' : 'Generate the summary first'}
                            onClick={() => void sendFollowUp(meeting.id)}
                          >
                            {followUpSending === meeting.id ? 'Sending…' : 'Send follow-up email'}
                          </button>
                        </div>
                        {followUpStatus[meeting.id] && (
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{followUpStatus[meeting.id]}</p>
                        )}
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>TRANSCRIPT ({lines.length} lines)</span>
                        {lines.length === 0 ? (
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.no_transcript_was_saved_for')}</p>
                        ) : (
                          <div className="scroll-refined" style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {lines.map((l: any, i: number) => (
                              <div key={i} style={{ fontSize: '0.8rem', lineHeight: 1.4, borderLeft: '2px solid var(--color-accent)', paddingLeft: '0.6rem' }}>
                                <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{l.name}</span>{' '}
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{l.time}</span>
                                <div>{l.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Phase C1 (28), notes and recordings/files for this meeting. */}
                        <MeetingRecordExtras meetingId={meeting.id} />
                        {/* Phase C1 (34), attendance and engagement insights. */}
                        <MeetingInsights meetingId={meeting.id} />
                        {/* Phase C2a (5), attendance certificates for this meeting. */}
                        <CertificatesPanel meetingId={meeting.id} meetingTitle={meeting.title} meetingDate={meeting.time} />
                        {/* Phase C2a (7), download the summary and notes as PDF or Word. */}
                        <NotesExport meetingId={meeting.id} meetingTitle={meeting.title} meetingDate={meeting.time} />
                        {/* Phase C2a (1 + 2), short link and QR code for this meeting. */}
                        <ShortLinkBox meetingId={meeting.id} />
                      </div>
                    );
                  })()}
                </div>
              )}
              </React.Fragment>
              );
            })}
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
                  {t('dash.go_pro')}
                </span>
                <h3 style={{ color: 'white', fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.75rem', fontFamily: 'var(--font-heading)' }}>
                  {t('dash.upgrade_to_pro_tiers')}
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.4, marginBottom: '1.5rem' }}>
                  {t('dash.longer_meetings_more_people_and')}
                </p>
                
                <ul style={{ color: 'white', fontSize: '0.85rem', paddingLeft: '1.25rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>{t('dash.meetings_up_to_24_hours')}</li>
                  <li>{t('dash.up_to_100_people_per')}</li>
                  <li>{t('dash.your_logo_and_colours')}</li>
                  <li>{t('dash.priority_support')}</li>
                </ul>
              </div>

              <button 
                onClick={() => onNavigate('billing')}
                className="premium-btn premium-btn-accent" 
                style={{ width: '100%', justifyContent: 'space-between', padding: '0.85rem 1.25rem', zIndex: 1 }}
              >
                <span>{t('dash.upgrade_for_9_99_mo')}</span>
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
                  <span className="badge badge-premium">{t('dash.pro_member')}</span>
                </div>
                <h3 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.75rem' }}>
                  {t('dash.you_are_a_giin_meet')}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                  {t('dash.thank_you_for_subscribing_your')}
                </p>
              </div>

              <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
                <div className="flex-between" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('dash.status')}</span>
                  <span style={{ fontWeight: 600, color: '#10B981' }}>{t('dash.active')}</span>
                </div>
                <div className="flex-between" style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('dash.next_billing_date')}</span>
                  <span>July 21, 2026</span>
                </div>
                
                <button 
                  onClick={() => onNavigate('billing')}
                  className="premium-btn premium-btn-secondary" 
                  style={{ width: '100%' }}
                >
                  {t('dash.manage_subscription')}
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
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowScheduleModal(false); }}>
          <div className="glass-panel" style={{
            width: '450px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)',
            maxHeight: '90dvh',
            overflowY: 'auto'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>{t('dash.schedule_a_meeting')}</h3>
            
            <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Round 9 (9D): one-click templates. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('dash.start_from_a_template')}</span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyScheduleTemplate('standup')}>{t('dash.team_standup')}</button>
                  <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyScheduleTemplate('client')}>{t('dash.client_call')}</button>
                  <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyScheduleTemplate('interview')}>{t('dash.interview')}</button>
                </div>
              </div>
              {/* Phase C1 (35), carry open action items from earlier
                  meetings into this one. Only the host's own open items. */}
              {openActionItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('dash.bring_open_action_items_into')}</span>
                  {openActionItems.map((item: any) => (
                    <label key={item.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem', lineHeight: 1.45, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!carrySelected[item.id]} onChange={() => toggleCarryItem(item.id)} style={{ marginTop: '3px', flexShrink: 0 }} />
                      <span style={{ minWidth: 0 }}>
                        {item.text}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> ({item.meetingTitle})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {/* Round 9 (9C): link expiry, a duration counts from the meeting date. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('dash.meeting_link_expires')}</label>
                <select value={scheduleLinkExpiry} onChange={(e) => setScheduleLinkExpiry(e.target.value)} className="premium-input" style={{ height: '44px' }}>
                  {LINK_EXPIRY_OPTIONS.map((o) => (
                    <option key={o.mode} value={o.mode}>{o.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.a_duration_counts_from_the')}</span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('dash.meeting_title')}</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder={t('dash.e_g_weekly_operations_sync')}
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('dash.date_time')}</label>
                <input 
                  type="datetime-local" 
                  className="premium-input" 
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  required
                />
              </div>
              {/* Phase C1 (33), smart scheduling assistant: find a time
                  that works, from stated hours and connected calendars. */}
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ alignSelf: 'flex-start', padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
                onClick={() => setShowSchedulingAssistant(true)}
              >
                <Clock size={15} style={{ marginRight: '0.4rem', verticalAlign: '-2px' }} /> {t('dash.find_a_time_that_works')}
              </button>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('dash.duration')}</label>
                <select value={templateDuration} onChange={(e) => setTemplateDuration(e.target.value)} className="premium-input" style={{ height: '44px' }}>
                  {durationOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Longest meeting on your {TIER_LABELS[planTier]} plan: {durationOptions[durationOptions.length - 1]?.label || '40 minutes'}. The room never ends a meeting at this length, it is the length you plan for.</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('dash.repeat')}</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select
                    className="premium-input"
                    value={scheduleRecurrence}
                    onChange={(e) => setScheduleRecurrence(e.target.value as 'none' | 'daily' | 'weekly' | 'monthly')}
                    style={{ flex: 1 }}
                  >
                    <option value="none">{t('dash.does_not_repeat')}</option>
                    <option value="daily">{t('dash.daily')}</option>
                    <option value="weekly">{t('dash.weekly')}</option>
                    <option value="monthly">{t('dash.monthly')}</option>
                  </select>
                </div>
                {scheduleRecurrence !== 'none' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="radio" checked={scheduleEndMode === 'count'} onChange={() => setScheduleEndMode('count')} />
                      {t('dash.after')}
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      className="premium-input"
                      value={scheduleRecurrenceCount}
                      disabled={scheduleEndMode !== 'count'}
                      onChange={(e) => setScheduleRecurrenceCount(parseInt(e.target.value) || 4)}
                      title={t('dash.number_of_occurrences')}
                      style={{ width: '70px', textAlign: 'center' }}
                    />
                    <span style={{ fontSize: '0.85rem' }}>meetings</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input type="radio" checked={scheduleEndMode === 'date'} onChange={() => setScheduleEndMode('date')} />
                      {t('dash.ends_on')}
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

              {/* Phase 1, meeting reminder (emailed to the host). */}
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={scheduleReminderEnabled}
                    onChange={(e) => setScheduleReminderEnabled(e.target.checked)}
                  />
                  {t('dash.email_me_a_reminder_before')}
                </label>
                {scheduleReminderEnabled && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                    <select
                      className="premium-input"
                      value={scheduleReminderMinutes}
                      onChange={(e) => setScheduleReminderMinutes(parseInt(e.target.value, 10) || 15)}
                      style={{ height: '44px', flex: 1 }}
                    >
                      <option value={5}>{t('dash.5_minutes_before')}</option>
                      <option value={15}>{t('dash.15_minutes_before')}</option>
                      <option value={30}>{t('dash.30_minutes_before')}</option>
                      <option value={60}>{t('dash.1_hour_before')}</option>
                    </select>
                  </div>
                )}
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  {t('dash.the_reminder_goes_to_your')}
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.security_admission')}</label>
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
                      <strong style={{ display: 'block' }}>{t('dash.host_admission_waiting_room')}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.participants_must_wait_to_be')}</span>
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
                      <strong style={{ display: 'block' }}>{t('dash.bypass_waiting_room_auto_join')}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.anyone_with_the_meeting_link')}</span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.meeting_passcode')}</label>
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
                    <strong style={{ display: 'block' }}>{t('dash.require_a_passcode_to_join')}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.guests_enter_this_code_before')}</span>
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
                      title={t('dash.generate_a_new_passcode')}
                      style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <RefreshCw size={14} />
                      <span>{t('dash.new_code')}</span>
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.end_to_end_encryption')}</label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: schedulePasscodeEnabled ? 'pointer' : 'default', color: 'white', opacity: schedulePasscodeEnabled ? 1 : 0.55 }}>
                  <input
                    type="checkbox"
                    checked={scheduleE2ee && schedulePasscodeEnabled}
                    disabled={!schedulePasscodeEnabled}
                    onChange={(e) => setScheduleE2ee(e.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <strong style={{ display: 'block' }}>{t('dash.encrypt_audio_and_video_end')}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {t('dash.audio_and_video_are_encrypted')}
                    </span>
                  </div>
                </label>
                {!schedulePasscodeEnabled && (
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#F59E0B', marginTop: '0.4rem' }}>{t('dash.turn_the_passcode_on_above')}</span>
                )}
              </div>

              {myOrganisations.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.organisation_brand')}</label>
                  <select
                    className="premium-input"
                    value={scheduleOrganisationId}
                    onChange={(e) => setScheduleOrganisationId(e.target.value)}
                    style={{ height: '44px', width: '100%' }}
                  >
                    <option value="">{t('dash.giinmeet_branding')}</option>
                    {myOrganisations.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    {t('dash.the_waiting_room_and_invites')}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => setShowScheduleModal(false)}
                >
                  {t('common.cancel')}
                </button>
                <button type="submit" className="premium-btn premium-btn-primary">
                  {t('schedule.title')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phase C1 (33), smart scheduling assistant, opened from the
          Schedule modal. Picking a slot fills the schedule form above. */}
      {showSchedulingAssistant && (
        <SchedulingAssistant
          initialTitle={meetingTitle}
          initialDurationMinutes={parseDurationMinutes(templateDuration)}
          onUseSlot={handleUseSuggestedSlot}
          onClose={() => setShowSchedulingAssistant(false)}
        />
      )}

      {/* Invite Modal, by email or from workspace contacts. The invite
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
                  const subject = encodeURIComponent(t('dash.invite_subject', { v1: full.title, v2: getLocalBrandName() }));
                  const body = encodeURIComponent(t('dash.please_join_my_video_meeting', { v1: getLocalBrandName(), v2: full.title, v3: new Date(full.time).toLocaleString(), v4: link, v5: full.id, v6: full.passcode || 'none - open link' }));
                  window.location.href = `mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`;
                  setInviteNote(t('dash.your_mail_app_opened_with', { v1: getLocalBrandName() }));
                }}
              >
                {t('dash.email_invite')}
              </button>
            </div>
            {inviteContacts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{t('dash.or_pick_a_workspace_contact')}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {inviteContacts.map((c: any) => (
                    <button
                      key={c.id}
                      type="button"
                      className="premium-btn premium-btn-secondary"
                      style={{ justifyContent: 'flex-start', fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                      onClick={() => {
                        if (c.email) setInviteEmail(c.email);
                        else setInviteNote(t('dash.has_no_email_on_their', { v1: c.name || 'This contact' }));
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
                setInviteNote('Invite link copied, paste it anywhere (WhatsApp, chat, email).');
              }}
            >
              <Copy size={14} /> {t('dash.copy_invite_link')}
            </button>
            {/* Phase 2 (#2), WhatsApp + SMS invites. WhatsApp is a wa.me
                share link and works now with no provider. SMS goes through
                Twilio on the server; until Suku connects a Twilio account
                the SMS button stays off and says so, nothing is ever
                pretended sent. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{t('dash.invite_by_whatsapp_or_sms')}</span>
              <input
                type="tel"
                className="premium-input"
                placeholder={t('dash.phone_with_country_code_e')}
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
                    window.open(buildWhatsAppInviteUrl(full, link, invitePhone, getLocalBrandName()), '_blank', 'noopener,noreferrer');
                    setInviteNote('WhatsApp opened with the invitation ready to send.');
                  }}
                >
                  {t('dash.whatsapp_invite')}
                </button>
                <button
                  className="premium-btn premium-btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={smsConfigured !== true || smsSending}
                  title={smsConfigured === false ? 'SMS needs a Twilio account, see docs/phase2-setup.md' : undefined}
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
                        setSmsNote(t('dash.sms_invite_sent_to', { v1: phone }));
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
                  ? 'SMS is not connected yet, it needs a Twilio account (see docs/phase2-setup.md). WhatsApp works now, no account needed.'
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
                {t('dash.cancel_this_meeting')}
              </button>
            )}
            <button
              className="premium-btn premium-btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setInviteMeeting(null)}
            >
              {t('agenda.timerDone')}
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
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>{t('dash.join_a_meeting')}</h3>
            
            <form onSubmit={handleJoinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('dash.meeting_code_or_link')}</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder={t('dash.paste_the_full_invite_link')}
                  value={meetingCode}
                  onChange={(e) => {
                    setMeetingCode(e.target.value);
                    setJoinError('');
                  }}
                  required
                />
                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  {t('dash.paste_the_invite_link_from')}
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
                  {t('common.cancel')}
                </button>
                <button type="submit" className="premium-btn premium-btn-accent">
                  {t('dash.joinMeeting')}
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
                {t('dash.meeting_scheduled_successfully')}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                Your professional {getLocalBrandName()} room is ready.
                {seriesCreated > 1 && t('dash.this_is_a_recurring_series', { v1: seriesCreated })}
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
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{t('dash.topic')}</span>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>{scheduledMeetingDetails.title}</div>
              </div>

              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{t('dash.time')}</span>
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
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{t('dash.meeting_id')}</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-secondary)' }}>
                    {scheduledMeetingDetails.id}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{t('dash.passcode')}</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                    {scheduledMeetingDetails.passcode || 'No passcode'}
                  </div>
                </div>
              </div>
            </div>

            {/* Sharing Link Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{t('dash.meeting_join_link')}</label>
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
                  <span>{copiedSuccessId === 'link' ? 'Copied' : copyFailedId === 'link' ? 'Copy failed, tap to retry' : 'Copy'}</span>
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
                const invitation = t('dash.please_join_my_video_conference', { v1: getLocalBrandName(), v2: scheduledMeetingDetails.title, v3: timeStr, v4: link, v5: scheduledMeetingDetails.id, v6: scheduledMeetingDetails.passcode || 'none - open link' });
                void copyTextHonest('details', invitation);
              }}
              className={`premium-btn ${copiedSuccessId === 'details' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              {copiedSuccessId === 'details' ? <Check size={16} /> : copyFailedId === 'details' ? <AlertCircle size={16} /> : <Copy size={16} />}
              <span>{copiedSuccessId === 'details' ? 'Invitation Copied' : copyFailedId === 'details' ? 'Copy failed, tap to retry' : 'Copy Invitation'}</span>
            </button>

            <button
              onClick={async () => {
                const full = await withHostPasscode(scheduledMeetingDetails);
                downloadICS(full, getLocalBrandName());
              }}
              className="premium-btn premium-btn-secondary"
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              <Calendar size={16} />
              <span>{t('dash.add_to_calendar_ics')}</span>
            </button>
            <button
              onClick={async () => {
                const full = await withHostPasscode(scheduledMeetingDetails);
                window.open(buildGoogleCalendarUrl(full, getLocalBrandName()), '_blank', 'noopener,noreferrer');
              }}
              className="premium-btn premium-btn-secondary"
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              <Calendar size={16} />
              <span>{t('dash.add_to_google_calendar')}</span>
            </button>

            <button
              onClick={() => {
                setShowSuccessModal(false);
                setScheduledMeetingDetails(null);
              }}
              className="premium-btn premium-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', marginTop: '0.5rem' }}
            >
              {t('common.close')}
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
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowInstantModal(false); }}>
          <div className="glass-panel" style={{
            maxWidth: '560px',
            width: 'calc(100% - 2rem)',
            padding: 0,
            maxHeight: '90dvh',
            overflow: 'hidden',
            animation: 'pop-in 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ flexShrink: 0, padding: '1.25rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)', color: 'white' }}>{t('dash.start_a_new_meeting')}</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.configure_your_instant_meeting_preferenc')}</p>
            </div>

            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.meeting_title')}</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  value={instantTitle}
                  onChange={(e) => setInstantTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.security_admission')}</label>
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
                      <strong style={{ display: 'block' }}>{t('dash.host_admission_waiting_room')}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.participants_must_wait_to_be')}</span>
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
                      <strong style={{ display: 'block' }}>{t('dash.bypass_waiting_room_auto_join')}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.anyone_with_the_meeting_link')}</span>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>{t('dash.meeting_passcode')}</label>
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
                    <strong style={{ display: 'block' }}>{t('dash.require_a_passcode_to_join')}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dash.guests_enter_this_code_before')}</span>
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
                      title={t('dash.generate_a_new_passcode')}
                      style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <RefreshCw size={14} />
                      <span>{t('dash.new_code')}</span>
                    </button>
                  </div>
                )}
              </div>

                {/* Round 9 (9D): one-click templates (instant meetings always expire when they end). */}
                <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('dash.start_from_a_template')}</span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyInstantTemplate('standup')}>{t('dash.team_standup')}</button>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyInstantTemplate('client')}>{t('dash.client_call')}</button>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} onClick={() => applyInstantTemplate('interview')}>{t('dash.interview')}</button>
                  </div>
                </div>

              </div>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)' }}>
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                onClick={() => setShowInstantModal(false)}
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  onStartMeeting(instantTitle, undefined, true, undefined, instantRequireWaitingRoom, instantPasscodeEnabled ? instantPasscode : null);
                  setInstantPasscode('');
                  setInstantPasscodeEnabled(true);
                  setShowInstantModal(false);
                }}
                className="premium-btn premium-btn-primary"
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                {t('dash.start_meeting')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
