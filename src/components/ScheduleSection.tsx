import React, { useMemo } from 'react';
import { CalendarDays, RotateCcw, Video } from 'lucide-react';
import { buildJoinLink } from '../supabaseClient';
import { MeetingPrepBrief } from './MeetingPrepBrief';
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
}

export const ScheduleSection: React.FC<Props> = ({ meetings }) => {
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const sorted = [...(meetings || [])].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
    return {
      upcoming: sorted.filter((m) => new Date(m.time).getTime() >= now - 60 * 60 * 1000),
      past: sorted
        .filter((m) => new Date(m.time).getTime() < now - 60 * 60 * 1000)
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
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
                    Only one meeting coming up, shown above with its prep brief.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: '0 0 0.5rem' }}>{t('dash.past')}</h3>
            {past.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{t('dash.noPast')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>{past.slice(0, 20).map((m) => row(m, false))}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
