// Live Interview Mode — interviewer dashboard and tools, inside the
// meeting room.
//
// Shown only to interviewers (lead + interviewers). The candidate
// never mounts this component and never receives its data.
//
// Tabs:
//   Flags — live flags feed (newest first), candidate status in plain
//     words, event timeline, severity counts, candidate video/audio
//     and connection status, lead controls (pause, end, send back to
//     waiting room, mute candidate), candidate recording controls.
//   Questions — the question bank; the lead taps a question to ask it
//     (timed, with a visible countdown), the candidate sees it live.
//   Notes & Scores — private notes per interviewer per question, and
//     the simple 1 to 5 scoring rubric. Private means private: notes
//     and scores are saved through the service-role API route and are
//     never sent to the candidate.
//   Code — a simple shared code area the interviewer opens. The
//     candidate sees the same area in their room view. Run executes
//     the code in this browser tab (the code is the interviewer's or
//     the candidate's own typing) and shows the output to both sides.
//
// Highlights (spec 8.2) are the flag times and question times on the
// timeline: no AI needed, and no AI summary is claimed (spec 8.1 is
// blocked on the LLM key, see the report).
import React, { useEffect, useMemo, useState } from 'react';
import { Flag, ListChecks, NotebookPen, Code2, Pause, Play, PhoneOff, MicOff, Video, Clock, Send, CheckCircle2 } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import type { InterviewFlagEvent } from '../hooks/useInterviewMonitor';
import { t } from '../i18n';

export interface InterviewQuestion {
  id: string;
  question_text: string;
  time_limit_seconds: number | null;
}

export interface InterviewCurrentQuestion {
  id: string;
  text: string;
  timeLimitSeconds: number | null;
  startedAt: number;
}

interface InterviewPanelProps {
  interviewId: string;
  interviewTitle: string;
  meetingId: string;
  myRole: 'lead' | 'interviewer';
  myId: string;
  myName: string;
  token: string | null;
  candidateName: string;
  candidateRowId: string | null;
  candidateStatus: string;
  candidateVideoOn: boolean;
  candidateAudioOn: boolean;
  connectionQuality: string;
  events: InterviewFlagEvent[];
  isPaused: boolean;
  candidateInWaiting: boolean;
  isRecordingCandidate: boolean;
  recordingSeconds: number;
  codeOpen: boolean;
  codeValue: string;
  codeOutput: string;
  currentQuestion: InterviewCurrentQuestion | null;
  onPause: (paused: boolean) => void;
  onEnd: () => void;
  onSendToWaiting: () => void;
  onMuteCandidate: () => void;
  onStartCandidateRecording: () => void;
  onStopCandidateRecording: () => void;
  onAskQuestion: (q: InterviewQuestion) => void;
  onCodeChange: (v: string) => void;
  onToggleCode: (open: boolean) => void;
  onRunCode: () => void;
  onSendWaitingMessage: (message: string) => void;
}

type Tab = 'flags' | 'questions' | 'notes' | 'code';

