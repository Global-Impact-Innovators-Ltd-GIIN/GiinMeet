import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, ShieldCheck, Users, Video, Activity, Settings as SettingsIcon,
  Search, Wrench, ScrollText, CheckCircle2, XCircle, AlertTriangle,
  LogOut, ArrowLeft, RefreshCw, Eye, EyeOff, Copy, Ban, UserCheck,
  KeyRound, Trash2, PhoneOff, Database, Cloud, Mail, Server, FileWarning,
  BarChart3,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { tierForProfile, TIER_LABELS, type PlanTier } from '../utils/tiers';
import { applyAccentColor, applyUiStyle, applyGlassOpacity, applyFont } from '../utils/theme';
import { t } from '../i18n';

// ============================================================================
// GiinMeet Superadmin Portal — a COMPLETELY SEPARATE portal from the user
// dashboard: its own route (/superadmin), its own sign-in, its own layout
// and navigation. Nothing here mounts the user dashboard shell.
//
// Gate: the portal signs the user in, then POSTs the session token to
// /api/superadmin/verify, which checks the token AND the database
// superadmin role server-side. A signed-in non-superadmin gets Access
// Denied; a signed-out visitor gets the sign-in page. Every data call
// below goes through /api/superadmin/* with the session token, and each
// route re-verifies the role server-side — a client-side hide alone is
// never the gate.
// ============================================================================

type Section =
  | 'overview' | 'users' | 'meetings' | 'config' | 'monitoring' | 'analytics' | 'reports' | 'troubleshooting' | 'audit' | 'setup';

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Activity size={18} /> },
  { id: 'users', label: 'Users', icon: <Users size={18} /> },
  { id: 'meetings', label: 'Meetings', icon: <Video size={18} /> },
  { id: 'config', label: 'Configuration', icon: <SettingsIcon size={18} /> },
  { id: 'monitoring', label: 'Monitoring', icon: <Activity size={18} /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
  { id: 'reports', label: 'Reports', icon: <FileWarning size={18} /> },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: <Wrench size={18} /> },
  { id: 'audit', label: t('admin.audit_log'), icon: <ScrollText size={18} /> },
  { id: 'setup', label: 'Setup', icon: <Server size={18} /> },
];

const UI_STYLES = [
  'glassmorphism', 'neumorphism', 'cyberpunk-glow', 'flat-minimal', 'liquid-glass',
  'bento-grid', 'spatial-ui', 'skeuomorphism', 'minimalism', 'maximalism',
];

const FONT_OPTIONS: { heading: string; body: string; label: string }[] = [
  { heading: 'Outfit', body: 'Inter', label: t('set.sleek_sans_outfit_inter') },
  { heading: 'Playfair Display', body: 'Georgia', label: t('set.classic_serif_playfair_display_georgia') },
  { heading: 'Fira Code', body: 'Fira Code', label: t('set.monospace_tech_fira_code') },
  { heading: 'Montserrat', body: 'Montserrat', label: t('set.elegant_modern_montserrat') },
  { heading: 'Orbitron', body: 'Rajdhani', label: t('set.futuristic_glow_orbitron_rajdhani') },
  { heading: 'Poppins', body: 'Poppins', label: t('set.geometric_pop_poppins') },
  { heading: 'Space Grotesk', body: 'Space Grotesk', label: t('set.modern_grotesk_space_grotesk') },
  { heading: 'Lora', body: 'Merriweather', label: t('set.literary_serif_lora_merriweather') },
  { heading: 'Quicksand', body: 'Nunito', label: t('set.soft_rounded_quicksand_nunito') },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-lg)',
  padding: '1.25rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '40px',
  padding: '0 0.75rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-app)',
  color: 'var(--text-main)',
  fontSize: '0.9rem',
  fontFamily: 'var(--font-sans)',
};

const btnPrimary: React.CSSProperties = {
  height: '40px',
  padding: '0 1rem',
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'var(--color-accent, #3B82F6)',
  color: 'var(--color-on-accent, #fff)',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  height: '36px',
  padding: '0 0.75rem',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)',
  background: 'transparent',
  color: 'var(--text-main)',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  ...btnGhost,
  border: '1px solid #FECACA',
  color: '#DC2626',
};

