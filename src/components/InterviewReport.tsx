// Live Interview Mode — post-interview integrity report.
//
// Title, date, duration, candidate, interviewers. Counts by event
// type and severity. The full event log with exact times. A short
// plain-worded summary at the top. The recording link (signed URL,
// only when a recording was uploaded) and the transcript link (only
// when live captions captured one; otherwise the report says plainly
// that no transcript was captured). Interviewers' notes and scores,
// with the score comparison across interviewers. Candidate feedback.
// Download as PDF (jsPDF, generated on this device) or print.
//
// The report also states, plainly: "Second screen use cannot be
// detected by the browser." No claim is made that the browser cannot
// support.
//
// Resend and identity confirmation live here too, because this is
// where the host sees the full participant list.
import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { ArrowLeft, Download, Printer, ShieldCheck, Mail, Loader2, Video, FileText } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

interface InterviewReportProps {
  interviewId: string;
  onBack: () => void;
}


function plainSummary(counts: { byType: Record<string, number>; longestAwaySeconds: number }): string {
  const parts: string[] = [];
  const tabSwitches = counts.byType['tab-hidden'] || 0;
  if (tabSwitches > 0) parts.push(tabSwitches === 1 ? '1 tab switch' : `${tabSwitches} tab switches`);
  const fsExits = counts.byType['fullscreen-exit'] || 0;
  if (fsExits > 0) parts.push(fsExits === 1 ? '1 full screen exit' : `${fsExits} full screen exits`);
  const pastes = counts.byType['paste'] || 0;
  if (pastes > 0) parts.push(pastes === 1 ? '1 paste' : `${pastes} pastes`);
  const blurs = counts.byType['window-blur'] || 0;
  if (blurs > 0) parts.push(blurs === 1 ? '1 window blur' : `${blurs} window blurs`);
  if (counts.longestAwaySeconds > 0) parts.push(`longest absence ${counts.longestAwaySeconds} seconds`);
  if (parts.length === 0) return 'No flags were recorded during this interview.';
  return parts.join(', ') + '.';
}

