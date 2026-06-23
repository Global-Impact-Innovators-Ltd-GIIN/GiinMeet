import { useState, useEffect } from 'react';
import { 
  Home, MessageSquare, Users, Settings as SettingsIcon, HelpCircle, 
  CreditCard, Bell, LogOut, Sun, Moon, CheckCircle2, ChevronDown, User, Shield
} from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { MeetingRoom } from './components/MeetingRoom';
import { Contacts } from './components/Contacts';
import { Chats } from './components/Chats';
import type { ChatThread, Message } from './components/Chats';
import { Settings } from './components/Settings';
import { Billing } from './components/Billing';
import { HelpCenter } from './components/HelpCenter';
import { Auth } from './components/Auth';
import { PrivateSpace } from './components/PrivateSpace';
import { Waitroom } from './components/Waitroom';
import { Superadmin } from './components/Superadmin';
import { mockAuth, supabase, getTransparentLogo } from './supabaseClient';
import { decryptMessage } from './services/e2ee';

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

  // Transparent logo loading state
  const [logoUrl, setLogoUrl] = useState('/logo.png');
  useEffect(() => {
    getTransparentLogo('/logo.png').then(url => setLogoUrl(url));
  }, []);

  // Guest user session state
  const [guestUser, setGuestUser] = useState<{ id: string; name: string; email: string } | null>(null);

  // Chat Center Global State & Sync
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [activeNotification, setActiveNotification] = useState<{ sender: string; text: string } | null>(null);

  // Audio chime helper
  const triggerInAppNotification = (sender: string, text: string) => {
    setActiveNotification({ sender, text });
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.warn('Audio play blocked:', e);
    }
  };

  useEffect(() => {
    if (activeNotification) {
      const timer = setTimeout(() => {
        setActiveNotification(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [activeNotification]);

  // Dynamically load threads based on database messages
  useEffect(() => {
    if (!user) return;
    const loadAllThreads = async () => {
      try {
        const { data: dbMessages } = await supabase
          .from('messages')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (dbMessages && dbMessages.length > 0) {
          const threadGroups: { [key: string]: any[] } = {};
          dbMessages.forEach(m => {
            if (!threadGroups[m.thread_id]) {
              threadGroups[m.thread_id] = [];
            }
            threadGroups[m.thread_id].push(m);
          });

          const profilesRes = await supabase.from('profiles').select('*');
          const profilesMap = new Map(profilesRes.data?.map(p => [p.id, p]) || []);

          const mappedThreadsPromises = Object.keys(threadGroups)
            .filter(threadId => {
              // ONLY load DM threads for Chat Center sidebar
              if (threadId.startsWith('dm-')) {
                const parts = threadId.split('-');
                return parts.includes(user.id);
              }
              return false; // Ignore meeting chats and other non-DM threads
            })
            .map(async (threadId) => {
              const msgs = threadGroups[threadId];

              let name = threadId;
              let avatar = threadId.substring(0, 2).toUpperCase();
              let avatarBg = '#8B5CF6';

              const profile = profilesMap.get(threadId);
              if (profile) {
                name = profile.name || 'Giin User';
                avatar = profile.avatar_url ? profile.avatar_url : (profile.name ? profile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U');
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                  hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                avatarBg = `hsl(${Math.abs(hash % 360)}, 60%, 40%)`;
              } else if (threadId.startsWith('dm-')) {
                const parts = threadId.split('-');
                const otherUserId = parts[1] === user.id ? parts[2] : parts[1];
                const otherProfile = profilesMap.get(otherUserId);
                if (otherProfile) {
                  name = otherProfile.name || 'Giin User';
                  avatar = otherProfile.avatar_url ? otherProfile.avatar_url : (otherProfile.name ? otherProfile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U');
                  let hash = 0;
                  for (let i = 0; i < name.length; i++) {
                    hash = name.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  avatarBg = `hsl(${Math.abs(hash % 360)}, 60%, 40%)`;
                }
              } else if (threadId.includes('-') && !threadId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                name = threadId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                avatar = name.split(' ').map(n => n[0]).join('');
              }

              // Asynchronously decrypt all messages in the group
              const decryptedMessages = await Promise.all(msgs.map(async (m) => {
                let text = m.text;
                if (threadId.startsWith('dm-')) {
                  text = await decryptMessage(m.text, threadId);
                }
                return {
                  id: m.id,
                  sender: m.sender_name,
                  text: text,
                  time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  self: m.sender_name === 'You' || !!(user && m.user_id === user.id)
                };
              }));

              return {
                id: threadId,
                name: name,
                avatar: avatar,
                avatarBg: avatarBg,
                isGroup: false,
                status: 'Online' as const,
                unreadCount: 0,
                messages: decryptedMessages
              };
            });

          const loadedThreads = await Promise.all(mappedThreadsPromises);

          setThreads(prev => {
            const merged = [...prev];
            loadedThreads.forEach(lt => {
              const idx = merged.findIndex(m => m.id === lt.id);
              if (idx >= 0) {
                merged[idx] = lt;
              } else {
                merged.push(lt);
              }
            });
            return merged;
          });

          if (loadedThreads.length > 0 && !activeThreadId) {
            setActiveThreadId(loadedThreads[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load threads from database:', err);
      }
    };

    loadAllThreads();
  }, [user]);

  // Real-time messages sync and unread/audio notification handler
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload: any) => {
          const newMsg = payload.new;
          if (!newMsg) return;

          // ONLY process DM messages involving the current user
          if (!newMsg.thread_id.startsWith('dm-')) return;
          const parts = newMsg.thread_id.split('-');
          if (!parts.includes(user.id)) return;

          // Decrypt if it's an encrypted direct message
          let text = newMsg.text;
          if (newMsg.thread_id.startsWith('dm-')) {
            text = await decryptMessage(newMsg.text, newMsg.thread_id);
          }

          const mappedMsg: Message = {
            id: newMsg.id,
            sender: newMsg.sender_name,
            text: text,
            time: new Date(newMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            self: newMsg.user_id === user.id || newMsg.sender_name === 'You'
          };

          setThreads(prev => {
            const hasThread = prev.some(t => t.id === newMsg.thread_id);
            if (!hasThread) {
              // Load the thread dynamically if someone starts a new chat
              const loadNewThread = async () => {
                if (newMsg.thread_id.startsWith('dm-')) {
                  const parts = newMsg.thread_id.split('-');
                  const otherUserId = parts[1] === user.id ? parts[2] : parts[1];
                  const { data: profile } = await supabase.from('profiles').select('*').eq('id', otherUserId).maybeSingle();
                  if (profile) {
                    const initials = profile.name ? profile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U';
                    let hash = 0;
                    for (let i = 0; i < (profile.name || '').length; i++) {
                      hash = (profile.name || '').charCodeAt(i) + ((hash << 5) - hash);
                    }
                    const avatarBg = `hsl(${Math.abs(hash % 360)}, 60%, 40%)`;
                    const newThread: ChatThread = {
                      id: newMsg.thread_id,
                      name: profile.name || 'User',
                      avatar: profile.avatar_url || initials,
                      avatarBg,
                      isGroup: false,
                      status: 'Online',
                      unreadCount: activeThreadId !== newMsg.thread_id || currentView !== 'chats' ? 1 : 0,
                      messages: [mappedMsg]
                    };
                    if (newMsg.user_id !== user.id) {
                      triggerInAppNotification(profile.name || 'New Contact', text);
                    }
                    setThreads(current => [newThread, ...current.filter(t => t.id !== newMsg.thread_id)]);
                  }
                }
              };
              loadNewThread();
              return prev;
            }

            return prev.map(t => {
              if (t.id === newMsg.thread_id) {
                if (t.messages.some((m: any) => m.id === mappedMsg.id)) return t;

                const isCurrent = t.id === activeThreadId && currentView === 'chats';
                const unreadCount = !isCurrent && newMsg.user_id !== user.id ? (t.unreadCount || 0) + 1 : 0;

                if (!isCurrent && newMsg.user_id !== user.id) {
                  triggerInAppNotification(t.name, text);
                }

                return {
                  ...t,
                  unreadCount,
                  messages: [...t.messages, mappedMsg]
                };
              }
              return t;
            });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, activeThreadId, currentView]);

  // Clear unread counts for the active thread when activeThreadId changes or currentView switches to chats
  useEffect(() => {
    if (activeThreadId && currentView === 'chats') {
      setThreads(prev => 
        prev.map(t => t.id === activeThreadId && (t.unreadCount || 0) > 0 ? { ...t, unreadCount: 0 } : t)
      );
    }
  }, [activeThreadId, currentView]);

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
        let profile = null;
        try {
          const { data } = await mockAuth.getProfile(session.user.id);
          profile = data;
        } catch (err) {
          console.warn('Failed to fetch profile in checkSession:', err);
        }

        const domain = session.user.email?.split('@')[1] || 'personal';
        const isSuperAdminEmail = session.user.email?.toLowerCase() === 'nimdaukus@gmail.com';

        // Self-healing check: if profile is not found in database, insert it
        if (!profile) {
          const isPersonalDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase());
          const workspaceName = isPersonalDomain ? 'Personal Workspace' : `${domain.split('.')[0].toUpperCase()} Enterprise Workspace`;
          const fullName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Giin User';

          const newProfile = {
            id: session.user.id,
            name: fullName,
            email: session.user.email || null,
            workspace_name: workspaceName,
            domain: domain,
            phone: session.user.phone || null,
            is_premium: false,
            is_superadmin: isSuperAdminEmail
          };

          try {
            await supabase.from('profiles').insert([newProfile]);
            const { data } = await mockAuth.getProfile(session.user.id);
            profile = data;
          } catch (err) {
            console.error('Self-healing profile creation failed:', err);
          }
        }

        // Strictly lock superadmin to nimdaukus@gmail.com
        const isSuperadmin = isSuperAdminEmail;

        if (isSuperAdminEmail && profile && !profile.is_superadmin) {
          mockAuth.updateProfileSuperadmin(session.user.id, true);
        } else if (!isSuperAdminEmail && profile?.is_superadmin) {
          // Reset database role if unauthorized user has superadmin flag
          mockAuth.updateProfileSuperadmin(session.user.id, false);
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

        // Persist session to localStorage
        localStorage.setItem('giin_user', JSON.stringify(authenticatedUser));
        localStorage.setItem('giin_name', authenticatedUser.name);
        localStorage.setItem('giin_email', authenticatedUser.email);

        if (isSuperadmin) {
          setCurrentView('superadmin');
          localStorage.setItem('giin_view', 'superadmin');
        } else {
          // Guard routing if they previously had superadmin in localStorage view
          if (localStorage.getItem('giin_view') === 'superadmin') {
            setCurrentView('dashboard');
            localStorage.setItem('giin_view', 'dashboard');
          }
        }
      }
    };
    checkSession();

    // Listen to real auth session state updates
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
      if (session?.user) {
        let profile = null;
        try {
          const { data } = await mockAuth.getProfile(session.user.id);
          profile = data;
        } catch (err) {
          console.warn('Failed to fetch profile in onAuthStateChange:', err);
        }

        const domain = session.user.email?.split('@')[1] || 'personal';
        const isSuperAdminEmail = session.user.email?.toLowerCase() === 'nimdaukus@gmail.com';

        // Self-healing check: if profile is not found in database, insert it
        if (!profile) {
          const isPersonalDomain = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com'].includes(domain.toLowerCase());
          const workspaceName = isPersonalDomain ? 'Personal Workspace' : `${domain.split('.')[0].toUpperCase()} Enterprise Workspace`;
          const fullName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Giin User';

          const newProfile = {
            id: session.user.id,
            name: fullName,
            email: session.user.email || null,
            workspace_name: workspaceName,
            domain: domain,
            phone: session.user.phone || null,
            is_premium: false,
            is_superadmin: isSuperAdminEmail
          };

          try {
            await supabase.from('profiles').insert([newProfile]);
            const { data } = await mockAuth.getProfile(session.user.id);
            profile = data;
          } catch (err) {
            console.error('Self-healing profile creation failed:', err);
          }
        }

        // Strictly lock superadmin to nimdaukus@gmail.com
        const isSuperadmin = isSuperAdminEmail;

        if (isSuperAdminEmail && profile && !profile.is_superadmin) {
          mockAuth.updateProfileSuperadmin(session.user.id, true);
        } else if (!isSuperAdminEmail && profile?.is_superadmin) {
          // Reset database role if unauthorized user has superadmin flag
          mockAuth.updateProfileSuperadmin(session.user.id, false);
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

        // Persist session to localStorage
        localStorage.setItem('giin_user', JSON.stringify(authenticatedUser));
        localStorage.setItem('giin_name', authenticatedUser.name);
        localStorage.setItem('giin_email', authenticatedUser.email);

        if (isSuperadmin) {
          setCurrentView('superadmin');
          localStorage.setItem('giin_view', 'superadmin');
        } else {
          // Guard routing if they previously had superadmin in localStorage view
          if (localStorage.getItem('giin_view') === 'superadmin') {
            setCurrentView('dashboard');
            localStorage.setItem('giin_view', 'dashboard');
          }
        }
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
              time: m.time || new Date().toISOString(),
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
  const [targetContactId, setTargetContactId] = useState<string | null>(null);

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

  const totalUnreadMessages = threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);

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
            time: saved.time,
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
        time: new Date().toISOString(),
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
    if (!user) {
      setGuestUser(null);
      setCurrentView('auth');
    } else {
      setCurrentView('dashboard');
    }
  };

  const handleAddMeeting = async (meet: Meeting) => {
    if (user && user.id) {
      try {
        const newDbMeet = {
          user_id: user.id,
          title: meet.title,
          time: meet.time,
          duration: meet.duration,
          status: 'Scheduled',
          host: user.name || 'You'
        };
        const saved = await mockAuth.createMeeting(newDbMeet);
        if (saved) {
          const mapped: Meeting = {
            id: saved.id,
            title: saved.title,
            time: saved.time,
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
    
    if (authenticatedUser.is_superadmin) {
      setCurrentView('superadmin');
      localStorage.setItem('giin_view', 'superadmin');
    } else {
      setCurrentView('dashboard');
    }
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

  const handleNavigateToChat = (contactId: string) => {
    setTargetContactId(contactId);
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
        onAdmitted={(title, _participantId, displayName) => {
          setActiveCallTitle(title);
          setActiveMeetingId(joinMeetingData.meetingId);
          if (!user) {
            setGuestUser({ id: _participantId, name: displayName, email: 'guest@phone.giinmeet.com' });
          }
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

  // Outer routing bypass: Render meeting room for unauthenticated guest users
  if (currentView === 'meeting' && activeMeetingId && !user && guestUser) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: 'var(--bg-app)' }}>
        <MeetingRoom 
          meetingId={activeMeetingId}
          meetingTitle={activeCallTitle || 'GIIN MEET Video Room'}
          onEndMeeting={handleEndMeeting}
          onSaveWorkspaceData={handleSaveWorkspaceData}
          currentUser={guestUser}
        />
      </div>
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
            <img 
              src={logoUrl} 
              alt="GIIN MEET Logo" 
              style={{
                width: '48px',
                height: '48px',
                objectFit: 'contain',
                borderRadius: '8px',
                filter: 'brightness(0) invert(1)'
              }} 
            />
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
                setTargetContactId(null);
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
                justifyContent: 'space-between',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <MessageSquare size={18} />
                <span>Chat Center</span>
              </div>
              {totalUnreadMessages > 0 && (
                <span style={{
                  backgroundColor: '#EF4444',
                  color: 'white',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.4rem',
                  borderRadius: '9999px',
                  minWidth: '18px',
                  textAlign: 'center'
                }}>
                  {totalUnreadMessages}
                </span>
              )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Mobile Branding Header */}
            <div className="mobile-brand-container" style={{
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <img 
                src={logoUrl} 
                alt="GIIN MEET Logo" 
                style={{
                  width: '32px',
                  height: '32px',
                  objectFit: 'contain',
                  filter: isDarkMode ? 'brightness(0) invert(1)' : 'none'
                }} 
              />
              <span style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 800,
                fontSize: '1.1rem',
                letterSpacing: '0.03em',
                color: 'var(--text-main)'
              }}>
                GIIN MEET
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0.25rem' }}>|</span>
            </div>

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
                  <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }} />
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
                      gap: '0.5rem',
                      background: 'none',
                      border: 'none',
                      color: '#EF4444',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontWeight: 600
                    }}
                  >
                    <LogOut size={14} color="#EF4444" />
                    <span>Log Out</span>
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
              initialTargetContactId={targetContactId}
              onClearTargetContact={() => setTargetContactId(null)}
              onStartMeeting={handleStartCall}
              user={user}
              threads={threads}
              setThreads={setThreads}
              activeThreadId={activeThreadId}
              setActiveThreadId={setActiveThreadId}
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
          onClick={() => { setTargetContactId(null); setCurrentView('dashboard'); }}
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
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <MessageSquare size={20} color={currentView === 'chats' ? 'var(--color-active-nav)' : 'var(--text-muted)'} style={{ color: currentView === 'chats' ? 'var(--color-active-nav)' : 'var(--text-muted)' }} />
            {totalUnreadMessages > 0 && (
              <span style={{
                position: 'absolute',
                top: '-5px',
                right: '-8px',
                backgroundColor: '#EF4444',
                color: 'white',
                fontSize: '0.6rem',
                fontWeight: 700,
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {totalUnreadMessages}
              </span>
            )}
          </div>
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

      {/* Slide-down In-App Notification Banner */}
      {activeNotification && (
        <div style={{
          position: 'fixed',
          top: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          width: '90%',
          maxWidth: '400px',
          padding: '1rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
          border: '1px solid var(--color-secondary)',
          boxShadow: 'var(--shadow-premium)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          animation: 'slide-down-bounce 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: 'var(--color-primary)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem',
            fontWeight: 700,
            flexShrink: 0
          }}>
            {activeNotification.sender ? activeNotification.sender.split(' ').map(n => n[0]).join('').toUpperCase() : 'U'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              {activeNotification.sender}
            </h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeNotification.text}
            </p>
          </div>
          <button 
            onClick={() => setActiveNotification(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.25rem',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
