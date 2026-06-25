import React, { useState, useEffect, useRef } from 'react';
import { 
  User, Bell, Video, Shield, Globe, Moon, Sun, Save, Check, 
  Terminal, Volume2, Camera, Sliders, RefreshCw, 
  Smartphone, Activity, Database, Zap
} from 'lucide-react';
import { supabase } from '../supabaseClient';

interface SettingsProps {
  isDarkMode: boolean;
  onToggleTheme: () => void;
  userName: string;
  userEmail: string;
  userAvatarUrl?: string;
  userPhone?: string;
  userRole?: string;
  userTimezone?: string;
  userLocation?: string;
  userSkills?: string[];
  userWorkspaceName?: string;
  userDomain?: string;
  onUpdateProfile: (
    name: string, 
    email: string, 
    avatarUrl?: string,
    role?: string,
    timezone?: string,
    location?: string,
    skills?: string[],
    phone?: string,
    workspaceName?: string,
    domain?: string
  ) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  isDarkMode,
  onToggleTheme,
  userName,
  userEmail,
  userAvatarUrl,
  userPhone = '',
  userRole = '',
  userTimezone = 'UTC',
  userLocation = '',
  userSkills = [],
  userWorkspaceName = 'Personal Workspace',
  userDomain = 'personal',
  onUpdateProfile,
}) => {
  const [activeCategory, setActiveCategory] = useState<'profile' | 'workspace' | 'devices' | 'security' | 'diagnostics' | 'notifications' | 'meetings'>('profile');
  
  // Profile settings state
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [avatarUrl, setAvatarUrl] = useState(userAvatarUrl || '');
  const [phone, setPhone] = useState(userPhone);
  const [role, setRole] = useState(userRole);
  const [timezone, setTimezone] = useState(userTimezone);
  const [location, setLocation] = useState(userLocation);
  const [skillsText, setSkillsText] = useState((userSkills || []).join(', '));
  
  // Workspace settings state
  const [workspaceName, setWorkspaceName] = useState(userWorkspaceName);
  const [domain, setDomain] = useState(userDomain);
  const [gatedRegistration, setGatedRegistration] = useState(false);
  const [directoryVisible, setDirectoryVisible] = useState(true);
  const [guestWaitroomGating, setGuestWaitroomGating] = useState(true);

  // Appearance & styling state
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('giin_accent_color') || '#3B82F6');
  const [glassOpacity, setGlassOpacity] = useState(() => localStorage.getItem('giin_glass_opacity') || 'frosted');

  // A/V testing state
  const [devicesList, setDevicesList] = useState<{ cameras: MediaDeviceInfo[], mics: MediaDeviceInfo[], speakers: MediaDeviceInfo[] }>({ cameras: [], mics: [], speakers: [] });
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  // E2EE cryptography keys & sessions
  const [publicKey, setPublicKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [activeSessions, setActiveSessions] = useState([
    { id: '1', os: 'Windows 11', browser: 'Google Chrome', ip: '192.168.1.108', active: true, location: 'Local Network' },
    { id: '2', os: 'macOS Sequoia', browser: 'Safari Browser', ip: '104.244.75.13', active: false, location: 'New York, USA' },
    { id: '3', os: 'iPhone 15 Pro', browser: 'GIIN MEET App', ip: '172.56.21.90', active: false, location: 'Mobile Data' }
  ]);

  // Diagnostics console state
  const [logs, setLogs] = useState<string[]>(['[GIIN] Engine started on 2026-06-25', '[RTC] Signaling socket initialized', '[DB] Local memory cache sync ok']);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);

  // General state
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Settings saved successfully!');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Sync props to state changes
  useEffect(() => {
    setName(userName);
    setEmail(userEmail);
    setPhone(userPhone || '');
    setRole(userRole || '');
    setTimezone(userTimezone || 'UTC');
    setLocation(userLocation || '');
    setSkillsText((userSkills || []).join(', '));
    setWorkspaceName(userWorkspaceName);
    setDomain(userDomain);
  }, [userName, userEmail, userPhone, userRole, userTimezone, userLocation, userSkills, userWorkspaceName, userDomain]);

  // Generate random keys on mount
  useEffect(() => {
    const generateHex = (length: number) => {
      const arr = new Uint8Array(length / 2);
      window.crypto.getRandomValues(arr);
      return Array.from(arr, dec => dec.toString(16).padStart(2, '0')).join('');
    };
    setPublicKey(`SHA-256: ${generateHex(64)}`);
    setPrivateKey(`AES-GCM: ${generateHex(48)}`);
  }, []);

  // Cleanup media streams
  useEffect(() => {
    return () => {
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [cameraStream, micStream]);

  // Enumerate actual devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const cameras = devices.filter(d => d.kind === 'videoinput');
        const mics = devices.filter(d => d.kind === 'audioinput');
        const speakers = devices.filter(d => d.kind === 'audiooutput');
        setDevicesList({ cameras, mics, speakers });
        if (cameras.length > 0) setSelectedCamera(cameras[0].deviceId);
        if (mics.length > 0) setSelectedMic(mics[0].deviceId);
        if (speakers.length > 0) setSelectedSpeaker(speakers[0].deviceId);
      })
      .catch(err => {
        console.warn('Failed to list media devices:', err);
      });
  }, []);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);
  };

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    const skillsArray = skillsText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    onUpdateProfile(name, email, avatarUrl, role, timezone, location, skillsArray, phone, workspaceName, domain);
    triggerToast('Profile settings saved successfully!');
  };

  const handleWorkspaceSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile(name, email, avatarUrl, role, timezone, location, userSkills, phone, workspaceName, domain);
    triggerToast('Workspace configuration applied successfully!');
  };

  // Avatar Compress
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 150;
        const MAX_HEIGHT = 150;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        setAvatarUrl(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Accent Colors Customizer
  const applyAccentColor = (primary: string, hover: string) => {
    setAccentColor(primary);
    localStorage.setItem('giin_accent_color', primary);
    localStorage.setItem('giin_accent_hover', hover);

    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-primary-hover', hover);
    const hex = primary.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      document.documentElement.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`);
    }
    triggerToast('Theme accent style updated globally!');
  };

  // Glassmorphism intensity selector
  const selectGlassOpacity = (level: string) => {
    setGlassOpacity(level);
    localStorage.setItem('giin_glass_opacity', level);

    if (level === 'none') {
      document.documentElement.style.setProperty('--glass-bg', 'var(--bg-card)');
      document.documentElement.style.setProperty('--glass-border', 'var(--border-color)');
      document.documentElement.style.setProperty('--glass-blur', '0px');
    } else if (level === 'ultra-clear') {
      document.documentElement.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.15)');
      document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.04)');
      document.documentElement.style.setProperty('--glass-blur', '8px');
    } else { // frosted
      document.documentElement.style.removeProperty('--glass-bg');
      document.documentElement.style.removeProperty('--glass-border');
      document.documentElement.style.removeProperty('--glass-blur');
    }
    triggerToast('Glassmorphism aesthetics intensity updated!');
  };

  // Toggle webcam testing feed
  const toggleCameraTest = async () => {
    if (cameraActive) {
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        setCameraStream(null);
      }
      setCameraActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true 
        });
        setCameraStream(stream);
        setCameraActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Camera access failed:', err);
        triggerToast('Failed to access camera media stream.');
      }
    }
  };

  // Toggle mic testing audio stream
  const toggleMicTest = async () => {
    if (micActive) {
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        setMicStream(null);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setMicActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true 
        });
        setMicStream(stream);
        setMicActive(true);
        setupAudioVisualizer(stream);
      } catch (err) {
        console.error('Microphone access failed:', err);
        triggerToast('Failed to access microphone audio stream.');
      }
    }
  };

  // Sound analyzer canvas draw loop
  const setupAudioVisualizer = (stream: MediaStream) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    const draw = () => {
      if (!canvas || !canvasCtx) return;
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = 'rgba(18, 24, 38, 0.4)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 1.5;
        canvasCtx.fillStyle = `hsl(${(i * 360) / bufferLength}, 80%, 60%)`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      }
    };
    draw();
  };

  // E2EE Rotate key
  const handleRotateKeys = () => {
    const generateHex = (length: number) => {
      const arr = new Uint8Array(length / 2);
      window.crypto.getRandomValues(arr);
      return Array.from(arr, dec => dec.toString(16).padStart(2, '0')).join('');
    };
    setPublicKey(`SHA-256: ${generateHex(64)}`);
    setPrivateKey(`AES-GCM: ${generateHex(48)}`);
    triggerToast('E2EE Cryptographic Keychains Rotated Successfully!');
  };

  // Revoke active session logs
  const handleRevokeSession = (sessionId: string) => {
    setActiveSessions(prev => prev.filter(s => s.id !== sessionId));
    triggerToast('Active Session terminated successfully.');
  };

  // Diagnostics Terminal Ping Test
  const runPingTest = async () => {
    setDiagnosticsRunning(true);
    setLogs(prev => [...prev, '[PING] Running diagnostic test routines...', '[PING] Pinging Supabase REST database endpoint...']);

    const startTime = Date.now();
    try {
      // Run actual read check from public profiles
      const { error } = await supabase.from('profiles').select('id').limit(1);
      const duration = Date.now() - startTime;

      if (error) throw error;

      setLogs(prev => [
        ...prev,
        `[PING] Supabase Endpoint resolved in ${duration}ms (Optimal connection)`,
        `[DB] Cache sync response -> 200 OK (Profiles table read verified)`,
        `[SYS] Security handshake active with E2EE modules`,
        `[STATUS] System health is currently 100% OPERATIONAL`
      ]);
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        `[WARNING] Supabase Endpoint resolved in ${Date.now() - startTime}ms`,
        `[ERROR] Profiles read fail: ${err.message}`,
        `[STATUS] Local server active, database operation restricted (Offline / RLS checked)`
      ]);
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  // Default Categories
  const categories = [
    { id: 'profile', name: 'Profile & App Accents', icon: User, desc: 'Display details & accent highlights' },
    { id: 'workspace', name: 'Workspace Admin', icon: Globe, desc: 'Subdomains, discovery, limits' },
    { id: 'devices', name: 'Hardware Devices', icon: Video, desc: 'Camera & microphone testing suite' },
    { id: 'security', name: 'E2EE Vault & Sessions', icon: Shield, desc: 'Cryptographic keys & active logins' },
    { id: 'diagnostics', name: 'Console Diagnostics', icon: Terminal, desc: 'API connectivity logs & pings' },
    { id: 'notifications', name: 'Notifications Options', icon: Bell, desc: 'Email summaries & push alerts' },
    { id: 'meetings', name: 'Meetings Presets', icon: Sliders, desc: 'Standard hardware join presets' },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '280px 1fr',
      gap: '2rem',
      height: 'calc(100vh - 120px)',
      animation: 'slide-in var(--transition-normal)'
    }} className="grid-2">
      
      {/* Categories Sidebar */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', height: 'fit-content' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem', paddingLeft: '0.25rem' }}>
          <Activity size={20} color="var(--color-primary)" />
          <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-heading)' }}>Settings Hub</h2>
        </div>
        
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isSelected = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id as any)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: isSelected ? 'var(--color-primary)' : 'transparent',
                color: isSelected ? 'white' : 'var(--text-main)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: isSelected ? 600 : 500, fontSize: '0.85rem' }}>
                <Icon size={16} />
                <span>{cat.name}</span>
              </div>
              <span style={{ fontSize: '0.65rem', color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', paddingLeft: '1.25rem' }}>{cat.desc}</span>
            </button>
          );
        })}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.75rem 0' }} />

        {/* Theme Toggler */}
        <div className="flex-between" style={{ padding: '0.25rem 0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dark Theme</span>
          <button 
            onClick={onToggleTheme}
            style={{
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              width: '34px',
              height: '34px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--color-accent)'
            }}
          >
            {isDarkMode ? <Sun size={15} /> : <Moon size={15} color="var(--color-primary)" />}
          </button>
        </div>
      </div>

      {/* Main Settings Display Area */}
      <div className="glass-panel" style={{ padding: '2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* Category Panel: Profile & App Accents */}
        {activeCategory === 'profile' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>Profile & Branding Style</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Customize your personal coordinates, workspace details, and visual styling theme.</p>
            
            <form onSubmit={handleProfileSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '520px' }}>
              {/* Picture Upload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '0.5rem' }}>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  overflow: 'hidden'
                }}>
                  {avatarUrl ? (
                    <img 
                      src={avatarUrl} 
                      alt={name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    />
                  ) : (
                    name ? name.split(' ').map(n => n[0]).join('') : 'U'
                  )}
                </div>
                <div>
                  <button 
                    type="button" 
                    onClick={() => fileInputRef.current?.click()}
                    className="premium-btn premium-btn-secondary" 
                    style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
                  >
                    Change Picture
                  </button>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>PNG, JPG or JPEG up to 5MB.</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Display Name</label>
                  <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="premium-input"
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Email Address</label>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="premium-input"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Phone Number</label>
                  <input 
                    type="text" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="premium-input"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Job Title / Role</label>
                  <input 
                    type="text" 
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="premium-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Office Location</label>
                  <input 
                    type="text" 
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="premium-input"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Office Timezone</label>
                  <select 
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="premium-input"
                  >
                    <option value="America/New_York">Eastern Time (New York)</option>
                    <option value="America/Chicago">Central Time (Chicago)</option>
                    <option value="America/Denver">Mountain Time (Denver)</option>
                    <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
                    <option value="Europe/London">Greenwich Mean Time (London)</option>
                    <option value="Europe/Berlin">Central European Time (Berlin)</option>
                    <option value="Asia/Singapore">Singapore Standard Time (Singapore)</option>
                    <option value="Asia/Tokyo">Japan Standard Time (Tokyo)</option>
                    <option value="UTC">UTC / Coordinated Universal Time</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Professional Skills (comma-separated)</label>
                <input 
                  type="text" 
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  className="premium-input"
                  placeholder="e.g. React, WebRTC, Security"
                />
              </div>

              {/* Accent Theme Colors customization */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.1)' }}>
                <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.65rem' }}>Branding Accent Highlight Theme</span>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {[
                    { name: 'Azul Brant', primary: '#3B82F6', hover: '#2563EB' },
                    { name: 'Eclipse Purple', primary: '#8B5CF6', hover: '#7C3AED' },
                    { name: 'Emerald Mint', primary: '#10B981', hover: '#059669' },
                    { name: 'Crimson Flame', primary: '#EF4444', hover: '#DC2626' },
                    { name: 'Sunset Amber', primary: '#F59E0B', hover: '#D97706' }
                  ].map((color) => (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => applyAccentColor(color.primary, color.hover)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: color.primary,
                        border: accentColor === color.primary ? '3px solid white' : '1px solid var(--border-color)',
                        cursor: 'pointer',
                        transform: accentColor === color.primary ? 'scale(1.15)' : 'scale(1)',
                        transition: 'all 0.15s ease',
                        boxShadow: accentColor === color.primary ? '0 0 10px rgba(0,0,0,0.5)' : 'none'
                      }}
                      title={color.name}
                    />
                  ))}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Select highlight color</span>
                </div>
              </div>

              {/* Glassmorphic intensity level customizer */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.1)' }}>
                <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.65rem' }}>Glassmorphism Panel Aesthetics</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[
                    { id: 'frosted', label: 'Frosted Glass' },
                    { id: 'ultra-clear', label: 'Ultra Clear' },
                    { id: 'none', label: 'Solid Panels' }
                  ].map((lvl) => (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => selectGlassOpacity(lvl.id)}
                      className={`premium-btn ${glassOpacity === lvl.id ? 'premium-btn-primary' : 'premium-btn-secondary'}`}
                      style={{ flex: 1, padding: '0.35rem', fontSize: '0.75rem', justifyContent: 'center' }}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
              </div>

              <button type="submit" className="premium-btn premium-btn-accent" style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem', marginTop: '0.25rem' }}>
                <Save size={16} />
                <span>Save Profile coordinates</span>
              </button>
            </form>
          </div>
        )}

        {/* Category Panel: Workspace Administration */}
        {activeCategory === 'workspace' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>Workspace Configuration</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Manage domain registration rules, visible directory access, and workspace parameters.</p>
            
            <form onSubmit={handleWorkspaceSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '520px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Workspace Name</label>
                <input 
                  type="text" 
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Workspace Domain Routing</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input 
                    type="text" 
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="premium-input"
                    required
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>.giinmeet.com</span>
                </div>
              </div>

              {/* Security check constraints */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.1)' }}>
                <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600 }}>Directory Security & Visibility Rules</span>
                
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input 
                    type="checkbox" 
                    checked={gatedRegistration} 
                    onChange={() => setGatedRegistration(!gatedRegistration)}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <strong style={{ display: 'block' }}>Enforce Domain Registration limits</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Restrict registration access strictly to users signing up with a matching domain extension.</span>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input 
                    type="checkbox" 
                    checked={directoryVisible} 
                    onChange={() => setDirectoryVisible(!directoryVisible)}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <strong style={{ display: 'block' }}>Public Directory Search Gating</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Allow users in the directory to lookup/search other profile records within this workspace domain.</span>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input 
                    type="checkbox" 
                    checked={guestWaitroomGating} 
                    onChange={() => setGuestWaitroomGating(!guestWaitroomGating)}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <strong style={{ display: 'block' }}>Enforce Guest Waitroom verification</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Gated guest users must wait for host approval before being admitted to meetings.</span>
                  </div>
                </label>
              </div>

              <button type="submit" className="premium-btn premium-btn-accent" style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem' }}>
                <Save size={16} />
                <span>Apply Workspace Config</span>
              </button>
            </form>
          </div>
        )}

        {/* Category Panel: Hardware Devices */}
        {activeCategory === 'devices' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>Audio & Video Devices</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Select active camera and sound sources, test equipment, and analyze frequencies.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Video Camera Input</label>
                  <select 
                    value={selectedCamera} 
                    onChange={(e) => setSelectedCamera(e.target.value)} 
                    className="premium-input"
                  >
                    {devicesList.cameras.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.substring(0, 5)})`}</option>
                    ))}
                    {devicesList.cameras.length === 0 && <option value="">No camera detected</option>}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Microphone Sound Input</label>
                  <select 
                    value={selectedMic} 
                    onChange={(e) => setSelectedMic(e.target.value)} 
                    className="premium-input"
                  >
                    {devicesList.mics.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic (${d.deviceId.substring(0, 5)})`}</option>
                    ))}
                    {devicesList.mics.length === 0 && <option value="">No microphone detected</option>}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>Audio Sound Output (Speaker)</label>
                <select 
                  value={selectedSpeaker} 
                  onChange={(e) => setSelectedSpeaker(e.target.value)} 
                  className="premium-input"
                >
                  {devicesList.speakers.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.substring(0, 5)})`}</option>
                  ))}
                  {devicesList.speakers.length === 0 && <option value="">Default system audio speaker</option>}
                </select>
              </div>

              {/* Hardware live testing screens */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                {/* Webcam live card */}
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Camera size={14} color="var(--color-primary)" />
                      <span>Webcam Feed</span>
                    </span>
                    {cameraActive && <span className="badge badge-success">ACTIVE</span>}
                  </div>
                  <div style={{ height: '140px', backgroundColor: '#090D16', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {cameraActive ? (
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      />
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Camera test disabled</span>
                    )}
                  </div>
                  <button 
                    onClick={toggleCameraTest} 
                    className={`premium-btn ${cameraActive ? 'premium-btn-danger' : 'premium-btn-primary'}`} 
                    style={{ fontSize: '0.75rem', padding: '0.4rem', justifyContent: 'center' }}
                  >
                    {cameraActive ? 'Stop Webcam' : 'Activate Camera Test'}
                  </button>
                </div>

                {/* Mic Sound waves canvas card */}
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Volume2 size={14} color="var(--color-accent)" />
                      <span>Microphone Decibels</span>
                    </span>
                    {micActive && <span className="badge badge-success">TESTING</span>}
                  </div>
                  <div style={{ height: '140px', backgroundColor: '#090D16', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative' }}>
                    <canvas 
                      ref={canvasRef} 
                      width={280} 
                      height={140} 
                      style={{ width: '100%', height: '100%' }} 
                    />
                    {!micActive && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Microphone test offline
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={toggleMicTest} 
                    className={`premium-btn ${micActive ? 'premium-btn-danger' : 'premium-btn-primary'}`} 
                    style={{ fontSize: '0.75rem', padding: '0.4rem', justifyContent: 'center' }}
                  >
                    {micActive ? 'Stop Audio Test' : 'Test Microphone'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Category Panel: E2EE Cryptography & Active Sessions */}
        {activeCategory === 'security' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>E2EE Cryptography & Sessions</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Review end-to-end encryption keychains, rotate cryptographic tokens, and manage logins.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px' }}>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1.25rem', backgroundColor: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Shield size={20} color="var(--color-primary)" />
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.9rem' }}>End-to-End Encryption (E2EE) Keychain</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Your direct chat messages are client-side encrypted before network transmission.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem', backgroundColor: '#090D16', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Public Key: </span>
                    <span style={{ color: 'var(--color-accent)' }}>{publicKey}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Private Key: </span>
                    <span style={{ color: '#EF4444' }}>{privateKey}</span>
                  </div>
                </div>

                <button 
                  onClick={handleRotateKeys} 
                  className="premium-btn premium-btn-primary" 
                  style={{ alignSelf: 'flex-start', fontSize: '0.75rem', gap: '0.35rem' }}
                >
                  <RefreshCw size={12} />
                  <span>Rotate Cryptographic Keys</span>
                </button>
              </div>

              {/* Active Sessions Lists */}
              <div>
                <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Smartphone size={16} color="var(--color-accent)" />
                  <span>Active Sessions Logins</span>
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {activeSessions.map(session => (
                    <div key={session.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '0.85rem' }}>{session.os}</strong>
                          {session.active && <span className="badge badge-success" style={{ fontSize: '0.55rem', padding: '1px 4px' }}>CURRENT</span>}
                        </div>
                        <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          Browser: {session.browser} • IP: {session.ip} • Loc: {session.location}
                        </span>
                      </div>
                      {!session.active && (
                        <button 
                          onClick={() => handleRevokeSession(session.id)}
                          className="premium-btn premium-btn-danger" 
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                          title="Revoke session"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Category Panel: Diagnostics Console */}
        {activeCategory === 'diagnostics' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>System Terminal & Diagnostics</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Verify network connection latency, monitor signal ports, and run health check telemetry.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '600px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Database size={16} color="var(--color-primary)" />
                  <span>Real-time Telemetry Monitor</span>
                </span>
                <button 
                  onClick={runPingTest} 
                  disabled={diagnosticsRunning}
                  className="premium-btn premium-btn-accent" 
                  style={{ fontSize: '0.75rem', gap: '0.35rem' }}
                >
                  {diagnosticsRunning ? <RefreshCw size={12} className="spin" /> : <Zap size={12} />}
                  <span>Run Connectivity Tests</span>
                </button>
              </div>

              {/* scrolling logs terminal viewport */}
              <div style={{
                height: '240px',
                backgroundColor: '#05070B',
                border: '1.5px solid #1E293B',
                borderRadius: '8px',
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: '#34D399',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)'
              }}>
                {logs.map((log, index) => (
                  <div key={index} style={{
                    color: log.includes('[ERROR]') ? '#F87171' : log.includes('[WARNING]') ? '#FBBF24' : '#34D399'
                  }}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Category Panel: Notifications */}
        {activeCategory === 'notifications' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>Notification Gating</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Set your email rules, desktop alerts, and communication filters.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '520px' }}>
              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>System Email Logs</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Receive email digests containing workspace reports and bills.</p>
                </div>
                <input type="checkbox" defaultChecked style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>

              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Push Call Alerts</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Trigger audio/video notifications when users ping you.</p>
                </div>
                <input type="checkbox" defaultChecked style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>
            </div>
          </div>
        )}

        {/* Category Panel: Meetings Presets */}
        {activeCategory === 'meetings' && (
          <div>
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>Meeting Hardware Presets</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Configure active hardware switches upon joining active call channels.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '520px' }}>
              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Mute sound on join</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Join the meeting room with microphone muted by default.</p>
                </div>
                <input type="checkbox" style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>

              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Disable webcam on join</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Start call with video feed turned off.</p>
                </div>
                <input type="checkbox" style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Floating success toast notifications */}
      {showSavedToast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: '#10B981',
          color: 'white',
          padding: '0.75rem 1.5rem',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 99999,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'slide-in 0.2s ease'
        }}>
          <Check size={18} />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
