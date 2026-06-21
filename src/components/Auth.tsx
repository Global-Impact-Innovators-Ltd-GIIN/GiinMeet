import React, { useState } from 'react';
import { Sparkles, Mail, Lock, User, ArrowRight, Globe } from 'lucide-react';
import { mockAuth } from '../supabaseClient';

interface AuthProps {
  onAuthSuccess: (user: { email: string; name: string; workspaceName: string; domain: string }) => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [workspaceDiscovery, setWorkspaceDiscovery] = useState<{ domain: string; name: string; isPersonal?: boolean } | null>(null);
  const [customWorkspaceName, setCustomWorkspaceName] = useState('');

  // Auto discover domain on input keyups
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEmail = e.target.value;
    setEmail(inputEmail);

    if (inputEmail.includes('@')) {
      const domain = inputEmail.split('@')[1];
      const domainParts = domain.split('.');
      if (domainParts.length >= 2) {
        const lowerDomain = domain.toLowerCase();
        const isPersonalDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(lowerDomain);
        if (!isPersonalDomain) {
          const companyName = domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
          setWorkspaceDiscovery({
            domain,
            name: `${companyName} Workspace Directory`,
            isPersonal: false
          });
        } else {
          setWorkspaceDiscovery({
            domain,
            name: 'Personal Workspace',
            isPersonal: true
          });
        }
      } else {
        setWorkspaceDiscovery(null);
      }
    } else {
      setWorkspaceDiscovery(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    try {
      const workspaceArg = workspaceDiscovery?.isPersonal ? (customWorkspaceName.trim() || 'Personal Workspace') : undefined;
      if (isLogin) {
        const { data } = await mockAuth.signIn(email, workspaceArg);
        if (data.user) {
          onAuthSuccess({
            email: data.user.email,
            name: data.user.name || email.split('@')[0],
            workspaceName: data.user.workspaceName,
            domain: data.user.domain
          });
        }
      } else {
        const { data } = await mockAuth.signUp(email, name || email.split('@')[0], workspaceArg);
        if (data.user) {
          onAuthSuccess({
            email: data.user.email,
            name: data.user.name,
            workspaceName: data.user.workspaceName,
            domain: data.user.domain
          });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSSO = async () => {
    setIsLoading(true);
    // Simulate SSO select
    setTimeout(() => {
      const targetEmail = email.trim() || 'sofia.brant@gmail.com';
      const domain = targetEmail.split('@')[1] || 'gmail.com';
      const defaultName = targetEmail.split('@')[0].split('.').map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(' ');
      const isPersonalDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase());
      
      const workspace = isPersonalDomain 
        ? (customWorkspaceName.trim() || 'Personal Workspace')
        : `${domain.split('.')[0].toUpperCase()} Enterprise Workspace`;

      onAuthSuccess({
        email: targetEmail,
        name: name || defaultName,
        workspaceName: workspace,
        domain: domain
      });
      setIsLoading(false);
    }, 1200);
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--color-primary) 0%, #0B0F19 100%)',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Decorative background grid */}
      <div style={{
        position: 'absolute',
        width: '120%',
        height: '120%',
        backgroundImage: 'radial-gradient(rgba(112, 130, 190, 0.15) 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        transform: 'rotate(-5deg)',
        zIndex: 1,
        pointerEvents: 'none'
      }} />

      <div className="glass-panel" style={{
        width: '460px',
        backgroundColor: 'rgba(18, 24, 38, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '3rem 2.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
        color: 'white',
        zIndex: 10,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        animation: 'pop-in var(--transition-normal)'
      }}>
        {/* Branding header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            backgroundColor: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
            color: 'black',
            fontWeight: 800,
            fontSize: '1.4rem'
          }}>
            G
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-heading)' }}>
            Welcome to GIIN MEET
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Next-Generation Corporate Virtualization Hub
          </p>
        </div>

        {/* Form panel */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {!isLogin && (
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder="e.g. Sofia Brant"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              Email Address (Work or Personal)
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="email" 
                className="premium-input" 
                placeholder="you@company.com or you@gmail.com"
                value={email}
                onChange={handleEmailChange}
                style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                required
              />
            </div>
            
            {/* Auto workspace discovery badge */}
            {workspaceDiscovery && (
              <div style={{
                marginTop: '0.5rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                backgroundColor: workspaceDiscovery.isPersonal ? 'rgba(112, 130, 190, 0.15)' : 'rgba(250, 189, 2, 0.12)',
                border: workspaceDiscovery.isPersonal ? '1px solid rgba(112, 130, 190, 0.3)' : '1px solid rgba(250, 189, 2, 0.3)',
                color: workspaceDiscovery.isPersonal ? 'white' : 'var(--color-accent)',
                fontSize: '0.75rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                animation: 'pop-in 0.25s ease'
              }}>
                <Sparkles size={12} color={workspaceDiscovery.isPersonal ? 'var(--color-secondary)' : 'var(--color-accent)'} />
                <span>
                  {workspaceDiscovery.isPersonal 
                    ? `Personal Account: Routing to your GIIN Personal space`
                    : `Domain Recognized: Routing to ${workspaceDiscovery.name}`
                  }
                </span>
              </div>
            )}

            {/* Custom workspace name input for personal email */}
            {workspaceDiscovery?.isPersonal && (
              <div style={{ marginTop: '0.75rem', animation: 'slide-in 0.2s ease' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Custom Workspace Name (Optional)
                </label>
                <div style={{ position: 'relative' }}>
                  <Globe size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    className="premium-input" 
                    placeholder="e.g. My Study Group, Hleo's Dev Team"
                    value={customWorkspaceName}
                    onChange={(e) => setCustomWorkspaceName(e.target.value)}
                    style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
              Secret Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                type="password" 
                className="premium-input" 
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: '2.5rem', backgroundColor: '#090D16', borderColor: '#1E293B', color: 'white' }}
                required
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="premium-btn premium-btn-accent" 
            style={{ width: '100%', padding: '0.85rem', justifyContent: 'center', fontWeight: 700 }}
          >
            {isLoading ? (
              <span>Authenticating Workspace...</span>
            ) : (
              <>
                <span>{isLogin ? 'Sign In' : 'Register Securely'}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>OR ENTER WITH SSO</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }} />
        </div>

        {/* SSO Button */}
        <button 
          onClick={handleGoogleSSO}
          disabled={isLoading}
          className="premium-btn premium-btn-secondary" 
          style={{ width: '100%', borderColor: '#1E293B', color: 'white', justifyContent: 'center' }}
        >
          <Globe size={16} color="var(--color-accent)" />
          <span>Authenticate with Google Workspace</span>
        </button>

        {/* Toggle between Register/Login */}
        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {isLogin ? (
            <span>
              Don't have an enterprise account?{' '}
              <button 
                onClick={() => setIsLogin(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
              >
                Sign Up
              </button>
            </span>
          ) : (
            <span>
              Already registered your workspace?{' '}
              <button 
                onClick={() => setIsLogin(true)}
                style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
              >
                Sign In
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
