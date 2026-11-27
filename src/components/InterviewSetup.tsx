// Live Interview Mode — host setup form.
//
// Creates an interview (and its meeting) through POST /api/interviews
// action create. Scheduled or instant, candidate + interviewers,
// length, role, description, question bank with per-question time
// limits, and a simple 1 to 5 scoring rubric (criteria list).
// Templates: a saved set of questions + criteria can fill the form,
// and the host can save the current set as a template.
// After creation the host sees the copyable links and, honestly,
// which invite emails went out and which did not.
import React, { useEffect, useState } from 'react';
import { Plus, X, Copy, Check, Loader2, Calendar, Link2, Mail, MailX, Download } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

interface InterviewSetupProps {
  onCreated: () => void;
  onCancel: () => void;
}

interface CreatedLinks {
  candidate: string | null;
  interviewers: { name: string; link: string }[];
}

export const InterviewSetup: React.FC<InterviewSetupProps> = ({ onCreated, onCancel }) => {
  const [title, setTitle] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [startNow, setStartNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60000);
    return d.toISOString().slice(0, 16);
  });
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [candidatePhone, setCandidatePhone] = useState('');
  const [interviewers, setInterviewers] = useState<{ name: string; email: string }[]>([{ name: '', email: '' }]);
  const [questions, setQuestions] = useState<{ text: string; timeLimitSeconds: number | '' }[]>([{ text: '', timeLimitSeconds: 300 }]);
  const [criteria, setCriteria] = useState<string[]>(['Communication', 'Problem solving', 'Technical skill']);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [created, setCreated] = useState<{
    interviewId: string; links: CreatedLinks; mail: { candidate: boolean; interviewers: boolean[] }; emailConfigured: boolean;
  } | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const token = await giinApi.interviewSessionToken();
        if (!token) return;
        const res: any = await giinApi.interviewPost('templates-list', { accessToken: token });
        if (res.templates) setTemplates(res.templates);
      } catch (e) { /* templates are optional */ }
    })();
  }, []);

  const applyTemplate = (id: string) => {
    setSelectedTemplate(id);
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    if (tpl.role_title) setRoleTitle(tpl.role_title);
    if (Array.isArray(tpl.questions) && tpl.questions.length > 0) {
      setQuestions(tpl.questions.map((q: any) => ({ text: q.text || '', timeLimitSeconds: q.timeLimitSeconds ?? '' })));
    }
    if (Array.isArray(tpl.criteria) && tpl.criteria.length > 0) setCriteria(tpl.criteria);
  };

  const copyLink = async (label: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    } catch (e) { /* clipboard unavailable: the link is selectable */ }
  };

  const downloadIcs = async (participantName: string) => {
    if (!created) return;
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) return;
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ics', interviewId: created.interviewId, accessToken: token }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `interview-${participantName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { /* ics is a convenience, not a blocker */ }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    try {
      const token = await giinApi.interviewSessionToken();
      if (!token) throw new Error(t('interview.sign_in_to_create_an_interview'));
      const res: any = await giinApi.interviewPost('create', {
        accessToken: token,
        title,
        roleTitle,
        description,
        durationMinutes,
        scheduledAt: startNow ? new Date().toISOString() : new Date(scheduledAt).toISOString(),
        candidate: { name: candidateName, email: candidateEmail, phone: candidatePhone },
        interviewers: interviewers.filter((iv) => iv.name.trim()),
        questions: questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text, timeLimitSeconds: q.timeLimitSeconds === '' ? undefined : q.timeLimitSeconds })),
        criteria: criteria.filter((c) => c.trim()),
      });
      if (saveAsTemplate) {
        try {
          await giinApi.interviewPost('templates-save', {
            accessToken: token,
            name: title,
            roleTitle,
            questions: questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text, timeLimitSeconds: q.timeLimitSeconds === '' ? undefined : q.timeLimitSeconds })),
            criteria: criteria.filter((c) => c.trim()),
            defaultTimeLimitSeconds: 300,
          });
        } catch (err) { /* template save is a bonus, not a blocker */ }
      }
      setCreated({ interviewId: res.interview.id, links: res.links, mail: res.mail, emailConfigured: res.emailConfigured });
    } catch (err: any) {
      setErrorMsg(err?.message || t('interview.could_not_create_the_interview'));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="glass-panel" style={{ maxWidth: '640px', width: '100%', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
          {t('interview.interview_created')}
        </h3>
        {!created.emailConfigured && (
          <p style={{ fontSize: '0.85rem', color: '#D97706', margin: 0, lineHeight: 1.5 }}>
            {t('interview.email_is_not_configured_copy_the_links')}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {t('interview.candidate_link')} {created.mail.candidate
                ? <span style={{ color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Mail size={13} /> {t('interview.email_sent')}</span>
                : <span style={{ color: '#D97706', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><MailX size={13} /> {t('interview.email_not_sent')}</span>}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input readOnly value={created.links.candidate || ''} className="premium-input" style={{ flex: 1, fontSize: '0.8rem', height: '40px' }} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => created.links.candidate && copyLink('candidate', created.links.candidate)} className="premium-btn premium-btn-secondary" style={{ height: '40px', padding: '0 0.9rem' }}>
                {copied === 'candidate' ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button type="button" onClick={() => downloadIcs('candidate')} className="premium-btn premium-btn-secondary" style={{ height: '40px', padding: '0 0.9rem' }} title={t('interview.download_calendar_invite')}>
                <Download size={16} />
              </button>
            </div>
          </div>
          {created.links.interviewers.map((iv, i) => (
            <div key={iv.name + i} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {iv.name} {created.mail.interviewers[i]
                  ? <span style={{ color: '#10B981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Mail size={13} /> {t('interview.email_sent')}</span>
                  : <span style={{ color: '#D97706', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><MailX size={13} /> {t('interview.email_not_sent')}</span>}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input readOnly value={iv.link} className="premium-input" style={{ flex: 1, fontSize: '0.8rem', height: '40px' }} onFocus={(e) => e.target.select()} />
                <button type="button" onClick={() => copyLink(`iv-${i}`, iv.link)} className="premium-btn premium-btn-secondary" style={{ height: '40px', padding: '0 0.9rem' }}>
                  {copied === `iv-${i}` ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          {t('interview.the_candidate_waits_in_the_waiting_room')}
        </p>
        <button type="button" onClick={onCreated} className="premium-btn premium-btn-primary" style={{ justifyContent: 'center', height: '46px' }}>
          {t('interview.done')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass-panel" style={{ maxWidth: '640px', width: '100%', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
        {t('interview.set_up_a_live_interview')}
      </h3>

      {templates.length > 0 && (
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem' }}>{t('interview.start_from_a_template')}</label>
          <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} className="premium-input" style={{ width: '100%', height: '44px' }}>
            <option value="">{t('interview.no_template')}</option>
            {templates.map((tpl) => (<option key={tpl.id} value={tpl.id}>{tpl.name}</option>))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder={t('interview.interview_title_placeholder')} className="premium-input" style={{ height: '44px' }} />
        <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} maxLength={200} placeholder={t('interview.role_title_placeholder')} className="premium-input" style={{ height: '44px' }} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} placeholder={t('interview.short_description_placeholder')} className="premium-input" style={{ resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-main)' }}>
            <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--color-secondary)' }} />
            {t('interview.start_now')}
          </label>
          {!startNow && (
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-main)' }}>
              <Calendar size={16} />
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required className="premium-input" style={{ height: '40px' }} />
            </label>
          )}
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-main)' }}>
            {t('interview.length_minutes')}
            <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} className="premium-input" style={{ height: '40px' }}>
              {[15, 30, 45, 60, 90, 120].map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.candidate')}</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} required maxLength={120} placeholder={t('interview.candidate_name')} className="premium-input" style={{ flex: 1, minWidth: '140px', height: '42px' }} />
          <input value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} type="email" maxLength={254} placeholder={t('interview.candidate_email')} className="premium-input" style={{ flex: 1, minWidth: '160px', height: '42px' }} />
          <input value={candidatePhone} onChange={(e) => setCandidatePhone(e.target.value)} maxLength={40} placeholder={t('interview.phone_optional')} className="premium-input" style={{ flex: 1, minWidth: '120px', height: '42px' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.interviewers')}</span>
        {interviewers.map((iv, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
            <input value={iv.name} onChange={(e) => setInterviewers((prev) => prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)))} maxLength={120} placeholder={t('interview.interviewer_name')} className="premium-input" style={{ flex: 1, height: '42px' }} />
            <input value={iv.email} onChange={(e) => setInterviewers((prev) => prev.map((p, j) => (j === i ? { ...p, email: e.target.value } : p)))} type="email" maxLength={254} placeholder={t('interview.interviewer_email')} className="premium-input" style={{ flex: 1, height: '42px' }} />
            {interviewers.length > 1 && (
              <button type="button" onClick={() => setInterviewers((prev) => prev.filter((_, j) => j !== i))} className="premium-btn premium-btn-secondary" style={{ height: '42px', padding: '0 0.7rem' }} aria-label={t('interview.remove')}>
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setInterviewers((prev) => [...prev, { name: '', email: '' }])} className="premium-btn premium-btn-secondary" style={{ alignSelf: 'flex-start', height: '38px' }}>
          <Plus size={16} /> {t('interview.add_interviewer')}
        </button>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('interview.you_are_the_lead_interviewer')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.questions')}</span>
        {questions.map((q, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
            <input value={q.text} onChange={(e) => setQuestions((prev) => prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)))} maxLength={1000} placeholder={t('interview.question_placeholder', { v1: i + 1 })} className="premium-input" style={{ flex: 1, height: '42px' }} />
            <input
              type="number" min={0} max={3600} value={q.timeLimitSeconds === '' ? '' : q.timeLimitSeconds}
              onChange={(e) => setQuestions((prev) => prev.map((p, j) => (j === i ? { ...p, timeLimitSeconds: e.target.value === '' ? '' : Number(e.target.value) } : p)))}
              placeholder={t('interview.seconds')}
              className="premium-input" style={{ width: '90px', height: '42px' }} title={t('interview.time_limit_in_seconds')}
            />
            {questions.length > 1 && (
              <button type="button" onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))} className="premium-btn premium-btn-secondary" style={{ height: '42px', padding: '0 0.7rem' }} aria-label={t('interview.remove')}>
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setQuestions((prev) => [...prev, { text: '', timeLimitSeconds: 300 }])} className="premium-btn premium-btn-secondary" style={{ alignSelf: 'flex-start', height: '38px' }}>
          <Plus size={16} /> {t('interview.add_question')}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.scoring_rubric')}</span>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {criteria.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.6rem', borderRadius: '999px', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-main)' }}>
              {c}
              <button type="button" onClick={() => setCriteria((prev) => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', color: 'var(--text-muted)' }} aria-label={t('interview.remove')}>
                <X size={13} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              const next = window.prompt(t('interview.new_criterion'));
              if (next && next.trim()) setCriteria((prev) => [...prev, next.trim().slice(0, 120)]);
            }}
            className="premium-btn premium-btn-secondary" style={{ height: '32px', padding: '0 0.7rem', fontSize: '0.8rem' }}
          >
            <Plus size={14} /> {t('interview.add_criterion')}
          </button>
        </div>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-main)' }}>
          <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--color-secondary)' }} />
          {t('interview.save_these_questions_as_a_template')}
        </label>
      </div>

      {errorMsg && <span style={{ fontSize: '0.85rem', color: '#EF4444' }}>{errorMsg}</span>}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button type="button" onClick={onCancel} className="premium-btn premium-btn-secondary" style={{ flex: 1, justifyContent: 'center', height: '46px' }}>
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={busy} className="premium-btn premium-btn-primary" style={{ flex: 2, justifyContent: 'center', height: '46px' }}>
          {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Link2 size={16} />}
          <span>{t('interview.create_interview_and_send_links')}</span>
        </button>
      </div>
    </form>
  );
};
