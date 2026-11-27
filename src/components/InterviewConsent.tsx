// Live Interview Mode — candidate consent and identity step.
//
// Shown between the pre-join device check and the waiting room, only
// for the candidate. Short words first, full detail behind a tap, no
// wall of text. The candidate must tap "I understand and agree" to
// join.
//
// Identity, two ways (spec section 2.7):
//   1. Email code: a 6-digit code sent to the candidate's email, when
//      the mail provider is configured. Confirms at once.
//   2. ID to camera: the candidate holds their ID up to the camera and
//      taps "I showed my ID". The lead interviewer confirms it later
//      from the dashboard or the interview panel; the candidate is not
//      blocked waiting for that tap, but the report shows whether
//      identity was confirmed and how.
// Name confirmation is part of both paths: the candidate confirms the
// name on the invite is theirs.
import React, { useState } from 'react';
import { ShieldCheck, ChevronDown, ChevronUp, Loader2, CheckCircle2, IdCard, Mail } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

export interface InterviewConsentInfo {
  id: string;
  meetingId: string;
  title: string;
  roleTitle: string;
  description: string;
  durationMinutes: number;
  scheduledAt: string | null;
  status: string;
}

interface InterviewConsentProps {
  interview: InterviewConsentInfo;
  candidateName: string;
  token: string;
  emailConfigured: boolean;
  identityConfirmed: boolean;
  onComplete: (identityConfirmed: boolean) => void;
  onBack: () => void;
}

