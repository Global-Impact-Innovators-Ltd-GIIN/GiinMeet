// Phase C1 (33), Smart scheduling assistant.
//
// A calm modal, opened from the Schedule modal: the host states the
// meeting length, the days and hours they are free, and (optionally)
// attendee emails. "Find times" asks the server for up to 5 slots that
// are free on connected calendars and have no clash with the host's own
// GiinMeet meetings. Each slot can fill the schedule form in one tap,
// or the host can send the slots as a poll and let attendees vote.
// Design: one grouped panel, clear headings, no new toolbar buttons;
// the poll link is the only link shown, and it points at giinmeet only.
import React, { useState } from 'react';
import { giinApi } from '../supabaseClient';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SchedulingAssistant({
  initialTitle,
  initialDurationMinutes,
  onUseSlot,
  onClose,
}: {
  initialTitle: string;
  initialDurationMinutes: number;
  onUseSlot: (startIso: string, title: string, durationMinutes: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [duration, setDuration] = useState(initialDurationMinutes || 60);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(plusDaysIso(7));
  const [emails, setEmails] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [slots, setSlots] = useState<any[]>([]);
  const [usedCalendars, setUsedCalendars] = useState<string[]>([]);
  const [poll, setPoll] = useState<any>(null);
  const [pollVotes, setPollVotes] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);

  const toggleDay = (day: number) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const handleSuggest = async () => {
    if (days.length === 0) {
      setStatus(t('assist.pick_at_least_one_day'));
      return;
    }
    setBusy(true);
    setStatus('');
    setSlots([]);
    setPoll(null);
    const availability = days.map((day) => ({ day, start: startTime, end: endTime }));
    const attendeeEmails = emails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const res: any = await giinApi.suggestTimes({
      title,
      durationMinutes: duration,
      dateFrom: `${dateFrom}T00:00:00`,
      dateTo: `${dateTo}T23:59:59`,
      attendeeEmails,
      hostAvailability: availability,
    });
    setBusy(false);
    if (!res?.ok) {
      setStatus(res?.message || res?.reason || 'Could not find times. Try again.');
      return;
    }
    setUsedCalendars(res.usedCalendars || []);
    setSlots(res.slots || []);
    setStatus(
      (res.slots || []).length === 0
        ? 'No free slot in that window. Widen the dates or hours and try again.'
        : '',
    );
  };

  const handleCreatePoll = async () => {
    if (slots.length < 2) return;
    setBusy(true);
    const res: any = await giinApi.createSchedulingPoll({
      title: title || 'GiinMeet meeting',
      durationMinutes: duration,
      slots: slots.map((s) => s.start),
      attendeeEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!res?.ok) {
      setStatus(res?.message || res?.reason || 'Could not create the poll. Try again.');
      return;
    }
    setPoll(res);
    setPollVotes([]);
    setStatus('');
  };

  const handleRefreshVotes = async () => {
    if (!poll?.token) return;
    const res: any = await giinApi.getSchedulingPoll(poll.token);
    if (res?.ok) setPollVotes(res.votes || []);
  };

  const copyPollLink = async () => {
    if (!poll?.link) return;
    try {
      await navigator.clipboard.writeText(poll.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setStatus(t('assist.copy_did_not_work_select'));
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(4px)',
        padding: '1rem',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: '520px',
          maxWidth: '100%',
          backgroundColor: 'var(--bg-card)',
          padding: '1.5rem',
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', fontFamily: 'var(--font-heading)' }}>
          {t('assist.find_a_time_that_works')}
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem', lineHeight: 1.5 }}>
          {t('assist.tell_us_when_you_are')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('assist.meeting_title')}</label>
            <input
              type="text"
              className="premium-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('assist.e_g_weekly_operations_sync')}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('assist.length_minutes')}</label>
              <input
                type="number"
                min={15}
                max={480}
                step={15}
                className="premium-input"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
              />
            </div>
            <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('assist.from')}</label>
              <input type="date" className="premium-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('assist.to_label')}</label>
              <input type="date" className="premium-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('assist.i_am_free_on')}</span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  style={{
                    padding: '0.4rem 0.7rem',
                    borderRadius: '999px',
                    border: days.includes(day) ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
                    backgroundColor: days.includes(day) ? 'rgba(250,189,2,0.15)' : 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '0.85rem' }}>
                From{' '}
                <input type="time" className="premium-input" style={{ width: '110px', padding: '0.4rem 0.5rem' }} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
              <label style={{ fontSize: '0.85rem' }}>
                To{' '}
                <input type="time" className="premium-input" style={{ width: '110px', padding: '0.4rem 0.5rem' }} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('assist.attendee_emails_optional_for_the')}</label>
            <input
              type="text"
              className="premium-input"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder={t('assist.name_example_com_another_example')}
            />
          </div>
          <button
            type="button"
            className="premium-btn premium-btn-primary"
            disabled={busy}
            onClick={() => void handleSuggest()}
          >
            {busy ? 'Looking…' : 'Find times'}
          </button>
          {status && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>{status}</p>}
          {slots.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                Suggested times
                {usedCalendars.length > 0
                  ? t('assist.checked_against', { v1: usedCalendars.map((p) => (p === 'google' ? 'Google Calendar' : 'Outlook')).join(' and ') })
                  : ' (no calendar connected)'}
              </span>
              {slots.map((s) => (
                <div
                  key={s.start}
                  style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', justifyContent: 'space-between', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.7rem 0.85rem', flexWrap: 'wrap' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{fmtSlot(s.start)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45, marginTop: '0.2rem' }}>
                      {(s.reasons || []).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="premium-btn premium-btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', flexShrink: 0 }}
                    onClick={() => onUseSlot(s.start, title, duration)}
                  >
                    {t('assist.use_this_time')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                disabled={busy}
                onClick={() => void handleCreatePoll()}
              >
                {t('assist.ask_attendees_to_vote_on')}
              </button>
            </div>
          )}
          {poll && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.85rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{t('assist.poll_created_share_this_link')}</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input type="text" readOnly value={poll.link} className="premium-input" style={{ flex: '1 1 200px', minWidth: 0, fontSize: '0.8rem' }} />
                <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => void copyPollLink()}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                {t('assist.anyone_with_the_link_can')}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }} onClick={() => void handleRefreshVotes()}>
                  {t('assist.refresh_votes')}
                </button>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {pollVotes.length === 0 ? t('assist.no_votes_yet') : t(pollVotes.length === 1 ? 'assist.one_person_voted' : 'assist.people_voted', { v1: pollVotes.length, v2: pollVotes.map((v: any) => v.voter_name).join(', ') })}
                </span>
              </div>
            </div>
          )}
          <button type="button" className="premium-btn premium-btn-secondary" onClick={onClose}>
            {t('agenda.timerDone')}
          </button>
        </div>
      </div>
    </div>
  );
}
