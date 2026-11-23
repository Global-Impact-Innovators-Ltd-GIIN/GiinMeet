import React, { useEffect, useState } from 'react';
import { ClipboardList, Users, ListChecks, RotateCcw } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

// Phase C2a (6), meeting prep brief.
//
// Before a meeting starts, the host gets a one-page brief: the agenda
// (from the saved agenda, feature 4), who is coming (people who joined
// the last meeting in the series, plus the host), and the open action
// items from the last meeting (feature 35). Shown on the dashboard
// before the meeting and in the Schedule section.
//
// Every section has its own honest empty state, so a meeting with no
// agenda yet never looks broken, it looks like a brief waiting for an
// agenda.
interface Props {
  meetingId: string;
  meetingTitle: string;
  meetingTime?: string;
}

interface AgendaItem {
  id: string;
  text: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
}

export const MeetingPrepBrief: React.FC<Props> = ({ meetingId, meetingTitle, meetingTime }) => {
  const [agenda, setAgenda] = useState<AgendaItem[] | null>(null);
  const [attendees, setAttendees] = useState<string[] | null>(null);
  const [openItems, setOpenItems] = useState<any[] | null>(null);
  const [lastMeetingTitle, setLastMeetingTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [agendaRes, openRes] = await Promise.all([
        giinApi.getAgenda(meetingId),
        giinApi.getOpenActionItems(),
      ]);
      // Agenda for this meeting. A missing agenda column is not an
      // error here, it just means no agenda was saved yet.
      if (agendaRes?.ok) setAgenda(agendaRes.items || []);
      else setAgenda([]);
      // Open items: keep the ones from the most recent past meeting,
      // so the brief shows what is still open from the last meeting,
      // not every open item the host has ever had.
      const items: any[] = openRes?.ok ? openRes.items || [] : [];
      const past = items.filter((it: any) => {
        if (it.meeting_id === meetingId) return false;
        if (!meetingTime) return true;
        return it.meetingTime ? new Date(it.meetingTime).getTime() < new Date(meetingTime).getTime() : true;
      });
      const byMeeting = new Map<string, any[]>();
      past.forEach((it: any) => {
        const list = byMeeting.get(it.meeting_id) || [];
        list.push(it);
        byMeeting.set(it.meeting_id, list);
      });
      let chosen: any[] = [];
      let chosenTitle = '';
      let chosenMeetingId = '';
      past.forEach((it: any) => {
        if (!chosenMeetingId) {
          chosenMeetingId = it.meeting_id;
          chosenTitle = it.meetingTitle || '';
        }
      });
      if (chosenMeetingId) {
        chosen = byMeeting.get(chosenMeetingId) || [];
        setLastMeetingTitle(chosenTitle);
        // Who is coming: the people who attended that last meeting.
        const att: any = await giinApi.getCertificateAttendees(chosenMeetingId);
        if (att?.ok) setAttendees((att.attendees || []).map((a: any) => a.name));
        else setAttendees([]);
      } else {
        setAttendees([]);
      }
      setOpenItems(chosen.slice(0, 5));
    } catch (e) {
      setError(t('brief.unavailable'));
      setAgenda([]);
      setAttendees([]);
      setOpenItems([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const when = meetingTime
    ? new Date(meetingTime).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <ClipboardList size={18} color="var(--color-accent)" />
        <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('brief.title')}</h3>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {meetingTitle}
          {when ? `, ${when}` : ''}
        </span>
      </div>
      {loading && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>{t('brief.loading')}</p>}
      {error && (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }} onClick={() => void load()}>
            <RotateCcw size={13} /> {t('common.retry')}
          </button>
        </div>
      )}
      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{t('brief.agenda').toUpperCase()}</span>
            {!agenda || agenda.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.35rem 0 0', lineHeight: 1.5 }}>{t('brief.noAgenda')}</p>
            ) : (
              <ol style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {agenda.map((item) => (
                  <li key={item.id} style={{ fontSize: '0.85rem', lineHeight: 1.45 }}>
                    {item.text}
                    {item.startTime && item.endTime ? ` (${item.startTime} to ${item.endTime})` : ''}
                    {!item.startTime && item.durationMinutes ? t('brief.duration_minutes', { v1: item.durationMinutes }) : ''}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{t('brief.coming').toUpperCase()}</span>
            {!attendees || attendees.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.35rem 0 0', lineHeight: 1.5 }}>{t('brief.noAttendees')}</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem' }}>
                <Users size={14} color="var(--text-muted)" style={{ marginTop: '2px' }} />
                {attendees.map((name) => (
                  <span key={name} style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', borderRadius: '999px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              {t('brief.openItems').toUpperCase()}
              {lastMeetingTitle ? `, ${lastMeetingTitle}` : ''}
            </span>
            {!openItems || openItems.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.35rem 0 0', lineHeight: 1.5 }}>{t('brief.noOpenItems')}</p>
            ) : (
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {openItems.map((it: any) => (
                  <li key={it.id} style={{ fontSize: '0.85rem', lineHeight: 1.45 }}>
                    {it.text}
                    {it.owner && it.owner !== 'Unassigned' ? `, ${it.owner}` : ''}
                  </li>
                ))}
              </ul>
            )}
            {openItems && openItems.length > 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.5rem 0 0', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <ListChecks size={13} /> {t('brief.open_items_carry_into_meeting')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
