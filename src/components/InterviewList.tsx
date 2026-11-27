// Live Interview Mode — host interview list.
//
// Shows the host's interviews with status, candidate, identity
// state and flag counts. From here the host can: open the integrity
// report, copy the candidate and interviewer links (built from the
// stored tokens), resend an invite email, confirm a candidate's ID
// after they showed it to the camera, end a live interview, and open
// the interview room.
import React, { useEffect, useState } from 'react';
import { Plus, FileText, Copy, Check, ShieldCheck, Video, XCircle, Loader2 } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

interface InterviewListProps {
  onNew: () => void;
  onOpenReport: (interviewId: string) => void;
  onOpenRoom: (meetingId: string) => void;
}

export const InterviewList: React.FC<InterviewListProps> = ({ onNew, onOpenReport, onOpenRoom }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) throw new Error(t('interview.sign_in_to_see_interviews'));
      const res: any = await giinApi.interviewPost('list', { accessToken: token });
      setRows(res.interviews || []);
    } catch (e: any) {
      setErrorMsg(e?.message || t('interview.could_not_load_interviews'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const copyLinks = async (interviewId: string) => {
    setBusyId(interviewId);
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) return;
      const res: any = await giinApi.interviewPost('get', { accessToken: token, interviewId });
      const lines: string[] = [];
      for (const p of res.participants || []) {
        lines.push(`${p.name} (${p.role}): ${origin}/#/join?interview=${interviewId}&token=${p.token}`);
      }
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(interviewId);
      setTimeout(() => setCopied(''), 2000);
    } catch (e) { /* clipboard unavailable */ } finally {
      setBusyId('');
    }
  };

  const endInterview = async (interviewId: string) => {
    setBusyId(interviewId);
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) return;
      await giinApi.interviewPost('end', { accessToken: token, interviewId });
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message || t('interview.could_not_end_the_interview'));
    } finally {
      setBusyId('');
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'live') return t('interview.live');
    if (status === 'paused') return t('interview.paused');
    if (status === 'ended') return t('interview.ended');
    if (status === 'cancelled') return t('interview.cancelled');
    return t('interview.scheduled');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '720px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
          {t('interview.live_interviews')}
        </h3>
        <button type="button" onClick={onNew} className="premium-btn premium-btn-primary" style={{ height: '42px' }}>
          <Plus size={16} /> {t('interview.new_interview')}
        </button>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> {t('interview.loading_interviews')}
        </div>
      )}
      {errorMsg && <span style={{ fontSize: '0.85rem', color: '#EF4444' }}>{errorMsg}</span>}
      {!loading && rows.length === 0 && (
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {t('interview.no_interviews_yet')}
        </p>
      )}

      {rows.map((row) => (
        <div key={row.id} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>{row.title}</div>
              {row.role_title && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{row.role_title}</div>}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {t('interview.candidate')}: {row.candidateName || t('interview.not_set')} · {row.scheduled_at ? new Date(row.scheduled_at).toLocaleString() : ''} · {row.duration_minutes} {t('interview.minutes')}
              </div>
            </div>
            <span style={{
              fontSize: '0.75rem', fontWeight: 700, padding: '0.3rem 0.7rem', borderRadius: '999px',
              backgroundColor: row.status === 'live' ? 'rgba(16, 185, 129, 0.15)' : row.status === 'ended' ? 'rgba(107, 114, 128, 0.15)' : 'rgba(59, 130, 246, 0.12)',
              color: row.status === 'live' ? '#10B981' : row.status === 'ended' ? '#6B7280' : 'var(--color-secondary)',
            }}>
              {statusLabel(row.status)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)', alignItems: 'center' }}>
            {row.identityConfirmed ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#10B981', fontWeight: 600 }}>
                <ShieldCheck size={14} /> {t('interview.identity_confirmed')}
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <ShieldCheck size={14} /> {t('interview.identity_not_confirmed')}
              </span>
            )}
            <span>·</span>
            <span>{t('interview.flags_count', { v1: row.eventCount || 0 })}</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(row.status === 'scheduled' || row.status === 'live' || row.status === 'paused') && (
              <button type="button" onClick={() => onOpenRoom(row.meeting_id)} className="premium-btn premium-btn-primary" style={{ height: '38px', padding: '0 0.9rem', fontSize: '0.85rem' }}>
                <Video size={15} /> {t('interview.open_room')}
              </button>
            )}
            <button type="button" onClick={() => onOpenReport(row.id)} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.9rem', fontSize: '0.85rem' }}>
              <FileText size={15} /> {t('interview.report')}
            </button>
            <button type="button" onClick={() => copyLinks(row.id)} disabled={busyId === row.id} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.9rem', fontSize: '0.85rem' }}>
              {copied === row.id ? <Check size={15} /> : <Copy size={15} />} {t('interview.copy_links')}
            </button>
            {(row.status === 'live' || row.status === 'paused') && (
              <button type="button" onClick={() => endInterview(row.id)} disabled={busyId === row.id} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.9rem', fontSize: '0.85rem', color: '#EF4444' }}>
                <XCircle size={15} /> {t('interview.end_interview')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
