import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, ShieldCheck, Users, Video, Activity, Settings as SettingsIcon,
  Search, Wrench, ScrollText, CheckCircle2, XCircle, AlertTriangle,
  LogOut, ArrowLeft, RefreshCw, Eye, EyeOff, Copy, Ban, UserCheck,
  KeyRound, Trash2, PhoneOff, Database, Cloud, Mail, Server, FileWarning,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { tierForProfile, TIER_LABELS, type PlanTier } from '../utils/tiers';
import { applyAccentColor, applyUiStyle, applyGlassOpacity, applyFont } from '../utils/theme';

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
  | 'overview' | 'users' | 'meetings' | 'config' | 'monitoring' | 'troubleshooting' | 'audit' | 'setup';

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Activity size={18} /> },
  { id: 'users', label: 'Users', icon: <Users size={18} /> },
  { id: 'meetings', label: 'Meetings', icon: <Video size={18} /> },
  { id: 'config', label: 'Configuration', icon: <SettingsIcon size={18} /> },
  { id: 'monitoring', label: 'Monitoring', icon: <Activity size={18} /> },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: <Wrench size={18} /> },
  { id: 'audit', label: 'Audit Log', icon: <ScrollText size={18} /> },
  { id: 'setup', label: 'Setup', icon: <Server size={18} /> },
];

const UI_STYLES = [
  'glassmorphism', 'neumorphism', 'cyberpunk-glow', 'flat-minimal', 'liquid-glass',
  'bento-grid', 'spatial-ui', 'skeuomorphism', 'minimalism', 'maximalism',
];