export const InterviewConsent: React.FC<InterviewConsentProps> = ({
  interview,
  candidateName,
  token,
  emailConfigured,
  identityConfirmed,
  onComplete,
  onBack,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [identityDone, setIdentityDone] = useState(identityConfirmed);
  const [identityMethod, setIdentityMethod] = useState<string | null>(identityConfirmed ? 'email-code' : null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [idShown, setIdShown] = useState(false);
  const [idBusy, setIdBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const sendCode = async () => {
    setCodeError('');
    setCodeBusy(true);
    try {
      const res: any = await giinApi.interviewPost('otp-request', { interviewId: interview.id, token });
      if (res.sent) {
        setCodeSent(true);
      } else {
        setCodeError(t('interview.email_codes_are_not_available'));
      }
    } catch (e: any) {
      setCodeError(e?.message || t('interview.could_not_send_the_code'));
    } finally {
      setCodeBusy(false);
    }
  };

  const verifyCode = async () => {
    setCodeError('');
    setCodeBusy(true);
    try {
      await giinApi.interviewPost('otp-verify', { interviewId: interview.id, token, code });
      setIdentityDone(true);
      setIdentityMethod('email-code');
    } catch (e: any) {
      setCodeError(e?.message || t('interview.that_code_is_wrong'));
    } finally {
      setCodeBusy(false);
    }
  };

  const markIdShown = async () => {
    setIdBusy(true);
    try {
      await giinApi.interviewPost('id-shown', { interviewId: interview.id, token });
      setIdShown(true);
      setIdentityMethod('id-camera');
    } catch (e: any) {
      setErrorMsg(e?.message || t('interview.could_not_save_that'));
    } finally {
      setIdBusy(false);
    }
  };

  const canContinue = nameConfirmed && (identityDone || idShown);

  return (
    <div className="flex-center" style={{ minHeight: '80vh', padding: '2rem' }}>
      <div className="glass-panel" style={{ maxWidth: '480px', width: '100%', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(59, 130, 246, 0.1)', alignItems: 'center', justifyContent: 'center', color: 'var(--color-secondary)', marginBottom: '0.75rem' }}>
            <ShieldCheck size={28} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: '0 0 0.25rem' }}>
            {interview.title}
          </h2>
          {interview.roleTitle && (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>{interview.roleTitle}</p>
          )}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
            {t('interview.this_interview_last_about', { v1: interview.durationMinutes })}
          </p>
        </div>

        <div style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
          <p style={{ margin: 0 }}>{t('interview.this_interview_is_monitored')}</p>
          <p style={{ margin: 0 }}>{t('interview.switching_tabs_or_leaving_full')}</p>
          <p style={{ margin: 0 }}>{t('interview.the_session_is_recorded')}</p>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-secondary)', fontSize: '0.85rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem', alignSelf: 'flex-start' }}
          >
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showDetails ? t('interview.hide_the_full_details') : t('interview.read_the_full_details')}
          </button>
          {showDetails && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0 }}>{t('interview.full_detail_monitoring')}</p>
              <p style={{ margin: 0 }}>{t('interview.full_detail_second_screen')}</p>
              <p style={{ margin: 0 }}>{t('interview.full_detail_recording')}</p>
              <p style={{ margin: 0 }}>{t('interview.full_detail_report')}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.45 }}>
            <input type="checkbox" checked={nameConfirmed} onChange={(e) => setNameConfirmed(e.target.checked)} style={{ marginTop: '0.2rem', width: '18px', height: '18px', accentColor: 'var(--color-secondary)' }} />
            <span>{t('interview.i_confirm_i_am', { v1: candidateName })}</span>
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>{t('interview.confirm_your_identity')}</span>
          {identityDone ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: '#10B981', fontWeight: 600 }}>
              <CheckCircle2 size={18} /> {t('interview.identity_confirmed')}
            </span>
          ) : (
            <>
              {emailConfigured ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{t('interview.we_can_send_a_6_digit_code')}</span>
                  {!codeSent ? (
                    <button type="button" onClick={sendCode} disabled={codeBusy} className="premium-btn premium-btn-secondary" style={{ justifyContent: 'center', height: '42px' }}>
                      {codeBusy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={16} />}
                      <span>{t('interview.send_me_a_code')}</span>
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="123456"
                        className="premium-input"
                        style={{ flex: 1, textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.1rem', height: '42px' }}
                      />
                      <button type="button" onClick={verifyCode} disabled={codeBusy || code.length !== 6} className="premium-btn premium-btn-primary" style={{ height: '42px', padding: '0 1rem' }}>
                        {t('interview.verify')}
                      </button>
                    </div>
                  )}
                  {codeError && <span style={{ fontSize: '0.8rem', color: '#EF4444' }}>{codeError}</span>}
                </div>
              ) : (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{t('interview.email_codes_are_not_available')}</span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{t('interview.or_hold_your_id_up_to_the_camera')}</span>
                {idShown ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: '#10B981', fontWeight: 600 }}>
                    <CheckCircle2 size={18} /> {t('interview.id_shown_the_interviewer_will_confirm')}
                  </span>
                ) : (
                  <button type="button" onClick={markIdShown} disabled={idBusy} className="premium-btn premium-btn-secondary" style={{ justifyContent: 'center', height: '42px' }}>
                    {idBusy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <IdCard size={16} />}
                    <span>{t('interview.i_showed_my_id')}</span>
                  </button>
                )}
              </div>
            </>
          )}
          {identityMethod === 'id-camera' && !identityDone && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('interview.your_id_will_be_confirmed_by_the_interviewer')}</span>
          )}
        </div>

        {errorMsg && <span style={{ fontSize: '0.85rem', color: '#EF4444' }}>{errorMsg}</span>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" onClick={onBack} className="premium-btn premium-btn-secondary" style={{ flex: 1, justifyContent: 'center', height: '46px' }}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onComplete(identityDone)}
            disabled={!canContinue}
            className="premium-btn premium-btn-primary"
            style={{ flex: 2, justifyContent: 'center', height: '46px', opacity: canContinue ? 1 : 0.5, cursor: canContinue ? 'pointer' : 'not-allowed' }}
          >
            {t('interview.i_understand_and_agree')}
          </button>
        </div>
      </div>
    </div>
  );
};
