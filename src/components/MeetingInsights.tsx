// Phase C1 (34), Attendance and engagement insights, shown in the
// dashboard Record view for one meeting.
//
// Server data first (the host's browser flushed join/leave/speak events
// when the meeting ended). When there is no server data yet, it falls
// back to this browser's own attendance record and says so plainly:
// that record only knows what this device saw, and it has no speaking
// time. Who never got a turn is the point: anyone who spoke for 0
// seconds gets a clear badge, so the host can invite them in next time.
import React, { useEffect, useState } from 'react';
import { giinApi } from '../supabaseClient';

function fmtClock(iso: string | null): string {
  if (!iso) return ',';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return ',';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function MeetingInsights({ meetingId }: { meetingId: string }) {
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'server' | 'local' | 'none'>('none');
  const [summary, setSummary] = useState<any>(null);
  const [people, setPeople] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res: any = await giinApi.getAttendanceEvents(meetingId);
      if (cancelled) return;
      if (res?.ok && Array.isArray(res.people) && res.people.length > 0) {
        setSource('server');
        setSummary(res.summary);
        setPeople(res.people);
        setLoading(false);
        return;
      }
      // Fallback: this browser's local attendance record (no speak times).
      try {
        const raw = localStorage.getItem(`giin_attendance_${meetingId}`);
        if (raw) {
          const map = JSON.parse(raw) as Record<string, { name: string; joinedAt: number; leftAt: number | null }>;
          const rows = Object.entries(map).map(([key, v]) => ({
            key,
            name: v.name,
            joinedAt: new Date(v.joinedAt).toISOString(),
            leftAt: v.leftAt ? new Date(v.leftAt).toISOString() : null,
            staySeconds: Math.max(0, Math.floor(((v.leftAt || Date.now()) - v.joinedAt) / 1000)),
            spokeSeconds: null,
            neverSpoke: null,
          }));
          if (rows.length > 0) {
            const stays = rows.map((r) => r.staySeconds);
            setSource('local');
            setSummary({
              joined: rows.length,
              spoke: null,
              neverSpoke: null,
              avgStaySeconds: Math.round(stays.reduce((a, b) => a + b, 0) / stays.length),
            });
            setPeople(rows);
            setLoading(false);
            return;
          }
        }
      } catch (e) { /* no local record either */ }
      setSource('none');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  if (loading) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Loading attendance…</p>;
  }
  if (source === 'none') {
    return (
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
        No attendance was recorded for this meeting.
      </p>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
        ATTENDANCE AND ENGAGEMENT
      </span>
      <p style={{ fontSize: '0.82rem', margin: 0, lineHeight: 1.5 }}>
        {summary.joined} {summary.joined === 1 ? 'person' : 'people'} joined
        {summary.spoke !== null && (
          <>
            {' · '} {summary.spoke} spoke
            {' · '} {summary.neverSpoke} never got a turn
          </>
        )}
        {' · '} average stay {fmtDuration(summary.avgStaySeconds)}
      </p>
      {source === 'local' && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
          From this device only, speaking time was not recorded for this meeting.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {people.map((p) => (
          <div
            key={p.key}
            style={{
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '0.5rem 0.75rem',
              fontSize: '0.82rem',
            }}
          >
            <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
              Joined {fmtClock(p.joinedAt)} · Stayed {fmtDuration(p.staySeconds)}
              {p.spokeSeconds !== null && ` · Spoke ${fmtDuration(p.spokeSeconds)}`}
            </span>
            {p.neverSpoke === true && (
              <span style={{ flexShrink: 0, backgroundColor: 'rgba(250,189,2,0.15)', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                Never spoke
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