export const InterviewReport: React.FC<InterviewReportProps> = ({ interviewId, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [record, setRecord] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ byType: Record<string, number>; bySeverity: Record<string, number>; total: number; longestAwaySeconds: number } | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const token = await giinApi.interviewSessionToken();
        if (!token) throw new Error(t('interview.sign_in_to_see_interviews'));
        const res: any = await giinApi.interviewPost('get', { accessToken: token, interviewId });
        setRecord(res);
        const ev: any = await giinApi.getInterviewEvents(interviewId);
        setEvents(ev.events || []);
        setCounts(ev.counts);
      } catch (e: any) {
        setErrorMsg(e?.message || t('interview.could_not_load_the_report'));
      } finally {
        setLoading(false);
      }
    })();
  }, [interviewId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '2rem' }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> {t('interview.loading_report')}
      </div>
    );
  }

  if (errorMsg || !record) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '2rem', maxWidth: '640px' }}>
        <span style={{ color: '#EF4444', fontSize: '0.9rem' }}>{errorMsg || t('interview.could_not_load_the_report')}</span>
        <button type="button" onClick={onBack} className="premium-btn premium-btn-secondary" style={{ alignSelf: 'flex-start', height: '42px' }}>
          <ArrowLeft size={16} /> {t('interview.back_to_interviews')}
        </button>
      </div>
    );
  }

  const iv = record.interview;
  const participants: any[] = record.participants || [];
  const questions: any[] = record.questions || [];
  const notes: any[] = record.notes || [];
  const scores: any[] = record.scores || [];
  const feedback: any[] = record.feedback || [];
  const candidate = participants.find((p) => p.role === 'candidate');
  const interviewers = participants.filter((p) => p.role !== 'candidate');
  const criteria: string[] = record.interview.criteria || [];
  const started = iv.started_at ? new Date(iv.started_at) : (iv.scheduled_at ? new Date(iv.scheduled_at) : null);
  const ended = iv.ended_at ? new Date(iv.ended_at) : null;
  const durationMin = started && ended ? Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000)) : iv.duration_minutes;
  const summary = counts ? plainSummary(counts) : '';

  const openRecording = async () => {
    setRecordingBusy(true);
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) return;
      const res: any = await giinApi.interviewPost('recording-link', { accessToken: token, interviewId });
      if (res.url) {
        setRecordingUrl(res.url);
        window.open(res.url, '_blank', 'noopener');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || t('interview.no_recording_yet'));
    } finally {
      setRecordingBusy(false);
    }
  };

  const resend = async (participantId: string) => {
    setBusyId(participantId);
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) return;
      await giinApi.interviewPost('resend-link', { accessToken: token, interviewId, participantId });
      setCopied(`resend-${participantId}`);
      setTimeout(() => setCopied(''), 2000);
    } catch (e: any) {
      setErrorMsg(e?.message || t('interview.could_not_resend_the_link'));
    } finally {
      setBusyId('');
    }
  };

  const confirmIdentity = async (participantId: string) => {
    setBusyId(participantId);
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) return;
      await giinApi.interviewPost('confirm-identity', { accessToken: token, interviewId, participantId });
      const res: any = await giinApi.interviewPost('get', { accessToken: token, interviewId });
      setRecord(res);
    } catch (e: any) {
      setErrorMsg(e?.message || t('interview.could_not_confirm_identity'));
    } finally {
      setBusyId('');
    }
  };

  const downloadPdf = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 16;
    const line = (text: string, size = 11, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, 178);
      for (const ln of lines) {
        if (y > 280) { doc.addPage(); y = 16; }
        doc.text(ln, 16, y);
        y += 6;
      }
      y += 2;
    };
    line(`Interview integrity report: ${iv.title}`, 16, true);
    line(`${t('interview.candidate')}: ${candidate?.name || ''}`, 11);
    line(`Date: ${started ? started.toLocaleString() : ''}  Duration: ${durationMin} minutes`, 11);
    line(`Interviewers: ${interviewers.map((p) => p.name).join(', ')}`, 11);
    line(`Summary: ${summary}`, 11, true);
    line(`Identity: ${candidate?.identity_confirmed ? `Confirmed (${candidate.identity_method || ''})` : 'Not confirmed'}`, 11);
    line('Counts', 12, true);
    if (counts) {
      for (const [type, n] of Object.entries(counts.byType)) line(`  ${type}: ${n}`, 11);
      line(`  Low: ${counts.bySeverity.low}  Medium: ${counts.bySeverity.medium}  High: ${counts.bySeverity.high}`, 11);
      line(`  Longest absence: ${counts.longestAwaySeconds} seconds`, 11);
    }
    line('Event log', 12, true);
    for (const e of events) {
      line(`${new Date(e.occurred_at).toLocaleTimeString()}  ${e.event_type} (${e.severity})  ${e.detail || ''}${e.away_seconds ? `  Away ${e.away_seconds}s` : ''}`, 10);
    }
    line('Second screen use cannot be detected by the browser.', 10);
    if (scores.length > 0) {
      line('Scores', 12, true);
      for (const s of scores) line(`  ${s.interviewer_name}: ${s.criterion} ${s.score}/5`, 11);
    }
    doc.save(`interview-report-${iv.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`);
  };

  const severityColor = (s: string) => (s === 'high' ? '#EF4444' : s === 'medium' ? '#D97706' : '#6B7280');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '760px', width: '100%' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} className="premium-btn premium-btn-secondary" style={{ height: '40px' }}>
          <ArrowLeft size={16} /> {t('interview.back_to_interviews')}
        </button>
        <button type="button" onClick={downloadPdf} className="premium-btn premium-btn-secondary" style={{ height: '40px' }}>
          <Download size={16} /> {t('interview.download_pdf')}
        </button>
        <button type="button" onClick={() => window.print()} className="premium-btn premium-btn-secondary" style={{ height: '40px' }}>
          <Printer size={16} /> {t('interview.print')}
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h3 style={{ fontSize: '1.35rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
          {t('interview.integrity_report')}: {iv.title}
        </h3>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6 }}>
          <div>{t('interview.candidate')}: {candidate?.name || ''}</div>
          <div>{t('interview.interviewers')}: {interviewers.map((p) => p.name).join(', ')}</div>
          <div>{t('interview.date')}: {started ? started.toLocaleString() : ''} · {t('interview.duration')}: {durationMin} {t('interview.minutes')}</div>
          <div>
            {t('interview.identity')}: {candidate?.identity_confirmed
              ? <span style={{ color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><ShieldCheck size={14} /> {t('interview.identity_confirmed')} ({candidate.identity_method || ''})</span>
              : <span style={{ color: '#D97706', fontWeight: 600 }}>{t('interview.identity_not_confirmed')}</span>}
          </div>
        </div>
        <div style={{ padding: '0.9rem 1rem', borderRadius: '8px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
          <strong>{t('interview.summary')}:</strong> {summary}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          {t('interview.second_screen_note')}
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.counts')}</h4>
        {counts ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem', color: 'var(--text-main)' }}>
            <div>{t('interview.low')}: {counts.bySeverity.low} · {t('interview.medium')}: {counts.bySeverity.medium} · {t('interview.high')}: {counts.bySeverity.high} · {t('interview.total')}: {counts.total}</div>
            {Object.entries(counts.byType).map(([type, n]) => (
              <div key={type}>{type}: {n}</div>
            ))}
            <div>{t('interview.longest_absence')}: {counts.longestAwaySeconds} {t('interview.seconds')}</div>
          </div>
        ) : (
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{t('interview.no_events_yet')}</p>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.event_log')}</h4>
        {events.length === 0 ? (
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{t('interview.no_events_yet')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '320px', overflowY: 'auto' }}>
            {events.map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: '0.75rem', fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.45, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(e.occurred_at).toLocaleTimeString()}</span>
                <span style={{ fontWeight: 700, color: severityColor(e.severity), whiteSpace: 'nowrap' }}>{e.severity}</span>
                <span>{e.detail || e.event_type}{e.away_seconds ? ` (${t('interview.away')} ${e.away_seconds}s)` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.recording_and_transcript')}</h4>
        {iv.recording_path ? (
          <button type="button" onClick={openRecording} disabled={recordingBusy} className="premium-btn premium-btn-secondary" style={{ alignSelf: 'flex-start', height: '40px' }}>
            {recordingBusy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Video size={16} />}
            <span>{t('interview.open_recording')}</span>
          </button>
        ) : (
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{t('interview.no_recording_yet')}</p>
        )}
        {recordingUrl && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('interview.recording_link_expires_in_one_hour')}</span>
        )}
        {iv.transcript_text ? (
          <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: '240px', overflowY: 'auto', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            {iv.transcript_text}
          </div>
        ) : (
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{t('interview.no_transcript_captured')}</p>
        )}
      </div>

      {scores.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.scores')}</h4>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.9rem', color: 'var(--text-main)', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>{t('interview.interviewer')}</th>
                <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>{t('interview.criterion')}</th>
                <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>{t('interview.score')}</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>{s.interviewer_name}</td>
                  <td style={{ padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>{s.criterion}</td>
                  <td style={{ padding: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>{s.score} / 5</td>
                </tr>
              ))}
            </tbody>
          </table>
          {criteria.length > 0 && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {t('interview.average_by_criterion')}: {criteria.map((c) => {
                const mine = scores.filter((s) => s.criterion === c);
                const avg = mine.length > 0 ? (mine.reduce((a: number, s: any) => a + s.score, 0) / mine.length).toFixed(1) : '-';
                return `${c} ${avg}`;
              }).join(' · ')}
            </div>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.notes')}</h4>
          {notes.map((n, i) => {
            const q = questions.find((qq) => qq.id === n.question_id);
            return (
              <div key={i} style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                <strong>{n.interviewer_name}</strong>{q ? ` — ${q.question_text}` : ''}: {n.note_text}
              </div>
            );
          })}
        </div>
      )}

      {feedback.length > 0 && (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.candidate_feedback')}</h4>
          {feedback.map((f, i) => (
            <div key={i} style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
              {f.rating ? `${t('interview.rating')}: ${f.rating}/5. ` : ''}{f.comment}
            </div>
          ))}
        </div>
      )}

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <h4 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>{t('interview.participants')}</h4>
        {participants.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.9rem', color: 'var(--text-main)' }}>
            <span><strong>{p.name}</strong> ({p.role}){p.email ? ` · ${p.email}` : ''}</span>
            {p.role === 'candidate' && (
              p.identity_confirmed
                ? <span style={{ color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><ShieldCheck size={14} /> {t('interview.identity_confirmed')}</span>
                : <>
                    <span style={{ color: '#D97706', fontWeight: 600 }}>{t('interview.identity_not_confirmed')}</span>
                    {p.id_shown_at && (
                      <button type="button" onClick={() => confirmIdentity(p.id)} disabled={busyId === p.id} className="premium-btn premium-btn-secondary" style={{ height: '34px', padding: '0 0.8rem', fontSize: '0.8rem' }}>
                        <ShieldCheck size={14} /> {t('interview.confirm_identity')}
                      </button>
                    )}
                  </>
            )}
            {p.email && (
              <button type="button" onClick={() => resend(p.id)} disabled={busyId === p.id} className="premium-btn premium-btn-secondary" style={{ height: '34px', padding: '0 0.8rem', fontSize: '0.8rem' }}>
                <Mail size={14} /> {copied === `resend-${p.id}` ? t('interview.link_resent') : t('interview.resend_link')}
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <FileText size={15} /> {t('interview.ai_summary_not_available')}
      </div>
    </div>
  );
};