export const InterviewPanel: React.FC<InterviewPanelProps> = (props) => {
  const {
    interviewId, interviewTitle, myRole, myId, myName, token, candidateName,
    candidateStatus, candidateVideoOn, candidateAudioOn, connectionQuality,
    events, isPaused, isRecordingCandidate, recordingSeconds,
    codeOpen, codeValue, codeOutput, currentQuestion,
  } = props;
  const [tab, setTab] = useState<Tab>('flags');
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [scores, setScores] = useState<any[]>([]);
  const [noteQuestionId, setNoteQuestionId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const [myScores, setMyScores] = useState<Record<string, number>>({});
  const [waitingMessage, setWaitingMessage] = useState('');
  const [messageSent, setMessageSent] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const sessionToken = await giinApi.interviewSessionToken();
        const res: any = await giinApi.interviewPost('get', { accessToken: sessionToken, token: token || undefined, interviewId });
        setQuestions(res.questions || []);
        setCriteria(res.interview?.criteria || []);
        setNotes(res.notes || []);
        setScores(res.scores || []);
        const mine: Record<string, number> = {};
        for (const s of res.scores || []) {
          if (s.interviewer_id === myId) mine[s.criterion] = s.score;
        }
        setMyScores(mine);
      } catch (e: any) {
        setLoadError(e?.message || t('interview.could_not_load_interview_tools'));
      }
    })();
  }, [interviewId, myId, token]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const bySeverity = { low: 0, medium: 0, high: 0 };
    for (const e of events) {
      if (e.severity === 'low' || e.severity === 'medium' || e.severity === 'high') bySeverity[e.severity] += 1;
    }
    return bySeverity;
  }, [events]);

  const sortedEvents = useMemo(() => [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [events]);

  const currentNote = notes.find((n) => n.interviewer_id === myId && (n.question_id || null) === noteQuestionId);
  useEffect(() => {
    setNoteText(currentNote?.note_text || '');
  }, [noteQuestionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNote = async () => {
    try {
      const sessionToken = await giinApi.interviewSessionToken();
      await giinApi.interviewPost('notes-save', {
        accessToken: sessionToken, token: token || undefined,
        interviewId, questionId: noteQuestionId, text: noteText,
      });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
      setNotes((prev) => {
        const next = prev.filter((n) => !(n.interviewer_id === myId && (n.question_id || null) === noteQuestionId));
        return [...next, { interviewer_id: myId, interviewer_name: myName, question_id: noteQuestionId, note_text: noteText }];
      });
    } catch (e) { /* note save retries on next blur */ }
  };

  const saveScore = async (criterion: string, score: number) => {
    setMyScores((prev) => ({ ...prev, [criterion]: score }));
    try {
      const sessionToken = await giinApi.interviewSessionToken();
      await giinApi.interviewPost('scores-save', {
        accessToken: sessionToken, token: token || undefined,
        interviewId, criterion, score,
      });
    } catch (e) { /* score stays local and retries on next tap */ }
  };

  const sendWaitingMessage = async () => {
    if (!waitingMessage.trim()) return;
    props.onSendWaitingMessage(waitingMessage.trim());
    setWaitingMessage('');
    setMessageSent(true);
    setTimeout(() => setMessageSent(false), 3000);
  };

  const remainingSeconds = currentQuestion && currentQuestion.timeLimitSeconds
    ? Math.max(0, currentQuestion.timeLimitSeconds - Math.floor((nowMs - currentQuestion.startedAt) / 1000))
    : null;
  const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const severityColor = (s: string) => (s === 'high' ? '#EF4444' : s === 'medium' ? '#D97706' : '#6B7280');

  const tabBtn = (id: Tab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        flex: 1, height: '38px', borderRadius: '8px', border: 'none', cursor: 'pointer',
        backgroundColor: tab === id ? 'var(--color-secondary)' : 'transparent',
        color: tab === id ? '#fff' : 'var(--text-main)',
        fontSize: '0.8rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
      }}
    >
      {icon} {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.interview_dashboard')}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{interviewTitle} · {candidateName}</span>
      </div>

      <div style={{ display: 'flex', gap: '0.35rem', padding: '0.3rem', borderRadius: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
        {tabBtn('flags', t('interview.flags'), <Flag size={14} />)}
        {tabBtn('questions', t('interview.questions'), <ListChecks size={14} />)}
        {tabBtn('notes', t('interview.notes_scores'), <NotebookPen size={14} />)}
        {tabBtn('code', t('interview.code'), <Code2 size={14} />)}
      </div>

      {loadError && <span style={{ fontSize: '0.8rem', color: '#EF4444' }}>{loadError}</span>}

      {tab === 'flags' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
            <span><strong>{t('interview.candidate_status')}:</strong> {candidateStatus}</span>
            <span>{t('interview.camera')}: {candidateVideoOn ? t('interview.on') : t('interview.off')} · {t('interview.microphone')}: {candidateAudioOn ? t('interview.on') : t('interview.off')} · {t('interview.connection')}: {connectionQuality || t('interview.unknown')}</span>
            <span>{t('interview.low')}: {counts.low} · {t('interview.medium')}: {counts.medium} · {t('interview.high')}: {counts.high}</span>
            {isPaused && <span style={{ color: '#D97706', fontWeight: 700 }}>{t('interview.interview_paused')}</span>}
            {isRecordingCandidate && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#EF4444', fontWeight: 700 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444', display: 'inline-block' }} />
                {t('interview.recording_candidate')} {fmtClock(recordingSeconds)}
              </span>
            )}
          </div>

          {myRole === 'lead' && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => props.onPause(!isPaused)} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem', fontSize: '0.85rem' }}>
                {isPaused ? <Play size={15} /> : <Pause size={15} />} {isPaused ? t('interview.resume') : t('interview.pause')}
              </button>
              <button type="button" onClick={props.onEnd} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem', fontSize: '0.85rem', color: '#EF4444' }}>
                <PhoneOff size={15} /> {t('interview.end_interview')}
              </button>
              <button type="button" onClick={props.onSendToWaiting} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem', fontSize: '0.85rem' }}>
                {props.candidateInWaiting ? t('interview.bring_candidate_back') : t('interview.send_back_to_waiting')}
              </button>
              <button type="button" onClick={props.onMuteCandidate} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem', fontSize: '0.85rem' }}>
                <MicOff size={15} /> {t('interview.mute_candidate')}
              </button>
              {isRecordingCandidate ? (
                <button type="button" onClick={props.onStopCandidateRecording} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem', fontSize: '0.85rem', color: '#EF4444' }}>
                  <Video size={15} /> {t('interview.stop_recording')}
                </button>
              ) : (
                <button type="button" onClick={props.onStartCandidateRecording} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem', fontSize: '0.85rem' }}>
                  <Video size={15} /> {t('interview.record_candidate')}
                </button>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={waitingMessage}
              onChange={(e) => setWaitingMessage(e.target.value)}
              maxLength={140}
              placeholder={t('interview.message_the_waiting_candidate')}
              className="premium-input"
              style={{ flex: 1, height: '38px', fontSize: '0.85rem' }}
            />
            <button type="button" onClick={sendWaitingMessage} disabled={!waitingMessage.trim()} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.8rem' }}>
              <Send size={15} />
            </button>
          </div>
          {messageSent && <span style={{ fontSize: '0.8rem', color: '#10B981' }}>{t('interview.message_sent')}</span>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.live_flags')}</span>
            {sortedEvents.length === 0 && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('interview.no_flags_yet')}</span>
            )}
            {sortedEvents.slice(0, 50).map((e) => (
              <div key={e.clientId} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.45, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(e.occurredAt).toLocaleTimeString()}</span>
                <span style={{ fontWeight: 700, color: severityColor(e.severity), whiteSpace: 'nowrap' }}>{e.severity}</span>
                <span>{e.detail || e.type}{e.awaySeconds ? ` (${t('interview.away')} ${e.awaySeconds}s)` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'questions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {currentQuestion && (
            <div style={{ padding: '0.9rem', borderRadius: '8px', border: '1px solid var(--color-secondary)', backgroundColor: 'rgba(59, 130, 246, 0.08)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('interview.current_question')}</span>
              <span style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.5 }}>{currentQuestion.text}</span>
              {remainingSeconds !== null && (
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: remainingSeconds <= 30 ? '#EF4444' : 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Clock size={16} /> {remainingSeconds === 0 ? t('interview.time_is_up') : fmtClock(remainingSeconds)}
                </span>
              )}
            </div>
          )}
          {questions.length === 0 && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('interview.no_questions_saved')}</span>
          )}
          {questions.map((q, i) => (
            <div key={q.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}.</span>
              <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.45 }}>{q.question_text}</span>
              {q.time_limit_seconds ? <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtClock(q.time_limit_seconds)}</span> : null}
              {myRole === 'lead' && (
                <button type="button" onClick={() => props.onAskQuestion(q)} className="premium-btn premium-btn-primary" style={{ height: '36px', padding: '0 0.8rem', fontSize: '0.85rem' }}>
                  {t('interview.ask')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem' }}>{t('interview.notes_for')}</label>
            <select value={noteQuestionId || ''} onChange={(e) => setNoteQuestionId(e.target.value || null)} className="premium-input" style={{ width: '100%', height: '40px' }}>
              <option value="">{t('interview.general_notes')}</option>
              {questions.map((q, i) => (<option key={q.id} value={q.id}>{i + 1}. {q.question_text.slice(0, 60)}</option>))}
            </select>
          </div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNote}
            rows={5}
            placeholder={t('interview.private_notes_placeholder')}
            className="premium-input"
            style={{ resize: 'vertical', fontSize: '0.9rem', lineHeight: 1.5 }}
          />
          {noteSaved && <span style={{ fontSize: '0.8rem', color: '#10B981', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><CheckCircle2 size={14} /> {t('interview.note_saved')}</span>}
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('interview.notes_are_private')}</span>

          {criteria.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.scoring_rubric')}</span>
              {criteria.map((c) => (
                <div key={c} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', minWidth: '120px', flex: 1 }}>{c}</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => saveScore(c, n)}
                      style={{
                        width: '34px', height: '34px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700,
                        border: '1px solid var(--border-color)',
                        backgroundColor: myScores[c] === n ? 'var(--color-secondary)' : 'transparent',
                        color: myScores[c] === n ? '#fff' : 'var(--text-main)',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {scores.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.scores_so_far')}</span>
              {scores.map((s, i) => (
                <span key={i} style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{s.interviewer_name}: {s.criterion} {s.score}/5</span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button type="button" onClick={() => props.onToggleCode(!codeOpen)} className="premium-btn premium-btn-secondary" style={{ height: '38px', padding: '0 0.9rem', fontSize: '0.85rem' }}>
              {codeOpen ? t('interview.close_code_pad') : t('interview.open_code_pad')}
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('interview.code_pad_shared_with_candidate')}</span>
          </div>
          {codeOpen && (
            <>
              <textarea
                value={codeValue}
                onChange={(e) => props.onCodeChange(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={t('interview.write_code_here')}
                className="premium-input"
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: 1.5 }}
              />
              <button type="button" onClick={props.onRunCode} className="premium-btn premium-btn-primary" style={{ alignSelf: 'flex-start', height: '38px', padding: '0 1rem' }}>
                {t('interview.run')}
              </button>
              {codeOutput && (
                <pre style={{ margin: 0, padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', fontSize: '0.85rem', color: 'var(--text-main)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>
                  {codeOutput}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
