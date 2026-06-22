import { useState, useEffect } from 'react';
import { 
  Home, MessageSquare, Users, Settings as SettingsIcon, HelpCircle, 
  CreditCard, Bell, LogOut, Sun, Moon, CheckCircle2, ChevronDown, User, Shield
} from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { MeetingRoom } from './components/MeetingRoom';
import { Contacts } from './components/Contacts';
import { Chats } from './components/Chats';
import { Settings } from './components/Settings';
import { Billing } from './components/Billing';
import { HelpCenter } from './components/HelpCenter';
import { Auth } from './components/Auth';
import { PrivateSpace } from './components/PrivateSpace';
import { Waitroom } from './components/Waitroom';
import { Superadmin } from './components/Superadmin';
import { mockAuth, supabase } from './supabaseClient';

interface Meeting {
  id: string;
  title: string;
  time: string;
  duration: string;
  status: 'Completed' | 'In Progress' | 'Scheduled';
  host: string;
}

function App() {
  // Authentication & Directory Discovery
  const [user, setUser] = useState<{ id: string; email: string; name: string; workspaceName: string; domain: string; is_superadmin?: boolean; avatar_url?: string } | null>(() => {
    const saved = localStorage.getItem('giin_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [joinMeetingData, setJoinMeetingData] = useState<{ meetingId: string; passcode: string } | null>(null);

  // Navigation & Theme
  const [currentView, setCurrentView] = useState<string>(() => {
    return localStorage.getItem('giin_view') || 'dashboard';
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('giin_theme') === 'dark';
  });
  const [isPremium, setIsPremium] = useState<boolean>(() => {
    return localStorage.getItem('giin_premium') === 'true';
  });

  // Profile
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('giin_name') || 'Giin User';
  });
  const [userEmail, setUserEmail] = useState<string>(() => {
    return localStorage.getItem('giin_email') || 'user@giinmeet.com';
  });

  // Meeting History State
  const [meetingHistory, setMeetingHistory] = useState<Meeting[]>([]);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

  // Hash query router listener
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#/join')) {
        const urlParams = new URLSearchParams(hash.split('?')[1]);
        const id = urlParams.get('id') || '';
        const passcode = urlParams.get('passcode') || '';
        if (id) {
          setJoinMeetingData({ meetingId: id, passcode });
          setCurrentView('join');
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sync session and fetch profile details on load
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await mockAuth.getProfile(session.user.id);
        const domain = session.user.email?.split('@')[1] || 'personal';
        const isSuperAdminEmail = session.user.email?.toLowerCase() === 'nimdaukus@gmail.com';
        const isSuperadmin = profile?.is_superadmin || isSuperAdminEmail || false;
        
        if (isSuperAdminEmail && profile && !profile.is_superadmin) {
          mockAuth.updateProfileSuperadmin(session.user.id, true);
        }

        const authenticatedUser = {
          id: session.user.id,
          email: session.user.email || '',
          name: profile?.name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Giin User',
          workspaceName: profile?.workspace_name || session.user.user_metadata?.workspace_name || 'Personal Workspace',
          domain: profile?.domain || domain,
          is_superadmin: isSuperadmin,
          avatar_url: profile?.avatar_url || ''
        };
        setUser(authenticatedUser);
        setUserName(authenticatedUser.name);
        setUserEmail(authenticatedUser.email);
        setIsPremium(profile?.is_premium || false);
      }
    };
    checkSession();

    // Listen to real auth session state updates
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
      if (session?.user) {
        const { data: profile } = await mockAuth.getProfile(session.user.id);
        const domain = session.user.email?.split('@')[1] || 'personal';
        const isSuperAdminEmail = session.user.email?.toLowerCase() === 'nimdaukus@gmail.com';
        const isSuperadmin = profile?.is_superadmin || isSuperAdminEmail || false;
        
        if (isSuperAdminEmail && profile && !profile.is_superadmin) {
          mockAuth.updateProfileSuperadmin(session.user.id, true);
        }

        const authenticatedUser = {
          id: session.user.id,
          email: session.user.email || '',
          name: profile?.name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Giin User',
          workspaceName: profile?.workspace_name || session.user.user_metadata?.workspace_name || 'Personal Workspace',
          domain: profile?.domain || domain,
          is_superadmin: isSuperadmin,
          avatar_url: profile?.avatar_url || ''
        };
        setUser(authenticatedUser);
        setUserName(authenticatedUser.name);
        setUserEmail(authenticatedUser.email);
        setIsPremium(profile?.is_premium || false);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Fetch meetings from Supabase database when user updates
  useEffect(() => {
    if (user && user.id) {
      const loadMeetings = async () => {
        try {
          const data = await mockAuth.getMeetings(user.id);
          if (data && data.length > 0) {
            const mapped: Meeting[] = data.map((m: any) => ({
              id: m.id,
              title: m.title,
              time: new Date(m.time).toLocaleString(),
              duration: m.duration || '40m limit',
              status: m.status as 'Completed' | 'In Progress' | 'Scheduled',
              host: m.host || 'You'
            }));
            setMeetingHistory(mapped);
          } else {
            setMeetingHistory([]);
          }
        } catch (err) {
          console.error('Failed to load meetings from database:', err);
        }
      };
      loadMeetings();
    }
  }, [user]);

  // Active call states
  const [activeCallTitle, setActiveCallTitle] = useState<string | null>(null);

  // Chat redirect helper
  const [targetContactName, setTargetContactName] = useState<string | null>(null);

  // Notifications State
  const [notifications, setNotifications] = useState<{ id: string; text: string; time: string; read: boolean }[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  // Effect to apply theme variable class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('giin_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('giin_theme', 'light');
    }
  }, [isDarkMode]);

  // Sync state changes to storage
  useEffect(() => {
    localStorage.setItem('giin_view', currentView);
  }, [currentView]);

  useEffect(() => {
    localStorage.setItem('giin_premium', String(isPremium));
  }, [isPremium]);

  useEffect(() => {
    localStorage.setItem('giin_meetings', JSON.stringify(meetingHistory));
  }, [meetingHistory]);

  const handleToggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const handleStartCall = async (title?: string) => {
    const finalTitle = title || 'Instant Call';
    setActiveCallTitle(finalTitle);
    
    if (user && user.id) {
      try {
        const newDbMeet = {
          user_id: user.id,
          title: finalTitle,
          time: new Date().toISOString(),
          duration: 'Active now',
          status: 'In Progress',
          host: user.name || 'You'
        };
        const saved = await mockAuth.createMeeting(newDbMeet);
        if (saved) {
          setActiveMeetingId(saved.id);
          const mapped: Meeting = {
            id: saved.id,
            title: saved.title,
            time: new Date(saved.time).toLocaleString(),
            duration: saved.duration || 'Active now',
            status: saved.status as 'Completed' | 'In Progress' | 'Scheduled',
            host: saved.host || 'You'
          };
          setMeetingHistory(prev => [mapped, ...prev]);
        }
      } catch (err) {
        console.error('Failed to create instant meeting in database:', err);
      }
    } else {
      const newMeet: Meeting = {
        id: Math.random().toString(36).substr(2, 9),
        title: finalTitle,
        time: new Date().toLocaleString(),
        duration: 'Active now',
        status: 'In Progress',
        host: 'You'
      };
      setMeetingHistory(prev => [newMeet, ...prev]);
    }
    setCurrentView('meeting');
  };

  const handleEndMeeting = async () => {
    setActiveCallTitle(null);
    if (activeMeetingId) {
      try {
        await mockAuth.updateMeetingNotes(activeMeetingId, 'Meeting completed successfully.', 0, 'Completed');
      } catch (err) {
        console.error('Failed to update end status of meeting in database:', err);
      }
      setActiveMeetingId(null);
    }
    setMeetingHistory(prev => 
      prev.map(m => m.status === 'In Progress' ? { ...m, status: 'Completed', duration: 'Ended call' } : m)
    );
    setCurrentView('dashboard');
  };

  const handleAddMeeting = async (meet: Meeting) => {
    if (user && user.id) {
      try {
        const newDbMeet = {
          user_id: user.id,
          title: meet.title,
          time: new Date(meet.time).toISOString(),
          duration: meet.duration,
          status: 'Scheduled',
          host: user.name || 'You'
        };
        const saved = await mockAuth.createMeeting(newDbMeet);
        if (saved) {
          const mapped: Meeting = {
            id: saved.id,
            title: saved.title,
            time: new Date(saved.time).toLocaleString(),
            duration: saved.duration || '40m limit',
            status: 'Scheduled',
            host: saved.host || 'You'
          };
          setMeetingHistory(prev => [mapped, ...prev]);
        }
      } catch (err) {
        console.error('Failed to schedule meeting in database:', err);
      }
    } else {
      setMeetingHistory(prev => [meet, ...prev]);
    }

    const newNotif = {
      id: Math.random().toString(36).substr(2, 9),
      text: `Scheduled new meeting: "${meet.title}"`,
      time: 'Just now',
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const handleAuthSuccess = (authenticatedUser: { id: string; email: string; name: string; workspaceName: string; domain: string; is_superadmin?: boolean; avatar_url?: string }) => {
    setUser(authenticatedUser);
    setUserName(authenticatedUser.name);
    setUserEmail(authenticatedUser.email);
    localStorage.setItem('giin_user', JSON.stringify(authenticatedUser));
    localStorage.setItem('giin_name', authenticatedUser.name);
    localStorage.setItem('giin_email', authenticatedUser.email);
    
    const newNotif = {
      id: Math.random().toString(36).substr(2, 9),
      text: `Connected to ${authenticatedUser.workspaceName} directory!`,
      time: 'Just now',
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
    setCurrentView('dashboard');
  };

  const handleSaveWorkspaceData = async (notes: string, actionItemsCount: number) => {
    const newNotif = {
      id: Math.random().toString(36).substr(2, 9),
      text: `Synced collaborative notes: Saved ${actionItemsCount} action tasks.`,
      time: 'Just now',
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);

    if (activeMeetingId) {
      try {
        await mockAuth.updateMeetingNotes(activeMeetingId, notes, actionItemsCount);
      } catch (err) {
        console.error('Failed to update meeting notes in database:', err);
      }
    }

    setMeetingHistory(prev => 
      prev.map(m => m.status === 'In Progress' ? { ...m, duration: `Saved notes (${actionItemsCount} tasks)` } : m)
    );
  };

  const handleNavigateToChat = (contactName: string) => {
    setTargetContactName(contactName);
    setCurrentView('chats');
  };

  const handleUpdateProfile = async (name: string, email: string, avatarUrl?: string) => {
    setUserName(name);
    setUserEmail(email);
    localStorage.setItem('giin_name', name);
    localStorage.setItem('giin_email', email);

    if (user && user.id) {
      try {
        await mockAuth.updateProfile(user.id, name, email, avatarUrl);
        const updatedUser = {
          ...user,
          name,
          email,
          avatar_url: avatarUrl !== undefined ? avatarUrl : user.avatar_url
        };
        setUser(updatedUser);
        localStorage.setItem('giin_user', JSON.stringify(updatedUser));
      } catch (err) {
        console.error('Failed to update profile in database:', err);
      }
    }
  };

  const handleUpgradeSuccess = () => {
    setIsPremium(true);
    // Add premium notification
    const newNotif = {
      id: Math.random().toString(36).substr(2, 9),
      text: 'Congratulations! Your GIIN MEET Pro account is now active.',
      time: 'Just now',
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const handleDowngrade = () => {
    setIsPremium(false);
  };

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const unreadNotifCount = notifications.filter(n => !n.read).length;

  if (currentView === 'join' && joinMeetingData) {
    return (
      <Waitroom 
        meetingId={joinMeetingData.meetingId}
        initialPasscode={joinMeetingData.passcode}
        user={user}
        onAdmitted={(title, _participantId) => {
          setActiveCallTitle(title);
          setActiveMeetingId(joinMeetingData.meetingId);
          setCurrentView('meeting');
        }}
        onDeclined={() => {
          setCurrentView(user ? 'dashboard' : 'auth');
        }}
        onBack={() => {
          setCurrentView(user ? 'dashboard' : 'auth');
        }}
      />
    );
  }

  if (user === null) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div style={{
      display: 'flex',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-app)'
    }}>
      
      {/* Sidebar Navigation */}
      <aside className="sidebar-desktop" style={{
        width: '260px',
        backgroundColor: 'var(--bg-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '2rem 1.5rem',
        borderRight: '1px solid var(--border-color)',
        zIndex: 50,
        color: 'white',
        flexShrink: 0
      }}>
        {/* Upper Logo Section */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '3rem',
            paddingLeft: '0.5rem'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              backgroundColor: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.25rem',
              color: 'black'
            }}>
              G
            </div>
            <div>
              <span style={{ 
                fontFamily: 'var(--font-heading)', 
                fontWeight: 800, 
                fontSize: '1.25rem', 
                letterSpacing: '0.05em',
                color: 'white'
              }}>
                GIIN MEET
              </span>
              <span style={{
                display: 'block',
                fontSize: '0.65rem',
                letterSpacing: '0.1em',
                color: 'var(--color-secondary)'
              }}>
                VIRTUALIZATION HUB
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Dashboard Link */}
            <button 
              onClick={() => {
                setTargetContactName(null);
                setCurrentView('dashboard');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: currentView === 'dashboard' ? 'var(--color-secondary)' : 'transparent',
                color: currentView === 'dashboard' ? 'white' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'dashboard' ? 600 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Home size={18} />
              <span>Dashboard</span>
            </button>

            {/* Chats Link */}
            <button 
              onClick={() => setCurrentView('chats')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: currentView === 'chats' ? 'var(--color-secondary)' : 'transparent',
                color: currentView === 'chats' ? 'white' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'chats' ? 600 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
            >
              <MessageSquare size={18} />
              <span>Chat Center</span>
            </button>

            {/* Contacts Link */}
            <button 
              onClick={() => setCurrentView('contacts')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: currentView === 'contacts' ? 'var(--color-secondary)' : 'transparent',
                color: currentView === 'contacts' ? 'white' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'contacts' ? 600 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Users size={18} />
              <span>Contacts</span>
            </button>

            {/* Private Space E2EE Vault Link */}
            <button 
              onClick={() => setCurrentView('private')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: currentView === 'private' ? '1px solid #EF4444' : 'none',
                background: currentView === 'private' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                color: currentView === 'private' ? '#EF4444' : 'rgba(255,255,255,0.75)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'private' ? 700 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Shield size={18} color={currentView === 'private' ? '#EF4444' : 'rgba(255,255,255,0.6)'} />
              <span>Private Vault</span>
            </button>

            {/* Help Center Link */}
            <button 
              onClick={() => setCurrentView('help')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: currentView === 'help' ? 'var(--color-secondary)' : 'transparent',
                color: currentView === 'help' ? 'white' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'help' ? 600 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
            >
              <HelpCircle size={18} />
              <span>Help & Support</span>
            </button>

            {/* Superadmin Portal Link */}
            {user?.is_superadmin && (
              <button 
                onClick={() => setCurrentView('superadmin')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: currentView === 'superadmin' ? '1px solid var(--color-accent)' : 'none',
                  background: currentView === 'superadmin' ? 'rgba(250, 189, 2, 0.15)' : 'transparent',
                  color: currentView === 'superadmin' ? 'var(--color-accent)' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontWeight: currentView === 'superadmin' ? 700 : 400,
                  fontSize: '0.95rem',
                  width: '100%',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Shield size={18} color={currentView === 'superadmin' ? 'var(--color-accent)' : 'rgba(255,255,255,0.6)'} />
                <span>Superadmin Portal</span>
              </button>
            )}

            {/* Settings Link */}
            <button 
              onClick={() => setCurrentView('settings')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: currentView === 'settings' ? 'var(--color-secondary)' : 'transparent',
                color: currentView === 'settings' ? 'white' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'settings' ? 600 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
            >
              <SettingsIcon size={18} />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* Lower Sidebar: Upgrade details & logout */}
        <div>
          {/* Plan badge */}
          <div 
            onClick={() => setCurrentView('billing')}
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              marginBottom: '1rem',
              cursor: 'pointer'
            }}
          >
            <div className="flex-between" style={{ marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>Current Tier</span>
              {isPremium ? (
                <span className="badge badge-premium" style={{ border: 'none', scale: '0.85' }}>Pro</span>
              ) : (
                <span className="badge" style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'white', scale: '0.85' }}>Free</span>
              )}
            </div>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {isPremium ? 'Active Access' : 'Upgrade Account'}
              <CreditCard size={12} color="var(--color-accent)" />
            </span>
          </div>

          <button 
            onClick={async () => {
              try {
                await supabase.auth.signOut();
              } catch (err) {
                console.warn('Signout issue:', err);
              }
              localStorage.clear();
              window.location.reload();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: '0.9rem',
              width: '100%',
              textAlign: 'left'
            }}
          >
            <LogOut size={16} />
            <span>Reset Demo Data</span>
          </button>
        </div>
      </aside>

      {/* Main Framework Container */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        
        {/* Top Header Row */}
        <header style={{
          height: '70px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 2.5rem',
          flexShrink: 0,
          zIndex: 40
        }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, textTransform: 'capitalize', fontFamily: 'var(--font-heading)' }}>
              {currentView === 'help' ? 'Help Center & Support' : currentView === 'chats' ? 'Chat Center' : currentView === 'meeting' ? 'Active Call Room' : currentView}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            {/* Quick Meeting button in Header */}
            {currentView !== 'meeting' && (
              <button 
                onClick={() => handleStartCall()}
                className="premium-btn premium-btn-primary" 
                style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem', borderRadius: '6px' }}
              >
                Start Instant Meeting
              </button>
            )}

            {/* Theme quick toggler */}
            <button 
              onClick={handleToggleTheme}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {isDarkMode ? <Sun size={20} color="var(--color-accent)" /> : <Moon size={20} color="var(--color-primary)" />}
            </button>

            {/* Notification Dropper */}
            <div style={{ position: 'relative' }}>
              <button 
                onClick={() => {
                  setShowNotifDropdown(!showNotifDropdown);
                  setShowProfileDropdown(false);
                  markAllNotificationsRead();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  position: 'relative'
                }}
              >
                <Bell size={20} />
                {unreadNotifCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    backgroundColor: '#EF4444',
                    color: 'white',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'pulse-ring 2s infinite'
                  }}>
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div className="glass-panel" style={{
                  position: 'absolute',
                  top: '40px',
                  right: 0,
                  width: '320px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '1.25rem',
                  zIndex: 100,
                  animation: 'pop-in 0.2s ease',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem'
                }}>
                  <div className="flex-between">
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Alerts & Notifications</span>
                    <button 
                      onClick={clearNotifications}
                      style={{ background: 'none', border: 'none', fontSize: '0.75rem', color: 'var(--color-secondary)', cursor: 'pointer' }}
                    >
                      Clear All
                    </button>
                  </div>
                  <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '200px', overflowY: 'auto' }}>
                    {notifications.map((n) => (
                      <div key={n.id} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem' }}>
                        <div style={{ marginTop: '0.15rem' }}><CheckCircle2 size={12} color="#10B981" /></div>
                        <div>
                          <p style={{ color: 'var(--text-main)' }}>{n.text}</p>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{n.time}</span>
                        </div>
                      </div>
                    ))}
                    {notifications.length === 0 && (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem 0' }}>
                        No new notifications.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Dropper */}
            <div style={{ position: 'relative' }}>
              <div 
                onClick={() => {
                  setShowProfileDropdown(!showProfileDropdown);
                  setShowNotifDropdown(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer'
                }}
              >
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  overflow: 'hidden'
                }}>
                  {user?.avatar_url ? (
                    <img 
                      src={user.avatar_url} 
                      alt={userName} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                    />
                  ) : (
                    userName.split(' ').map(n => n[0]).join('')
                  )}
                </div>
                <ChevronDown size={14} color="var(--text-muted)" />
              </div>

              {showProfileDropdown && (
                <div className="glass-panel" style={{
                  position: 'absolute',
                  top: '45px',
                  right: 0,
                  width: '240px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '1.25rem',
                  zIndex: 100,
                  animation: 'pop-in 0.2s ease',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem'
                }}>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>{userName}</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{userEmail}</p>
                  </div>
                  <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />
                  <button 
                    onClick={() => {
                      setCurrentView('settings');
                      setShowProfileDropdown(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <User size={14} />
                    <span>My Profile</span>
                  </button>
                  <button 
                    onClick={() => {
                      setCurrentView('billing');
                      setShowProfileDropdown(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <CreditCard size={14} />
                    <span>Billing & Plans</span>
                  </button>
                </div>
              )}
            </div>

          </div>
        </header>

        {/* Dynamic Inner Panel viewport */}
        <main style={{
          flex: 1,
          padding: '2.5rem',
          overflowY: 'auto',
          backgroundColor: 'transparent'
        }}>
          {currentView === 'dashboard' && (
            <Dashboard 
              isPremium={isPremium}
              onNavigate={setCurrentView}
              onStartMeeting={handleStartCall}
              meetingHistory={meetingHistory}
              onAddMeeting={handleAddMeeting}
              userName={user?.name || userName}
            />
          )}

          {currentView === 'meeting' && activeMeetingId && (
            <MeetingRoom 
              meetingId={activeMeetingId}
              meetingTitle={activeCallTitle || 'GIIN MEET Video Room'}
              onEndMeeting={handleEndMeeting}
              onSaveWorkspaceData={handleSaveWorkspaceData}
              currentUser={user}
            />
          )}

          {currentView === 'private' && (
            <PrivateSpace 
              viewerName={userName}
              viewerEmail={userEmail}
              meetingTitle="Confidential Board Alignment"
              onExit={() => setCurrentView('dashboard')}
            />
          )}

          {currentView === 'contacts' && (
            <Contacts 
              userDomain={user?.domain}
              userWorkspaceName={user?.workspaceName}
              onNavigateToChat={handleNavigateToChat}
              onStartCall={handleStartCall}
            />
          )}

          {currentView === 'chats' && (
            <Chats 
              initialTargetContact={targetContactName}
              onClearTargetContact={() => setTargetContactName(null)}
              onStartMeeting={handleStartCall}
              user={user}
            />
          )}

          {currentView === 'settings' && (
            <Settings 
              isDarkMode={isDarkMode}
              onToggleTheme={handleToggleTheme}
              userName={userName}
              userEmail={userEmail}
              userAvatarUrl={user?.avatar_url || ''}
              onUpdateProfile={handleUpdateProfile}
            />
          )}

          {currentView === 'billing' && (
            <Billing 
              isPremium={isPremium}
              onUpgradeSuccess={handleUpgradeSuccess}
              onDowngrade={handleDowngrade}
            />
          )}

          {currentView === 'superadmin' && (
            <Superadmin />
          )}

          {currentView === 'help' && (
            <HelpCenter />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <div className="bottom-nav-mobile" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '65px',
        backgroundColor: 'var(--bg-card)',
        borderTop: '1px solid var(--border-color)',
        display: 'none', // Shown on mobile via media query in index.css
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 100,
        boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.05)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}>
        <button 
          onClick={() => { setTargetContactName(null); setCurrentView('dashboard'); }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            gap: '4px',
            cursor: 'pointer',
            padding: '0.25rem',
            flex: 1
          }}
        >
          <Home size={20} color={currentView === 'dashboard' ? 'var(--color-active-nav)' : 'var(--text-muted)'} style={{ color: currentView === 'dashboard' ? 'var(--color-active-nav)' : 'var(--text-muted)' }} />
          <span style={{
            fontSize: '0.65rem',
            fontWeight: currentView === 'dashboard' ? 700 : 500,
            color: currentView === 'dashboard' ? 'var(--color-active-nav)' : 'var(--text-muted)',
            fontFamily: 'var(--font-heading)'
          }}>Home</span>
        </button>

        <button 
          onClick={() => setCurrentView('chats')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            gap: '4px',
            cursor: 'pointer',
            padding: '0.25rem',
            flex: 1
          }}
        >
          <MessageSquare size={20} color={currentView === 'chats' ? 'var(--color-active-nav)' : 'var(--text-muted)'} style={{ color: currentView === 'chats' ? 'var(--color-active-nav)' : 'var(--text-muted)' }} />
          <span style={{
            fontSize: '0.65rem',
            fontWeight: currentView === 'chats' ? 700 : 500,
            color: currentView === 'chats' ? 'var(--color-active-nav)' : 'var(--text-muted)',
            fontFamily: 'var(--font-heading)'
          }}>Chats</span>
        </button>

        <button 
          onClick={() => setCurrentView('contacts')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            gap: '4px',
            cursor: 'pointer',
            padding: '0.25rem',
            flex: 1
          }}
        >
          <Users size={20} color={currentView === 'contacts' ? 'var(--color-active-nav)' : 'var(--text-muted)'} style={{ color: currentView === 'contacts' ? 'var(--color-active-nav)' : 'var(--text-muted)' }} />
          <span style={{
            fontSize: '0.65rem',
            fontWeight: currentView === 'contacts' ? 700 : 500,
            color: currentView === 'contacts' ? 'var(--color-active-nav)' : 'var(--text-muted)',
            fontFamily: 'var(--font-heading)'
          }}>Contacts</span>
        </button>

        <button 
          onClick={() => setCurrentView('private')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            gap: '4px',
            cursor: 'pointer',
            padding: '0.25rem',
            flex: 1
          }}
        >
          <Shield size={20} color={currentView === 'private' ? '#EF4444' : 'var(--text-muted)'} style={{ color: currentView === 'private' ? '#EF4444' : 'var(--text-muted)' }} />
          <span style={{
            fontSize: '0.65rem',
            fontWeight: currentView === 'private' ? 700 : 500,
            color: currentView === 'private' ? '#EF4444' : 'var(--text-muted)',
            fontFamily: 'var(--font-heading)'
          }}>Vault</span>
        </button>

        <button 
          onClick={() => setCurrentView('settings')}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            gap: '4px',
            cursor: 'pointer',
            padding: '0.25rem',
            flex: 1
          }}
        >
          <SettingsIcon size={20} color={currentView === 'settings' ? 'var(--color-active-nav)' : 'var(--text-muted)'} style={{ color: currentView === 'settings' ? 'var(--color-active-nav)' : 'var(--text-muted)' }} />
          <span style={{
            fontSize: '0.65rem',
            fontWeight: currentView === 'settings' ? 700 : 500,
            color: currentView === 'settings' ? 'var(--color-active-nav)' : 'var(--text-muted)',
            fontFamily: 'var(--font-heading)'
          }}>Settings</span>
        </button>
      </div>

    </div>
  );
}

export default App;
