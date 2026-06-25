import React, { useState } from 'react';
import { User, Bell, Video, Shield, Globe, Moon, Sun, Save, Check } from 'lucide-react';

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
  onUpdateProfile: (
    name: string, 
    email: string, 
    avatarUrl?: string,
    role?: string,
    timezone?: string,
    location?: string,
    skills?: string[],
    phone?: string
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
  onUpdateProfile,
}) => {
  const [activeCategory, setActiveCategory] = useState<'profile' | 'notifications' | 'meetings' | 'security' | 'language'>('profile');
  
  // Profile state
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [avatarUrl, setAvatarUrl] = useState(userAvatarUrl || '');
  const [phone, setPhone] = useState(userPhone);
  const [role, setRole] = useState(userRole);
  const [timezone, setTimezone] = useState(userTimezone);
  const [location, setLocation] = useState(userLocation);
  const [skillsText, setSkillsText] = useState((userSkills || []).join(', '));
  const [showSavedToast, setShowSavedToast] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (userAvatarUrl) {
      setAvatarUrl(userAvatarUrl);
    }
  }, [userAvatarUrl]);

  React.useEffect(() => {
    setName(userName);
    setEmail(userEmail);
    setPhone(userPhone || '');
    setRole(userRole || '');
    setTimezone(userTimezone || 'UTC');
    setLocation(userLocation || '');
    setSkillsText((userSkills || []).join(', '));
  }, [userName, userEmail, userPhone, userRole, userTimezone, userLocation, userSkills]);

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

  // Toggle states
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(true);
  const [muteOnJoin, setMuteOnJoin] = useState(false);
  const [videoOffOnJoin, setVideoOffOnJoin] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');

  const categories = [
    { id: 'profile', name: 'Profile Settings', icon: User },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'meetings', name: 'Meeting Defaults', icon: Video },
    { id: 'security', name: 'Security & Privacy', icon: Shield },
    { id: 'language', name: 'Language & Region', icon: Globe },
  ];

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    const skillsArray = skillsText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    onUpdateProfile(name, email, avatarUrl, role, timezone, location, skillsArray, phone);
    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '260px 1fr',
      gap: '2rem',
      height: 'calc(100vh - 120px)',
      animation: 'slide-in var(--transition-normal)'
    }} className="grid-2">
      
      {/* Categories Sidebar */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', height: 'fit-content' }}>
        <h2 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-heading)', marginBottom: '1rem' }}>Settings</h2>
        
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id as any)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: activeCategory === cat.id ? 'var(--color-primary)' : 'transparent',
                color: activeCategory === cat.id ? 'white' : 'var(--text-main)',
                textAlign: 'left',
                fontWeight: activeCategory === cat.id ? 600 : 400,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Icon size={18} />
              <span>{cat.name}</span>
            </button>
          );
        })}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '1rem 0' }} />

        {/* Theme Toggler inside settings */}
        <div className="flex-between" style={{ padding: '0.5rem 1rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Theme mode</span>
          <button 
            onClick={onToggleTheme}
            style={{
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--color-accent)'
            }}
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} color="var(--color-primary)" />}
          </button>
        </div>
      </div>

      {/* Main Settings Display Area */}
      <div className="glass-panel" style={{ padding: '2.5rem', overflowY: 'auto' }}>
        
        {activeCategory === 'profile' && (
          <div>
            <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Profile Settings</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Update your user profile picture, contact details, and display preferences.</p>
            
            <form onSubmit={handleProfileSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '500px' }}>
              {/* Picture simulation */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '0.5rem' }}>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.8rem',
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
                    style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
                  >
                    Upload Photo
                  </button>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>PNG, JPG or GIF up to 5MB.</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Display Name</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Email Address</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Phone Number</label>
                <input 
                  type="text" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +1 (555) 019-2834"
                  className="premium-input"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Job Title & Role</label>
                <input 
                  type="text" 
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Senior UX Designer"
                  className="premium-input"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Office Location</label>
                <input 
                  type="text" 
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. San Francisco, CA"
                  className="premium-input"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Primary Timezone</label>
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

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Skills (comma-separated)</label>
                <input 
                  type="text" 
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  placeholder="e.g. React, TypeScript, WebRTC"
                  className="premium-input"
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                <button type="submit" className="premium-btn premium-btn-primary">
                  <Save size={16} />
                  <span>Save Changes</span>
                </button>

                {showSavedToast && (
                  <span style={{ 
                    color: '#10B981', 
                    fontSize: '0.9rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.25rem',
                    animation: 'pop-in 0.2s ease'
                  }}>
                    <Check size={16} />
                    <span>Settings saved successfully!</span>
                  </span>
                )}
              </div>
            </form>
          </div>
        )}

        {activeCategory === 'notifications' && (
          <div>
            <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Notification Options</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Configure how and when you receive system alerts, calls, and email newsletters.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px' }}>
              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Email Notifications</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Receive email logs, meeting summaries, and billing invoices.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={emailNotif}
                  onChange={() => setEmailNotif(!emailNotif)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>

              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Push Alerts</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Receive alerts when contacts send messages or invite you to calls.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={pushNotif}
                  onChange={() => setPushNotif(!pushNotif)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'meetings' && (
          <div>
            <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Meeting Default Presets</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Adjust standard audio and video hardware options for joining calls.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px' }}>
              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Mute microphone on join</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Automatically mute your sound feed when joining any virtualization room.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={muteOnJoin}
                  onChange={() => setMuteOnJoin(!muteOnJoin)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>

              <div className="flex-between" style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Turn off video camera on join</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Start in audio-only mode and activate video manually inside rooms.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={videoOffOnJoin}
                  onChange={() => setVideoOffOnJoin(!videoOffOnJoin)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>
        )}

        {activeCategory === 'security' && (
          <div>
            <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Security & Privacy</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Configure passwords, session settings, and encrypted token configurations.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '500px' }}>
              <button className="premium-btn premium-btn-secondary" style={{ justifyContent: 'center' }}>
                Reset Login Password
              </button>
              <button className="premium-btn premium-btn-danger" style={{ justifyContent: 'center' }}>
                Revoke All Active Sessions
              </button>
            </div>
          </div>
        )}

        {activeCategory === 'language' && (
          <div>
            <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Language & Region</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Set your default UI language, timezone, and calendar offsets.</p>
            
            <div style={{ maxWidth: '400px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Preferred Language</label>
              <select 
                value={selectedLanguage} 
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="premium-input"
              >
                <option value="en">English (US)</option>
                <option value="pt">Português (Brasil)</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