// Phone layout: below 860px the sidebar becomes a top bar with a
// horizontally scrollable nav, so the content keeps the full width.
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => {
    try { return window.matchMedia('(max-width: 860px)').matches; } catch { return false; }
  });
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export const SuperadminPortal: React.FC = () => {
  const [gate, setGate] = useState<'loading' | 'signin' | 'denied' | 'portal'>('loading');
  const [gateError, setGateError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [section, setSection] = useState<Section>('overview');
  const [toast, setToast] = useState('');
  const narrow = useIsNarrow();
  const mainRef = React.useRef<HTMLElement>(null);
  // Every section starts at its top — otherwise a tall section leaves
  // the next one scrolled half-way down.
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }, [section]);

  // Apply the saved app theme so the portal feels like GiinMeet, with
  // its own dark-navy portal identity on the sidebar.
  useEffect(() => {
    try {
      const accent = localStorage.getItem('giin_accent_color') || '#3B82F6';
      const hover = localStorage.getItem('giin_accent_hover') || '#2563EB';
      applyAccentColor(accent, hover);
      const uiStyle = localStorage.getItem('giin_ui_style') || 'glassmorphism';
      const dark = localStorage.getItem('giin_dark_theme') === 'true';
      applyUiStyle(uiStyle, dark);
      applyGlassOpacity(localStorage.getItem('giin_glass_opacity') || 'frosted', dark);
      applyFont(
        localStorage.getItem('giin_font_heading') || 'Outfit',
        localStorage.getItem('giin_font_body') || 'Inter'
      );
    } catch (e) {
      /* theme is cosmetic, the portal works without it */
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }, []);

  const callAdmin = useCallback(
    async (path: string, body: Record<string, unknown> = {}): Promise<any> => {
      const token = await getToken();
      if (!token) throw new Error(t('admin.your_session_has_expired_sign'));
      const res = await fetch(`/api/superadmin/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || t('admin.the_server_refused_the_request', { v1: res.status }));
      }
      return data;
    },
    [getToken]
  );

  // Gate check on mount: an existing session enters directly.
  // Also listens for SIGNED_IN: when Google returns, supabase-js
  // establishes the session from the URL hash — if that lands a beat
  // after the first getSession() check, the sign-in page would
  // otherwise stay up even though the user is now signed in.
  useEffect(() => {
    let cancelled = false;
    const runGateCheck = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session?.access_token) {
          setGate('signin');
          return;
        }
        const res = await fetch('/api/superadmin/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: session.access_token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data.error) {
          setGate('signin');
          return;
        }
        setAdminEmail(data.email || session.user.email || '');
        setGate(data.isSuperadmin ? 'portal' : 'denied');
      } catch (e) {
        if (!cancelled) setGate('signin');
      }
    };
    runGateCheck();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: any, session: any) => {
      if (event === 'SIGNED_IN' && session?.access_token) runGateCheck();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError('');
    setSigningIn(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.session?.access_token) {
        throw new Error(error?.message || 'Sign-in failed. Check the email and password.');
      }
      const res = await fetch('/api/superadmin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.session.access_token }),
      });
      const v = await res.json().catch(() => ({}));
      if (!res.ok || v.error) {
        throw new Error(v.message || 'Could not verify this account.');
      }
      setAdminEmail(v.email || email.trim());
      setGate(v.isSuperadmin ? 'portal' : 'denied');
    } catch (err: any) {
      setGateError(err?.message || 'Sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  };

  // Google sign-in through real Supabase OAuth — same mechanism as the
  // main app's Auth screen (Auth.tsx handleGoogleSSO). Suku signs in
  // with Google, so the portal must offer it too: an email/password-only
  // sign-in is a dead end for him.
  //
  // redirectTo is /superadmin (not the plain origin): after Google
  // completes, the user lands back inside the portal and the gate below
  // verifies the Google session token exactly like a password session —
  // the gate only ever checks the token + the DB superadmin role, so a
  // Google session passes it unchanged.
  //
  // Fallback: Supabase only honours a redirectTo that is allowlisted,
  // and otherwise sends the user to the Site URL (the main dashboard).
  // The marker below lets the main app (App.tsx onAuthStateChange)
  // send that tab straight to /superadmin instead of stranding the
  // user on the dashboard. sessionStorage is per-tab, so no other tab
  // is affected, and the marker is cleared before any redirect.
  const handleGoogleSignIn = async () => {
    setGateError('');
    setSigningIn(true);
    try {
      try { sessionStorage.setItem('giin_superadmin_oauth_return', '1'); } catch (e) { /* storage unavailable, the primary redirect still works */ }
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/superadmin`,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(t('auth.no_redirect_url_returned_from'));
      }
    } catch (err: any) {
      console.error('[Superadmin] Google sign-in failed:', err);
      try { sessionStorage.removeItem('giin_superadmin_oauth_return'); } catch (e) { /* ignore */ }
      setGateError(
        err?.message || 'Google sign-in failed. Google may not be enabled for this project yet, use email sign-in instead.'
      );
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setGate('signin');
    setEmail('');
    setPassword('');
  };

  if (gate === 'loading') {
    return (
      <div style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', color: 'var(--text-muted)', overflowY: 'auto' }}>
        {t('admin.checking_your_session')}
      </div>
    );
  }

  // ---- Sign-in page (separate from the user sign-in screen) ----------
  if (gate === 'signin') {
    return (
      <div className="sa-portal" style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060911', padding: '1rem', overflowY: 'auto' }}>
      <style>{`.sa-portal button:disabled, .sa-portal input:disabled, .sa-portal select:disabled, .sa-portal textarea:disabled { opacity: 0.55; cursor: not-allowed; }`}</style>
        <div style={{ width: '100%', maxWidth: '420px', background: '#0E1628', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '2rem', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#FABD02', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0B0F19' }}>
              <Shield size={24} />
            </span>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '1.35rem', fontWeight: 800 }}>GiinMeet</div>
              <div style={{ fontSize: '0.75rem', letterSpacing: '0.14em', color: '#FABD02', fontWeight: 700 }}>{t('admin.superadmin_portal')}</div>
            </div>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', margin: '0.75rem 0 1.5rem' }}>
            {t('admin.system_administration_only_sign_in')}
          </p>
          <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <input
              type="email"
              placeholder={t('admin.superadmin_email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              style={{ ...inputStyle, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            />
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={t('admin.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ ...inputStyle, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', paddingRight: '2.5rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {gateError && (
              <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', borderRadius: '0.5rem', padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                {gateError}
              </div>
            )}
            <button type="submit" disabled={signingIn} style={{ ...btnPrimary, background: '#FABD02', color: '#0B0F19', height: '44px' }}>
              {signingIn ? 'Signing in…' : 'Enter Superadmin Portal'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.25rem 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.15)' }} />
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em' }}>{t('admin.or_continue_with')}</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.15)' }} />
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              style={{ height: '44px', width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {t('admin.continue_with_google')}
            </button>
          </form>
          <button
            onClick={() => { window.location.href = '/'; }}
            style={{ marginTop: '1rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <ArrowLeft size={15} /> {t('admin.back_to_giinmeet')}
          </button>
        </div>
      </div>
    );
  }

  // ---- Access denied (signed in, but not a superadmin) ---------------
  if (gate === 'denied') {
    return (
      <div style={{ height: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem', overflowY: 'auto' }}>
        <div style={{ ...cardStyle, maxWidth: '480px', textAlign: 'center' }}>
          <Shield size={40} color="#DC2626" style={{ margin: '0 auto 0.75rem' }} />
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', color: 'var(--text-main)' }}>{t('admin.access_denied')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.5 }}>
            {adminEmail ? <><strong>{adminEmail}</strong> {t('admin.is_signed_in_but_that')}</> : 'This account is not a superadmin.'}
            {' '}Only the superadmin account can use this portal. If this is wrong, the superadmin can grant the role from Users.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem' }}>
            <button onClick={handleSignOut} style={btnGhost}>{t('admin.sign_out')}</button>
            <button onClick={() => { window.location.href = '/'; }} style={btnPrimary}>{t('admin.back_to_giinmeet')}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Portal shell ----------------------------------------------------
  return (
    <div className="sa-portal" style={{ height: '100dvh', width: '100%', background: 'var(--bg-app)', color: 'var(--text-main)', fontFamily: 'var(--font-sans)', display: 'flex', flexDirection: narrow ? 'column' : 'row', overflow: 'hidden' }}>
      <style>{`.sa-portal button:disabled, .sa-portal input:disabled, .sa-portal select:disabled, .sa-portal textarea:disabled { opacity: 0.55; cursor: not-allowed; }`}</style>
      {toast && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', background: 'var(--color-primary)', color: '#fff', padding: '0.8rem 1.1rem', borderRadius: 'var(--radius-md)', zIndex: 1000, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={18} /> {toast}
        </div>
      )}

      {/* Portal sidebar — dark navy, distinct from the user dashboard */}
      <aside style={narrow
        ? { width: '100%', background: '#060911', color: '#fff', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: '0.6rem 0.75rem', gap: '0.35rem', flexShrink: 0, overflowX: 'auto' }
        : { width: '248px', background: '#060911', color: '#fff', display: 'flex', flexDirection: 'column', padding: '1.25rem 0.9rem', gap: '0.35rem', height: '100dvh', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0 0.4rem 1rem' }}>
          <span style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#FABD02', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0B0F19', flexShrink: 0 }}>
            <Shield size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '1.05rem', lineHeight: 1.1 }}>GiinMeet</div>
            <div style={{ fontSize: '0.65rem', letterSpacing: '0.14em', color: '#FABD02', fontWeight: 700 }}>SUPERADMIN</div>
          </div>
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setSection(n.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.7rem', width: narrow ? 'auto' : '100%',
              whiteSpace: 'nowrap', flexShrink: 0,
              padding: '0.65rem 0.8rem', borderRadius: '0.6rem', border: 'none', cursor: 'pointer',
              background: section === n.id ? '#FABD02' : 'transparent',
              color: section === n.id ? '#0B0F19' : 'rgba(255,255,255,0.75)',
              fontWeight: section === n.id ? 700 : 500, fontSize: '0.92rem', textAlign: 'left',
            }}
          >
            {n.icon} {n.label}
          </button>
        ))}
        <div style={{ marginTop: narrow ? 0 : 'auto', paddingTop: narrow ? '0.5rem' : '1rem', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: narrow ? 'row' : 'column', gap: '0.6rem', width: narrow ? '100%' : undefined, alignItems: narrow ? 'center' : undefined }}>
          <div style={{ display: narrow ? 'none' : 'block', padding: '0 0.4rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', wordBreak: 'break-all' }}>
            {t('admin.signed_in_as')}<br /><strong style={{ color: '#fff' }}>{adminEmail}</strong>
          </div>
          <button onClick={() => { window.location.href = '/'; }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0.8rem', textAlign: 'left' }}>
            <ArrowLeft size={16} /> {t('admin.back_to_giinmeet')}
          </button>
          <button onClick={handleSignOut} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0.8rem', textAlign: 'left' }}>
            <LogOut size={16} /> {t('admin.sign_out')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main ref={mainRef} className="scroll-refined" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: narrow ? '1rem 1rem 2.5rem' : '1.5rem 2rem 3rem' }}>
        <PortalBody section={section} callAdmin={callAdmin} showToast={showToast} adminEmail={adminEmail} />
      </main>
    </div>
  );
};

// ============================================================================
// Portal body — one component per section, each loading its own real data.
// ============================================================================

function SectionTitle({ title, sub, onRefresh, refreshing }: { title: string; sub: string; onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.25rem' }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>{title}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', margin: '0.3rem 0 0' }}>{sub}</p>
      </div>
      {onRefresh && (
        <button onClick={onRefresh} disabled={refreshing} style={{ ...btnGhost, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <RefreshCw size={15} /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <span style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'rgba(var(--color-accent-rgb, 59,130,246), 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)', flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-heading)', lineHeight: 1.2 }}>{value}</div>
        {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

function Notice({ kind, children }: { kind: 'warn' | 'error' | 'info'; children: React.ReactNode }) {
  const colors = {
    warn: { bg: 'rgba(245,158,11,0.1)', border: '#F59E0B', color: '#92400E' },
    error: { bg: 'rgba(239,68,68,0.08)', border: '#EF4444', color: '#991B1B' },
    info: { bg: 'rgba(59,130,246,0.08)', border: '#3B82F6', color: '#1E40AF' },
  }[kind];
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.color, borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', fontSize: '0.9rem', lineHeight: 1.5, display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
      {kind === 'warn' ? <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} /> : kind === 'error' ? <XCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} /> : <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px' }} />}
      <span>{children}</span>
    </div>
  );
}

function PortalBody({ section, callAdmin, showToast, adminEmail }: {
  section: Section;
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
  adminEmail: string;
}) {
  switch (section) {
    case 'overview': return <OverviewSection callAdmin={callAdmin} />;
    case 'users': return <UsersSection callAdmin={callAdmin} showToast={showToast} adminEmail={adminEmail} />;
    case 'meetings': return <MeetingsSection callAdmin={callAdmin} showToast={showToast} />;
    case 'config': return <ConfigSection callAdmin={callAdmin} showToast={showToast} />;
    case 'monitoring': return <MonitoringSection callAdmin={callAdmin} />;
    case 'analytics': return <AnalyticsSection callAdmin={callAdmin} />;
    case 'reports': return <ReportsSection callAdmin={callAdmin} showToast={showToast} />;
    case 'troubleshooting': return <TroubleshootingSection callAdmin={callAdmin} showToast={showToast} />;
    case 'audit': return <AuditSection callAdmin={callAdmin} />;
    case 'setup': return <SetupSection callAdmin={callAdmin} />;
    default: return null;
  }
}

// ---- Overview -------------------------------------------------------------
function OverviewSection({ callAdmin }: { callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any> }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await callAdmin('overview'));
    } catch (e: any) {
      setError(e?.message || 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>{t('admin.loading_live_numbers')}</div>;
  if (error) return <Notice kind="error">{error}</Notice>;

  const s = data?.stats || {};
  const setup = data?.setup || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <SectionTitle title={t('admin.overview')} sub="The whole system at a glance, every number below is live." onRefresh={load} refreshing={loading} />
      {!setup?.superadminSql?.ok && (
        <Notice kind="warn">
          <strong>{t('admin.setup_incomplete')}</strong> {setup?.superadminSql?.detail || 'giinmeet_superadmin.sql has not run yet.'} Until it runs, settings, the audit log and suspension are unavailable, the rest of this portal still works.
        </Notice>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label={t('admin.total_users')} value={String(s.totalUsers ?? 0)} icon={<Users size={22} />} />
        <StatCard label={t('admin.signups_this_week')} value={String(s.signupsThisWeek ?? 0)} icon={<UserCheck size={22} />} />
        <StatCard label={t('admin.meetings_live_now')} value={String(s.liveMeetings ?? 0)} sub={t('admin.scheduled_today', { v1: s.meetingsToday ?? 0 })} icon={<Video size={22} />} />
        <StatCard label={t('admin.total_meetings')} value={String(s.totalMeetings ?? 0)} icon={<Video size={22} />} />
        <StatCard
          label={t('admin.participant_minutes_this_month')}
          value={s.participantMinutesThisMonth === null ? '-' : String(s.participantMinutesThisMonth)}
          sub="Approximate, from room allocations"
          icon={<Activity size={22} />}
        />
        <StatCard
          label={t('admin.livekit_rooms_live')}
          value={String((s.livekitRooms || []).length)}
          sub={s.livekitConfigured ? 'Video server connected' : 'Video server not configured'}
          icon={<Cloud size={22} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.live_meetings_now')}</h3>
          {(data?.liveMeetingRows || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_meeting_is_in_progress')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {data.liveMeetingRows.map((m: any) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{m.title}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{m.host || '-'} · {formatDateTime(m.time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.recent_sign_ins')}</h3>
          {(data?.recentSignins || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_recent_sign_ins_recorded')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {data.recentSignins.map((r: any) => (
                <div key={r.email} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{r.email}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(r.lastSignInAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.storage_use')}</h3>
          {(s.storage || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_storage_buckets_found')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(s.storage || []).map((b: any) => (
                <div key={b.bucket} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{b.bucket}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{b.files} file{b.files === 1 ? '' : 's'} · {formatBytes(b.bytes)}{b.capped ? ' (approx.)' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.recent_superadmin_activity')}</h3>
          {(data?.recentAudit || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              {setup?.superadminSql?.ok ? 'No superadmin actions recorded yet.' : 'The audit log is not set up yet, run giinmeet_superadmin.sql.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {data.recentAudit.map((a: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span><strong>{a.action}</strong>{a.target_type ? ` · ${a.target_type}` : ''}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Users ----------------------------------------------------------------
interface PortalUser {
  id: string;
  name: string;
  email?: string;
  workspace_name: string;
  domain: string;
  phone?: string;
  is_premium: boolean;
  plan_tier?: string | null;
  is_superadmin: boolean;
  is_suspended?: boolean;
  suspended_reason?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
}

function UsersSection({ callAdmin, showToast, adminEmail }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
  adminEmail: string;
}) {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin('users');
      setUsers(d.users || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  const act = async (user: PortalUser, action: string, extra: Record<string, unknown> = {}) => {
    setBusyId(user.id);
    try {
      const d = await callAdmin('users', { action, userId: user.id, ...extra });
      if (d.warning) showToast(d.warning);
      else showToast('Done.');
      if (action === 'reset-password' && d.tempPassword) {
        setTempPassword({ email: user.email || user.id, password: d.tempPassword });
      }
      await load();
    } catch (e: any) {
      window.alert(e?.message || 'That did not work.');
    } finally {
      setBusyId('');
    }
  };

  const confirmSuspend = (user: PortalUser) => {
    if (!window.confirm(t('admin.suspend_they_will_not_be', { v1: user.name || user.email }))) return;
    const reason = window.prompt('Reason for suspension (optional):', '') || undefined;
    act(user, 'suspend', reason ? { reason } : {});
  };

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.name, u.email, u.workspace_name, u.domain].some((v) => (v || '').toLowerCase().includes(q));
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.users')} sub={t('admin.account_s_assign_tiers_suspend', { v1: users.length })} onRefresh={load} refreshing={loading} />
      {error && <Notice kind="error">{error}</Notice>}
      {tempPassword && (
        <Notice kind="warn">
          <span>
            <strong>One-time temporary password for {tempPassword.email}:</strong>{' '}
            <code style={{ fontSize: '1rem', fontWeight: 700 }}>{tempPassword.password}</code>
            {' '}copy it now and share it with the user. It is shown once and never stored.
            <button
              onClick={() => { try { navigator.clipboard.writeText(tempPassword.password); showToast('Copied.'); } catch (e) { /* clipboard unavailable */ } }}
              style={{ ...btnGhost, marginLeft: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Copy size={14} /> {t('common.copy')}
            </button>
            <button onClick={() => setTempPassword(null)} style={{ ...btnGhost, marginLeft: '0.5rem' }}>{t('admin.dismiss')}</button>
          </span>
        </Notice>
      )}
      <div style={{ ...cardStyle, padding: '1rem 1.25rem' }}>
        <div style={{ position: 'relative', maxWidth: '360px', marginBottom: '1rem' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder={t('admin.search_by_name_email_workspace')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: '2.2rem' }}
          />
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('admin.loading_users')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.user')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.tier')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.role')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.status')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.joined')}</th>
                  <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isSelf = u.email?.toLowerCase() === adminEmail.toLowerCase();
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        <div style={{ fontWeight: 700 }}>{u.name || 'Unnamed user'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', wordBreak: 'break-all' }}>{u.email || '-'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{u.workspace_name || ''}</div>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        <select
                          value={tierForProfile(u)}
                          disabled={busyId === u.id}
                          onChange={(e) => act(u, 'set-tier', { tier: e.target.value as PlanTier })}
                          style={{ ...inputStyle, height: '34px', fontSize: '0.82rem', fontWeight: 600, minWidth: '130px' }}
                          title={t('admin.free_50_people_40_min')}
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        <button
                          onClick={() => act(u, 'toggle-superadmin', { value: !u.is_superadmin })}
                          disabled={busyId === u.id || isSelf}
                          title={isSelf ? 'You cannot change your own role.' : 'Grant or revoke the superadmin role'}
                          style={{ border: 'none', background: 'none', cursor: isSelf ? 'not-allowed' : 'pointer', color: u.is_superadmin ? 'var(--color-accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: u.is_superadmin ? 700 : 400, fontSize: '0.85rem' }}
                        >
                          {u.is_superadmin ? <><ShieldCheck size={15} /> {t('admin.superadmin')}</> : <><Shield size={15} /> {t('admin.standard')}</>}
                        </button>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        {u.is_suspended ? (
                          <span style={{ color: '#DC2626', fontWeight: 700, fontSize: '0.85rem' }}>Suspended{u.suspended_reason ? `, ${u.suspended_reason}` : ''}</span>
                        ) : (
                          <span style={{ color: '#15803D', fontWeight: 600, fontSize: '0.85rem' }}>{t('admin.active')}</span>
                        )}
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                        <div style={{ fontSize: '0.78rem' }}>Last sign-in: {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'never'}</div>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {u.is_suspended ? (
                          <button onClick={() => act(u, 'activate')} disabled={busyId === u.id} style={{ ...btnGhost, marginRight: '0.4rem' }} title={t('admin.activate_this_account_again')}>
                            <UserCheck size={14} /> {t('admin.activate')}
                          </button>
                        ) : (
                          <button onClick={() => confirmSuspend(u)} disabled={busyId === u.id || u.is_superadmin || isSelf} style={{ ...btnDanger, marginRight: '0.4rem' }} title={t('admin.suspend_this_account_blocks_sign')}>
                            <Ban size={14} /> {t('admin.suspend')}
                          </button>
                        )}
                        <button onClick={() => { if (window.confirm(t('admin.reset_the_password_for_a', { v1: u.email || u.name }))) act(u, 'reset-password'); }} disabled={busyId === u.id} style={btnGhost} title={t('admin.set_a_one_time_temporary')}>
                          <KeyRound size={14} /> {t('admin.reset_password')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>{t('admin.no_matching_users')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
        {t('admin.there_is_no_payment_processor')}
      </p>
    </div>
  );
}

// ---- Meetings ---------------------------------------------------------------
function MeetingsSection({ callAdmin, showToast }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
}) {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'live' | 'scheduled' | 'completed'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin('meetings');
      setMeetings(d.meetings || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load meetings.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  const act = async (m: any, action: 'end' | 'delete') => {
    const label = action === 'end'
      ? t('admin.end_for_everyone_right_now', { v1: m.title })
      : t('admin.delete_from_history_this_is', { v1: m.title });
    if (!window.confirm(label)) return;
    setBusyId(m.id);
    try {
      const d = await callAdmin('meetings', { action, meetingId: m.id });
      if (d.warning || d.livekitWarning) showToast(d.warning || d.livekitWarning);
      else showToast(action === 'end' ? 'Meeting ended.' : 'Meeting deleted from history.');
      await load();
    } catch (e: any) {
      window.alert(e?.message || 'That did not work.');
    } finally {
      setBusyId('');
    }
  };

  const visible = meetings.filter((m) => {
    if (m.deleted_at) return false;
    if (filter === 'live') return m.status === 'In Progress';
    if (filter === 'scheduled') return m.status === 'Scheduled';
    if (filter === 'completed') return m.status === 'Completed';
    return true;
  }).filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [m.title, m.host_name, m.host].some((v) => (v || '').toLowerCase().includes(q));
  });

  const isDeletable = (m: any): boolean => {
    if (m.status === 'Completed') return true;
    if (m.status !== 'Scheduled') return false;
    return m.time ? new Date(m.time).getTime() < Date.now() : false;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('common.meetings')} sub={t('admin.meeting_s_in_total_end', { v1: meetings.filter((m) => !m.deleted_at).length })} onRefresh={load} refreshing={loading} />
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ ...cardStyle, padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          {(['all', 'live', 'scheduled', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...btnGhost,
                background: filter === f ? 'var(--color-accent)' : 'transparent',
                color: filter === f ? 'var(--color-on-accent, #fff)' : 'var(--text-main)',
                border: filter === f ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
                textTransform: 'capitalize',
              }}
            >
              {f === 'live' ? 'Live now' : f}
            </button>
          ))}
          <div style={{ position: 'relative', marginLeft: 'auto', minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" placeholder={t('admin.search_title_or_host')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '2.2rem' }} />
          </div>
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('admin.loading_meetings')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.meeting')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.host')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.when')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.people')}</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.status')}</th>
                  <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.8rem 0.5rem', fontWeight: 600 }}>{m.title}</td>
                    <td style={{ padding: '0.8rem 0.5rem' }}>{m.host_name || m.host || '-'}</td>
                    <td style={{ padding: '0.8rem 0.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(m.time)}
                      <div style={{ fontSize: '0.78rem' }}>{m.duration || ''}</div>
                    </td>
                    <td style={{ padding: '0.8rem 0.5rem' }}>{m.participant_count}</td>
                    <td style={{ padding: '0.8rem 0.5rem' }}>
                      <span style={{
                        fontWeight: 700, fontSize: '0.82rem',
                        color: m.status === 'In Progress' ? '#15803D' : m.status === 'Completed' ? 'var(--text-muted)' : 'var(--color-accent)',
                      }}>
                        {m.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.8rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {m.status === 'In Progress' && (
                        <button onClick={() => act(m, 'end')} disabled={busyId === m.id} style={{ ...btnDanger, marginRight: '0.4rem' }} title={t('admin.end_this_meeting_for_everyone')}>
                          <PhoneOff size={14} /> {t('admin.end_meeting')}
                        </button>
                      )}
                      <button
                        onClick={() => act(m, 'delete')}
                        disabled={busyId === m.id || !isDeletable(m)}
                        style={btnGhost}
                        title={isDeletable(m) ? 'Delete from history (soft delete, audited)' : 'Only completed meetings and expired scheduled meetings can be deleted, end a live meeting first, or cancel an upcoming one.'}
                      >
                        <Trash2 size={14} /> {t('admin.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>{t('admin.no_meetings_match_this_view')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Configuration ----------------------------------------------------------
// Grouped settings: General, Security, Branding. Every control below
// is wired to a real backend effect — a setting reads from and writes
// to system_settings (or the workspace_brand table) and the app reads
// the same key where the behaviour lives. Nothing here is decorative:
// a toggle with no backend does not get a place in this section.
function ConfigGroup({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.15rem', fontWeight: 800, margin: '0 0 0.2rem' }}>{title}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 0.9rem' }}>{sub}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>{children}</div>
    </section>
  );
}

function ConfigSection({ callAdmin, showToast }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
}) {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [notSetUp, setNotSetUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [brand, setBrand] = useState<any>(null);
  const [brandNotSetUp, setBrandNotSetUp] = useState(false);
  const [brandSaving, setBrandSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin('settings');
      setSettings(d.settings || {});
      setNotSetUp(!!d.notSetUp);
    } catch (e: any) {
      setError(e?.message || 'Could not load settings.');
    }
    try {
      const b = await callAdmin('brand');
      setBrand(b.brand || null);
      setBrandNotSetUp(!!b.notSetUp);
    } catch (e) {
      setBrand(null);
      setBrandNotSetUp(true);
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  const save = async (key: string, value: Record<string, unknown>) => {
    setSavingKey(key);
    try {
      await callAdmin('settings', { action: 'set', key, value });
      setSettings((prev) => ({ ...prev, [key]: value }));
      showToast('Setting saved.');
    } catch (e: any) {
      window.alert(e?.message || 'Could not save the setting.');
    } finally {
      setSavingKey('');
    }
  };

  const clearSetting = async (key: string) => {
    setSavingKey(key);
    try {
      await callAdmin('settings', { action: 'clear', key });
      setSettings((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      showToast('Setting cleared, the built-in default applies again.');
    } catch (e: any) {
      window.alert(e?.message || 'Could not clear the setting.');
    } finally {
      setSavingKey('');
    }
  };

  const saveBrand = async (b: { brand_name: string; slogan: string; logo_url: string | null; accent_color: string; accent_hover: string }) => {
    setBrandSaving(true);
    try {
      await callAdmin('brand', { action: 'set', brand: b });
      setBrand(b);
      showToast('Brand saved, every user sees it on their next load.');
    } catch (e: any) {
      window.alert(e?.message || 'Could not save the brand.');
    } finally {
      setBrandSaving(false);
    }
  };

  const resetBrand = async () => {
    if (!window.confirm(t('admin.reset_the_shared_brand_to'))) return;
    setBrandSaving(true);
    try {
      await callAdmin('brand', { action: 'reset' });
      setBrand(null);
      showToast('Brand reset to the GiinMeet default.');
    } catch (e: any) {
      window.alert(e?.message || 'Could not reset the brand.');
    } finally {
      setBrandSaving(false);
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>{t('admin.loading_configuration')}</div>;
  if (error) return <Notice kind="error">{error}</Notice>;

  const guestsCanChat = settings.guests_can_chat?.enabled === true;
  const waitingRoomDefault = settings.default_require_waiting_room?.enabled !== false;
  const limits = settings.tier_limits || { free: 50, pro: 100, enterprise: 250 };
  const durations = settings.tier_max_duration_minutes || { free: 40, pro: 1440, enterprise: 1440 };
  const defaultDuration = typeof settings.default_meeting_duration_minutes?.minutes === 'number'
    ? settings.default_meeting_duration_minutes.minutes : null;
  const accent = settings.default_accent?.color || '#3B82F6';
  const theme = settings.default_theme || { ui_style: 'glassmorphism', glass_opacity: 'frosted' };
  const font = settings.default_font || { heading: 'Outfit', body: 'Inter' };
  const banner = settings.announcement_banner || { enabled: false, message: '' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <SectionTitle title={t('admin.configuration')} sub="System-wide settings. Every change is written to the audit log." onRefresh={load} refreshing={loading} />
      {notSetUp && (
        <Notice kind="warn">
          {t('admin.system_settings_are_not_set')} <strong>giinmeet_superadmin.sql</strong> {t('admin.in_the_supabase_sql_editor')}
        </Notice>
      )}

      <ConfigGroup title={t('admin.general')} sub="Limits, defaults and announcements for the whole system.">
        {/* Tier limits */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.tier_limits')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.maximum_participants_per_meeting_and')}</p>
          <TierLimitsForm limits={limits} durations={durations} disabled={notSetUp} saving={savingKey !== ''} onSave={async (l, d) => { await save('tier_limits', l); await save('tier_max_duration_minutes', d); }} />
        </div>

        {/* Default meeting duration */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.default_meeting_duration')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.the_duration_the_dashboard_pre')}</p>
          <DurationDefaultForm
            minutes={defaultDuration}
            disabled={notSetUp}
            saving={savingKey === 'default_meeting_duration_minutes'}
            onSave={(m) => save('default_meeting_duration_minutes', { minutes: m })}
            onClear={() => clearSetting('default_meeting_duration_minutes')}
          />
        </div>

        {/* Announcement banner */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.announcement_maintenance_banner')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.shown_at_the_top_of')}</p>
          <BannerForm
            banner={{ enabled: banner.enabled === true, message: banner.message || '' }}
            disabled={notSetUp}
            saving={savingKey === 'announcement_banner'}
            onSave={(v) => save('announcement_banner', v)}
          />
        </div>
      </ConfigGroup>

      <ConfigGroup title={t('admin.security')} sub="Who can do what in meetings, enforced by the app and the video server.">
        {/* Feature flags */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.guest_chat')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.whether_people_without_an_account')}</p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: notSetUp ? 'not-allowed' : 'pointer', opacity: notSetUp ? 0.6 : 1 }}>
            <input
              type="checkbox"
              checked={guestsCanChat}
              disabled={notSetUp || savingKey === 'guests_can_chat'}
              onChange={(e) => save('guests_can_chat', { enabled: e.target.checked })}
              style={{ width: '18px', height: '18px', marginTop: '2px' }}
            />
            <span>
              <strong>{t('admin.guests_may_send_chat')}</strong>
              <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                {guestsCanChat
                  ? 'ON, guests without an account can send messages in a meeting.'
                  : 'OFF, guests can read chat but cannot send messages (today’s behaviour). Turn it on to let guests write.'}
              </span>
            </span>
          </label>
        </div>

        {/* Waiting-room default */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.waiting_room_default')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.whether_new_meetings_admit_guests')}</p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: notSetUp ? 'not-allowed' : 'pointer', opacity: notSetUp ? 0.6 : 1 }}>
            <input
              type="checkbox"
              checked={waitingRoomDefault}
              disabled={notSetUp || savingKey === 'default_require_waiting_room'}
              onChange={(e) => save('default_require_waiting_room', { enabled: e.target.checked })}
              style={{ width: '18px', height: '18px', marginTop: '2px' }}
            />
            <span>
              <strong>{t('admin.waiting_room_on_for_new')}</strong>
              <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                {waitingRoomDefault
                  ? 'ON, guests wait to be admitted. The host can still switch it off per meeting.'
                  : 'OFF, guests join new meetings directly. The host can still switch the waiting room on per meeting.'}
              </span>
            </span>
          </label>
        </div>
      </ConfigGroup>

      <ConfigGroup title={t('admin.branding')} sub="What every user sees, the shared brand, and the defaults a brand-new workspace starts with.">
        {/* Shared workspace brand */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.shared_workspace_brand')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.the_name_slogan_logo_and')}</p>
          {brandNotSetUp ? (
            <Notice kind="warn">{t('admin.shared_branding_is_not_set')} <strong>giinmeet_phase3_brand.sql</strong> {t('admin.in_the_supabase_sql_editor_2')}</Notice>
          ) : (
            <BrandForm brand={brand} disabled={notSetUp} saving={brandSaving} onSave={saveBrand} onReset={resetBrand} />
          )}
        </div>

        {/* Workspace defaults */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.defaults_for_new_workspaces')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.the_accent_theme_and_fonts')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
              {t('admin.default_accent')}
              <input
                type="color"
                value={accent}
                disabled={notSetUp}
                onChange={(e) => save('default_accent', { color: e.target.value })}
                style={{ width: '48px', height: '32px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'none', cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
              {t('admin.default_theme')}
              <select
                value={theme.ui_style}
                disabled={notSetUp}
                onChange={(e) => save('default_theme', { ui_style: e.target.value, glass_opacity: theme.glass_opacity || 'frosted' })}
                style={{ ...inputStyle, width: '200px' }}
              >
                {UI_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
              {t('admin.default_font')}
              <select
                value={`${font.heading}|${font.body}`}
                disabled={notSetUp}
                onChange={(e) => {
                  const [heading, body] = e.target.value.split('|');
                  save('default_font', { heading, body });
                }}
                style={{ ...inputStyle, width: '220px' }}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.label} value={`${f.heading}|${f.body}`}>{f.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </ConfigGroup>
    </div>
  );
}

function TierLimitsForm({ limits, durations, disabled, saving, onSave }: {
  limits: Record<string, number>;
  durations: Record<string, number>;
  disabled: boolean;
  saving: boolean;
  onSave: (limits: Record<string, number>, durations: Record<string, number>) => Promise<void>;
}) {
  const [l, setL] = useState<Record<string, number>>({ ...limits });
  const [d, setD] = useState<Record<string, number>>({ ...durations });
  useEffect(() => { setL({ ...limits }); setD({ ...durations }); }, [limits, durations]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {(['free', 'pro', 'enterprise'] as const).map((tier) => (
        <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
          <span style={{ width: '92px', fontWeight: 700, textTransform: 'capitalize' }}>{tier}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
            <input
              type="number" min={1} max={10000} value={l[tier]} disabled={disabled}
              onChange={(e) => setL((prev) => ({ ...prev, [tier]: Number(e.target.value) || 1 }))}
              style={{ ...inputStyle, width: '84px', height: '36px' }}
            /> people
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
            <input
              type="number" min={1} max={1440} value={d[tier]} disabled={disabled}
              onChange={(e) => setD((prev) => ({ ...prev, [tier]: Number(e.target.value) || 1 }))}
              style={{ ...inputStyle, width: '84px', height: '36px' }}
            /> {t('admin.min_max')}
          </label>
        </div>
      ))}
      <div>
        <button onClick={() => void onSave(l, d)} disabled={disabled || saving} style={btnPrimary}>{t('admin.save_tier_limits')}</button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>{t('admin.limits_must_grow_with_the')}</p>
    </div>
  );
}

function DurationDefaultForm({ minutes, disabled, saving, onSave, onClear }: {
  minutes: number | null;
  disabled: boolean;
  saving: boolean;
  onSave: (minutes: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [value, setValue] = useState<string>(minutes === null ? '' : String(minutes));
  useEffect(() => { setValue(minutes === null ? '' : String(minutes)); }, [minutes]);
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 5 && n <= 1440;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
        <input
          type="number" min={5} max={1440} value={value} disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder="120"
          style={{ ...inputStyle, width: '96px', height: '36px' }}
        /> minutes
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => { if (valid) void onSave(Math.round(n)); }} disabled={disabled || saving || !valid} style={btnPrimary}>{t('admin.save_default_duration')}</button>
        {minutes !== null && (
          <button onClick={() => void onClear()} disabled={disabled || saving} style={btnGhost}>{t('admin.clear_use_tier_default')}</button>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
        {minutes === null
          ? 'Not set, new meetings default to the tier default (Free 40 min, Pro / Enterprise 2 hours).'
          : t('admin.currently_minutes_the_dashboard_pre', { v1: minutes })} 5-1440 minutes.
      </p>
    </div>
  );
}

function BannerForm({ banner, disabled, saving, onSave }: {
  banner: { enabled: boolean; message: string };
  disabled: boolean;
  saving: boolean;
  onSave: (value: { enabled: boolean; message: string }) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState<boolean>(banner.enabled === true);
  const [message, setMessage] = useState<string>(banner.message || '');
  useEffect(() => {
    setEnabled(banner.enabled === true);
    setMessage(banner.message || '');
  }, [banner.enabled, banner.message]);
  const dirty = enabled !== (banner.enabled === true) || message !== (banner.message || '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => setEnabled(e.target.checked)}
          style={{ width: '18px', height: '18px' }}
        />
        <strong>{t('admin.show_the_banner')}</strong>
      </label>
      <textarea
        value={message}
        disabled={disabled}
        maxLength={300}
        rows={3}
        placeholder={t('admin.e_g_scheduled_maintenance_on')}
        onChange={(e) => setMessage(e.target.value)}
        style={{ ...inputStyle, height: 'auto', minHeight: '72px', padding: '0.6rem 0.75rem', resize: 'vertical' }}
      />
      <div>
        <button onClick={() => void onSave({ enabled, message })} disabled={disabled || saving || !dirty} style={btnPrimary}>{t('admin.save_banner')}</button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>{t('admin.the_message_saves_with_the')}</p>
    </div>
  );
}

interface BrandDraft {
  brand_name: string;
  slogan: string;
  logo_url: string | null;
  accent_color: string;
  accent_hover: string;
}

const DEFAULT_BRAND: BrandDraft = {
  brand_name: 'GiinMeet',
  slogan: 'Connect, Collaborate, Virtualize',
  logo_url: null,
  accent_color: '#3B82F6',
  accent_hover: '#2563EB',
};

function BrandForm({ brand, disabled, saving, onSave, onReset }: {
  brand: BrandDraft | null;
  disabled: boolean;
  saving: boolean;
  onSave: (b: BrandDraft) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const current: BrandDraft = brand || DEFAULT_BRAND;
  const [name, setName] = useState(current.brand_name);
  const [slogan, setSlogan] = useState(current.slogan);
  const [logo, setLogo] = useState<string | null>(current.logo_url);
  const [accentColor, setAccentColor] = useState(current.accent_color);
  const [accentHover, setAccentHover] = useState(current.accent_hover);
  const [logoError, setLogoError] = useState('');
  useEffect(() => {
    setName(current.brand_name);
    setSlogan(current.slogan);
    setLogo(current.logo_url);
    setAccentColor(current.accent_color);
    setAccentHover(current.accent_hover);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);
  const dirty =
    name !== current.brand_name ||
    slogan !== current.slogan ||
    logo !== current.logo_url ||
    accentColor !== current.accent_color ||
    accentHover !== current.accent_hover;
  const onLogoFile = (file: File | undefined) => {
    setLogoError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('Choose an image file (PNG, JPG or WebP).');
      return;
    }
    if (file.size > 1024 * 1024) {
      setLogoError('That image is over 1 MB, pick a smaller one. The logo is stored in the database, so keep it small.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result || ''));
    reader.onerror = () => setLogoError('Could not read that file.');
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <label style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {t('admin.brand_name')}
        <input type="text" value={name} disabled={disabled} maxLength={80} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {t('admin.slogan')}
        <input type="text" value={slogan} disabled={disabled} maxLength={120} onChange={(e) => setSlogan(e.target.value)} style={inputStyle} />
      </label>
      <div style={{ fontSize: '0.9rem' }}>
        <div style={{ marginBottom: '0.35rem' }}>{t('admin.logo')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {logo ? (
            <img src={logo} alt={t('admin.brand_logo_preview')} style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border-color)', background: '#fff' }} />
          ) : (
            <span style={{ width: '56px', height: '56px', borderRadius: '8px', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.25rem' }}>{t('admin.default_logo')}</span>
          )}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(e) => onLogoFile(e.target.files?.[0])} style={{ fontSize: '0.85rem', maxWidth: '220px' }} />
          {logo && (
            <button onClick={() => setLogo(null)} disabled={disabled} style={btnGhost}>{t('admin.remove_logo')}</button>
          )}
        </div>
        {logoError && <p style={{ color: '#DC2626', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>{logoError}</p>}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
        {t('admin.accent_colour')}
        <input
          type="color"
          value={accentColor}
          disabled={disabled}
          onChange={(e) => setAccentColor(e.target.value)}
          style={{ width: '48px', height: '32px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'none', cursor: 'pointer' }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
        {t('admin.accent_hover_colour')}
        <input
          type="color"
          value={accentHover}
          disabled={disabled}
          onChange={(e) => setAccentHover(e.target.value)}
          style={{ width: '48px', height: '32px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'none', cursor: 'pointer' }}
        />
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => void onSave({ brand_name: name.trim() || DEFAULT_BRAND.brand_name, slogan, logo_url: logo, accent_color: accentColor, accent_hover: accentHover })}
          disabled={disabled || saving || !dirty || name.trim().length === 0}
          style={btnPrimary}
        >
          {t('admin.save_brand')}
        </button>
        {brand !== null && (
          <button onClick={() => void onReset()} disabled={disabled || saving} style={btnGhost}>{t('admin.reset_to_default')}</button>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
        {brand === null
          ? 'No shared brand is set, everyone sees the default GiinMeet brand. Save one to change it.'
          : 'Saved brands apply when each user next loads the app, sign-in screen, meetings and header included.'}
      </p>
    </div>
  );
}

// ---- Monitoring ---------------------------------------------------------------
// ---- Analytics (Phase D, 40) -------------------------------------------
// Real numbers only, straight from the meetings, participants, profiles
// and feedback tables. Anything not measurable yet shows as a dash.
function AnalyticsSection({ callAdmin }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await callAdmin('analytics');
      setData(res?.analytics || null);
    } catch (e: any) {
      setError(e?.message || 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>{t('admin.crunching_the_real_numbers')}</div>;

  const a = data || {};
  const perDay: { date: string; count: number }[] = a.meetingsPerDay || [];
  const peak: { hour: number; count: number }[] = a.peakHours || [];
  const plans: { tier: string; users: number }[] = a.planUsage || [];
  const maxDay = Math.max(1, ...perDay.map((d) => d.count));
  const maxPeak = Math.max(1, ...peak.map((d) => d.count));
  const fb = a.feedback || null;
  const fbMax = fb ? Math.max(1, ...fb.distribution) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.analytics')} sub="Real usage from the live tables. No invented numbers: anything not measurable yet shows as a dash." onRefresh={load} refreshing={loading} />
      {error && <Notice kind="error">{error}</Notice>}
      {a.generatedAt && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>Generated {formatDateTime(a.generatedAt)}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label={t('admin.meetings_all_time')} value={String(a.totalMeetings ?? '-')} sub={t('admin.completed_live_now', { v1: a.completedMeetings ?? 0, v2: a.liveMeetings ?? 0 })} icon={<Video size={22} />} />
        <StatCard label="Accounts" value={String(a.totalUsers ?? '-')} icon={<Users size={22} />} />
        <StatCard label={t('admin.participant_minutes_month')} value={a.participantMinutesThisMonth === null || a.participantMinutesThisMonth === undefined ? '-' : String(a.participantMinutesThisMonth)} sub="Approximate" icon={<Activity size={22} />} />
        <StatCard label={t('admin.meeting_rating')} value={fb && fb.average !== null ? `${fb.average} / 5` : '-'} sub={fb ? t('admin.rating_after_meetings', { v1: fb.count, v2: fb.count === 1 ? '' : 's' }) : 'No ratings yet'} icon={<BarChart3 size={22} />} />
        <StatCard label={t('admin.open_abuse_reports')} value={a.reportsAvailable ? String(a.openReports ?? 0) : '-'} sub={a.reportsAvailable ? 'See the Reports section' : 'Needs the Phase D database setup'} icon={<FileWarning size={22} />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.meetings_per_day_last_30')}</h3>
          {perDay.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_meetings_in_the_last')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {perDay.map((d) => (
                <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                  <span style={{ width: '86px', flexShrink: 0, color: 'var(--text-muted)' }}>{d.date.slice(5)}</span>
                  <span style={{ flex: 1, height: '10px', background: 'var(--bg-app)', borderRadius: '5px', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(d.count / maxDay) * 100}%`, background: 'var(--color-accent, #3B82F6)' }} />
                  </span>
                  <span style={{ width: '28px', textAlign: 'right', fontWeight: 700 }}>{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.peak_times_utc_hour')}</h3>
          {peak.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_meeting_times_to_chart')}</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '110px' }} title={t('admin.meetings_per_utc_hour')}>
              {peak.map((h) => (
                <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{h.count > 0 ? h.count : ''}</span>
                  <span style={{ width: '100%', height: `${Math.max(h.count > 0 ? 6 : 2, (h.count / maxPeak) * 78)}px`, background: h.count === maxPeak && h.count > 0 ? '#FABD02' : 'var(--color-accent, #3B82F6)', borderRadius: '2px 2px 0 0' }} />
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{h.hour}</span>
                </div>
              ))}
            </div>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0.6rem 0 0' }}>{t('admin.hours_are_utc_rwanda_is')}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.plan_usage')}</h3>
          {plans.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_plan_data_yet')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {plans.map((p) => (
                <div key={p.tier} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{p.tier}</span>
                  <span>{p.users} account{p.users === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          )}
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '1.25rem 0 0.75rem' }}>{t('admin.top_hosts')}</h3>
          {(a.topHosts || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_host_data_yet')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(a.topHosts || []).map((h: any) => (
                <div key={h.host} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{h.host}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>{h.meetings} meeting{h.meetings === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.feedback_after_meetings')}</h3>
          {!fb ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.ratings_need_the_phase_d')}</p>
          ) : fb.count === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_ratings_yet_ratings_appear')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {[5, 4, 3, 2, 1].map((stars) => (
                <div key={stars} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                  <span style={{ width: '34px', flexShrink: 0 }}>{stars} ★</span>
                  <span style={{ flex: 1, height: '10px', background: 'var(--bg-app)', borderRadius: '5px', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(fb.distribution[stars - 1] / fbMax) * 100}%`, background: '#FABD02' }} />
                  </span>
                  <span style={{ width: '28px', textAlign: 'right', fontWeight: 700 }}>{fb.distribution[stars - 1]}</span>
                </div>
              ))}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>Average {fb.average} out of 5 from {fb.count} rating{fb.count === 1 ? '' : 's'}.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Reports (Phase D, 39) ------------------------------------------------
// Abuse and spam reports from meetings, with the two actions that matter:
// mark a report handled, or block the meeting's host from the superadmin.
function ReportsSection({ callAdmin, showToast }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
}) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await callAdmin('reports', { action: 'list' });
      if (res?.ok === false) {
        setError(res?.message || 'Reports need the Phase D database setup first (run giinmeet_phaseD.sql).');
        setReports([]);
      } else {
        setReports(res?.reports || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  const act = async (reportId: string, action: string, status?: string) => {
    setBusyId(reportId);
    try {
      await callAdmin('reports', { action, reportId, ...(status ? { status } : {}) });
      showToast(action === 'block-host' ? 'Host blocked.' : 'Report updated.');
      await load();
    } catch (e: any) {
      showToast(e?.message || 'That action failed.');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>{t('admin.loading_reports')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.reports')} sub="Meetings people reported for abuse or spam. Review them here, and block the host when a report checks out." onRefresh={load} refreshing={loading} />
      {error && <Notice kind="warn">{error}</Notice>}
      {reports.length === 0 && !error ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>{t('admin.no_reports_when_someone_reports')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {reports.map((r: any) => (
            <div key={r.id} style={{ ...cardStyle }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.95rem' }}>{r.meetingTitle || 'Meeting (deleted or unknown)'}</strong>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: r.status === 'open' ? '#DC2626' : r.status === 'resolved' ? '#059669' : '#64748B', textTransform: 'uppercase' }}>{r.status}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.6 }}>
                Host: {r.hostEmail || 'unknown'} · Reported by: {r.reporterEmail || 'anonymous'} · {formatDateTime(r.createdAt)}
                {r.meetingTime && (<> · Meeting time: {formatDateTime(r.meetingTime)}</>)}
              </div>
              <p style={{ fontSize: '0.9rem', margin: '0.6rem 0 0' }}><strong>Reason:</strong> {r.reason}</p>
              {r.detail && <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>{r.detail}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                {r.status === 'open' && (
                  <button style={btnGhost} disabled={busyId === r.id} onClick={() => void act(r.id, 'set-status', 'reviewed')}>{t('admin.mark_reviewed')}</button>
                )}
                {r.status !== 'resolved' && (
                  <button style={btnGhost} disabled={busyId === r.id} onClick={() => void act(r.id, 'set-status', 'resolved')}>{t('admin.mark_resolved')}</button>
                )}
                {r.hostId && (
                  <button style={{ ...btnGhost, borderColor: 'rgba(239,68,68,0.5)', color: '#DC2626' }} disabled={busyId === r.id} onClick={() => { if (window.confirm(t('admin.block_from_your_meetings_they', { v1: r.hostEmail || 'this host' }))) void act(r.id, 'block-host'); }}>
                    <Ban size={14} style={{ verticalAlign: '-2px', marginRight: '4px' }} />{t('admin.block_host')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonitoringSection({ callAdmin }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
}) {
  const [overview, setOverview] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Phase D (43): health checks for LiveKit, Supabase and the site.
  const [health, setHealth] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, lk, h] = await Promise.all([
        callAdmin('overview'),
        callAdmin('livekit').catch((e: any) => ({ ok: false, message: e?.message || 'LiveKit check failed.' })),
        callAdmin('health', { action: 'list' }).catch(() => null),
      ]);
      setOverview(o);
      setRooms(lk?.rooms || []);
      setHealth(h);
      if (lk && lk.ok === false) setError(lk.message || 'LiveKit is not configured.');
    } catch (e: any) {
      setError(e?.message || 'Could not load monitoring data.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  const runHealthCheck = async () => {
    setChecking(true);
    try {
      await callAdmin('health', { action: 'check' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'The health check failed to run.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>{t('admin.checking_the_live_systems')}</div>;

  const s = overview?.stats || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.monitoring')} sub="Live rooms on the video server, recent sign-ins, and system health, refreshed on demand." onRefresh={load} refreshing={loading} />
      {error && <Notice kind="warn">{error}</Notice>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label={t('admin.livekit_rooms_live')} value={String(rooms.length)} sub={s.livekitConfigured ? 'Video server connected' : 'Video server not configured'} icon={<Cloud size={22} />} />
        <StatCard label={t('admin.people_in_live_rooms')} value={String(rooms.reduce((n: number, r: any) => n + (r.participants?.length || 0), 0))} icon={<Users size={22} />} />
        <StatCard label={t('admin.meetings_live_now')} value={String(s.liveMeetings ?? 0)} sub={t('admin.scheduled_today', { v1: s.meetingsToday ?? 0 })} icon={<Video size={22} />} />
        <StatCard label={t('admin.participant_minutes_month')} value={s.participantMinutesThisMonth === null ? '-' : String(s.participantMinutesThisMonth)} sub="Approximate · LiveKit free tier: 5,000 / month" icon={<Activity size={22} />} />
      </div>

      {/* Phase D (43): service health. The latest check per service,
          open alerts, and a button to probe LiveKit, Supabase and the
          site right now. A new outage also emails the superadmin. */}
      <div style={{ ...cardStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>{t('admin.service_health')}</h3>
          <button onClick={() => void runHealthCheck()} disabled={checking} style={{ ...btnPrimary, height: '36px', fontSize: '0.85rem' }}>
            {checking ? 'Checking…' : 'Run health check'}
          </button>
        </div>
        {!health?.available ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
            {t('admin.health_monitoring_needs_the_phase')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {(() => {
              const latest = new Map<string, any>();
              for (const c of (health.checks || []) as any[]) {
                if (!latest.has(c.service)) latest.set(c.service, c);
              }
              const services = ['supabase', 'livekit', 'site'];
              return services.map((svc) => {
                const c = latest.get(svc);
                const up = c?.status === 'up';
                return (
                  <div key={svc} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{svc === 'site' ? 'This site' : svc}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{c ? c.detail : 'Not checked yet'}</span>
                    <span style={{ fontWeight: 700, color: c ? (up ? '#059669' : '#DC2626') : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {c ? (up ? 'Up' : c.status === 'down' ? 'Down' : 'Degraded') : '-'}
                    </span>
                  </div>
                );
              });
            })()}
            {(health.alerts || []).length > 0 && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', marginTop: '0.5rem' }}>
                <strong style={{ fontSize: '0.9rem', color: '#991B1B' }}>Open alerts ({health.alerts.length})</strong>
                {(health.alerts || []).map((al: any) => (
                  <div key={al.id} style={{ fontSize: '0.85rem', marginTop: '0.4rem', lineHeight: 1.5 }}>
                    <strong style={{ textTransform: 'capitalize' }}>{al.service}</strong> is {al.status}: {al.message}
                    <span style={{ color: 'var(--text-muted)' }}> · {formatDateTime(al.created_at)}{al.notified ? ' · superadmin emailed' : ' · email not sent'}</span>
                  </div>
                ))}
              </div>
            )}
            {(health.alerts || []).length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{t('admin.no_open_alerts_when_a')}</p>
            )}
          </div>
        )}
      </div>

      <div style={{ ...cardStyle }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>{t('admin.live_rooms_on_the_video')}</h3>
        {rooms.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_room_is_live_on')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {rooms.map((r: any) => (
              <div key={r.name} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <strong style={{ wordBreak: 'break-all' }}>{r.name}</strong>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.participants.length} participant{r.participants.length === 1 ? '' : 's'}</span>
                </div>
                {r.participants.length > 0 && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    {r.participants.map((p: any) => p.name || p.identity).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.recent_sign_ins')}</h3>
          {(overview?.recentSignins || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_recent_sign_ins_recorded')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {overview.recentSignins.map((r: any) => (
                <div key={r.email} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, wordBreak: 'break-all' }}>{r.email}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(r.lastSignInAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>{t('admin.error_audit_feed')}</h3>
          {(overview?.recentAudit || []).length === 0 && (overview?.recentDeletions || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.nothing_recorded_yet_superadmin_actions')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(overview?.recentAudit || []).map((a: any, i: number) => (
                <div key={`a${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span><strong>{a.action}</strong> by {a.actor_email || '-'}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</span>
                </div>
              ))}
              {(overview?.recentDeletions || []).map((d: any, i: number) => (
                <div key={`d${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span>{t('admin.meeting_deleted')} <strong>{d.meeting_title || 'Untitled'}</strong></span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(d.deleted_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Troubleshooting ----------------------------------------------------------
function TroubleshootingSection({ callAdmin, showToast }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [lookup, setLookup] = useState<any>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [meetingId, setMeetingId] = useState('');
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [checks, setChecks] = useState<any[]>([]);
  const [checksBusy, setChecksBusy] = useState(false);

  const runLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupBusy(true);
    setLookup(null);
    try {
      setLookup(await callAdmin('diagnostics', { action: 'lookup', email }));
    } catch (err: any) {
      window.alert(err?.message || 'Lookup failed.');
    } finally {
      setLookupBusy(false);
    }
  };

  const runDiagnose = async (e: React.FormEvent) => {
    e.preventDefault();
    setDiagBusy(true);
    setDiagnosis(null);
    try {
      setDiagnosis(await callAdmin('meetings', { action: 'diagnose', meetingId: meetingId.trim() }));
    } catch (err: any) {
      window.alert(err?.message || 'Diagnosis failed.');
    } finally {
      setDiagBusy(false);
    }
  };

  const loadChecks = async () => {
    setChecksBusy(true);
    try {
      const d = await callAdmin('diagnostics');
      setChecks(d.checks || []);
      showToast('Migration status refreshed.');
    } catch (err: any) {
      window.alert(err?.message || 'Could not load migration status.');
    } finally {
      setChecksBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.troubleshooting')} sub="Find a user, diagnose a meeting, and see which database migrations have actually been applied." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.user_lookup')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.auth_profile_meetings_for_one')}</p>
          <form onSubmit={runLookup} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
            <button type="submit" disabled={lookupBusy} style={btnPrimary}>{lookupBusy ? '…' : 'Look up'}</button>
          </form>
          {lookup && !lookup.found && <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>{lookup.message}</p>}
          {lookup?.found && (
            <div style={{ marginTop: '1rem', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div><strong>{lookup.user.profile?.name || lookup.user.email}</strong></div>
              <div style={{ color: 'var(--text-muted)' }}>Account created: {formatDateTime(lookup.user.created_at)}</div>
              <div style={{ color: 'var(--text-muted)' }}>Last sign-in: {formatDateTime(lookup.user.last_sign_in_at)}</div>
              <div style={{ color: 'var(--text-muted)' }}>Email confirmed: {lookup.user.email_confirmed_at ? formatDateTime(lookup.user.email_confirmed_at) : 'not confirmed'}</div>
              <div style={{ color: 'var(--text-muted)' }}>Banned until: {lookup.user.banned_until ? formatDateTime(lookup.user.banned_until) : 'not banned'}</div>
              <div>Tier: <strong>{lookup.user.profile ? TIER_LABELS[tierForProfile(lookup.user.profile)] : '-'}</strong> {t('admin.superadmin_2')} <strong>{lookup.user.profile?.is_superadmin ? 'yes' : 'no'}</strong> {t('admin.suspended')} <strong>{lookup.user.profile?.is_suspended ? 'yes' : 'no'}</strong></div>
              <div style={{ color: 'var(--text-muted)' }}>Meetings: {lookup.user.meetings_count} total, {lookup.user.live_meetings} live now</div>
              {!lookup.user.profile && <Notice kind="warn">{t('admin.this_auth_account_has_no')}</Notice>}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>{t('admin.meeting_diagnostics')}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>{t('admin.room_state_waiting_room_participants')}</p>
          <form onSubmit={runDiagnose} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="text" placeholder={t('admin.meeting_id_uuid')} value={meetingId} onChange={(e) => setMeetingId(e.target.value)} required style={inputStyle} />
            <button type="submit" disabled={diagBusy} style={btnPrimary}>{diagBusy ? '…' : 'Diagnose'}</button>
          </form>
          {diagnosis && (
            <div style={{ marginTop: '1rem', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div><strong>{diagnosis.meeting.title}</strong>, {diagnosis.meeting.status}</div>
              <div style={{ color: 'var(--text-muted)' }}>Scheduled: {formatDateTime(diagnosis.meeting.time)} · Duration: {diagnosis.meeting.duration || '-'}</div>
              <div style={{ color: 'var(--text-muted)' }}>Waiting room: {diagnosis.meeting.require_waiting_room ? 'required' : 'not required'} · Locked: {diagnosis.meeting.is_locked ? 'yes' : 'no'}</div>
              <div>
                Video room: {diagnosis.room ? (
                  <><strong>{diagnosis.room.slug}</strong>, {diagnosis.room.is_active ? 'active' : 'inactive'}, capacity {diagnosis.room.max_capacity}, engine {diagnosis.room.current_engine}</>
                ) : 'no room row exists yet'}
              </div>
              <div>
                LiveKit: {diagnosis.livekit.live ? (
                  <>room is LIVE with {diagnosis.livekit.participants.length} participant{diagnosis.livekit.participants.length === 1 ? '' : 's'}{diagnosis.livekit.participants.length > 0 ? ` (${diagnosis.livekit.participants.join(', ')})` : ''}</>
                ) : 'room is not live on the video server'}
              </div>
              <div style={{ marginTop: '0.4rem' }}>
                <strong>Participants ({(diagnosis.participants || []).length}):</strong>
                {(diagnosis.participants || []).length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}> {t('admin.none_recorded')}</span>
                ) : (
                  <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem', color: 'var(--text-muted)' }}>
                    {diagnosis.participants.map((p: any) => (
                      <li key={p.id}>{p.name}, {p.status} ({p.role})</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: 0 }}>{t('admin.migration_sql_status')}</h3>
          <button onClick={loadChecks} disabled={checksBusy} style={btnGhost}>{checksBusy ? 'Checking…' : 'Check now'}</button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>
          {t('admin.which_of_the_repos_sql')}
        </p>
        {checks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.press_check_now_to_probe')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {checks.map((c: any) => (
              <div key={c.file} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                {c.status === 'applied' ? <CheckCircle2 size={17} color="#15803D" style={{ flexShrink: 0, marginTop: '2px' }} />
                  : c.status === 'not-applied' ? <XCircle size={17} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                  : <FileWarning size={17} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />}
                <div>
                  <div><strong style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.file}</strong>, {c.what}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Audit log ----------------------------------------------------------------
function AuditSection({ callAdmin }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
}) {
  const [entries, setEntries] = useState<any[]>([]);
  const [deletions, setDeletions] = useState<any[]>([]);
  const [notSetUp, setNotSetUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin('audit', { limit: 100 });
      setEntries(d.entries || []);
      setDeletions(d.deletions || []);
      setNotSetUp(!!d.notSetUp);
    } catch (e: any) {
      setError(e?.message || 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.audit_log')} sub="Every superadmin action, with actor, action, target and time, plus the meeting-deletion trail." onRefresh={load} refreshing={loading} />
      {error && <Notice kind="error">{error}</Notice>}
      {notSetUp && (
        <Notice kind="warn">{t('admin.the_audit_log_is_not')} <strong>giinmeet_superadmin.sql</strong> {t('admin.in_the_supabase_sql_editor_3')}</Notice>
      )}
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('admin.loading_the_audit_log')}</p>
      ) : (
        <>
          <div style={cardStyle}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>{t('admin.superadmin_actions')}</h3>
            {entries.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_superadmin_actions_recorded_yet')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.when')}</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.actor')}</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.action')}</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.target')}</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>{t('admin.detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((a: any) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.7rem 0.5rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatDateTime(a.created_at)}</td>
                        <td style={{ padding: '0.7rem 0.5rem', wordBreak: 'break-all' }}>{a.actor_email || '-'}</td>
                        <td style={{ padding: '0.7rem 0.5rem', fontWeight: 700 }}>{a.action}</td>
                        <td style={{ padding: '0.7rem 0.5rem' }}>{a.target_type ? `${a.target_type}: ` : ''}{a.target_id ? String(a.target_id).slice(0, 13) : '-'}</td>
                        <td style={{ padding: '0.7rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{a.detail ? JSON.stringify(a.detail) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={cardStyle}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>{t('admin.meeting_deletions')}</h3>
            {deletions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{t('admin.no_meetings_have_been_deleted')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {deletions.map((d: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    <span><strong>{d.meeting_title || 'Untitled meeting'}</strong></span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(d.deleted_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Setup --------------------------------------------------------------------
function SetupSection({ callAdmin }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
}) {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOverview(await callAdmin('overview'));
    } catch (e: any) {
      setError(e?.message || 'Could not load setup status.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>{t('admin.checking_the_system_setup')}</div>;
  if (error) return <Notice kind="error">{error}</Notice>;

  const setup = overview?.setup || {};
  const items: { icon: React.ReactNode; title: string; ok: boolean; detail: string }[] = [
    { icon: <Database size={20} />, title: t('admin.supabase_database_auth'), ok: !!setup.supabase?.ok, detail: setup.supabase?.detail || '' },
    { icon: <Cloud size={20} />, title: t('admin.livekit_video_server'), ok: !!setup.livekit?.ok, detail: setup.livekit?.detail || '' },
    { icon: <Mail size={20} />, title: t('admin.smtp_resend_email'), ok: !!setup.resend?.ok, detail: t('admin.magic_link_and_forgot_password', { v1: setup.resend?.detail || '' }) },
    { icon: <Server size={20} />, title: t('admin.vercel_hosting'), ok: !!setup.vercel?.ok, detail: setup.vercel?.detail || '' },
    { icon: <ShieldCheck size={20} />, title: t('admin.superadmin_sql'), ok: !!setup.superadminSql?.ok, detail: setup.superadminSql?.detail || '' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title={t('admin.setup')} sub="What the system is built on, whether each piece is live, and what still needs running." onRefresh={load} refreshing={loading} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        {items.map((it) => (
          <div key={it.title} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ width: '40px', height: '40px', borderRadius: '10px', background: it.ok ? 'rgba(21,128,61,0.1)' : 'rgba(220,38,38,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: it.ok ? '#15803D' : '#DC2626' }}>{it.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-heading)' }}>{it.title}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: it.ok ? '#15803D' : '#DC2626' }}>{it.ok ? 'Live' : 'Needs attention'}</div>
              </div>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0, lineHeight: 1.5 }}>{it.detail}</p>
          </div>
        ))}
      </div>
      <div style={cardStyle}>
        <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.5rem' }}>{t('admin.to_finish_the_setup')}</h3>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.92rem', lineHeight: 1.7, color: 'var(--text-main)' }}>
          <li>{t('admin.run')} <code>giinmeet_superadmin.sql</code> {t('admin.once_in_the_supabase_sql')} <code>umeptngfntryekzxifvq</code>).</li>
          <li>{t('admin.run_any_other_sql_file')}</li>
          <li>{t('admin.sign_in_here_with_the')}</li>
        </ol>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0.75rem 0 0' }}>
          {t('admin.the_service_role_key_is')} <code>KEY_ROTATION_STEPS.md</code> {t('admin.in_the_repo_root_create')}
        </p>
      </div>
    </div>
  );
}
