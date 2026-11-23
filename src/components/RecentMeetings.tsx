import React, { useMemo, useState } from 'react';
import { History, RotateCcw, Copy, Check } from 'lucide-react';
import { readRecentMeetings, type RecentMeeting } from '../utils/recent';
import { buildJoinLink } from '../supabaseClient';

// Phase C1 (26) — recent meetings, one-tap rejoin.
//
// One grouped section: the meetings this device joined most recently,
// merged with the newest meetings from history, newest first. Rejoin
// goes through the normal join link, so a passcode or waiting room still
// applies where the meeting has one. Nothing is fetched: the recent list
// is local to this browser.
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

export const RecentMeetings: React.FC<Props> = ({ meetings }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const recents = useMemo(() => {
    const local = readRecentMeetings();
    const byId = new Map<string, RecentMeeting>();
    local.forEach((m) => byId.set(m.id, m));
    meetings.forEach((m) => {
      if (!byId.has(m.id)) {
        byId.set(m.id, { id: m.id, title: m.title, time: m.time, host: m.host });
      }
    });
    return [...byId.values()]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);
  }, [meetings]);

  if (recents.length === 0) return null;

  const handleRejoin = (id: string) => {
    window.location.hash = `#/join?id=${id}`;
  };

  const handleCopy = async (m: RecentMeeting) => {
    try {
      await navigator.clipboard.writeText(buildJoinLink(m.id));
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      // Copy is best effort; the rejoin button is the main path.
    }
  };

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const day =
      sameDay ? 'Today' : d.toDateString() === yesterday.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${day}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <History size={18} color="var(--color-accent)" />
        <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0 }}>Recent meetings</h3>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0.25rem' }}>
        Jump back in with one tap. The usual join checks still apply.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {recents.map((m) => (
          <div
            key={m.id}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}
          >
            <span style={{ flex: '1 1 160px', minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.title}
              </span>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {fmtWhen(m.time)}{m.host ? ` · Host: ${m.host}` : ''}
              </span>
            </span>
            <button
              type="button"
              className="premium-btn premium-btn-primary"
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
              onClick={() => handleRejoin(m.id)}
            >
              <RotateCcw size={13} /> Rejoin
            </button>
            <button
              type="button"
              className="premium-btn premium-btn-secondary"
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
              title="Copy the join link"
              onClick={() => void handleCopy(m)}
            >
              {copiedId === m.id ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