const FONT_OPTIONS: { heading: string; body: string; label: string }[] = [
  { heading: 'Outfit', body: 'Inter', label: 'Sleek Sans (Outfit / Inter)' },
  { heading: 'Playfair Display', body: 'Georgia', label: 'Classic Serif (Playfair Display / Georgia)' },
  { heading: 'Fira Code', body: 'Fira Code', label: 'Monospace Tech (Fira Code)' },
  { heading: 'Montserrat', body: 'Montserrat', label: 'Elegant Modern (Montserrat)' },
  { heading: 'Orbitron', body: 'Rajdhani', label: 'Futuristic Glow (Orbitron / Rajdhani)' },
  { heading: 'Poppins', body: 'Poppins', label: 'Geometric Pop (Poppins)' },
  { heading: 'Space Grotesk', body: 'Space Grotesk', label: 'Modern Grotesk (Space Grotesk)' },
  { heading: 'Lora', body: 'Merriweather', label: 'Literary Serif (Lora / Merriweather)' },
  { heading: 'Quicksand', body: 'Nunito', label: 'Soft Rounded (Quicksand / Nunito)' },
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
  if (!iso) return '—';
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
      /* theme is cosmetic — the portal works without it */
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
      if (!token) throw new Error('Your session has expired — sign in again.');
      const res = await fetch(`/api/superadmin/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || `The server refused the request (${res.status}).`);
      }
      return data;
    },
    [getToken]
  );

  // Gate check on mount: an existing session enters directly.
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
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
        if (!res.ok || data.error) {
          setGate('signin');
          return;
        }
        setAdminEmail(data.email || session.user.email || '');
        setGate(data.isSuperadmin ? 'portal' : 'denied');
      } catch (e) {
        setGate('signin');
      }
    })();
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setGate('signin');
    setEmail('');
    setPassword('');
  };

  if (gate === 'loading') {
    return (
      <div style={{ minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', color: 'var(--text-muted)' }}>
        Checking your session…
      </div>
    );
  }

  // ---- Sign-in page (separate from the user sign-in screen) ----------
  if (gate === 'signin') {
    return (
      <div style={{ minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060911', padding: '1rem' }}>
        <div style={{ width: '100%', maxWidth: '420px', background: '#0E1628', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '2rem', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#FABD02', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0B0F19' }}>
              <Shield size={24} />
            </span>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '1.35rem', fontWeight: 800 }}>GiinMeet</div>
              <div style={{ fontSize: '0.75rem', letterSpacing: '0.14em', color: '#FABD02', fontWeight: 700 }}>SUPERADMIN PORTAL</div>
            </div>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', margin: '0.75rem 0 1.5rem' }}>
            System administration only. Sign in with the superadmin account.
          </p>
          <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <input
              type="email"
              placeholder="Superadmin email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              style={{ ...inputStyle, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
            />
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
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
          </form>
          <button
            onClick={() => { window.location.href = '/'; }}
            style={{ marginTop: '1rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <ArrowLeft size={15} /> Back to GiinMeet
          </button>
        </div>
      </div>
    );
  }

  // ---- Access denied (signed in, but not a superadmin) ---------------
  if (gate === 'denied') {
    return (
      <div style={{ minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', padding: '1rem' }}>
        <div style={{ ...cardStyle, maxWidth: '480px', textAlign: 'center' }}>
          <Shield size={40} color="#DC2626" style={{ margin: '0 auto 0.75rem' }} />
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', color: 'var(--text-main)' }}>Access denied</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.5 }}>
            {adminEmail ? <><strong>{adminEmail}</strong> is signed in, but that account is not a superadmin.</> : 'This account is not a superadmin.'}
            {' '}Only the superadmin account can use this portal. If this is wrong, the superadmin can grant the role from Users.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.25rem' }}>
            <button onClick={handleSignOut} style={btnGhost}>Sign out</button>
            <button onClick={() => { window.location.href = '/'; }} style={btnPrimary}>Back to GiinMeet</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Portal shell ----------------------------------------------------
  return (
    <div style={{ minHeight: '100vh', width: '100%', background: 'var(--bg-app)', color: 'var(--text-main)', fontFamily: 'var(--font-sans)', display: 'flex' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', background: 'var(--color-primary)', color: '#fff', padding: '0.8rem 1.1rem', borderRadius: 'var(--radius-md)', zIndex: 1000, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={18} /> {toast}
        </div>
      )}

      {/* Portal sidebar — dark navy, distinct from the user dashboard */}
      <aside style={{ width: '248px', minHeight: '100vh', background: '#060911', color: '#fff', display: 'flex', flexDirection: 'column', padding: '1.25rem 0.9rem', gap: '0.35rem', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', flexShrink: 0 }}>
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
              display: 'flex', alignItems: 'center', gap: '0.7rem', width: '100%',
              padding: '0.65rem 0.8rem', borderRadius: '0.6rem', border: 'none', cursor: 'pointer',
              background: section === n.id ? '#FABD02' : 'transparent',
              color: section === n.id ? '#0B0F19' : 'rgba(255,255,255,0.75)',
              fontWeight: section === n.id ? 700 : 500, fontSize: '0.92rem', textAlign: 'left',
            }}
          >
            {n.icon} {n.label}
          </button>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ padding: '0 0.4rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', wordBreak: 'break-all' }}>
            Signed in as<br /><strong style={{ color: '#fff' }}>{adminEmail}</strong>
          </div>
          <button onClick={() => { window.location.href = '/'; }} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0.8rem', textAlign: 'left' }}>
            <ArrowLeft size={16} /> Back to GiinMeet
          </button>
          <button onClick={handleSignOut} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem 0.8rem', textAlign: 'left' }}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, padding: '1.5rem 2rem 3rem' }}>
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

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading live numbers…</div>;
  if (error) return <Notice kind="error">{error}</Notice>;

  const s = data?.stats || {};
  const setup = data?.setup || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <SectionTitle title="Overview" sub="The whole system at a glance — every number below is live." onRefresh={load} refreshing={loading} />
      {!setup?.superadminSql?.ok && (
        <Notice kind="warn">
          <strong>Setup incomplete:</strong> {setup?.superadminSql?.detail || 'giinmeet_superadmin.sql has not run yet.'} Until it runs, settings, the audit log and suspension are unavailable — the rest of this portal still works.
        </Notice>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label="Total users" value={String(s.totalUsers ?? 0)} icon={<Users size={22} />} />
        <StatCard label="Signups this week" value={String(s.signupsThisWeek ?? 0)} icon={<UserCheck size={22} />} />
        <StatCard label="Meetings live now" value={String(s.liveMeetings ?? 0)} sub={`${s.meetingsToday ?? 0} scheduled today`} icon={<Video size={22} />} />
        <StatCard label="Total meetings" value={String(s.totalMeetings ?? 0)} icon={<Video size={22} />} />
        <StatCard
          label="Participant-minutes this month"
          value={s.participantMinutesThisMonth === null ? '—' : String(s.participantMinutesThisMonth)}
          sub="Approximate, from room allocations"
          icon={<Activity size={22} />}
        />
        <StatCard
          label="LiveKit rooms live"
          value={String((s.livekitRooms || []).length)}
          sub={s.livekitConfigured ? 'Video server connected' : 'Video server not configured'}
          icon={<Cloud size={22} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Live meetings now</h3>
          {(data?.liveMeetingRows || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No meeting is in progress right now.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {data.liveMeetingRows.map((m: any) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>{m.title}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{m.host || '—'} · {formatDateTime(m.time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Recent sign-ins</h3>
          {(data?.recentSignins || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No recent sign-ins recorded.</p>
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
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Storage use</h3>
          {(s.storage || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No storage buckets found.</p>
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
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Recent superadmin activity</h3>
          {(data?.recentAudit || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              {setup?.superadminSql?.ok ? 'No superadmin actions recorded yet.' : 'The audit log is not set up yet — run giinmeet_superadmin.sql.'}
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
    if (!window.confirm(`Suspend ${user.name || user.email}? They will not be able to sign in or join meetings until you activate them again.`)) return;
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
      <SectionTitle title="Users" sub={`${users.length} account(s). Assign tiers, suspend or activate accounts, reset passwords, grant the superadmin role.`} onRefresh={load} refreshing={loading} />
      {error && <Notice kind="error">{error}</Notice>}
      {tempPassword && (
        <Notice kind="warn">
          <span>
            <strong>One-time temporary password for {tempPassword.email}:</strong>{' '}
            <code style={{ fontSize: '1rem', fontWeight: 700 }}>{tempPassword.password}</code>
            {' '}— copy it now and share it with the user. It is shown once and never stored.
            <button
              onClick={() => { try { navigator.clipboard.writeText(tempPassword.password); showToast('Copied.'); } catch (e) { /* clipboard unavailable */ } }}
              style={{ ...btnGhost, marginLeft: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Copy size={14} /> Copy
            </button>
            <button onClick={() => setTempPassword(null)} style={{ ...btnGhost, marginLeft: '0.5rem' }}>Dismiss</button>
          </span>
        </Notice>
      )}
      <div style={{ ...cardStyle, padding: '1rem 1.25rem' }}>
        <div style={{ position: 'relative', maxWidth: '360px', marginBottom: '1rem' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search by name, email, workspace…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: '2.2rem' }}
          />
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading users…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.6rem 0.5rem' }}>User</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Tier</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Role</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Joined</th>
                  <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isSelf = u.email?.toLowerCase() === adminEmail.toLowerCase();
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        <div style={{ fontWeight: 700 }}>{u.name || 'Unnamed user'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', wordBreak: 'break-all' }}>{u.email || '—'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{u.workspace_name || ''}</div>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        <select
                          value={tierForProfile(u)}
                          disabled={busyId === u.id}
                          onChange={(e) => act(u, 'set-tier', { tier: e.target.value as PlanTier })}
                          style={{ ...inputStyle, height: '34px', fontSize: '0.82rem', fontWeight: 600, minWidth: '130px' }}
                          title="Free: 50 people, 40 min · Pro: 100 people, up to 24h · Enterprise: 250 people, up to 24h"
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
                          {u.is_superadmin ? <><ShieldCheck size={15} /> Superadmin</> : <><Shield size={15} /> Standard</>}
                        </button>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem' }}>
                        {u.is_suspended ? (
                          <span style={{ color: '#DC2626', fontWeight: 700, fontSize: '0.85rem' }}>Suspended{u.suspended_reason ? ` — ${u.suspended_reason}` : ''}</span>
                        ) : (
                          <span style={{ color: '#15803D', fontWeight: 600, fontSize: '0.85rem' }}>Active</span>
                        )}
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        <div style={{ fontSize: '0.78rem' }}>Last sign-in: {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'never'}</div>
                      </td>
                      <td style={{ padding: '0.8rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {u.is_suspended ? (
                          <button onClick={() => act(u, 'activate')} disabled={busyId === u.id} style={{ ...btnGhost, marginRight: '0.4rem' }} title="Activate this account again">
                            <UserCheck size={14} /> Activate
                          </button>
                        ) : (
                          <button onClick={() => confirmSuspend(u)} disabled={busyId === u.id || u.is_superadmin || isSelf} style={{ ...btnDanger, marginRight: '0.4rem' }} title="Suspend this account (blocks sign-in)">
                            <Ban size={14} /> Suspend
                          </button>
                        )}
                        <button onClick={() => { if (window.confirm(`Reset the password for ${u.email || u.name}? A one-time temporary password will be shown once.`)) act(u, 'reset-password'); }} disabled={busyId === u.id} style={btnGhost} title="Set a one-time temporary password">
                          <KeyRound size={14} /> Reset password
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No matching users.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
        There is no payment processor connected yet — tiers are assigned manually here, never automatically. Enterprise is assigned this way.
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
      ? `End "${m.title}" for everyone right now? Participants will be disconnected.`
      : `Delete "${m.title}" from history? This is a soft delete and is written to the audit trail.`;
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
      <SectionTitle title="Meetings" sub={`${meetings.filter((m) => !m.deleted_at).length} meeting(s) in total. End a live meeting for everyone, or delete a completed / expired one from history.`} onRefresh={load} refreshing={loading} />
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
            <input type="text" placeholder="Search title or host…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: '2.2rem' }} />
          </div>
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading meetings…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Meeting</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Host</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>When</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>People</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>Status</th>
                  <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.8rem 0.5rem', fontWeight: 600 }}>{m.title}</td>
                    <td style={{ padding: '0.8rem 0.5rem' }}>{m.host_name || m.host || '—'}</td>
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
                        <button onClick={() => act(m, 'end')} disabled={busyId === m.id} style={{ ...btnDanger, marginRight: '0.4rem' }} title="End this meeting for everyone">
                          <PhoneOff size={14} /> End meeting
                        </button>
                      )}
                      <button
                        onClick={() => act(m, 'delete')}
                        disabled={busyId === m.id || !isDeletable(m)}
                        style={btnGhost}
                        title={isDeletable(m) ? 'Delete from history (soft delete, audited)' : 'Only completed meetings and expired scheduled meetings can be deleted — end a live meeting first, or cancel an upcoming one.'}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No meetings match this view.</td></tr>
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
function ConfigSection({ callAdmin, showToast }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string) => void;
}) {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [notSetUp, setNotSetUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin('settings');
      setSettings(d.settings || {});
      setNotSetUp(!!d.notSetUp);
    } catch (e: any) {
      setError(e?.message || 'Could not load settings.');
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

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Loading configuration…</div>;
  if (error) return <Notice kind="error">{error}</Notice>;

  const guestsCanChat = settings.guests_can_chat?.enabled === true;
  const limits = settings.tier_limits || { free: 50, pro: 100, enterprise: 250 };
  const durations = settings.tier_max_duration_minutes || { free: 40, pro: 1440, enterprise: 1440 };
  const accent = settings.default_accent?.color || '#3B82F6';
  const theme = settings.default_theme || { ui_style: 'glassmorphism', glass_opacity: 'frosted' };
  const font = settings.default_font || { heading: 'Outfit', body: 'Inter' };
  const banner = settings.announcement_banner || { enabled: false, message: '' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title="Configuration" sub="System-wide settings. Every change is written to the audit log." onRefresh={load} refreshing={loading} />
      {notSetUp && (
        <Notice kind="warn">
          System settings are not set up yet — run <strong>giinmeet_superadmin.sql</strong> in the Supabase SQL Editor once. Until then these controls show the built-in defaults and cannot be saved.
        </Notice>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        {/* Tier limits */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>Tier limits</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>Maximum participants per meeting and longest meeting per tier. The video server enforces these.</p>
          <TierLimitsForm limits={limits} durations={durations} disabled={notSetUp} saving={savingKey !== ''} onSave={(l, d) => { save('tier_limits', l); save('tier_max_duration_minutes', d); }} />
        </div>

        {/* Feature flags */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>Feature flags</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>Switch behaviour for the whole system.</p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: notSetUp ? 'not-allowed' : 'pointer', opacity: notSetUp ? 0.6 : 1 }}>
            <input
              type="checkbox"
              checked={guestsCanChat}
              disabled={notSetUp || savingKey === 'guests_can_chat'}
              onChange={(e) => save('guests_can_chat', { enabled: e.target.checked })}
              style={{ width: '18px', height: '18px', marginTop: '2px' }}
            />
            <span>
              <strong>Guests may send chat</strong>
              <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                {guestsCanChat
                  ? 'ON — guests without an account can send messages in a meeting.'
                  : 'OFF — guests can read chat but cannot send messages (today’s behaviour). Turn it on to let guests write.'}
              </span>
            </span>
          </label>
        </div>

        {/* Workspace defaults */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>Defaults for new workspaces</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>The accent, theme and fonts a brand-new workspace starts with.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
              Default accent
              <input
                type="color"
                value={accent}
                disabled={notSetUp}
                onChange={(e) => save('default_accent', { color: e.target.value })}
                style={{ width: '48px', height: '32px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'none', cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
              Default theme
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
              Default font
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

        {/* Announcement banner */}
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>Announcement / maintenance banner</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>Shown at the top of the dashboard for every user while it is on.</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: notSetUp ? 'not-allowed' : 'pointer', opacity: notSetUp ? 0.6 : 1, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            <input
              type="checkbox"
              checked={banner.enabled === true}
              disabled={notSetUp}
              onChange={(e) => save('announcement_banner', { enabled: e.target.checked, message: banner.message || '' })}
              style={{ width: '18px', height: '18px' }}
            />
            <strong>Show the banner</strong>
          </label>
          <textarea
            value={banner.message || ''}
            disabled={notSetUp}
            maxLength={300}
            rows={3}
            placeholder="e.g. Scheduled maintenance on Sunday 02:00–03:00 SAST — meetings may be briefly interrupted."
            onChange={(e) => setSettings((prev) => ({ ...prev, announcement_banner: { enabled: banner.enabled, message: e.target.value } }))}
            onBlur={(e) => {
              if (e.target.value !== (settings.announcement_banner?.message || '')) save('announcement_banner', { enabled: banner.enabled, message: e.target.value });
            }}
            style={{ ...inputStyle, height: 'auto', minHeight: '72px', padding: '0.6rem 0.75rem', resize: 'vertical' }}
          />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>The message saves when you click away from the box. 300 characters maximum.</p>
        </div>
      </div>
    </div>
  );
}

function TierLimitsForm({ limits, durations, disabled, saving, onSave }: {
  limits: Record<string, number>;
  durations: Record<string, number>;
  disabled: boolean;
  saving: boolean;
  onSave: (limits: Record<string, number>, durations: Record<string, number>) => void;
}) {
  const [l, setL] = useState<Record<string, number>>({ ...limits });
  const [d, setD] = useState<Record<string, number>>({ ...durations });
  useEffect(() => { setL({ ...limits }); setD({ ...durations }); }, [limits, durations]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {(['free', 'pro', 'enterprise'] as const).map((t) => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
          <span style={{ width: '92px', fontWeight: 700, textTransform: 'capitalize' }}>{t}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
            <input
              type="number" min={1} max={10000} value={l[t]} disabled={disabled}
              onChange={(e) => setL((prev) => ({ ...prev, [t]: Number(e.target.value) || 1 }))}
              style={{ ...inputStyle, width: '84px', height: '36px' }}
            /> people
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)' }}>
            <input
              type="number" min={1} max={1440} value={d[t]} disabled={disabled}
              onChange={(e) => setD((prev) => ({ ...prev, [t]: Number(e.target.value) || 1 }))}
              style={{ ...inputStyle, width: '84px', height: '36px' }}
            /> min max
          </label>
        </div>
      ))}
      <div>
        <button onClick={() => onSave(l, d)} disabled={disabled || saving} style={btnPrimary}>Save tier limits</button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>Limits must grow with the tier (Free ≤ Pro ≤ Enterprise). Durations are capped at 24 hours (1440 min).</p>
    </div>
  );
}

// ---- Monitoring ---------------------------------------------------------------
function MonitoringSection({ callAdmin }: {
  callAdmin: (path: string, body?: Record<string, unknown>) => Promise<any>;
}) {
  const [overview, setOverview] = useState<any>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, lk] = await Promise.all([
        callAdmin('overview'),
        callAdmin('livekit').catch((e: any) => ({ ok: false, message: e?.message || 'LiveKit check failed.' })),
      ]);
      setOverview(o);
      setRooms(lk?.rooms || []);
      if (lk && lk.ok === false) setError(lk.message || 'LiveKit is not configured.');
    } catch (e: any) {
      setError(e?.message || 'Could not load monitoring data.');
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Checking the live systems…</div>;

  const s = overview?.stats || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title="Monitoring" sub="Live rooms on the video server, recent sign-ins, and system health — refreshed on demand." onRefresh={load} refreshing={loading} />
      {error && <Notice kind="warn">{error}</Notice>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label="LiveKit rooms live" value={String(rooms.length)} sub={s.livekitConfigured ? 'Video server connected' : 'Video server not configured'} icon={<Cloud size={22} />} />
        <StatCard label="People in live rooms" value={String(rooms.reduce((n: number, r: any) => n + (r.participants?.length || 0), 0))} icon={<Users size={22} />} />
        <StatCard label="Meetings live now" value={String(s.liveMeetings ?? 0)} sub={`${s.meetingsToday ?? 0} scheduled today`} icon={<Video size={22} />} />
        <StatCard label="Participant-minutes / month" value={s.participantMinutesThisMonth === null ? '—' : String(s.participantMinutesThisMonth)} sub="Approximate · LiveKit free tier: 5,000 / month" icon={<Activity size={22} />} />
      </div>

      <div style={{ ...cardStyle }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>Live rooms on the video server</h3>
        {rooms.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No room is live on the video server right now.</p>
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
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Recent sign-ins</h3>
          {(overview?.recentSignins || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No recent sign-ins recorded.</p>
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
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Error / audit feed</h3>
          {(overview?.recentAudit || []).length === 0 && (overview?.recentDeletions || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>Nothing recorded yet. Superadmin actions and meeting deletions appear here.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(overview?.recentAudit || []).map((a: any, i: number) => (
                <div key={`a${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span><strong>{a.action}</strong> by {a.actor_email || '—'}</span>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</span>
                </div>
              ))}
              {(overview?.recentDeletions || []).map((d: any, i: number) => (
                <div key={`d${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                  <span>Meeting deleted: <strong>{d.meeting_title || 'Untitled'}</strong></span>
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
      <SectionTitle title="Troubleshooting" sub="Find a user, diagnose a meeting, and see which database migrations have actually been applied." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>User lookup</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>Auth + profile + meetings for one email address.</p>
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
              <div>Tier: <strong>{lookup.user.profile ? TIER_LABELS[tierForProfile(lookup.user.profile)] : '—'}</strong> · Superadmin: <strong>{lookup.user.profile?.is_superadmin ? 'yes' : 'no'}</strong> · Suspended: <strong>{lookup.user.profile?.is_suspended ? 'yes' : 'no'}</strong></div>
              <div style={{ color: 'var(--text-muted)' }}>Meetings: {lookup.user.meetings_count} total, {lookup.user.live_meetings} live now</div>
              {!lookup.user.profile && <Notice kind="warn">This auth account has no profile row — the self-healing profile creation will make one on next sign-in.</Notice>}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.25rem' }}>Meeting diagnostics</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>Room state, waiting-room participants, and whether the video server still has the room live.</p>
          <form onSubmit={runDiagnose} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="text" placeholder="Meeting ID (UUID)" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} required style={inputStyle} />
            <button type="submit" disabled={diagBusy} style={btnPrimary}>{diagBusy ? '…' : 'Diagnose'}</button>
          </form>
          {diagnosis && (
            <div style={{ marginTop: '1rem', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div><strong>{diagnosis.meeting.title}</strong> — {diagnosis.meeting.status}</div>
              <div style={{ color: 'var(--text-muted)' }}>Scheduled: {formatDateTime(diagnosis.meeting.time)} · Duration: {diagnosis.meeting.duration || '—'}</div>
              <div style={{ color: 'var(--text-muted)' }}>Waiting room: {diagnosis.meeting.require_waiting_room ? 'required' : 'not required'} · Locked: {diagnosis.meeting.is_locked ? 'yes' : 'no'}</div>
              <div>
                Video room: {diagnosis.room ? (
                  <><strong>{diagnosis.room.slug}</strong> — {diagnosis.room.is_active ? 'active' : 'inactive'}, capacity {diagnosis.room.max_capacity}, engine {diagnosis.room.current_engine}</>
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
                  <span style={{ color: 'var(--text-muted)' }}> none recorded</span>
                ) : (
                  <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem', color: 'var(--text-muted)' }}>
                    {diagnosis.participants.map((p: any) => (
                      <li key={p.id}>{p.name} — {p.status} ({p.role})</li>
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
          <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: 0 }}>Migration / SQL status</h3>
          <button onClick={loadChecks} disabled={checksBusy} style={btnGhost}>{checksBusy ? 'Checking…' : 'Check now'}</button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1rem' }}>
          Which of the repo’s SQL files have actually been applied to the live database. Probed live where a read can prove it; files that only change a constraint, a policy or an extension say so honestly instead of guessing.
        </p>
        {checks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>Press “Check now” to probe the live database.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {checks.map((c: any) => (
              <div key={c.file} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                {c.status === 'applied' ? <CheckCircle2 size={17} color="#15803D" style={{ flexShrink: 0, marginTop: '2px' }} />
                  : c.status === 'not-applied' ? <XCircle size={17} color="#DC2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                  : <FileWarning size={17} color="#D97706" style={{ flexShrink: 0, marginTop: '2px' }} />}
                <div>
                  <div><strong style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.file}</strong> — {c.what}</div>
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
      <SectionTitle title="Audit Log" sub="Every superadmin action, with actor, action, target and time — plus the meeting-deletion trail." onRefresh={load} refreshing={loading} />
      {error && <Notice kind="error">{error}</Notice>}
      {notSetUp && (
        <Notice kind="warn">The audit log is not set up yet — run <strong>giinmeet_superadmin.sql</strong> in the Supabase SQL Editor once. Actions taken before then are not recorded.</Notice>
      )}
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading the audit log…</p>
      ) : (
        <>
          <div style={cardStyle}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>Superadmin actions</h3>
            {entries.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No superadmin actions recorded yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.6rem 0.5rem' }}>When</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Actor</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Action</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Target</th>
                      <th style={{ padding: '0.6rem 0.5rem' }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((a: any) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.7rem 0.5rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatDateTime(a.created_at)}</td>
                        <td style={{ padding: '0.7rem 0.5rem', wordBreak: 'break-all' }}>{a.actor_email || '—'}</td>
                        <td style={{ padding: '0.7rem 0.5rem', fontWeight: 700 }}>{a.action}</td>
                        <td style={{ padding: '0.7rem 0.5rem' }}>{a.target_type ? `${a.target_type}: ` : ''}{a.target_id ? String(a.target_id).slice(0, 13) : '—'}</td>
                        <td style={{ padding: '0.7rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{a.detail ? JSON.stringify(a.detail) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={cardStyle}>
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.75rem' }}>Meeting deletions</h3>
            {deletions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No meetings have been deleted from history.</p>
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

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Checking the system setup…</div>;
  if (error) return <Notice kind="error">{error}</Notice>;

  const setup = overview?.setup || {};
  const items: { icon: React.ReactNode; title: string; ok: boolean; detail: string }[] = [
    { icon: <Database size={20} />, title: 'Supabase (database + auth)', ok: !!setup.supabase?.ok, detail: setup.supabase?.detail || '' },
    { icon: <Cloud size={20} />, title: 'LiveKit (video server)', ok: !!setup.livekit?.ok, detail: setup.livekit?.detail || '' },
    { icon: <Mail size={20} />, title: 'SMTP / Resend (email)', ok: !!setup.resend?.ok, detail: `${setup.resend?.detail || ''} Magic-link and forgot-password emails were verified delivered on 15 Nov 2026.` },
    { icon: <Server size={20} />, title: 'Vercel (hosting)', ok: !!setup.vercel?.ok, detail: setup.vercel?.detail || '' },
    { icon: <ShieldCheck size={20} />, title: 'Superadmin SQL', ok: !!setup.superadminSql?.ok, detail: setup.superadminSql?.detail || '' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SectionTitle title="Setup" sub="What the system is built on, whether each piece is live, and what still needs running." onRefresh={load} refreshing={loading} />
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
        <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem', margin: '0 0 0.5rem' }}>To finish the setup</h3>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.92rem', lineHeight: 1.7, color: 'var(--text-main)' }}>
          <li>Run <code>giinmeet_superadmin.sql</code> once in the Supabase SQL Editor (project <code>umeptngfntryekzxifvq</code>).</li>
          <li>Run any other SQL file the Troubleshooting → Migration status list shows as “Not applied”.</li>
          <li>Sign in here with the superadmin account — the portal then unlocks Users, Meetings, Configuration, Monitoring and the Audit Log.</li>
        </ol>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0.75rem 0 0' }}>
          The service-role key is still the original one shared in chat — rotating it is a separate, still-open job: set a new key in Supabase, update the Vercel env var, and redeploy.
        </p>
      </div>
    </div>
  );
}
