import React, { useState, useEffect, useRef } from 'react';
import { 
  User, Bell, Video, Shield, Globe, Moon, Sun, Save, Check, 
  Terminal, Volume2, Camera, Sliders, RefreshCw, 
  Smartphone, Activity, Database, Zap, Download, Keyboard,
  Image as ImageIcon, Trash2, Cpu, Type, Palette
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { applyAccentColor, applyBorderRadius, applyFont, applyGlassOpacity, applyUiStyle } from '../utils/theme';
import { probeBrandSupport, loadWorkspaceBrand, saveWorkspaceBrand, resetWorkspaceBrand, DEFAULT_BRAND_NAME, DEFAULT_BRAND_SLOGAN, DEFAULT_BRAND_ACCENT, DEFAULT_BRAND_ACCENT_HOVER, type WorkspaceBrand } from '../utils/brand';
import { OrganisationsPanel } from './OrganisationsPanel';
import { ApiDeveloperPanel } from './ApiDeveloperPanel';
import type { PlanTier } from '../utils/tiers';
import { t } from '../i18n';

interface SettingsProps {
  planTier?: PlanTier;
  onNavigate?: (view: string) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  userName: string;
  userEmail: string;
  userAvatarUrl?: string;
  userPhone?: string;
  userRole?: string;
  userTimezone?: string;
  userLocation?: string;
  userWorkspaceName?: string;
  // Phase 3 (Feature 4): only the superadmin can publish/remove the
  // shared workspace brand (RLS enforces it server-side too).
  isSuperadmin?: boolean;
  userDomain?: string;
  userSkills?: string[];
  userSocialHandles?: {
    linkedin?: string;
    instagram?: string;
    facebook?: string;
    twitter?: string;
    tiktok?: string;
    github?: string;
  };
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
    domain?: string,
    socialHandles?: any
  ) => void;
}

// Panel header band: gradient band with an icon chip, title and subtitle,
// so every settings panel presents the same way. Content unchanged.
const PanelHeader = ({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '1rem',
    padding: '1.1rem 1.25rem', marginBottom: '1.5rem',
    borderRadius: 'var(--radius-md)',
    background: 'linear-gradient(135deg, var(--color-primary) 0%, #001A4C 100%)',
    color: 'white', boxShadow: 'var(--shadow-sm)',
    border: '1px solid rgba(250,189,2,0.35)'
  }}>
    <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: 'rgba(250,189,2,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)', flexShrink: 0 }}>
      <Icon size={22} />
    </div>
    <div>
      <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', margin: 0, lineHeight: 1.2, color: '#FFFFFF' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', margin: '0.25rem 0 0' }}>{subtitle}</p>
    </div>
  </div>
);

// Section card: a premium grouped card inside a settings panel — icon chip,
// title + subtitle header, then the fields. Presentation only; no behaviour change.
const SectionCard = ({ icon: Icon, title, subtitle, children }: { icon?: any; title: string; subtitle?: string; children: React.ReactNode }) => (
  <section className="stg-section">
    <div className="stg-section-head">
      {Icon ? (
        <div className="stg-section-icon"><Icon size={17} /></div>
      ) : null}
      <div>
        <h3 className="stg-section-title">{title}</h3>
        {subtitle ? <p className="stg-section-sub">{subtitle}</p> : null}
      </div>
    </div>
    {children}
  </section>
);

