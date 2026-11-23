import React, { useMemo } from 'react';
import { CalendarDays, RotateCcw, Video } from 'lucide-react';
import { buildJoinLink } from '../supabaseClient';
import { MeetingPrepBrief } from './MeetingPrepBrief';
import { CalendarSyncPanel } from './CalendarSyncPanel';
import { TemplatesPanel, type MeetingTemplate } from './TemplatesPanel';
import { ShortLinkBox } from './ShortLinkBox';
import { t } from '../i18n';

// Phase C2a (10), Schedule side-panel section.
//
// All meetings, past and coming, in one clear view, with one tap to
// join or rejoin. Built on feature 26 (recent meetings, C1) and the
// scheduling features. The next meeting carries its prep brief
// (feature 6) and its short link (feature 1). This is the other part
// of the space the Privacy Vault occupied, under the clean-design rule.
interface HistoryMeeting {
  id: string;
  title: string;
  time: string;
  host: string;
  status: string;
}

interface Props {
  meetings: HistoryMeeting[];
  onNavigate?: (view: string) => void;
  onStartMeeting?: (
    title?: string,
    dmThreadId?: string,
    isVideo?: boolean,
    existingMeetingId?: string,
    requireWaitingRoom?: boolean,
    passcode?: string | null,
  ) => void;
}

export const ScheduleSection: React.FC<Props> = ({ meetings, onNavigate, onStartMeeting }) => {
  // A template picked here opens pre-filled in the dashboard schedule
  // form: the pick is stored, then the dashboard applies it on mount.
  const handleScheduleTemplate = (t: MeetingTemplate) => {
    try {
      localStorage.setItem('giin_pending_template', JSON.stringify(t));
    } catch (e) { /* storage is best effort */ }
    onNavigate?.('dashboard');
  };
  const handleStartTemplate = (t: MeetingTemplate) => {
    onStartMeeting?.(t.title, undefined, true, undefined, t.require_waiting_room, t.passcode ?? null);
  };
  const { upcoming } = useMemo(() => {
    const now = Date.now();
    const sorted = [...(meetings || [])].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
    return {
      upcoming: sorted.filter((m) => new Date(m.time).getTime() >= now - 60 * 60 * 1000),
    };
  }, [meetings]);

  const next = upcoming[0] || null;

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const handleJoin = (id: string) => {
    window.location.hash = `#/join?id=${id}`;
  };

  const row = (m: HistoryMeeting, isNext: boolean) => (
    <div
      key={m.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
        padding: '0.7rem 0',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <span style={{ flex: '1 1 180px', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.title}
        </span>
        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {fmtWhen(m.time)}
          {m.host ? `, Host: ${m.host}` : ''}
          {m.status ? `, ${m.status}` : ''}
        </span>
      </span>
      <button
        type="button"
        className="premium-btn premium-btn-primary"
        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
        onClick={() => handleJoin(m.id)}
      >
        {isNext ? (
          <>
            <Video size={13} /> {t('common.join')}
          </>
        ) : (
          <>
            <RotateCcw size={13} /> {t('common.rejoin')}
          </>
        )}
      </button>
      <button
        type="button"
        className="premium-btn premium-btn-secondary"
        style={{ padding: '0.4rem 0.7rem', fontSize: '0.8rem' }}
        onClick={() => {
          try {
            void navigator.clipboard.writeText(buildJoinLink(m.id));
          } catch (e) {
            // Copy is best effort.
          }
        }}
      >
        {t('common.copy')}
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem 2rem', maxWidth: '960px' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <CalendarDays size={20} color="var(--color-accent)" />
          <h2 style={{ fontSize: '1.35rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('schedule.title')}</h2>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
          {t('schedule.hint')}
        </p>
      </div>

      {meetings.length === 0 ? (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.noMeetings')}</p>
        </div>
      ) : (
        <>
          {next && (
            <>
              <MeetingPrepBrief meetingId={next.id} meetingTitle={next.title} meetingTime={next.time} />
              <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: '0 0 0.5rem' }}>{t('dash.upcoming')}</h3>
                {row(next, true)}
                <div style={{ marginTop: '0.75rem' }}>
                  <ShortLinkBox meetingId={next.id} />
                </div>
              </div>
            </>
          )}

          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: '0 0 0.5rem' }}>{t('dash.coming')}</h3>
            {upcoming.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.noUpcoming')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {upcoming.slice(next ? 1 : 0).map((m) => row(m, false))}
                {upcoming.length === 1 && next && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
                    {t('sched.only_one_meeting_coming_up')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: '0 0 0.5rem' }}>{t('dash.past')}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
              {t('sched.past_meetings_live_with_your')}
            </p>
            <button
              type="button"
              className="premium-btn premium-btn-secondary"
              style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }}
              onClick={() => onNavigate?.('dashboard')}
            >
              {t('sched.see_recent_meetings')}
            </button>
          </div>
        </>
      )}
      {/* Calendar sync and templates live here now, as children of
          Schedule, collapsed so the meeting list stays the focus. */}
      <details style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700, padding: '1rem 1.25rem' }}>{t('sched.calendar_sync')}</summary>
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          <CalendarSyncPanel meetings={meetings} />
        </div>
      </details>
      <details style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700, padding: '1rem 1.25rem' }}>{t('sched.meeting_templates')}</summary>
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          <TemplatesPanel
            currentTitle=""
            currentDurationMinutes={60}
            currentRequireWaitingRoom
            currentPasscode={null}
            onStartTemplate={handleStartTemplate}
            onScheduleTemplate={handleScheduleTemplate}
          />
        </div>
      </details>
    </div>
  );
};