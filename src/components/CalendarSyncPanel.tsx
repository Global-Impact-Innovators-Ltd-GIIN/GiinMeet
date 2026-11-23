import React, { useEffect, useState } from 'react';
import { Calendar, Check, RefreshCw } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

// Phase C1 (23) — calendar sync panel.
//
// One grouped section on the dashboard: Google and Outlook, each with a
// Connect / Disconnect row, and a plain-words note while setup is still
// needed. A second, collapsed-by-default list shows what changed on the
// connected calendars (an event moved in Google or Outlook) with one tap
// to apply the new time back to GiinMeet. Nothing here is a wall of
// buttons: two provider rows, one "check for changes" action.
interface CalendarMeeting {
  id: string;
  title: string;
  time: string;
}

interface Props {
  meetings: CalendarMeeting[];
}

interface ProviderStatus {
  provider: string;
  accountEmail: string | null;
}

export const CalendarSyncPanel: React.FC<Props> = ({ meetings }) => {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState({ google: false, outlook: false });
  const [connections, setConnections] = useState<ProviderStatus[]>([]);
  const [tokensEncrypted, setTokensEncrypted] = useState(true);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pulled, setPulled] = useState<any[] | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);

  const loadStatus = async () => {
    setLoading(true);
    const result: any = await giinApi.getCalendarStatus();
    setLoading(false);
    if (!result?.ok) {
      setStatusNote(
        result?.reason === 'NO_SESSION'
          ? 'Sign in to connect a calendar.'
          : 'Calendar sync needs the Phase C1 database setup first (run giinmeet_phaseC1.sql).',
      );
      return;
    }
    setConfigured(result.configured || { google: false, outlook: false });
    setConnections(result.connections || []);
    setTokensEncrypted(result.tokensEncrypted !== false);
    setStatusNote(null);
  };

  useEffect(() => {
    void loadStatus();
    // The OAuth callback lands back on the dashboard with a hash query
    // (?calendar=google-connected): reload the status once, then clear it.
    try {
      const hash = window.location.hash || '';
      if (hash.includes('calendar=')) {
        const match = hash.match(/calendar=([a-z-]+)/);
        if (match) {
          if (match[1] === 'needs-sql') {
            setStatusNote('Calendar sync needs the Phase C1 database setup first (run giinmeet_phaseC1.sql).');
          } else if (match[1].endsWith('-connected')) {
            setStatusNote(`Connected. Your meetings will now appear on that calendar.`);
          } else if (match[1] === 'error') {
            setStatusNote('That calendar could not be connected. Please try again.');
          }
        }
        window.history.replaceState(null, '', window.location.pathname + '#/dashboard');
      }
    } catch (e) { /* hash cleanup is best effort */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = (provider: string) =>
    connections.some((c) => c.provider === provider);

  const accountEmail = (provider: string) =>
    connections.find((c) => c.provider === provider)?.accountEmail || null;

  const handleConnect = async (provider: 'google' | 'outlook') => {
    setConnecting(provider);
    const result: any = await giinApi.connectCalendar(provider);
    setConnecting(null);
    if (result?.ok && result.authUrl) {
      window.location.href = result.authUrl;
    } else {
      setStatusNote(
        result?.message ||
          'That calendar could not be connected right now. Please try again.',
      );
    }
  };

  const handleDisconnect = async (provider: 'google' | 'outlook') => {
    const result: any = await giinApi.disconnectCalendar(provider);
    if (result?.ok) void loadStatus();
    else setStatusNote('That calendar could not be disconnected right now.');
  };

  const handlePull = async () => {
    setPulling(true);
    setPullNote(null);
    const result: any = await giinApi.pullCalendarEvents();
    setPulling(false);
    if (!result?.ok) {
      setPullNote('Could not read your calendars right now. Please try again.');
      return;
    }
    setPulled(result.events || []);
    if ((result.events || []).length === 0) {
      setPullNote('Nothing on your calendars in the next two weeks.');
    }
  };

  // Events whose GiinMeet meeting moved on the provider side.
  const changed = (pulled || []).filter((e: any) => {
    if (!e.meetingId) return false;
    const local = meetings.find((m) => m.id === e.meetingId);
    if (!local || !e.start) return false;
    return Math.abs(new Date(e.start).getTime() - new Date(local.time).getTime()) > 60 * 1000;
  });

  const handleApplyChanges = async () => {
    setApplying(true);
    const updates = changed.map((e: any) => ({ meetingId: e.meetingId, newTime: e.start }));
    const result: any = await giinApi.applyCalendarChanges(updates);
    setApplying(false);
    if (result?.ok) {
      setAppliedCount((result.applied || []).length);
      setPulled(null);
      setPullNote(null);
    } else {
      setPullNote('Those changes could not be applied. Please try again.');
    }
  };

  const providerRow = (provider: 'google' | 'outlook', label: string) => {
    const configuredNow = configured[provider];
    const connected = isConnected(provider);
    return (
      <div
        key={provider}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          padding: '0.75rem 0',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <span
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            backgroundColor: 'rgba(250,189,2,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Calendar size={17} color="var(--color-accent)" />
        </span>
        <span style={{ flex: '1 1 160px', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700 }}>{label}</span>
          <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {connected
              ? `Connected${accountEmail(provider) ? ` as ${accountEmail(provider)}` : ''}`
              : configuredNow
                ? 'Not connected yet'
                : 'Needs setup (see below)'}
          </span>
        </span>
        {connected ? (
          <button
            type="button"
            className="premium-btn premium-btn-secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            onClick={() => void handleDisconnect(provider)}
          >
            {t('cal.disconnect')}
          </button>
        ) : (
          <button
            type="button"
            className="premium-btn premium-btn-primary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            disabled={!configuredNow || connecting === provider}
            onClick={() => void handleConnect(provider)}
          >
            {connecting === provider ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <Calendar size={18} color="var(--color-accent)" />
        <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('cal.calendar_sync')}</h3>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0.25rem' }}>
        {t('cal.meetings_you_schedule_appear_on')}
      </p>
      {loading ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('cal.checking_your_calendars')}</p>
      ) : (
        <>
          {providerRow('google', 'Google Calendar')}
          <div style={{ borderBottom: 'none' }}>{providerRow('outlook', 'Outlook Calendar')}</div>
          {statusNote && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
              {statusNote}
            </p>
          )}
          {!configured.google && !configured.outlook && !statusNote && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
              {t('cal.calendar_sync_needs_setup_a')}
            </p>
          )}
          {connections.length > 0 && !tokensEncrypted && (
            <p style={{ fontSize: '0.8rem', color: '#F59E0B', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
              {t('cal.calendar_tokens_are_stored_without')}
            </p>
          )}
          {connections.length > 0 && (
            <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="premium-btn premium-btn-secondary"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                  disabled={pulling}
                  onClick={() => void handlePull()}
                >
                  <RefreshCw size={14} /> {pulling ? 'Checking…' : 'Check for changes on my calendars'}
                </button>
                {appliedCount > 0 && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <Check size={13} style={{ verticalAlign: '-2px' }} /> {appliedCount} change{appliedCount === 1 ? '' : 's'} applied.
                    <button
                      type="button"
                      className="premium-btn premium-btn-secondary"
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', marginLeft: '0.5rem' }}
                      onClick={() => window.location.reload()}
                    >
                      {t('cal.refresh_list')}
                    </button>
                  </span>
                )}
              </div>
              {pullNote && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{pullNote}</p>
              )}
              {changed.length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{t('cal.moved_on_your_calendar')}</span>
                  {changed.map((e: any) => {
                    const local = meetings.find((m) => m.id === e.meetingId);
                    return (
                      <div key={`${e.provider}-${e.eventId}`} style={{ fontSize: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 600 }}>{local?.title || e.title}</span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          moved to {new Date(e.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="premium-btn premium-btn-primary"
                    style={{ alignSelf: 'flex-start', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                    disabled={applying}
                    onClick={() => void handleApplyChanges()}
                  >
                    {applying ? 'Applying…' : t('cal.apply_change_to_giinmeet', { v1: changed.length, v2: changed.length === 1 ? '' : 's' })}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