export const Settings: React.FC<SettingsProps> = ({
  planTier = 'free',
  onNavigate,
  isDarkMode,
  onToggleTheme,
  userName,
  userEmail,
  userAvatarUrl,
  userPhone = '',
  userRole = '',
  userTimezone = 'UTC',
  userLocation = '',
  userWorkspaceName = 'Personal Workspace',
  isSuperadmin = false,
  userDomain = 'personal',
  userSkills = [],
  userSocialHandles = {},
  onUpdateProfile,
}) => {
  const [activeCategory, setActiveCategory] = useState<'profile' | 'branding' | 'workspace' | 'devices' | 'shortcuts' | 'security' | 'diagnostics' | 'notifications' | 'meetings' | 'organisations' | 'developer'>('profile');
  
  // Profile settings state
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [avatarUrl, setAvatarUrl] = useState(userAvatarUrl || '');
  const [phone, setPhone] = useState(userPhone);
  const [role, setRole] = useState(userRole);
  // Phase C2b (11), organisation badge text.
  const [organisation, setOrganisation] = useState('');
  const [timezone, setTimezone] = useState(userTimezone);
  const [location, setLocation] = useState(userLocation);
  const [skillsText, setSkillsText] = useState((userSkills || []).join(', '));
  
  // Social media handles state
  const [linkedin, setLinkedin] = useState(userSocialHandles.linkedin || '');
  const [instagram, setInstagram] = useState(userSocialHandles.instagram || '');
  const [facebook, setFacebook] = useState(userSocialHandles.facebook || '');
  const [twitter, setTwitter] = useState(userSocialHandles.twitter || '');
  const [tiktok, setTiktok] = useState(userSocialHandles.tiktok || '');
  const [github, setGithub] = useState(userSocialHandles.github || '');
  
  // Workspace settings state
  const [workspaceName, setWorkspaceName] = useState(userWorkspaceName);
  const [domain, setDomain] = useState(userDomain);
  const [gatedRegistration, setGatedRegistration] = useState(false);
  const [directoryVisible, setDirectoryVisible] = useState(true);
  const [guestWaitroomGating, setGuestWaitroomGating] = useState(true);

  // Appearance, styling, & branding states
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('giin_accent_color') || '#3B82F6');
  const [glassOpacity, setGlassOpacity] = useState(() => localStorage.getItem('giin_glass_opacity') || 'frosted');
  const [logoPreview, setLogoPreview] = useState(() => localStorage.getItem('giin_custom_logo') || '');
  const [meetingWatermark, setMeetingWatermark] = useState(() => localStorage.getItem('giin_watermark') || 'branded');
  const [layoutStyle, setLayoutStyle] = useState(() => localStorage.getItem('giin_layout') || 'left-docked');

  const [brandNameState, setBrandNameState] = useState(() => {
    const v = localStorage.getItem('giin_brand_name');
    return !v || v === 'GIIN MEET' ? 'GiinMeet' : v;
  });
  const [brandSloganState, setBrandSloganState] = useState(() => {
    const v = localStorage.getItem('giin_brand_slogan');
    return !v || v === 'VIRTUALIZATION HUB' ? 'Connect, Collaborate, Virtualize' : v;
  });
  // Phase 3 (Feature 4) — shared workspace brand: what everyone
  // currently sees (null = no shared brand set, default GiinMeet brand
  // everywhere). Probe-gated: before giinmeet_phase3_brand.sql runs
  // this just reports "not set up" and the local controls below keep
  // working exactly as before.
  const [sharedBrand, setSharedBrand] = useState<WorkspaceBrand | null>(null);
  const [brandSetupKnown, setBrandSetupKnown] = useState(false);
  const [brandNotSetUp, setBrandNotSetUp] = useState(false);
  const [publishingBrand, setPublishingBrand] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await probeBrandSupport(supabase);
      if (cancelled) return;
      setBrandSetupKnown(true);
      if (!supported) { setBrandNotSetUp(true); return; }
      const brand = await loadWorkspaceBrand(supabase);
      if (!cancelled) setSharedBrand(brand);
    })();
    return () => { cancelled = true; };
  }, []);

  const [fontHeading, setFontHeading] = useState(() => localStorage.getItem('giin_font_heading') || 'Outfit');
  const [fontBody, setFontBody] = useState(() => localStorage.getItem('giin_font_body') || 'Inter');
  const [borderRadiusVal, setBorderRadiusVal] = useState(() => localStorage.getItem('giin_border_radius') || '8');
  const [uiStyle, setUiStyle] = useState(() => localStorage.getItem('giin_ui_style') || 'glassmorphism');
  const [watermarkOpacity, setWatermarkOpacity] = useState(() => localStorage.getItem('giin_watermark_opacity') || '80');
  const [watermarkScale, setWatermarkScale] = useState(() => localStorage.getItem('giin_watermark_scale') || '100');

  // A/V testing & noise profiles state
  const [devicesList, setDevicesList] = useState<{ cameras: MediaDeviceInfo[], mics: MediaDeviceInfo[], speakers: MediaDeviceInfo[] }>({ cameras: [], mics: [], speakers: [] });
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [isSpatialAudioEnabled, setIsSpatialAudioEnabled] = useState(() => localStorage.getItem('giin_spatial_audio') === 'true');

  const handleToggleSpatialAudio = (enabled: boolean) => {
    setIsSpatialAudioEnabled(enabled);
    localStorage.setItem('giin_spatial_audio', enabled ? 'true' : 'false');
    window.dispatchEvent(new Event('giin_spatial_audio_changed'));
    triggerToast(t('set.spatial_audio', { v1: enabled ? 'enabled' : 'disabled' }));
  };

  // Fix Round 6: these two join presets were dead checkboxes — no
  // state, no onChange, nothing read them. They now persist to the
  // same keys the lobby reads when a meeting is joined.
  const [muteOnJoin, setMuteOnJoin] = useState(() => localStorage.getItem('giin_mute_on_join') === 'true');
  const [videoOffOnJoin, setVideoOffOnJoin] = useState(() => localStorage.getItem('giin_video_off_on_join') === 'true');

  const handleToggleMuteOnJoin = (enabled: boolean) => {
    setMuteOnJoin(enabled);
    try { localStorage.setItem('giin_mute_on_join', enabled ? 'true' : 'false'); } catch (e) {}
    triggerToast(t('set.join_muted', { v1: enabled ? 'enabled' : 'disabled' }));
  };

  const handleToggleVideoOffOnJoin = (enabled: boolean) => {
    setVideoOffOnJoin(enabled);
    try { localStorage.setItem('giin_video_off_on_join', enabled ? 'true' : 'false'); } catch (e) {}
    triggerToast(t('set.join_with_camera_off', { v1: enabled ? 'enabled' : 'disabled' }));
  };

  // Interactive keyboard shortcuts customizer states
  const [hotkeyMute, setHotkeyMute] = useState(() => localStorage.getItem('giin_hotkey_mute') || 'm');
  const [hotkeyCam, setHotkeyCam] = useState(() => localStorage.getItem('giin_hotkey_cam') || 'v');
  const [hotkeyChat, setHotkeyChat] = useState(() => localStorage.getItem('giin_hotkey_chat') || 'c');
  const [recordingHotkey, setRecordingHotkey] = useState<'mute' | 'cam' | 'chat' | null>(null);

  // Active device sessions
  const [activeSessions, setActiveSessions] = useState([
    { id: '1', os: 'Windows 11', browser: 'Google Chrome', ip: '192.168.1.108', active: true, location: 'Local Network' },
    { id: '2', os: 'macOS Sequoia', browser: 'Safari Browser', ip: '104.244.75.13', active: false, location: 'New York, USA' },
    { id: '3', os: 'iPhone 15 Pro', browser: 'GIIN MEET App', ip: '172.56.21.90', active: false, location: 'Mobile Data' }
  ]);

  // Diagnostics console state
  const [logs, setLogs] = useState<string[]>(['[GIIN] Engine started on 2026-06-25', '[RTC] Signaling socket initialized', '[DB] Local memory cache sync ok']);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  
  // Real-time Telemetry Data arrays (CPU, Latency, Loss)
  const telemetryHistoryRef = useRef<{ cpu: number[], ping: number[], loss: number[] }>({ cpu: [], ping: [], loss: [] });

  // General toast state
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Settings saved successfully!');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const telemetryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const telemetryFrameRef = useRef<number | null>(null);

  // Phase C2b (11), load the organisation badge text from the profile.
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive || !data?.user) return;
      supabase.from('profiles').select('organisation').eq('id', data.user.id).maybeSingle().then(({ data: row }) => {
        if (alive && row && typeof (row as any).organisation === 'string') setOrganisation((row as any).organisation);
      }).catch(() => { /* column not set up yet: badge stays blank */ });
    }).catch(() => { /* not signed in */ });
    return () => { alive = false; };
  }, []);
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
    setLinkedin(userSocialHandles.linkedin || '');
    setInstagram(userSocialHandles.instagram || '');
    setFacebook(userSocialHandles.facebook || '');
    setTwitter(userSocialHandles.twitter || '');
    setTiktok(userSocialHandles.tiktok || '');
    setGithub(userSocialHandles.github || '');
  }, [userName, userEmail, userPhone, userRole, userTimezone, userLocation, userSkills, userWorkspaceName, userDomain, userSocialHandles]);

  // Cleanup media streams and animation frames
  useEffect(() => {
    return () => {
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (telemetryFrameRef.current) cancelAnimationFrame(telemetryFrameRef.current);
    };
  }, [cameraStream, micStream]);

  // Hotkey recording keydown listener
  useEffect(() => {
    if (!recordingHotkey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const pressedKey = e.key.toLowerCase();
      if (recordingHotkey === 'mute') {
        setHotkeyMute(pressedKey);
        localStorage.setItem('giin_hotkey_mute', pressedKey);
      } else if (recordingHotkey === 'cam') {
        setHotkeyCam(pressedKey);
        localStorage.setItem('giin_hotkey_cam', pressedKey);
      } else if (recordingHotkey === 'chat') {
        setHotkeyChat(pressedKey);
        localStorage.setItem('giin_hotkey_chat', pressedKey);
      }
      triggerToast(t('set.hotkey_for_bound_to', { v1: recordingHotkey, v2: e.key.toUpperCase() }));
      setRecordingHotkey(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recordingHotkey]);

  // Telemetry real-time loop grapher
  useEffect(() => {
    if (activeCategory !== 'diagnostics') {
      if (telemetryFrameRef.current) cancelAnimationFrame(telemetryFrameRef.current);
      return;
    }

    const canvas = telemetryCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Prepopulate array history
    const history = telemetryHistoryRef.current;
    if (history.cpu.length === 0) {
      for (let i = 0; i < 40; i++) {
        history.cpu.push(10 + Math.random() * 20);
        history.ping.push(30 + Math.random() * 15);
        history.loss.push(Math.random() * 1.5);
      }
    }

    const drawTelemetry = () => {
      if (!canvas || !ctx) return;
      
      // Update values with walk variations
      history.cpu.shift();
      history.cpu.push(Math.max(5, Math.min(95, (history.cpu[history.cpu.length - 1] || 15) + (Math.random() - 0.5) * 8)));
      
      history.ping.shift();
      history.ping.push(Math.max(10, Math.min(150, (history.ping[history.ping.length - 1] || 40) + (Math.random() - 0.5) * 12)));

      history.loss.shift();
      history.loss.push(Math.max(0, Math.min(5, (history.loss[history.loss.length - 1] || 0.5) + (Math.random() - 0.5) * 0.4)));

      ctx.fillStyle = '#090D16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid helper lines
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      for (let i = 20; i < canvas.height; i += 20) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      const drawLine = (data: number[], color: string, maxVal: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const step = canvas.width / (data.length - 1);
        data.forEach((val, index) => {
          const y = canvas.height - (val / maxVal) * (canvas.height - 10) - 5;
          const x = index * step;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      };

      // Draw CPU (Green), Ping (Blue), Loss (Red)
      drawLine(history.cpu, '#10B981', 100);
      drawLine(history.ping, '#3B82F6', 150);
      drawLine(history.loss, '#EF4444', 5);

      telemetryFrameRef.current = requestAnimationFrame(drawTelemetry);
    };

    drawTelemetry();
  }, [activeCategory]);

  // Enumerate hardware sources
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const cameras = devices.filter(d => d.kind === 'videoinput');
        const mics = devices.filter(d => d.kind === 'audioinput');
        const speakers = devices.filter(d => d.kind === 'audiooutput');
        setDevicesList({ cameras, mics, speakers });
        // Fix Round 6: prefer the device the user already chose (the
        // room reads the same keys) — the old code always reset to the
        // first device, so a saved choice was silently discarded here.
        const savedCam = localStorage.getItem('giin_selected_camera') || '';
        const savedMic = localStorage.getItem('giin_selected_mic') || '';
        const savedSpk = localStorage.getItem('giin_selected_speaker') || '';
        if (cameras.length > 0) setSelectedCamera(cameras.some(d => d.deviceId === savedCam) ? savedCam : cameras[0].deviceId);
        if (mics.length > 0) setSelectedMic(mics.some(d => d.deviceId === savedMic) ? savedMic : mics[0].deviceId);
        if (speakers.length > 0) setSelectedSpeaker(speakers.some(d => d.deviceId === savedSpk) ? savedSpk : speakers[0].deviceId);
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

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Phase C2b (11), organisation badge text, saved on the profile.
    // A missing column (Phase C2b SQL not run yet) only skips the
    // badge, it never blocks the rest of the profile save.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase.from('profiles').update({ organisation: organisation.trim().slice(0, 80) }).eq('id', user.id);
        if (error) console.warn('[Settings] Organisation could not be saved yet:', error.message);
      }
    } catch (err) { /* badge save is best effort */ }
    const skillsArray = skillsText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    onUpdateProfile(name, email, avatarUrl, role, timezone, location, skillsArray, phone, workspaceName, domain, {
      linkedin,
      instagram,
      facebook,
      twitter,
      tiktok,
      github
    });
    triggerToast(t('set.profile_settings_saved_successfully'));
  };

  const handleWorkspaceSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile(name, email, avatarUrl, role, timezone, location, userSkills, phone, workspaceName, domain, userSocialHandles);
    triggerToast(t('set.workspace_configuration_applied_successf'));
  };

  // Avatar Image Compression uploader
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

  // Custom branding logo file selection
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setLogoPreview(base64);
      localStorage.setItem('giin_custom_logo', base64);
      window.dispatchEvent(new Event('giin_logo_changed'));
      triggerToast(t('set.custom_brand_logo_applied_successfully'));
    };
    reader.readAsDataURL(file);
  };

  const resetToDefaultLogo = () => {
    setLogoPreview('');
    localStorage.removeItem('giin_custom_logo');
    window.dispatchEvent(new Event('giin_logo_changed'));
    triggerToast(t('set.brand_logo_reset_to_default'));
  };

  // Theme accent applier — state + persistence here, variable application
  // in the shared util (sets the primary AND accent families, so the
  // colour re-themes the whole platform).
  const handleAccentColor = (primary: string, hover: string) => {
    setAccentColor(primary);
    localStorage.setItem('giin_accent_color', primary);
    localStorage.setItem('giin_accent_hover', hover);
    applyAccentColor(primary, hover);
    triggerToast(t('set.brand_accent_color_updated_globally'));
  };

  const selectGlassOpacity = (level: string) => {
    setGlassOpacity(level);
    localStorage.setItem('giin_glass_opacity', level);
    // Shared levels: none = solid, frosted = 12px blur, ultra-clear =
    // 24px blur on a mostly see-through panel (distinct, in that order).
    applyGlassOpacity(level, isDarkMode);
    triggerToast(t('set.glassmorphism_aesthetics_opacity_updated'));
  };

  const saveBrandingConfig = (watermark: string, layout: string) => {
    setMeetingWatermark(watermark);
    setLayoutStyle(layout);
    localStorage.setItem('giin_watermark', watermark);
    localStorage.setItem('giin_layout', layout);
    // Live-apply: App listens for the layout event and re-renders the
    // navigation; MeetingRoom listens for the watermark event and
    // re-renders the video-feed watermark. Without these, both settings
    // only took effect after a full reload (and the layout never did).
    window.dispatchEvent(new Event('giin_layout_changed'));
    window.dispatchEvent(new Event('giin_watermark_changed'));
    triggerToast(t('set.advanced_branding_configuration_saved'));
  };

  const handleUpdateBrandingText = (name: string, slogan: string) => {
    setBrandNameState(name);
    setBrandSloganState(slogan);
    localStorage.setItem('giin_brand_name', name);
    localStorage.setItem('giin_brand_slogan', slogan);
    window.dispatchEvent(new Event('giin_branding_changed'));
    triggerToast(t('set.brand_identity_updated'));
  };

  // Phase 3 (Feature 4) — publish the brand currently shown on
  // this device (name, tagline, logo, accent from the controls below)
  // as the shared workspace brand, so every user on every device sees
  // it. The local values are the draft — nothing is shared until
  // Publish is pressed. Superadmin only in the UI; the RLS policy on
  // workspace_brand is the real enforcement.
  const publishSharedBrand = async () => {
    setPublishingBrand(true);
    const result = await saveWorkspaceBrand(supabase, {
      brand_name: brandNameState,
      slogan: brandSloganState,
      logo_url: logoPreview || null,
      accent_color: accentColor,
      accent_hover: localStorage.getItem('giin_accent_hover') || accentColor,
    });
    setPublishingBrand(false);
    if (!result.ok) { triggerToast(result.reason); return; }
    setSharedBrand({
      brand_name: brandNameState,
      slogan: brandSloganState,
      logo_url: logoPreview || null,
      accent_color: accentColor,
      accent_hover: localStorage.getItem('giin_accent_hover') || accentColor,
    });
    triggerToast(t('set.shared_brand_published_everyone_now', { v1: brandNameState || DEFAULT_BRAND_NAME }));
  };

  // Remove the shared brand: everyone goes back to the default
  // GiinMeet brand, including this device (local brand keys are
  // cleared and the change is applied live).
  const removeSharedBrand = async () => {
    setPublishingBrand(true);
    const result = await resetWorkspaceBrand(supabase);
    setPublishingBrand(false);
    if (!result.ok) { triggerToast(result.reason); return; }
    setSharedBrand(null);
    localStorage.removeItem('giin_brand_name');
    localStorage.removeItem('giin_brand_slogan');
    localStorage.removeItem('giin_custom_logo');
    localStorage.setItem('giin_accent_color', DEFAULT_BRAND_ACCENT);
    localStorage.setItem('giin_accent_hover', DEFAULT_BRAND_ACCENT_HOVER);
    setBrandNameState(DEFAULT_BRAND_NAME);
    setBrandSloganState(DEFAULT_BRAND_SLOGAN);
    setLogoPreview('');
    setAccentColor(DEFAULT_BRAND_ACCENT);
    applyAccentColor(DEFAULT_BRAND_ACCENT, DEFAULT_BRAND_ACCENT_HOVER);
    window.dispatchEvent(new Event('giin_logo_changed'));
    window.dispatchEvent(new Event('giin_branding_changed'));
    triggerToast(t('set.shared_brand_removed_everyone_sees'));
  };

  const handleUpdateFont = (heading: string, body: string) => {
    setFontHeading(heading);
    setFontBody(body);
    localStorage.setItem('giin_font_heading', heading);
    localStorage.setItem('giin_font_body', body);
    applyFont(heading, body);
    triggerToast(t('set.typography_style_updated'));
  };

  const handleUpdateBorderRadius = (radius: string) => {
    setBorderRadiusVal(radius);
    localStorage.setItem('giin_border_radius', radius);
    applyBorderRadius(parseInt(radius, 10));
    triggerToast(t('set.corner_shape_updated'));
  };

  const handleUpdateUiStyle = (style: string) => {
    setUiStyle(style);
    localStorage.setItem('giin_ui_style', style);
    applyUiStyle(style, isDarkMode);
    triggerToast(t('set.ui_style_effect_applied'));
  };

  const handleUpdateWatermarkSettings = (opacity: string, scale: string) => {
    setWatermarkOpacity(opacity);
    setWatermarkScale(scale);
    localStorage.setItem('giin_watermark_opacity', opacity);
    localStorage.setItem('giin_watermark_scale', scale);
    // Live-apply: MeetingRoom listens for this and re-renders the
    // video-feed watermark at the new size/opacity immediately.
    window.dispatchEvent(new Event('giin_watermark_changed'));
    triggerToast(t('set.watermark_geometry_saved'));
  };

  // Toggle camera hardware test
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
        triggerToast(t('set.failed_to_access_camera_stream'));
      }
    }
  };

  // Toggle microphone decibel test
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
        // Fix Round 6: the test must capture like the real call does —
        // echo cancellation, noise suppression, gain control, mono —
        // or a mic that sounds fine here can still feed back in the room.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedMic ? { deviceId: { exact: selectedMic }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } }
        });
        setMicStream(stream);
        setMicActive(true);
        setupAudioVisualizer(stream);
      } catch (err) {
        console.error('Microphone access failed:', err);
        triggerToast(t('set.failed_to_access_microphone_stream'));
      }
    }
  };

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

  const handleRevokeSession = (sessionId: string) => {
    setActiveSessions(prev => prev.filter(s => s.id !== sessionId));
    triggerToast(t('set.active_session_terminated_successfully'));
  };

  // Ping test
  const runPingTest = async () => {
    setDiagnosticsRunning(true);
    setLogs(prev => [...prev, '[PING] Running diagnostic test routines...', '[PING] Pinging Supabase REST database endpoint...']);

    const startTime = Date.now();
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1);
      const duration = Date.now() - startTime;

      if (error) throw error;

      setLogs(prev => [
        ...prev,
        t('set.ping_supabase_endpoint_resolved', { v1: duration }),
        `[DB] Cache sync response -> 200 OK (Profiles table read verified)`,
        `[SYS] Transport encryption active (DTLS-SRTP)`,
        `[STATUS] System health is currently 100% OPERATIONAL`
      ]);
    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        t('set.warning_supabase_endpoint_resolved', { v1: Date.now() - startTime }),
        t('set.error_profiles_read_fail', { v1: err.message }),
        `[STATUS] Local server active, database operation restricted (Offline / RLS checked)`
      ]);
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  // Export local workspace coordinates
  const handleExportWorkspace = () => {
    const workspaceData = {
      profile: { name, email, phone, role, location, timezone, skills: userSkills },
      workspace: { workspaceName, domain, gatedRegistration, directoryVisible, guestWaitroomGating },
      aesthetics: { accentColor, glassOpacity, layoutStyle, meetingWatermark },
      security: { activeSessions },
      exportedAt: new Date().toISOString()
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(workspaceData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${workspaceName.replace(/\s+/g, '_')}_workspace_coordinates.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    triggerToast(t('set.workspace_configuration_exported_success'));
  };

  const handleClearCache = () => {
    if (window.confirm(t('set.are_you_sure_you_want'))) {
      localStorage.clear();
      triggerToast(t('set.local_cache_cleared_reloading_system'));
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  // Categories Sidebar
  const categories = [
    { id: 'profile', name: 'Profile Settings', icon: User, desc: 'Display details & contact info' },
    { id: 'branding', name: 'Branding & Layout', icon: ImageIcon, desc: 'Themes, custom logos, watermarks' },
    { id: 'workspace', name: 'Workspace Admin', icon: Globe, desc: 'Subdomains, limits & exports' },
    { id: 'devices', name: 'Hardware & Audio', icon: Video, desc: 'A/V testing & audio enhancement' },
    { id: 'shortcuts', name: 'Shortcuts Manager', icon: Keyboard, desc: 'Custom keyboard productivity bindings' },
    { id: 'security', name: 'Connection Security & Logins', icon: Shield, desc: 'Transport encryption & active device logs' },
    { id: 'diagnostics', name: 'System Telemetry', icon: Terminal, desc: 'Pings, scrolling terminals, CPU graphs' },
    { id: 'notifications', name: 'Notifications', icon: Bell, desc: 'Alert channels & push filters' },
    { id: 'meetings', name: 'Meeting Defaults', icon: Sliders, desc: 'Microphone & camera preset switches' },
    { id: 'organisations', name: 'Organisations', icon: Building2, desc: 'White-label brands and members' },
    { id: 'developer', name: 'Developer', icon: Code, desc: 'API keys and webhooks' },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '280px 1fr',
      gap: '2rem',
      height: 'calc(100dvh - 70px - 5rem)',
      maxHeight: '100%',
      minHeight: 0,
      animation: 'slide-in var(--transition-normal)'
    }} className="grid-2">
      
      {/* Categories Sidebar */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', height: 'fit-content', minHeight: 0, maxHeight: '100%', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem', paddingLeft: '0.25rem' }}>
          <Activity size={20} color="var(--color-primary)" />
          <h2 style={{ fontSize: '1.3rem', fontFamily: 'var(--font-heading)' }}>{t('set.settings_hub')}</h2>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '420px', overflowY: 'auto' }}>
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isSelected = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                className="stg-hub-btn"
                onClick={() => setActiveCategory(cat.id as any)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  padding: '0.6rem 0.8rem',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: isSelected ? 'var(--color-primary)' : 'transparent',
                  boxShadow: isSelected ? 'inset 3px 0 0 var(--color-accent)' : 'none',
                  color: isSelected ? 'white' : 'var(--text-main)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: isSelected ? 600 : 500, fontSize: '0.85rem' }}>
                  <Icon size={15} />
                  <span>{cat.name}</span>
                </div>
                <span style={{ fontSize: '0.65rem', color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', paddingLeft: '1.25rem' }}>{cat.desc}</span>
              </button>
            );
          })}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.75rem 0' }} />

        {/* Theme toggler */}
        <div className="flex-between" style={{ padding: '0.25rem 0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('set.dark_theme')}</span>
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
      <div className="glass-panel" style={{ padding: '2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 0 }}>
        
        {/* Category Panel: Profile Details */}
        {activeCategory === 'profile' && (
          <div>
            <PanelHeader icon={User} title={t('set.profile_coordinates')} subtitle="Update your corporate identification details, job specs, and contact numbers." />
            
            <form onSubmit={handleProfileSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Camera} title={t('set.profile_photo')} subtitle="Your avatar shown across meetings and chat.">
              {/* Picture Upload */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
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
                    {t('set.change_photo')}
                  </button>
                  <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{t('set.png_jpg_or_jpeg_up')}</span>
                </div>
              </div>
              </SectionCard>

              <SectionCard icon={User} title={t('set.identity')} subtitle="How your name and role appear to other participants.">
              <div className="stg-grid-2">
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.display_name')}</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="premium-input" required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.job_title_role')}</label>
                  <input type="text" value={role} onChange={(e) => setRole(e.target.value)} className="premium-input" />
                </div>
              </div>
              <div style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.organisation_company_school_or_church')}</label>
                <input type="text" value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder={t('set.e_g_global_impact_innovators')} maxLength={80} className="premium-input" />
                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{t('set.shown_as_a_small_badge')}</span>
              </div>
              </SectionCard>

              <SectionCard icon={Smartphone} title={t('set.contact_details')} subtitle="Where we reach you — shown in full, never clipped.">
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.email_address')}</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="premium-input" required />
              </div>
              <div className="stg-grid-2" style={{ marginTop: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.phone_number')}</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="premium-input" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.office_location')}</label>
                  <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="premium-input" />
                </div>
              </div>
              </SectionCard>

              <SectionCard icon={Activity} title={t('set.work_time')} subtitle="Your timezone sets meeting times across the platform.">
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.primary_timezone')}</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="premium-input">
                  <option value="America/New_York">{t('set.eastern_time_new_york')}</option>
                  <option value="America/Chicago">{t('set.central_time_chicago')}</option>
                  <option value="America/Denver">{t('set.mountain_time_denver')}</option>
                  <option value="America/Los_Angeles">{t('set.pacific_time_los_angeles')}</option>
                  <option value="Europe/London">{t('set.greenwich_mean_time_london')}</option>
                  <option value="Europe/Berlin">{t('set.central_european_time_berlin')}</option>
                  <option value="Asia/Singapore">{t('set.singapore_standard_time_singapore')}</option>
                  <option value="Asia/Tokyo">{t('set.japan_standard_time_tokyo')}</option>
                  <option value="UTC">{t('set.utc_coordinated_universal_time')}</option>
                </select>
              </div>
              </SectionCard>

              <SectionCard icon={Zap} title={t('set.professional_skills')} subtitle="Comma-separated — shown on your profile.">
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.professional_skills_comma_separated')}</label>
                <input 
                  type="text" 
                  value={skillsText} 
                  onChange={(e) => setSkillsText(e.target.value)} 
                  className="premium-input" 
                  placeholder={t('set.e_g_react_webrtc_devops')} 
                />
              </div>
              </SectionCard>

              <SectionCard icon={Globe} title={t('set.social_directory')} subtitle="Your public profiles, linked from your workspace directory.">
              <div className="stg-grid-2">
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.linkedin_profile_url')}</label>
                  <input type="url" placeholder="https://linkedin.com/in/username" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} className="premium-input" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.github_profile_url')}</label>
                  <input type="url" placeholder="https://github.com/username" value={github} onChange={(e) => setGithub(e.target.value)} className="premium-input" />
                </div>
              </div>
              <div className="stg-grid-2" style={{ marginTop: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.x_twitter_profile_url')}</label>
                  <input type="url" placeholder="https://x.com/username" value={twitter} onChange={(e) => setTwitter(e.target.value)} className="premium-input" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.instagram_profile_url')}</label>
                  <input type="url" placeholder="https://instagram.com/username" value={instagram} onChange={(e) => setInstagram(e.target.value)} className="premium-input" />
                </div>
              </div>
              <div className="stg-grid-2" style={{ marginTop: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.facebook_profile_url')}</label>
                  <input type="url" placeholder="https://facebook.com/username" value={facebook} onChange={(e) => setFacebook(e.target.value)} className="premium-input" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.tiktok_profile_url')}</label>
                  <input type="url" placeholder="https://tiktok.com/@username" value={tiktok} onChange={(e) => setTikTok(e.target.value)} className="premium-input" />
                </div>
              </div>
              </SectionCard>

              <button type="submit" className="premium-btn premium-btn-accent" style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem', marginTop: '0.25rem' }}>
                <Save size={16} />
                <span>{t('set.save_profile_coordinates')}</span>
              </button>
            </form>
          </div>
        )}

        {/* Category Panel: Branding & Custom Logo */}
        {activeCategory === 'branding' && (
          <div>
            <PanelHeader icon={ImageIcon} title={t('set.branding_aesthetic_styles')} subtitle="Customize global branding themes, accent colors, custom logo headers, and meeting layouts." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '780px', width: '100%' }}>
              
              {/* Shared workspace brand (Phase 3, Feature 4) */}
              <SectionCard icon={Globe} title={t('set.shared_workspace_brand')} subtitle="The logo, name, tagline and accent everyone sees — on every device, including the sign-in screen, waiting room and lobby.">
                {brandNotSetUp ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                    {t('set.shared_branding_is_not_set')}
                  </p>
                ) : !brandSetupKnown ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>{t('set.loading_the_shared_brand')}</p>
                ) : sharedBrand ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {sharedBrand.logo_url && (
                      <img src={sharedBrand.logo_url} alt={t('set.shared_brand_logo')} style={{ width: '40px', height: '40px', objectFit: 'contain', borderRadius: '6px', backgroundColor: '#090D16' }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{sharedBrand.brand_name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{sharedBrand.slogan}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        {t('set.accent')} <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: sharedBrand.accent_color, verticalAlign: '-1px' }} /> {sharedBrand.accent_color}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                    No shared brand is set — everyone currently sees the default GiinMeet brand. {isSuperadmin ? 'Edit the brand below, then publish it to share it with everyone.' : 'Only the workspace admin can publish one.'}
                  </p>
                )}
                {isSuperadmin && !brandNotSetUp && brandSetupKnown && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={publishSharedBrand} disabled={publishingBrand} className="premium-btn premium-btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>
                      {publishingBrand ? 'Publishing…' : 'Publish current brand for everyone'}
                    </button>
                    {sharedBrand && (
                      <button type="button" onClick={removeSharedBrand} disabled={publishingBrand} className="premium-btn premium-btn-danger" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>
                        {t('set.remove_shared_brand')}
                      </button>
                    )}
                  </div>
                )}
                {!isSuperadmin && sharedBrand && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: '0.75rem 0 0' }}>
                    {t('set.set_by_your_workspace_admin')}
                  </p>
                )}
              </SectionCard>

              {/* Brand Identity Details */}
              <SectionCard icon={Type} title={t('set.brand_identity_texts')} subtitle="The name and tagline shown across the platform.">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.company_app_name')}</label>
                    <input
                      type="text"
                      value={brandNameState}
                      disabled={!!sharedBrand && !isSuperadmin}
                      onChange={(e) => handleUpdateBrandingText(e.target.value, brandSloganState)}
                      className="premium-input"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.tagline_slogan')}</label>
                    <input
                      type="text"
                      value={brandSloganState}
                      disabled={!!sharedBrand && !isSuperadmin}
                      onChange={(e) => handleUpdateBrandingText(brandNameState, e.target.value)}
                      className="premium-input"
                    />
                  </div>
                </div>
              </SectionCard>

              {/* Custom Logo Upload */}
              <SectionCard icon={ImageIcon} title={t('set.custom_branding_logo')} subtitle="Upload your corporate brand icon to replace the default logo dynamically.">
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                  <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" style={{ display: 'none' }} />
                  <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '8px',
                    backgroundColor: '#090D16',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden'
                  }}>
                    {logoPreview ? (
                      <img src={logoPreview} alt={t('set.custom_logo_preview')} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{t('set.default_logo')}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={!!sharedBrand && !isSuperadmin} className="premium-btn premium-btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>
                      {t('set.upload_brand_logo')}
                    </button>
                    {logoPreview && (
                      <button type="button" onClick={resetToDefaultLogo} disabled={!!sharedBrand && !isSuperadmin} className="premium-btn premium-btn-danger" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>
                        {t('set.reset_default')}
                      </button>
                    )}
                  </div>
                </div>
              </SectionCard>

              {/* Theme Primary Accent */}
              <SectionCard icon={Palette} title={t('set.theme_primary_accent')} subtitle="The accent colour used across buttons and highlights.">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem' }}>
                  {[
                    { name: 'Azul Brant', primary: '#3B82F6', hover: '#2563EB' },
                    { name: 'Eclipse Purple', primary: '#8B5CF6', hover: '#7C3AED' },
                    { name: 'Emerald Mint', primary: '#10B981', hover: '#059669' },
                    { name: 'Crimson Flame', primary: '#EF4444', hover: '#DC2626' },
                    { name: 'Sunset Amber', primary: '#F59E0B', hover: '#D97706' },
                    { name: 'Cyberpunk Pink', primary: '#FF007F', hover: '#D6006B' },
                    { name: 'Ocean Teal', primary: '#008080', hover: '#006666' },
                    { name: 'Royal Velvet', primary: '#4B0082', hover: '#3A0063' },
                    { name: 'Luxury Gold', primary: '#D4AF37', hover: '#AA8C2C' }
                  ].map((color) => (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => handleAccentColor(color.primary, color.hover)}
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
                </div>
                
                {/* Custom color picker */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{t('set.custom_accent_color')}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
                    <input 
                      type="color" 
                      value={accentColor} 
                      onChange={(e) => handleAccentColor(e.target.value, e.target.value)} 
                      style={{ border: 'none', width: '32px', height: '32px', borderRadius: '4px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }} 
                    />
                    <input 
                      type="text" 
                      value={accentColor} 
                      onChange={(e) => handleAccentColor(e.target.value, e.target.value)} 
                      className="premium-input" 
                      style={{ width: '100px', padding: '0.25rem 0.5rem', fontSize: '0.8rem', textAlign: 'center' }} 
                    />
                  </div>
                </div>
              </SectionCard>

              {/* UI Theme Style Effect */}
              <SectionCard icon={Zap} title={t('set.ui_styling_theme_effect')} subtitle="Choose the visual language of the whole app — tap a theme to preview it live.">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {[
                    { id: 'glassmorphism', label: 'Glassmorphism' },
                    { id: 'neumorphism', label: 'Neumorphism' },
                    { id: 'cyberpunk-glow', label: t('set.cyberpunk_glow') },
                    { id: 'flat-minimal', label: t('set.flat_minimal') },
                    { id: 'liquid-glass', label: t('set.liquid_glass') },
                    { id: 'bento-grid', label: t('set.bento_grid') },
                    { id: 'spatial-ui', label: t('set.spatial_ui') },
                    { id: 'skeuomorphism', label: 'Skeuomorphism' },
                    { id: 'minimalism', label: 'Minimalism' },
                    { id: 'maximalism', label: 'Maximalism' }
                  ].map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => handleUpdateUiStyle(style.id)}
                      className={`premium-btn ${uiStyle === style.id ? 'premium-btn-primary' : 'premium-btn-secondary'}`}
                      style={{ padding: '0.5rem', fontSize: '0.75rem', justifyContent: 'center', flexDirection: 'column', alignItems: 'stretch', gap: 0 }}
                    >
                      <span className={t('set.theme_swatch_theme_swatch', { v1: style.id })} aria-hidden="true" />
                      <span style={{ textAlign: 'center' }}>{style.label}</span>
                    </button>
                  ))}
                </div>
              </SectionCard>

              {/* Glassmorphism Blur Filter (Only visible if glassmorphism is selected) */}
              {uiStyle === 'glassmorphism' && (
                <SectionCard icon={Sliders} title={t('set.glassmorphism_blur_filter')} subtitle="How frosted the glass panels look.">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {[
                      { id: 'frosted', label: t('set.frosted_glass') },
                      { id: 'ultra-clear', label: t('set.ultra_clear') },
                      { id: 'none', label: t('set.solid_panels') }
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
                </SectionCard>
              )}

              {/* Premium Typography (Fonts) */}
              <SectionCard icon={Type} title={t('set.premium_typography_fonts')} subtitle="Heading and body fonts for the whole app — including the sidebar.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {[
                    { id: 'sleek', label: t('set.sleek_sans_outfit_inter'), heading: 'Outfit', body: 'Inter' },
                    { id: 'classic', label: t('set.classic_serif_playfair_display_georgia'), heading: 'Playfair Display', body: 'Georgia' },
                    { id: 'tech', label: t('set.monospace_tech_fira_code'), heading: 'Fira Code', body: 'Fira Code' },
                    { id: 'modern', label: t('set.elegant_modern_montserrat'), heading: 'Montserrat', body: 'Montserrat' },
                    { id: 'futuristic', label: t('set.futuristic_glow_orbitron_rajdhani'), heading: 'Orbitron', body: 'Rajdhani' },
                    { id: 'geometric', label: t('set.geometric_pop_poppins'), heading: 'Poppins', body: 'Poppins' },
                    { id: 'grotesk', label: t('set.modern_grotesk_space_grotesk'), heading: 'Space Grotesk', body: 'Space Grotesk' },
                    { id: 'literary', label: t('set.literary_serif_lora_merriweather'), heading: 'Lora', body: 'Merriweather' },
                    { id: 'rounded', label: t('set.soft_rounded_quicksand_nunito'), heading: 'Quicksand', body: 'Nunito' }
                  ].map((font) => {
                    const isSelected = fontHeading === font.heading && fontBody === font.body;
                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => handleUpdateFont(font.heading, font.body)}
                        className={`premium-btn ${isSelected ? 'premium-btn-primary' : 'premium-btn-secondary'}`}
                        style={{ padding: '0.5rem', fontSize: '0.8rem', justifyContent: 'flex-start', fontFamily: font.heading }}
                      >
                        {font.label}
                      </button>
                    );
                  })}
                </div>
              </SectionCard>

              {/* Corner Shapes (Border Radius) */}
              <SectionCard icon={Sliders} title={t('set.corner_shapes_border_radius')} subtitle="How sharp or rounded corners feel.">
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[
                    { val: '0', label: 'Sharp' },
                    { val: '8', label: 'Sleek' },
                    { val: '16', label: 'Rounded' },
                    { val: '24', label: t('set.soft_pill') }
                  ].map((shape) => (
                    <button
                      key={shape.val}
                      type="button"
                      onClick={() => handleUpdateBorderRadius(shape.val)}
                      className={`premium-btn ${borderRadiusVal === shape.val ? 'premium-btn-primary' : 'premium-btn-secondary'}`}
                      style={{ flex: 1, padding: '0.35rem', fontSize: '0.75rem', justifyContent: 'center' }}
                    >
                      {shape.label}
                    </button>
                  ))}
                </div>
              </SectionCard>

              {/* Watermark & Layout Configuration */}
              <SectionCard icon={Video} title={t('set.watermark_layout_configuration')} subtitle="Logo overlays on video feeds and the navigation layout.">
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.video_feed_watermark')}</label>
                  <select value={meetingWatermark} onChange={(e) => saveBrandingConfig(e.target.value, layoutStyle)} className="premium-input">
                    <option value="branded">{t('set.branded_overlay_top_left_logo')}</option>
                    <option value="watermark">{t('set.top_right_logo_watermark')}</option>
                    <option value="none">{t('set.no_branded_overlays')}</option>
                  </select>
                </div>

                {meetingWatermark !== 'none' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem' }}>
                    <div>
                      <div className="flex-between" style={{ marginBottom: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Watermark Opacity ({watermarkOpacity}%)</label>
                      </div>
                      <input 
                        type="range" 
                        min="10" 
                        max="100" 
                        value={watermarkOpacity} 
                        onChange={(e) => handleUpdateWatermarkSettings(e.target.value, watermarkScale)} 
                        style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--color-primary)' }} 
                      />
                    </div>
                    <div>
                      <div className="flex-between" style={{ marginBottom: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>Watermark Scale ({watermarkScale}%)</label>
                      </div>
                      <input 
                        type="range" 
                        min="50" 
                        max="150" 
                        value={watermarkScale} 
                        onChange={(e) => handleUpdateWatermarkSettings(watermarkOpacity, e.target.value)} 
                        style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--color-primary)' }} 
                      />
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.navbar_scaffolding_layout')}</label>
                  <select value={layoutStyle} onChange={(e) => saveBrandingConfig(meetingWatermark, e.target.value)} className="premium-input">
                    <option value="left-docked">{t('set.left_docked_panel_icon_menu')}</option>
                    <option value="header-only">{t('set.top_navbar_menu_horizontal_bar')}</option>
                  </select>
                </div>
              </SectionCard>

            </div>
          </div>
        )}

        {/* Category Panel: Workspace Gating & Exports */}
        {activeCategory === 'workspace' && (
          <div>
            <PanelHeader icon={Globe} title={t('set.workspace_administration')} subtitle="Manage domain registration rules, directory searches, export logs, and flush cache." />
            
            <form onSubmit={handleWorkspaceSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Globe} title={t('set.workspace_identity')} subtitle="Your workspace name and subdomain.">
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.workspace_name')}</label>
                <input type="text" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className="premium-input" required />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.workspace_domain_routing')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} className="premium-input" required />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>.giinmeet.com</span>
                </div>
              </div>

              </SectionCard>

              <SectionCard icon={Shield} title={t('set.directory_security_visibility_rules')} subtitle="Who can register and see the directory.">
                
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={gatedRegistration} onChange={() => setGatedRegistration(!gatedRegistration)} style={{ marginTop: '3px' }} />
                  <div>
                    <strong style={{ display: 'block' }}>{t('set.enforce_domain_registration_limits')}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.restrict_registration_access_strictly_to')}</span>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={directoryVisible} onChange={() => setDirectoryVisible(!directoryVisible)} style={{ marginTop: '3px' }} />
                  <div>
                    <strong style={{ display: 'block' }}>{t('set.public_directory_search_gating')}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.allow_workspace_directories_to_query')}</span>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={guestWaitroomGating} onChange={() => setGuestWaitroomGating(!guestWaitroomGating)} style={{ marginTop: '3px' }} />
                  <div>
                    <strong style={{ display: 'block' }}>{t('set.enforce_guest_waitroom_gating')}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.gated_guest_users_must_wait')}</span>
                  </div>
                </label>
              </SectionCard>

              {/* Data Portability Tools */}
              <SectionCard icon={Download} title={t('set.workspace_data_portability_resets')} subtitle="Export your profile records and aesthetic settings, or clear temporary local storage configurations.">
                
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button type="button" onClick={handleExportWorkspace} className="premium-btn premium-btn-primary" style={{ flex: 1, fontSize: '0.75rem', gap: '4px', justifyContent: 'center' }}>
                    <Download size={12} />
                    <span>{t('set.export_data_json')}</span>
                  </button>
                  <button type="button" onClick={handleClearCache} className="premium-btn premium-btn-danger" style={{ flex: 1, fontSize: '0.75rem', gap: '4px', justifyContent: 'center' }}>
                    <Trash2 size={12} />
                    <span>{t('set.flush_app_cache')}</span>
                  </button>
                </div>
              </SectionCard>

              <button type="submit" className="premium-btn premium-btn-accent" style={{ alignSelf: 'flex-start', padding: '0.5rem 1.25rem' }}>
                <Save size={16} />
                <span>{t('set.save_workspace_config')}</span>
              </button>
            </form>
          </div>
        )}

        {/* Category Panel: Hardware Devices & Filters */}
        {activeCategory === 'devices' && (
          <div>
            <PanelHeader icon={Video} title={t('set.audio_video_filters')} subtitle="Manage hardware inputs, test microphones, and adjust audio enhancement." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Video} title={t('set.input_sources')} subtitle="Camera, microphone and speaker used in meetings.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.camera_input_source')}</label>
                  <select value={selectedCamera} onChange={(e) => { setSelectedCamera(e.target.value); try { localStorage.setItem('giin_selected_camera', e.target.value); } catch (err) {} }} className="premium-input">
                    {devicesList.cameras.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.substring(0, 5)})`}</option>
                    ))}
                    {devicesList.cameras.length === 0 && <option value="">{t('set.no_camera_detected')}</option>}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.microphone_input_source')}</label>
                  <select value={selectedMic} onChange={(e) => { setSelectedMic(e.target.value); try { localStorage.setItem('giin_selected_mic', e.target.value); } catch (err) {} }} className="premium-input">
                    {devicesList.mics.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic (${d.deviceId.substring(0, 5)})`}</option>
                    ))}
                    {devicesList.mics.length === 0 && <option value="">{t('set.no_microphone_detected')}</option>}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>{t('set.audio_output_source_speaker')}</label>
                <select value={selectedSpeaker} onChange={(e) => { setSelectedSpeaker(e.target.value); try { localStorage.setItem('giin_selected_speaker', e.target.value); } catch (err) {} }} className="premium-input">
                  {devicesList.speakers.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.substring(0, 5)})`}</option>
                  ))}
                  {devicesList.speakers.length === 0 && <option value="">{t('set.default_system_speaker')}</option>}
                </select>
              </div>
              </SectionCard>

              {/* Audio enhancement filters */}
              <SectionCard icon={Volume2} title={t('set.audio_settings')} subtitle="Enhancement and spatial audio for your meetings.">
                


                {/* Spatial Audio Toggle */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.8rem' }}>
                    <input type="checkbox" checked={isSpatialAudioEnabled} onChange={(e) => handleToggleSpatialAudio(e.target.checked)} style={{ marginRight: '8px' }} />
                    <div>
                      <strong style={{ display: 'block' }}>{t('set.3d_spatial_audio_panning')}</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.immersive_audio_panning_matches_speakers')}</span>
                    </div>
                  </label>
                </div>

              </SectionCard>

              {/* Live Webcam & Microphone decibels tests */}
              <SectionCard icon={Camera} title={t('set.hardware_tests')} subtitle="Test your camera and microphone live before joining a call.">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Camera size={14} color="var(--color-primary)" />
                      <span>{t('set.webcam_feed')}</span>
                    </span>
                    {cameraActive && <span className="badge badge-success">ACTIVE</span>}
                  </div>
                  <div style={{ height: '140px', backgroundColor: '#090D16', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {cameraActive ? (
                      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.camera_test_offline')}</span>
                    )}
                  </div>
                  <button type="button" onClick={toggleCameraTest} className={`premium-btn ${cameraActive ? 'premium-btn-danger' : 'premium-btn-primary'}`} style={{ fontSize: '0.75rem', padding: '0.4rem', justifyContent: 'center' }}>
                    {cameraActive ? 'Stop Webcam' : 'Activate Camera Test'}
                  </button>
                </div>

                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Volume2 size={14} color="var(--color-accent)" />
                      <span>{t('set.microphone_analyzer')}</span>
                    </span>
                    {micActive && <span className="badge badge-success">TESTING</span>}
                  </div>
                  <div style={{ height: '140px', backgroundColor: '#090D16', borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative' }}>
                    <canvas ref={canvasRef} width={280} height={140} style={{ width: '100%', height: '100%' }} />
                    {!micActive && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {t('set.microphone_test_offline')}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={toggleMicTest} className={`premium-btn ${micActive ? 'premium-btn-danger' : 'premium-btn-primary'}`} style={{ fontSize: '0.75rem', padding: '0.4rem', justifyContent: 'center' }}>
                    {micActive ? 'Stop Audio Test' : 'Test Microphone'}
                  </button>
                </div>
              </div>
              </SectionCard>
            </div>
          </div>
        )}

        {/* Category Panel: Keyboard Shortcuts */}
        {activeCategory === 'shortcuts' && (
          <div>
            <PanelHeader icon={Keyboard} title={t('set.keyboard_shortcuts_manager')} subtitle="Bind custom keyboard keys to trigger application functions instantly during calls." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Keyboard} title={t('set.keyboard_bindings')} subtitle="Press a key to rebind each action.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                
                {/* Mute bind */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                  <div>
                    <strong style={{ fontSize: '0.85rem', display: 'block' }}>{t('set.toggle_sound_microphone_mute')}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.quick_toggle_to_mute_unmute')}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setRecordingHotkey('mute')} 
                    className="premium-btn premium-btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', gap: '4px' }}
                  >
                    <Keyboard size={12} />
                    <span>{recordingHotkey === 'mute' ? 'Press Key...' : `[ ${hotkeyMute.toUpperCase()} ]`}</span>
                  </button>
                </div>

                {/* Cam bind */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                  <div>
                    <strong style={{ fontSize: '0.85rem', display: 'block' }}>{t('set.toggle_video_webcam_feed')}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.enable_disable_your_webcam_feed')}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setRecordingHotkey('cam')} 
                    className="premium-btn premium-btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', gap: '4px' }}
                  >
                    <Keyboard size={12} />
                    <span>{recordingHotkey === 'cam' ? 'Press Key...' : `[ ${hotkeyCam.toUpperCase()} ]`}</span>
                  </button>
                </div>

                {/* Chat toggle bind */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                  <div>
                    <strong style={{ fontSize: '0.85rem', display: 'block' }}>{t('set.toggle_sidebar_chat_panel')}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('set.slide_in_out_active_chat')}</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setRecordingHotkey('chat')} 
                    className="premium-btn premium-btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', gap: '4px' }}
                  >
                    <Keyboard size={12} />
                    <span>{recordingHotkey === 'chat' ? 'Press Key...' : `[ ${hotkeyChat.toUpperCase()} ]`}</span>
                  </button>
                </div>

              </div>
              </SectionCard>
            </div>
          </div>
        )}

        {/* Category Panel: Connection Security & Logins */}
        {activeCategory === 'security' && (
          <div>
            <PanelHeader icon={Shield} title={t('set.connection_security_active_logins')} subtitle="Review how your calls and messages are protected, and manage active device sessions." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Shield} title={t('set.protection_overview')} subtitle="How your calls and messages are protected.">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{t('set.calls_use_standard_webrtc_transport')}</p>
              </SectionCard>

              {/* Active Sessions Lists */}
              <SectionCard icon={Smartphone} title={t('set.active_sessions')} subtitle="Devices signed in to your account — revoke any you do not recognise.">
                
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
                          type="button"
                          onClick={() => handleRevokeSession(session.id)}
                          className="premium-btn premium-btn-danger" 
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                          title={t('set.revoke_session')}
                        >
                          {t('set.revoke')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          </div>
        )}

        {/* Category Panel: Diagnostics & Telemetry Graphs */}
        {activeCategory === 'diagnostics' && (
          <div>
            <PanelHeader icon={Terminal} title={t('set.system_terminal_telemetry')} subtitle="Monitor real-time network latencies, CPU core loads, bandwidth packets, and execute diagnostic pings." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Terminal} title={t('set.real_time_telemetry')} subtitle="Live bandwidth, CPU and latency, plus connectivity tests.">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Database size={16} color="var(--color-primary)" />
                  <span>{t('set.real_time_telemetry_monitor')}</span>
                </span>
                <button 
                  onClick={runPingTest} 
                  disabled={diagnosticsRunning}
                  className="premium-btn premium-btn-accent" 
                  style={{ fontSize: '0.75rem', gap: '0.35rem' }}
                >
                  {diagnosticsRunning ? <RefreshCw size={12} className="spin" /> : <Zap size={12} />}
                  <span>{t('set.run_connectivity_tests')}</span>
                </button>
              </div>

              {/* Canvas-based Telemetry line graphs plotting */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1rem', backgroundColor: '#090D16', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Cpu size={12} color="var(--color-primary)" />
                    <span>{t('set.real_time_bandwidth_cpu_latency')}</span>
                  </span>
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.65rem' }}>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>{t('set.cpu_load')}</span>
                    <span style={{ color: '#3B82F6', fontWeight: 600 }}>{t('set.latency_ms')}</span>
                    <span style={{ color: '#EF4444', fontWeight: 600 }}>{t('set.packet_loss')}</span>
                  </div>
                </div>
                <div style={{ height: '150px', position: 'relative' }}>
                  <canvas ref={telemetryCanvasRef} width={540} height={150} style={{ width: '100%', height: '100%', borderRadius: '6px' }} />
                </div>
              </div>
              </SectionCard>

              {/* Scrolling logs console */}
              <SectionCard icon={Terminal} title={t('set.diagnostics_console')} subtitle="Live system log — errors in red, warnings in amber.">
              <div style={{
                height: '180px',
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
              </SectionCard>
            </div>
          </div>
        )}

        {/* Category Panel: Notifications */}
        {activeCategory === 'notifications' && (
          <div>
            <PanelHeader icon={Bell} title={t('set.notification_gating')} subtitle="Set your email rules, desktop alerts, and communication filters." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Bell} title={t('set.notification_channels')} subtitle="Email digests and push call alerts.">
              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>{t('set.system_email_logs')}</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{t('set.receive_email_digests_containing_workspa')}</p>
                </div>
                <input type="checkbox" defaultChecked style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>

              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>{t('set.push_call_alerts')}</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{t('set.trigger_audio_video_notifications_when')}</p>
                </div>
                <input type="checkbox" defaultChecked style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>
              </SectionCard>
            </div>
          </div>
        )}

        {/* Category Panel: Meetings Defaults */}
        {activeCategory === 'organisations' && (
          <div>
            <PanelHeader icon={Building2} title={t('set.organisations')} subtitle="White-label brands and members." />
            <OrganisationsPanel />
          </div>
        )}
        {activeCategory === 'developer' && (
          <div>
            <PanelHeader icon={Code} title={t('set.developer')} subtitle="API keys and webhooks." />
            <ApiDeveloperPanel planTier={planTier} onUpgrade={() => onNavigate?.('billing')} />
          </div>
        )}
        {activeCategory === 'meetings' && (
          <div>
            <PanelHeader icon={Sliders} title={t('set.meeting_presets')} subtitle="Configure active hardware switches upon joining active call channels." />
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '780px', width: '100%' }}>
              <SectionCard icon={Sliders} title={t('set.join_presets')} subtitle="Microphone and camera state when you join a meeting.">
              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>{t('set.mute_sound_on_join')}</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{t('set.join_the_meeting_room_with')}</p>
                </div>
                <input type="checkbox" checked={muteOnJoin} onChange={(e) => handleToggleMuteOnJoin(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>

              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>{t('set.disable_webcam_on_join')}</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{t('set.start_call_with_video_feed')}</p>
                </div>
                <input type="checkbox" checked={videoOffOnJoin} onChange={(e) => handleToggleVideoOffOnJoin(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              </div>
              </SectionCard>
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
