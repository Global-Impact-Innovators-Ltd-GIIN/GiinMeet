import { useState, useEffect, useRef } from 'react';
import { 
  Home, MessageSquare, Users, Settings as SettingsIcon, HelpCircle, 
  CreditCard, Bell, LogOut, Sun, Moon, CheckCircle2, ChevronDown, User, Shield,
  Phone, PhoneOff, ChevronLeft, ChevronRight
} from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { MeetingRoom, startRingSound, stopRingSound } from './components/MeetingRoom';
import { Contacts } from './components/Contacts';
import { Chats } from './components/Chats';
import type { ChatThread, Message } from './components/Chats';
import { Settings } from './components/Settings';
import { Billing } from './components/Billing';
import { HelpCenter } from './components/HelpCenter';
import { Auth } from './components/Auth';
import { PrivateSpace } from './components/PrivateSpace';
import { Waitroom } from './components/Waitroom';
import { PreJoinCheck } from './components/PreJoinCheck';
import { Superadmin } from './components/Superadmin';
import { MeetingLobby } from './components/MeetingLobby';
import { giinApi, supabase, getTransparentLogo, isMeetingHost, isMeetingHostForUser } from './supabaseClient';
import { encryptMessage, decryptMessage } from './services/e2ee';


interface Meeting {
  id: string;
  title: string;
  time: string;
  duration: string;
  // Round 9 (9A/9B/9C): 'Cancelled' is a real status (Round 8 cancel);
  // link expiry is read lazily (the columns only exist once
  // giinmeet_link_expiry.sql runs), so both fields are optional.
  status: 'Completed' | 'In Progress' | 'Scheduled' | 'Cancelled';
  host: string;
  passcode?: string;
  link_expires_at?: string | null;
  link_expiry_mode?: string | null;
  // Phase 1 — all optional: the columns only exist once
  // giinmeet_phase1.sql runs, so every reader must tolerate absence.
  reminder_enabled?: boolean;
  reminder_minutes_before?: number;
  series_id?: string | null;
  recurrence_rule?: string | null;
  recurrence_count?: number | null;
  personal_room_slug?: string | null;
}

const applyFont = (fontFamilyHeading: string, fontFamilyBody: string) => {
  document.documentElement.style.setProperty('--font-heading', fontFamilyHeading);
  document.documentElement.style.setProperty('--font-sans', fontFamilyBody);
  const fontId = 'google-font-' + fontFamilyHeading.replace(/\s+/g, '-').toLowerCase();
  if (!document.getElementById(fontId)) {
    const link = document.createElement('link');
    link.id = fontId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${fontFamilyHeading.replace(/\s+/g, '+')}:wght@400;500;600;700&family=${fontFamilyBody.replace(/\s+/g, '+')}:wght@400;500;600;700&display=swap`;
    document.head.appendChild(link);
  }
};

const applyBorderRadius = (radius: number) => {
  document.documentElement.style.setProperty('--radius-sm', `${radius * 0.5}px`);
  document.documentElement.style.setProperty('--radius-md', `${radius}px`);
  document.documentElement.style.setProperty('--radius-lg', `${radius * 2}px`);
  document.documentElement.style.setProperty('--radius-xl', `${radius * 3}px`);
};

const applyUiStyle = (style: string, isDark: boolean) => {
  document.documentElement.setAttribute('data-ui-style', style);
  // Remove temporary inline properties to avoid clashing with the stylesheet rule sets
  document.documentElement.style.removeProperty('--bg-app');
  document.documentElement.style.removeProperty('--bg-sidebar');
  document.documentElement.style.removeProperty('--bg-card');
  document.documentElement.style.removeProperty('--border-color');
  document.documentElement.style.removeProperty('--radius-md');
  document.documentElement.style.removeProperty('--radius-lg');
  document.documentElement.style.removeProperty('--glass-bg');
  document.documentElement.style.removeProperty('--glass-border');
  document.documentElement.style.removeProperty('--glass-blur');
  document.documentElement.style.removeProperty('--shadow-premium');
  document.documentElement.style.removeProperty('--shadow-sm');
  document.documentElement.style.removeProperty('--shadow-md');

  if (style === 'neumorphism') {
    const shadowDark = isDark ? '#070a10' : '#b8c2d0';
    const shadowLight = isDark ? '#1d273c' : '#ffffff';
    document.documentElement.style.setProperty('--glass-bg', 'var(--bg-card)');
    document.documentElement.style.setProperty('--glass-border', 'none');
    document.documentElement.style.setProperty('--glass-blur', '0px');
    document.documentElement.style.setProperty('--shadow-premium', `8px 8px 16px ${shadowDark}, -8px -8px 16px ${shadowLight}`);
    document.documentElement.style.setProperty('--shadow-sm', `3px 3px 6px ${shadowDark}, -3px -3px 6px ${shadowLight}`);
    document.documentElement.style.setProperty('--shadow-md', `6px 6px 12px ${shadowDark}, -6px -6px 12px ${shadowLight}`);
    document.documentElement.style.setProperty('--shadow-inset', `inset 4px 4px 8px ${shadowDark}, inset -4px -4px 8px ${shadowLight}`);
  } else if (style === 'cyberpunk-glow') {
    document.documentElement.style.setProperty('--glass-bg', isDark ? '#080c16' : '#f0f4ff');
    document.documentElement.style.setProperty('--glass-border', '2px solid var(--color-primary)');
    document.documentElement.style.setProperty('--glass-blur', '0px');
    document.documentElement.style.setProperty('--shadow-premium', '0 0 15px rgba(var(--color-primary-rgb), 0.35)');
    document.documentElement.style.setProperty('--shadow-sm', '0 0 5px rgba(var(--color-primary-rgb), 0.2)');
    document.documentElement.style.setProperty('--shadow-md', '0 0 8px rgba(var(--color-primary-rgb), 0.3)');
  } else if (style === 'flat-minimal') {
    document.documentElement.style.setProperty('--glass-bg', 'var(--bg-card)');
    document.documentElement.style.setProperty('--glass-border', '1px solid var(--border-color)');
    document.documentElement.style.setProperty('--glass-blur', '0px');
    document.documentElement.style.setProperty('--shadow-premium', 'none');
    document.documentElement.style.setProperty('--shadow-sm', 'none');
    document.documentElement.style.setProperty('--shadow-md', 'none');
  } else if (style === 'glassmorphism') {
    if (isDark) {
      document.documentElement.style.setProperty('--glass-bg', 'rgba(18, 24, 38, 0.75)');
      document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.06)');
      document.documentElement.style.setProperty('--glass-blur', '16px');
      document.documentElement.style.setProperty('--shadow-premium', '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)');
    } else {
      document.documentElement.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.7)');
      document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.4)');
      document.documentElement.style.setProperty('--glass-blur', '12px');
      document.documentElement.style.setProperty('--shadow-premium', '0 20px 25px -5px rgba(0, 32, 91, 0.08), 0 10px 10px -5px rgba(0, 32, 91, 0.04)');
    }
  }
};

function App() {
  // Authentication & Directory Discovery
  const [user, setUser] = useState<{ 
    id: string; 
    email: string; 
    name: string; 
    workspaceName: string; 
    domain: string; 
    is_superadmin?: boolean; 
    avatar_url?: string;
    phone?: string;
    role?: string;
    timezone?: string;
    location?: string;
    skills?: string[];
    social_handles?: any;
  } | null>(() => {
    const saved = localStorage.getItem('giin_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [joinMeetingData, setJoinMeetingData] = useState<{ meetingId: string; passcode: string } | null>(null);
  // Phase 1 — personal room: while a #/room/<slug> link resolves to its
  // session meeting, the app shows an "Opening your room…" card instead
  // of the dashboard. resolvingRoomRef guards against resolving the same
  // slug twice (the hash listener runs on mount and on every change).
  const [resolvingPersonalRoom, setResolvingPersonalRoom] = useState(false);
  const resolvingRoomRef = useRef<string | null>(null);
  // Password recovery: Supabase fires PASSWORD_RECOVERY when the user
  // opens the reset link from their email. While this is set, the Auth
  // screen shows the new-password form instead of the dashboard.
  const [passwordRecovery, setPasswordRecovery] = useState(() => window.location.hash.includes('type=recovery'));
  // Pre-join check state (defect #1): every link joiner runs the device /
  // network check before the passcode gate and the waiting room. The host
  // never sees it (hash router bypass). Reset whenever a new join starts.
  const [preJoinDone, setPreJoinDone] = useState(false);
  const [preJoinName, setPreJoinName] = useState('');
  const [preJoinVideoOn, setPreJoinVideoOn] = useState(true);
  const [preJoinAudioOn, setPreJoinAudioOn] = useState(true);
  const [joinMeetingTitle, setJoinMeetingTitle] = useState('GIIN MEET Call');
  useEffect(() => {
    if (!joinMeetingData) return;
    setPreJoinDone(false);
    setPreJoinName('');
    setPreJoinVideoOn(true);
    setPreJoinAudioOn(true);
    let active = true;
    giinApi.getMeetingDetails(joinMeetingData.meetingId).then(({ data }) => {
      if (active && data?.title) setJoinMeetingTitle(data.title);
    }).catch(() => {});
    return () => { active = false; };
  }, [joinMeetingData?.meetingId]);

  // Navigation & Theme
  const [currentView, setCurrentView] = useState<string>(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#/join')) {
      return 'join';
    }
    if (hash.startsWith('#/')) {
      const view = hash.substring(2).split('?')[0];
      if (['dashboard', 'chats', 'contacts', 'private', 'help', 'settings', 'billing', 'superadmin'].includes(view)) {
        return view;
      }
    }
    // A refresh in the lobby or mid-meeting cannot be restored: the
    // lobby data and the live meeting state are not persisted, so the
    // lobby would render a blank panel. Fall back to the dashboard.
    const storedView = localStorage.getItem('giin_view');
    return storedView && !['lobby', 'meeting'].includes(storedView) ? storedView : 'dashboard';
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('giin_theme') === 'dark';
  });
  const [isPremium, setIsPremium] = useState<boolean>(() => {
    return localStorage.getItem('giin_premium') === 'true';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('giin_sidebar_collapsed') === 'true';
  });


  // Profile
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('giin_name') || 'Giin User';
  });
  const [userEmail, setUserEmail] = useState<string>(() => {
    return localStorage.getItem('giin_email') || 'user@giinmeet.com';
  });

  // Meeting History State with localStorage hydration
  const [meetingHistory, setMeetingHistory] = useState<Meeting[]>(() => {
    try {
      const cached = localStorage.getItem('giin_meetings');
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });
  const [createdMeetings, setCreatedMeetings] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem('giin_created_meetings');
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  });
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [lobbyMeetingData, setLobbyMeetingData] = useState<{
    id: string;
    title: string;
    passcode: string;
    host: string;
    isVideoOn?: boolean;
  } | null>(null);
  const [isP2PCall, setIsP2PCall] = useState<boolean>(false);

  // Dynamic branding text
  const [brandName, setBrandName] = useState(() => localStorage.getItem('giin_brand_name') || 'GIIN MEET');
  const [brandSlogan, setBrandSlogan] = useState(() => localStorage.getItem('giin_brand_slogan') || 'VIRTUALIZATION HUB');

  // Transparent logo loading state
  const [logoUrl, setLogoUrl] = useState(() => localStorage.getItem('giin_custom_logo') || '/logo.png');
  useEffect(() => {
    const handleLogoUpdate = () => {
      const customLogo = localStorage.getItem('giin_custom_logo');
      if (customLogo) {
        setLogoUrl(customLogo);
      } else {
        getTransparentLogo('/logo.png').then(url => setLogoUrl(url));
      }
    };
    window.addEventListener('giin_logo_changed', handleLogoUpdate);
    handleLogoUpdate();
    return () => {
      window.removeEventListener('giin_logo_changed', handleLogoUpdate);
    };
  }, []);

  // Guest user session state
  const [guestUser, setGuestUser] = useState<{ id: string; name: string; email: string } | null>(null);

  // Chat Center Global State & Sync
  // Chat Center Global State & Sync with localStorage caching
  const [threads, setThreads] = useState<ChatThread[]>(() => {
    try {
      const cached = localStorage.getItem('giin_chat_threads');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const unique: ChatThread[] = [];
          parsed.forEach((t: ChatThread) => {
            if (t && t.id && !unique.some(u => u.id === t.id)) {
              unique.push(t);
            }
          });
          return unique;
        }
      }
      return [];
    } catch (e) {
      return [];
    }
  });
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [activeNotification, setActiveNotification] = useState<{ sender: string; text: string } | null>(null);
  
  // Real-time typing indicators state
  const [typingStatuses, setTypingStatuses] = useState<{ [key: string]: { userName: string; timestamp: number } }>({});
  const channelRef = useRef<any>(null);

  const handleSendTypingStatus = (threadId: string, isTyping: boolean) => {
    if (user && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          userId: user.id,
          userName: user.name,
          threadId,
          isTyping
        }
      });
    }
  };

  // Clean up stale typing statuses (older than 4 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingStatuses(prev => {
        const now = Date.now();
        const updated = { ...prev };
        let changed = false;
        Object.keys(updated).forEach(key => {
          if (now - updated[key].timestamp > 4000) {
            delete updated[key];
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Auto-cache threads whenever they change
  useEffect(() => {
    if (threads.length > 0) {
      localStorage.setItem('giin_chat_threads', JSON.stringify(threads));
    }
  }, [threads]);

  // Real-time call / signaling states
  const [incomingCall, setIncomingCall] = useState<{ meetingId: string; passcode: string; callerName: string; callerId: string } | null>(null);
  const [dialingState, setDialingState] = useState<{ targetUserId: string; targetUserName: string; meetingId: string; passcode: string } | null>(null);

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
        // Fetch groups the current user belongs to
        let { data: memberships } = await supabase
          .from('group_members')
          .select('group_id, groups(id, name)')
          .eq('user_id', user.id);

        const userGroups = memberships?.map((m: any) => m.groups).filter(Boolean) || [];
        const userGroupIds = new Set(userGroups.map(g => g.id));

        const { data: dbMessages } = await supabase
          .from('messages')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (dbMessages) {
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
              if (threadId.startsWith('dm_')) {
                const parts = threadId.split('_');
                return parts.includes(user.id);
              }
              if (threadId.startsWith('group_')) {
                const groupId = threadId.substring(6);
                return userGroupIds.has(groupId);
              }
              return false;
            })
            .map(async (threadId) => {
              const msgs = threadGroups[threadId];

              let name = threadId;
              let avatar = threadId.substring(0, 2).toUpperCase();
              let avatarBg = '#8B5CF6';
              let isGroupThread = false;

              const profile = profilesMap.get(threadId);
              if (profile) {
                name = profile.name || 'Giin User';
                avatar = profile.avatar_url ? profile.avatar_url : (profile.name ? profile.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U');
                let hash = 0;
                for (let i = 0; i < name.length; i++) {
                  hash = name.charCodeAt(i) + ((hash << 5) - hash);
                }
                avatarBg = `hsl(${Math.abs(hash % 360)}, 60%, 40%)`;
              } else if (threadId.startsWith('dm_')) {
                const parts = threadId.split('_');
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
              } else if (threadId.startsWith('group_')) {
                isGroupThread = true;
                const groupId = threadId.substring(6);
                const matchedGroup = userGroups.find(g => g.id === groupId);
                name = matchedGroup?.name || 'Group Chat';
                avatar = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) || 'GP';
                avatarBg = '#10B981';
              }

              // Decrypt DM messages, clear text group messages
              const decryptedMessages = await Promise.all(msgs.map(async (m) => {
                let text = m.text;
                if (threadId.startsWith('dm_')) {
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
                isGroup: isGroupThread,
                status: 'Online' as const,
                unreadCount: 0,
                messages: decryptedMessages
              };
            });

          const loadedThreads = await Promise.all(mappedThreadsPromises);

          // Build empty group chats (created but no messages sent yet)
          const activeThreadIds = new Set(Object.keys(threadGroups));
          const emptyGroupThreads = userGroups
            .filter(g => !activeThreadIds.has(`group_${g.id}`))
            .map(g => {
              const initials = g.name ? g.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'GP';
              return {
                id: `group_${g.id}`,
                name: g.name,
                avatar: initials,
                avatarBg: '#10B981',
                isGroup: true,
                status: 'Online' as const,
                unreadCount: 0,
                messages: []
              };
            });

          const allThreads = [...loadedThreads, ...emptyGroupThreads];

          setThreads(prev => {
            const merged = [...prev];
            allThreads.forEach(lt => {
              const idx = merged.findIndex(m => m.id === lt.id);
              if (idx >= 0) {
                merged[idx] = lt;
              } else {
                merged.push(lt);
              }
            });
            return merged;
          });

          if (allThreads.length > 0 && !activeThreadId) {
            setActiveThreadId(allThreads[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load threads from database:', err);
      }
    };

    loadAllThreads();
  }, [user]);

  // Refs to prevent real-time channel teardown/re-subscription on view/thread changes
  const threadsRef = useRef(threads);
  const activeThreadIdRef = useRef(activeThreadId);
  const currentViewRef = useRef(currentView);
  const userRef = useRef(user);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    userRef.current = user;
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

          // ONLY process DM messages involving the current user or group messages of groups they belong to
          let isGroup = false;
          let isMember = false;

          if (newMsg.thread_id.startsWith('dm_')) {
            const parts = newMsg.thread_id.split('_');
            if (parts.includes(user.id)) {
              isMember = true;
            }
          } else if (newMsg.thread_id.startsWith('group_')) {
            isGroup = true;
            // Fast local check: if group is already in threads, user is a member
            const hasThread = threadsRef.current.some((t: ChatThread) => t.id === newMsg.thread_id);
            if (hasThread) {
              isMember = true;
            } else {
              // Fallback to database check in case they were just added to a new group
              const groupId = newMsg.thread_id.substring(6);
              try {
                const { data: memberRecord } = await supabase
                  .from('group_members')
                  .select('id')
                  .eq('group_id', groupId)
                  .eq('user_id', user.id)
                  .maybeSingle();
                if (memberRecord) {
                  isMember = true;
                }
              } catch (e) {
                console.warn('Failed to verify group membership in real-time listener:', e);
              }
            }
          }

          if (!isMember) return;

          // Decrypt if it's an encrypted direct message or filter whispers for group chats
          let text = newMsg.text;
          let whisperToId: string | null = null;
          if (newMsg.thread_id.startsWith('dm_')) {
            text = await decryptMessage(newMsg.text, newMsg.thread_id);
          } else if (newMsg.thread_id.startsWith('group_')) {
            const match = text.match(/^\[WHISPER:([^:]+):([\s\S]*)\]$/);
            if (match) {
              const targetId = match[1];
              const whisperText = match[2];
              const isSender = newMsg.user_id === user.id;
              const isTarget = targetId === user.id;
              if (!isSender && !isTarget) {
                // Whisper not for current user, silently skip
                return;
              }
              text = whisperText;
              whisperToId = targetId;
            }
          }

          // Mention check
          const hasMention = text.toLowerCase().includes(`@${user.name.toLowerCase()}`) || 
                             (user.email && text.toLowerCase().includes(`@${user.email.toLowerCase()}`));

          const mappedMsg: Message & { whisperToId?: string | null } = {
            id: newMsg.id,
            sender: newMsg.sender_name,
            text: text,
            time: new Date(newMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            self: newMsg.user_id === user.id || newMsg.sender_name === 'You',
            whisperToId
          };

          setThreads(prev => {
            const hasThread = prev.some(t => t.id === newMsg.thread_id);
            if (!hasThread) {
              // Load the thread dynamically if someone starts a new chat
              const loadNewThread = async () => {
                if (newMsg.thread_id.startsWith('dm_')) {
                  const parts = newMsg.thread_id.split('_');
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
                      unreadCount: activeThreadIdRef.current !== newMsg.thread_id || currentViewRef.current !== 'chats' ? 1 : 0,
                      messages: [mappedMsg]
                    };
                    if (newMsg.user_id !== user.id) {
                      triggerInAppNotification(profile.name || 'New Contact', text);
                    }
                    setThreads(current => {
                      if (current.some(t => t.id === newMsg.thread_id)) return current;
                      return [newThread, ...current.filter(t => t.id !== newMsg.thread_id)];
                    });
                  }
                } else if (newMsg.thread_id.startsWith('group_')) {
                  const groupId = newMsg.thread_id.substring(6);
                  const { data: matchedGroup } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle();
                  if (matchedGroup) {
                    const initials = matchedGroup.name ? matchedGroup.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'GP';
                    const newThread: ChatThread = {
                      id: newMsg.thread_id,
                      name: matchedGroup.name,
                      avatar: initials,
                      avatarBg: '#10B981',
                      isGroup: true,
                      status: 'Online',
                      unreadCount: activeThreadIdRef.current !== newMsg.thread_id || currentViewRef.current !== 'chats' ? 1 : 0,
                      messages: [mappedMsg]
                    };
                    if (newMsg.user_id !== user.id) {
                      if (hasMention) {
                        triggerInAppNotification(`${newMsg.sender_name} (Mentioned You)`, text);
                      }
                    }
                    setThreads(current => {
                      if (current.some(t => t.id === newMsg.thread_id)) return current;
                      return [newThread, ...current.filter(t => t.id !== newMsg.thread_id)];
                    });
                  }
                }
              };
              loadNewThread();
              return prev;
            }

            return prev.map(t => {
              if (t.id === newMsg.thread_id) {
                if (t.messages.some((m: any) => m.id === mappedMsg.id)) return t;

                const isCurrent = t.id === activeThreadIdRef.current && currentViewRef.current === 'chats';
                const unreadCount = !isCurrent && newMsg.user_id !== user.id ? (t.unreadCount || 0) + 1 : 0;

                if (!isCurrent && newMsg.user_id !== user.id) {
                  if (isGroup) {
                    if (hasMention) {
                      triggerInAppNotification(`${newMsg.sender_name} (Mentioned You)`, text);
                    }
                  } else {
                    triggerInAppNotification(t.name, text);
                  }
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
      .on(
        'broadcast',
        { event: 'typing' },
        (payload: any) => {
          const data = payload.payload;
          if (data && data.userId !== user.id) {
            const key = `${data.threadId}_${data.userId}`;
            setTypingStatuses(prev => {
              if (data.isTyping) {
                return { ...prev, [key]: { userName: data.userName, timestamp: Date.now() } };
              } else {
                const updated = { ...prev };
                delete updated[key];
                return updated;
              }
            });
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime] Messages channel status: ${status}`, err || '');
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user]);

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
    const handleHashChange = async () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#/room/')) resolvingRoomRef.current = null;
      // Phase 1 — personal room link (#/room/<slug>): resolve the slug to
      // its session meeting server-side, then hand over to the normal
      // #/join flow (host bypass for the signed-in host, passcode gate +
      // waiting room for everyone else). The hash is rewritten, so this
      // branch runs once per link open.
      if (hash.startsWith('#/room/')) {
        const slug = hash.substring(7).split('?')[0].split('/')[0].trim().toLowerCase();
        if (!slug) return;
        if (resolvingRoomRef.current === slug) return;
        resolvingRoomRef.current = slug;
        setResolvingPersonalRoom(true);
        try {
          const resolved = await giinApi.resolvePersonalRoom(slug);
          setResolvingPersonalRoom(false);
          window.location.hash = `#/join?id=${resolved.meetingId}`;
        } catch (e: any) {
          setResolvingPersonalRoom(false);
          resolvingRoomRef.current = null;
          window.alert(e?.message || 'This personal room link could not be opened.');
          if (window.location.hash !== '#/dashboard') window.location.hash = '#/dashboard';
        }
        return;
      }
      if (hash.startsWith('#/join')) {
        const urlParams = new URLSearchParams(hash.split('?')[1]);
        const id = urlParams.get('id') || '';
        const passcode = urlParams.get('passcode') || '';
        if (!id) return;
        // Host bypass (server truth): if the signed-in user IS this
        // meeting's host, they go straight into the room as host - never
        // the passcode gate, never the waiting room. This also covers the
        // host opening their own invite link or refreshing mid-meeting.
        const me = userRef.current;
        if (me?.id) {
          try {
            const { data } = await giinApi.getMeetingDetails(id);
            if (data && (await isMeetingHostForUser(data, me))) {
              try {
                const hostRow: any = await giinApi.joinMeetingRoom(id, me.name || 'You', me.id, 'Admin', 'Admitted');
                if (hostRow?.id) {
                  try { localStorage.setItem(`giin_participant_row_${id}`, hostRow.id); } catch (e) {}
                }
              } catch (e) { /* host entry does not depend on the row write */ }
              try {
                localStorage.setItem(`admitted_meeting_${id}`, 'true');
                localStorage.setItem(`admitted_meeting_title_${id}`, data.title || 'GIIN MEET Call');
                localStorage.setItem(`admitted_meeting_name_${id}`, me.name || 'You');
              } catch (e) {}
              setActiveCallTitle(data.title || 'GIIN MEET Call');
              setActiveMeetingId(id);
              setIsP2PCall(false);
              if (window.location.hash !== '#/meeting') {
                window.location.hash = '#/meeting';
              }
              setCurrentView('meeting');
              return;
            }
          } catch (e) {
            // If the host check itself fails, fall through to the normal
            // join gate rather than stranding the user on the dashboard.
            console.warn('[GiinMeet] Host check failed, using join gate:', (e as any)?.message);
          }
        }
        setJoinMeetingData({ meetingId: id, passcode });
        setCurrentView('join');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
    // Fix Round 8 (#2): re-run when the signed-in user becomes known.
    // On a cold page load the session restores asynchronously, so the
    // first run can see no user and skip the host bypass — the host
    // then lands in the join gate instead of straight into the room.
    // The handler is idempotent for every other case.
  }, [user]);

  // Sync session and fetch profile details on load
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        let profile = null;
        try {
          const { data } = await giinApi.getProfile(session.user.id);
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
            const { data } = await giinApi.getProfile(session.user.id);
            profile = data;
          } catch (err) {
            console.error('Self-healing profile creation failed:', err);
          }
        }

        // Strictly lock superadmin to nimdaukus@gmail.com
        const isSuperadmin = isSuperAdminEmail;

        if (isSuperAdminEmail && profile && !profile.is_superadmin) {
          giinApi.updateProfileSuperadmin(session.user.id, true);
        } else if (!isSuperAdminEmail && profile?.is_superadmin) {
          // Reset database role if unauthorized user has superadmin flag
          giinApi.updateProfileSuperadmin(session.user.id, false);
        }

        const authenticatedUser = {
          id: session.user.id,
          email: session.user.email || '',
          name: profile?.name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Giin User',
          workspaceName: profile?.workspace_name || session.user.user_metadata?.workspace_name || 'Personal Workspace',
          domain: profile?.domain || domain,
          is_superadmin: isSuperadmin,
          avatar_url: profile?.avatar_url || '',
          phone: profile?.phone || '',
          role: profile?.role || 'Member',
          timezone: profile?.timezone || 'UTC',
          location: profile?.location || 'Remote',
          skills: profile?.skills || [],
          social_handles: profile?.social_handles || {}
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
      } else {
        // No live Supabase session: the cached giin_user (if any) is
        // stale — it was restored into state on load and would present
        // a signed-out (or different-account) user as signed in, so
        // every write checked against auth.uid() (e.g. scheduling a
        // meeting) fails RLS. Clear it so the app shows the sign-in
        // screen instead of a signed-in dashboard that cannot save.
        try {
          localStorage.removeItem('giin_user');
          localStorage.removeItem('giin_name');
          localStorage.removeItem('giin_email');
        } catch (e) {}
        setUser(null);
      }
    };
    checkSession();

    // Listen to real auth session state updates
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      if (session?.user) {
        let profile = null;
        try {
          const { data } = await giinApi.getProfile(session.user.id);
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
            const { data } = await giinApi.getProfile(session.user.id);
            profile = data;
          } catch (err) {
            console.error('Self-healing profile creation failed:', err);
          }
        }

        // Strictly lock superadmin to nimdaukus@gmail.com
        const isSuperadmin = isSuperAdminEmail;

        if (isSuperAdminEmail && profile && !profile.is_superadmin) {
          giinApi.updateProfileSuperadmin(session.user.id, true);
        } else if (!isSuperAdminEmail && profile?.is_superadmin) {
          // Reset database role if unauthorized user has superadmin flag
          giinApi.updateProfileSuperadmin(session.user.id, false);
        }

        const authenticatedUser = {
          id: session.user.id,
          email: session.user.email || '',
          name: profile?.name || session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Giin User',
          workspaceName: profile?.workspace_name || session.user.user_metadata?.workspace_name || 'Personal Workspace',
          domain: profile?.domain || domain,
          is_superadmin: isSuperadmin,
          avatar_url: profile?.avatar_url || '',
          phone: profile?.phone || '',
          role: profile?.role || 'Member',
          timezone: profile?.timezone || 'UTC',
          location: profile?.location || 'Remote',
          skills: profile?.skills || [],
          social_handles: profile?.social_handles || {}
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
        try {
          localStorage.removeItem('giin_user');
          localStorage.removeItem('giin_name');
          localStorage.removeItem('giin_email');
        } catch (e) {}
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Fetch meetings from Supabase database when user updates
  // Load meetings on startup with auto-seeding and localStorage fallback
  useEffect(() => {
    if (user && user.id) {
      const loadMeetings = async () => {
        try {
          const cachedRaw = localStorage.getItem('giin_meetings');
          const cached = cachedRaw ? JSON.parse(cachedRaw) : [];
          if (cached.length > 0) {
            setMeetingHistory(cached);
          }

          let data = await giinApi.getMeetingsForUser(user.id, user.email);

          if (data && data.length > 0) {
            const mapped: Meeting[] = data.filter((m: any) => m.status !== 'Cancelled').map((m: any) => ({
              id: m.id,
              title: m.title,
              time: m.time || new Date().toISOString(),
              duration: m.duration || '40m limit',
              status: m.status as 'Completed' | 'In Progress' | 'Scheduled',
              host: m.host || 'You',
              passcode: m.passcode
            }));

            // Merge with local cache
            const merged = [...mapped];
            cached.forEach((cm: any) => {
              if (!merged.some(m => m.id === cm.id)) {
                merged.push(cm);
              }
            });

            setMeetingHistory(merged);
          } else {
            if (cached.length > 0) {
              setMeetingHistory(cached);
            } else {
              setMeetingHistory([]);
            }
          }
        } catch (err) {
          console.error('Failed to load meetings from database:', err);
        }
      };
      loadMeetings();
    }
  }, [user]);

  // Fix Round 8 (Evidence 2): a dashboard tab left open never
  // refetched its history — an ended meeting stayed "IN PROGRESS"
  // with a Join Now button until a manual reload. Refetch on focus,
  // on becoming visible, and every 60 s while the tab is open, using
  // the same server-first merge as the startup load.
  const refreshMeetingHistory = async () => {
    if (!user?.id) return;
    try {
      const data = await giinApi.getMeetingsForUser(user.id, user.email);
      if (!data) return;
      const mapped: Meeting[] = data
        .filter((m: any) => m.status !== 'Cancelled')
        .map((m: any) => ({
          id: m.id,
          title: m.title,
          time: m.time || new Date().toISOString(),
          duration: m.duration || '40m limit',
          status: m.status as 'Completed' | 'In Progress' | 'Scheduled',
          host: m.host || 'You',
          passcode: m.passcode
        }));
      setMeetingHistory(prev => {
        const merged = [...mapped];
        prev.forEach((cm: any) => {
          if (!merged.some(m => m.id === cm.id)) merged.push(cm);
        });
        return merged;
      });
    } catch (err) {
      console.warn('[GiinMeet] Meeting history refresh failed:', err);
    }
  };
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void refreshMeetingHistory(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { if (!document.hidden) void refreshMeetingHistory(); }, 60000);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Active call states
  const [activeCallTitle, setActiveCallTitle] = useState<string | null>(null);
  const [activeCallVideoState, setActiveCallVideoState] = useState<boolean>(true);
  const [activeCallMuted, setActiveCallMuted] = useState<boolean>(false);

  // Chat redirect helper
  const [targetContactId, setTargetContactId] = useState<string | null>(null);

  // Notifications State
  const [notifications, setNotifications] = useState<{ id: string; text: string; time: string; read: boolean; meetingId?: string; meetingTitle?: string; targetView?: string }[]>([]);
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

  // Effect to apply custom accent colors, glassmorphism, fonts, border-radii & UI styles dynamically
  useEffect(() => {
    // 1. Accent color
    const savedAccent = localStorage.getItem('giin_accent_color');
    const savedHover = localStorage.getItem('giin_accent_hover');
    if (savedAccent && savedHover) {
      document.documentElement.style.setProperty('--color-primary', savedAccent);
      document.documentElement.style.setProperty('--color-primary-hover', savedHover);
      const hex = savedAccent.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        document.documentElement.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`);
      }
    } else {
      document.documentElement.style.removeProperty('--color-primary');
      document.documentElement.style.removeProperty('--color-primary-hover');
      document.documentElement.style.removeProperty('--color-primary-rgb');
    }

    // 2. Glassmorphism opacity (only applies if default glassmorphism is selected)
    const savedUiStyle = localStorage.getItem('giin_ui_style') || 'glassmorphism';
    const savedGlass = localStorage.getItem('giin_glass_opacity');
    
    if (savedUiStyle === 'glassmorphism') {
      if (savedGlass === 'none') {
        document.documentElement.style.setProperty('--glass-bg', 'var(--bg-card)');
        document.documentElement.style.setProperty('--glass-border', 'var(--border-color)');
        document.documentElement.style.setProperty('--glass-blur', '0px');
      } else if (savedGlass === 'ultra-clear') {
        document.documentElement.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.15)');
        document.documentElement.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.04)');
        document.documentElement.style.setProperty('--glass-blur', '8px');
      } else {
        document.documentElement.style.removeProperty('--glass-bg');
        document.documentElement.style.removeProperty('--glass-border');
        document.documentElement.style.removeProperty('--glass-blur');
      }
    }

    // 3. UI Style
    applyUiStyle(savedUiStyle, isDarkMode);

    // 4. Typography / Font Families
    const savedFontHeading = localStorage.getItem('giin_font_heading') || 'Outfit';
    const savedFontBody = localStorage.getItem('giin_font_body') || 'Inter';
    applyFont(savedFontHeading, savedFontBody);

    // 5. Border Radius
    const savedRadius = localStorage.getItem('giin_border_radius') || '8';
    applyBorderRadius(parseInt(savedRadius, 10));

    // 6. Listen for branding details change
    const handleBrandingChange = () => {
      setBrandName(localStorage.getItem('giin_brand_name') || 'GIIN MEET');
      setBrandSlogan(localStorage.getItem('giin_brand_slogan') || 'VIRTUALIZATION HUB');
    };
    window.addEventListener('giin_branding_changed', handleBrandingChange);
    handleBrandingChange();

    return () => {
      window.removeEventListener('giin_branding_changed', handleBrandingChange);
    };
  }, [user, isDarkMode]);

  const totalUnreadMessages = threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);

  // Window focus state tracker
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Flash browser tab title when user is idle/away and has unread messages
  useEffect(() => {
    let interval: any = null;
    if (totalUnreadMessages > 0 && !isWindowFocused) {
      let showAlert = true;
      interval = setInterval(() => {
        document.title = showAlert 
          ? `💬 (${totalUnreadMessages}) New Message!` 
          : 'GIIN MEET | Premium Video';
        showAlert = !showAlert;
      }, 1500);
    } else {
      document.title = totalUnreadMessages > 0 
        ? `💬 (${totalUnreadMessages}) GIIN MEET | Chat` 
        : 'GIIN MEET | Premium Video Conferencing & Virtualization';
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [totalUnreadMessages, isWindowFocused]);

  // Sync state changes to storage and update URL hash
  useEffect(() => {
    localStorage.setItem('giin_view', currentView);
    
    const hash = window.location.hash;
    // Don't override if we are loading/joining a meeting from a direct link
    if (currentView === 'join' && hash.startsWith('#/join')) {
      return;
    }
    if (currentView === 'meeting' && activeMeetingId) {
      // The address bar shows the meeting view, never a join link. Writing
      // #/join?id=... here made the hash listener route the host straight
      // back into the passcode waitroom for their own meeting. The shareable
      // invite link is copied from the lobby, the dashboard, or the in-room
      // Invite panel instead.
      if (window.location.hash !== '#/meeting') {
        window.location.hash = '#/meeting';
      }
      return;
    }
    
    // For all other views, update the hash
    const targetHash = `#/${currentView}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }, [currentView, activeMeetingId, lobbyMeetingData]);

  useEffect(() => {
    localStorage.setItem('giin_premium', String(isPremium));
  }, [isPremium]);

  useEffect(() => {
    localStorage.setItem('giin_meetings', JSON.stringify(meetingHistory));
  }, [meetingHistory]);

  const handleToggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const handleStartCall = async (title?: string, dmThreadId?: string, isVideo = true, existingMeetingId?: string, requireWaitingRoom = true, passcode?: string | null) => {
    if (existingMeetingId && activeMeetingId === existingMeetingId) {
      setCurrentView('meeting');
      return;
    }
    const finalTitle = title || 'Instant Call';
    setActiveCallTitle(finalTitle);
    setActiveCallVideoState(isVideo);
    
    // Check if this is a professional meeting (no direct DM ringing)
    const isMeeting = !dmThreadId;
    setIsP2PCall(!isMeeting);

    if (user && user.id) {
      try {
        let saved = null;
        if (existingMeetingId) {
          // Joining an existing meeting: the input may be a full invite
          // link (.../#/join?id=<uuid>&passcode=<code>), a bare meeting
          // UUID, or — the old bug — a 6-character passcode or anything
          // else. A passcode alone cannot identify a meeting, and an
          // unparseable input must fail loudly instead of silently
          // creating a brand-new meeting the user never asked for.
          const rawInput = existingMeetingId.trim();
          let joinId: string | null = null;
          let joinPasscode: string | null = null;
          const idMatch = rawInput.match(/[?&]id=([0-9a-f-]{36})/i);
          if (idMatch) {
            joinId = idMatch[1];
            const pcMatch = rawInput.match(/[?&]passcode=([A-Za-z0-9]+)/i);
            if (pcMatch) joinPasscode = pcMatch[1];
          } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawInput)) {
            joinId = rawInput;
          }
          if (!joinId) {
            window.alert('That meeting code or link was not recognised. Paste the full invite link or the meeting ID (the long code with dashes) — a 6-character passcode alone is not enough to find a meeting.');
            return;
          }
          // Fetch existing meeting details
          const { data } = await giinApi.getMeetingDetails(joinId);
          if (!data) {
            window.alert('That meeting could not be found. It may have been deleted — check the link or code and try again.');
            return;
          }
          // Only the meeting's creator / admin may (re)start it as host.
          // Anyone else goes through the waiting room like any other
          // joiner: passcode + host admission. Never register a joiner
          // as Admin — the old code did, which bypassed both.
          const isCallerHost = await isMeetingHostForUser(data, user);
          if (!isCallerHost) {
            const joinHash = `#/join?id=${joinId}` + (joinPasscode ? `&passcode=${joinPasscode}` : '');
            window.location.hash = joinHash;
            return;
          }
          // The passcode column is hidden from anon reads, so the
          // host fetches it through the host-only server route for the
          // lobby invite link below.
          const hostPasscode = await giinApi.getMeetingPasscode(joinId);
          saved = {
            id: joinId,
            title: data.title || finalTitle,
            time: new Date().toISOString(),
            duration: 'Active now',
            status: 'In Progress',
            host: data.host || user.name || 'You',
            passcode: hostPasscode || undefined,
            require_waiting_room: data.require_waiting_room ?? true
          };
        }

        if (!saved) {
          const newDbMeet = {
            user_id: user.id,
            title: finalTitle,
            time: new Date().toISOString(),
            duration: 'Active now',
            status: 'In Progress',
            host: user.name || 'You',
            require_waiting_room: requireWaitingRoom,
            passcode,
            // Round 9 (9C): instant meetings expire when they end.
            link_expiry_mode: 'on-end',
            link_expires_at: null
          };
          saved = await giinApi.createMeeting(newDbMeet);
        }

        if (saved) {
          setActiveMeetingId(saved.id);
          setCreatedMeetings(prev => {
            const next = [...prev.filter(id => id !== saved.id), saved.id];
            localStorage.setItem('giin_created_meetings', JSON.stringify(next));
            return next;
          });
          // Register the host in the meeting participants list as Admitted
          const hostRow: any = await giinApi.joinMeetingRoom(saved.id, user.name, user.id, 'Admin', 'Admitted');
          if (hostRow?.id) {
            try { localStorage.setItem(`giin_participant_row_${saved.id}`, hostRow.id); } catch (e) {}
          }
          // Remember that this browser's user is the host of this
          // meeting, so a refresh mid-meeting routes straight back in
          // instead of deadlocking in the waiting room (the host is
          // the only admitter). Cleared on leave/end in handleEndMeeting.
          try {
            localStorage.setItem(`admitted_meeting_${saved.id}`, 'true');
            localStorage.setItem(`admitted_meeting_title_${saved.id}`, saved.title || 'GIIN MEET Call');
            localStorage.setItem(`admitted_meeting_name_${saved.id}`, user.name || 'You');
          } catch (e) {}
          
          const mapped: Meeting = {
            id: saved.id,
            title: saved.title,
            time: saved.time,
            duration: saved.duration || 'Active now',
            status: 'In Progress',
            host: saved.host || 'You',
            passcode: saved.passcode
          };

          // Update meeting status in history to In Progress
          setMeetingHistory(prev => [mapped, ...prev.filter(m => m.id !== saved.id)]);

          if (dmThreadId) {
            const inviteMsg = `📞 CALL_INVITE:${saved.id}:${saved.passcode}:${user.name}`;
            let dbText = inviteMsg;
            if (dmThreadId.startsWith('dm_')) {
              dbText = await encryptMessage(inviteMsg, dmThreadId);
            }
            // The invite DM must not block starting the meeting: if it fails
            // to send, the call still goes ahead and the failure is logged.
            try {
              await giinApi.sendMessage({
                thread_id: dmThreadId,
                sender_name: user.name || 'You',
                text: dbText,
                user_id: user.id
              });
            } catch (inviteErr: any) {
              console.warn('[GiinMeet] Could not send the call invite message:', inviteErr?.message);
            }

            if (dmThreadId.startsWith('dm_')) {
              const parts = dmThreadId.split('_');
              const targetUserId = parts[1] === user.id ? parts[2] : parts[1];
              const targetThread = threads.find(t => t.id === dmThreadId);
              const targetName = targetThread ? targetThread.name : 'Contact';

              setDialingState({
                targetUserId,
                targetUserName: targetName,
                meetingId: saved.id,
                passcode: saved.passcode
              });

              startRingSound();

              const targetChannel = supabase.channel(`user-signals-${targetUserId}`);
              targetChannel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                  targetChannel.send({
                    type: 'broadcast',
                    event: 'incoming-call',
                    payload: {
                      meetingId: saved.id,
                      passcode: saved.passcode,
                      callerName: user.name || 'You',
                      callerId: user.id
                    }
                  });
                }
              });
            }
          }

          if (isMeeting) {
            setLobbyMeetingData({
              id: saved.id,
              title: saved.title,
              passcode: saved.passcode,
              host: saved.host || user.name || 'You',
              isVideoOn: isVideo
            });
            setCurrentView('lobby');
            return;
          }
        }
      } catch (err: any) {
        console.error('Failed to start meeting/call:', err);
        window.alert(`Could not start the meeting: ${err?.message || 'the meeting could not be saved.'} Please check your connection and try again.`);
      }
    } else {
      // Guests cannot start meetings: hosting needs a signed-in account so the
      // meeting, its passcode and its video room can be stored. Never invent a
      // local-only meeting — it could never connect.
      console.warn('[GiinMeet] A guest tried to start a meeting. Sign-in is required to host a meeting.');
      window.alert('Sign in to start a meeting. Guests can join a meeting from an invite link.');
      return;
    }

    setCurrentView('meeting');
  };

  const handleEndMeeting = async (skipServerEnd = false) => {
    setActiveCallTitle(null);
    const endedId = activeMeetingId;
    if (endedId) {
      // Ending a meeting for everyone is a HOST-ONLY act. App calls this
      // for every leaver - including guests and non-hosts (leave button,
      // end-for-all broadcast) - and the old code marked the meeting
      // Completed (and overwrote its notes) on ANY leave. Now: only the
      // host ends the meeting server-side (status Completed, notes
      // PRESERVED, room deactivated, capacity slots freed). Everyone else
      // just leaves locally; the meeting keeps running.
      const leaver = userRef.current;
      let isLeaverHost = false;
      if (leaver?.id) {
        try {
          const { data } = await giinApi.getMeetingDetails(endedId);
          if (data && isMeetingHost(data, leaver.id)) isLeaverHost = true;
        } catch (e) { /* host check failed: fail closed, do not end */ }
      }
      // skipServerEnd: the room already ended server-side (the host's
      // own "End for everyone" did it before showing the ended screen),
      // so do not end it twice. Otherwise the host ends it here.
      // Fix Round 6 (Phase 6): there is NO client-side fallback that
      // marks the meeting Completed when the server end fails. That
      // fallback was a silent partial end — the database said ended
      // while everyone was still connected.
      if (isLeaverHost && !skipServerEnd) {
        try {
          await giinApi.endMeeting(endedId);
        } catch (err) {
          console.error('Server end-meeting failed. The meeting was NOT marked ended:', err);
          // Fix Round 7 (#7): an end-meeting failure must NOT silently
          // send the host to the dashboard while the meeting keeps
          // running. Stay in the room and say so plainly - the host
          // retries from the meeting (End for everyone).
          window.alert('Could not end the meeting - it is still running and you are still the host. Please check your connection and try ending it again from the meeting.');
          return;
        }
      }
      // Round 9 (9A): leaving a LIVE meeting (not ending it) leaves a
      // marker so the dashboard shows "Rejoin" instead of "Join Now".
      // Ending it clears the marker — an ended meeting shows no join
      // action at all.
      try {
        if (isLeaverHost && !skipServerEnd) localStorage.removeItem(`giin_left_meeting_${endedId}`);
        else localStorage.setItem(`giin_left_meeting_${endedId}`, String(Date.now()));
      } catch (e) {}
      // Clear this meeting's admission-bypass flags so a later visit
      // to the same meeting ID does not skip the passcode and waiting
      // room forever (the flag is per-meeting and was never cleared).
      try {
        localStorage.removeItem(`admitted_meeting_${endedId}`);
        localStorage.removeItem(`admitted_meeting_title_${endedId}`);
        localStorage.removeItem(`admitted_meeting_name_${endedId}`);
        localStorage.removeItem(`giin_participant_row_${endedId}`);
        localStorage.removeItem(`admitted_keys_${endedId}`);
        localStorage.removeItem(`giin_display_name_${endedId}`);
      } catch (e) {}
      setActiveMeetingId(null);
      setPreJoinDone(false);
      setPreJoinName('');
    }
    // Only the meeting that just ended becomes Completed - the old code
    // marked EVERY In Progress meeting Completed, including live ones.
    setMeetingHistory(prev =>
      prev.map(m => m.id === endedId ? { ...m, status: 'Completed', duration: 'Ended call' } : m)
    );
    if (!user) {
      setGuestUser(null);
      setCurrentView('auth');
    } else {
      setCurrentView('dashboard');
    }
  };

  // Leave-call screen Rejoin: the room is still mounted showing the
  // leave screen, so startCall with the same id would be a no-op (it
  // early-returns when the meeting is already active). Unmount the room
  // first, then go through the normal #/join flow — the hash router
  // sends the host straight back in and everyone else through the
  // pre-join check / waiting room as usual.
  const handleRejoinMeeting = (meetingId: string) => {
    setActiveMeetingId(null);
    setPreJoinDone(false);
    window.location.hash = `#/join?id=${meetingId}`;
  };

  // Round 9 (9B): live-sync the dashboard history when any meeting row
  // changes — another tab ended it, the host admitted someone, the last
  // person left and the leave route completed it. Realtime only fires
  // when the table is in the publication; the focus/visibility/60s
  // refetch from Round 8 is the fallback, so a missing publication
  // degrades silently. Debounced to one refetch per 5 seconds.
  const lastHistorySyncRef = useRef(0);
  useEffect(() => {
    const channel = supabase
      .channel('meetings-history-sync')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meetings' },
        () => {
          const now = Date.now();
          if (now - lastHistorySyncRef.current < 5000) return;
          lastHistorySyncRef.current = now;
          void refreshMeetingHistory();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleAcceptCall = async () => {
    if (incomingCall) {
      setIsP2PCall(true);
      const callerChannel = supabase.channel(`user-signals-${incomingCall.callerId}`);
      callerChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          callerChannel.send({
            type: 'broadcast',
            event: 'call-accepted',
            payload: {
              targetId: user?.id
            }
          });
          supabase.removeChannel(callerChannel);
        }
      });
      stopRingSound();
      
      // Register the receiver in the meeting participants list. A failure here
      // must not block accepting the call: the token route registers the
      // participant again when the video connection is set up.
      if (user) {
        try {
          await giinApi.joinMeetingRoom(incomingCall.meetingId, user.name, user.id, 'Participant', 'Admitted');
        } catch (err: any) {
          console.warn('[GiinMeet] Could not register the receiver in the meeting participants list:', err?.message);
        }
      }

      setActiveCallTitle(`Call with ${incomingCall.callerName}`);
      setActiveMeetingId(incomingCall.meetingId);
      setCurrentView('meeting');
      setIncomingCall(null);
    }
  };

  const handleDeclineCall = () => {
    if (incomingCall) {
      const callerChannel = supabase.channel(`user-signals-${incomingCall.callerId}`);
      callerChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          callerChannel.send({
            type: 'broadcast',
            event: 'call-declined',
            payload: {
              targetId: user?.id
            }
          });
          supabase.removeChannel(callerChannel);
        }
      });
      stopRingSound();
      setIncomingCall(null);
    }
  };

  const handleCancelCall = () => {
    if (dialingState) {
      const targetChannel = supabase.channel(`user-signals-${dialingState.targetUserId}`);
      targetChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          targetChannel.send({
            type: 'broadcast',
            event: 'call-cancelled',
            payload: {
              callerId: user?.id
            }
          });
          supabase.removeChannel(targetChannel);
        }
      });
      stopRingSound();
      setDialingState(null);
      handleEndMeeting();
    }
  };

  // Global signaling channel subscription
  useEffect(() => {
    if (!user) return;

    const channelId = `user-signals-${user.id}`;
    const sigChannel = supabase.channel(channelId, {
      config: {
        broadcast: { self: false }
      }
    });

    sigChannel
      .on('broadcast', { event: 'incoming-call' }, (payload: any) => {
        const data = payload.payload;
        setIncomingCall(data);
        startRingSound();
      })
      .on('broadcast', { event: 'call-cancelled' }, () => {
        stopRingSound();
        setIncomingCall(null);
      })
      .on('broadcast', { event: 'call-declined' }, () => {
        stopRingSound();
        setDialingState(null);
        handleEndMeeting();
      })
      .on('broadcast', { event: 'call-accepted' }, () => {
        stopRingSound();
        setDialingState(null);
      })
      .subscribe((status) => {
        console.log(`[Realtime] Signaling channel ${channelId} status: ${status}`);
      });

    return () => {
      supabase.removeChannel(sigChannel);
      stopRingSound();
    };
  }, [user]);


  // Fix Round 8 (#12): cancel a scheduled meeting. The row is marked
  // Cancelled on the server and dropped from the history here, so a
  // cancelled meeting never renders again.
  const handleCancelMeeting = async (meetingId: string, title: string) => {
    if (!window.confirm(`Cancel "${title}"? Guests with the link will no longer be able to join.`)) return;
    const { error } = await giinApi.updateMeetingStatus(meetingId, 'Cancelled');
    if (error) {
      window.alert('Could not cancel the meeting — please try again.');
      return;
    }
    setMeetingHistory(prev => prev.filter(m => m.id !== meetingId));
  };

  // Phase 1 — cancel a whole recurring series: every still-Scheduled
  // instance in the series becomes Cancelled (past/completed instances
  // are untouched). The server path (giinApi.cancelSeries) only works
  // once giinmeet_phase1.sql has run; until then the series lives in
  // localStorage, so the instances are cancelled one by one instead.
  const handleCancelSeries = async (seriesId: string, title: string) => {
    const seriesMeetings = meetingHistory.filter((m: any) => {
      const sid = m.series_id || (() => { try { const raw = localStorage.getItem(`giin_series_${m.id}`); return raw ? JSON.parse(raw).seriesId : null; } catch (e) { return null; } })();
      return sid === seriesId && m.status === 'Scheduled';
    });
    if (seriesMeetings.length === 0) return;
    if (!window.confirm(`Cancel the whole series "${title}"? ${seriesMeetings.length} upcoming meeting${seriesMeetings.length === 1 ? '' : 's'} will be cancelled.`)) return;
    const { count, error } = await giinApi.cancelSeries(seriesId);
    if (error) {
      // No series columns yet — cancel the known instances one by one.
      let failed = 0;
      for (const m of seriesMeetings) {
        const { error: oneError } = await giinApi.updateMeetingStatus(m.id, 'Cancelled');
        if (oneError) failed++;
      }
      if (failed > 0) {
        window.alert(`Could not cancel ${failed} of the ${seriesMeetings.length} meetings — please try again.`);
      }
    } else if (count === 0) {
      // The server found nothing (columns missing or rows already gone) —
      // fall back to the instances we know about.
      for (const m of seriesMeetings) {
        await giinApi.updateMeetingStatus(m.id, 'Cancelled');
      }
    }
    setMeetingHistory(prev => prev.filter((m: any) => {
      const sid = m.series_id || (() => { try { const raw = localStorage.getItem(`giin_series_${m.id}`); return raw ? JSON.parse(raw).seriesId : null; } catch (e) { return null; } })();
      return !(sid === seriesId && m.status === 'Scheduled');
    }));
  };

  const handleAddMeeting = async (meet: { title: string; time: string; duration: string; requireWaitingRoom?: boolean; passcode?: string | null; linkExpiry?: { mode: string; expiresAt: string | null }; reminder?: { enabled: boolean; minutesBefore: number }; series?: { id: string; rule: string; count: number } }) => {
    if (!user || !user.id) {
      window.alert('Sign in to schedule a meeting.');
      return null;
    }
    // The dashboard can show a cached user after the live session has
    // expired (or changed accounts); the meetings INSERT policy checks
    // auth.uid() against user_id, so scheduling with a stale id fails
    // RLS. Check the live session first and say so plainly.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        window.alert('Your session has expired. Please sign in again to schedule a meeting.');
        return null;
      }
      if (session.user.id !== user.id) {
        window.alert('You are signed in with a different account than this dashboard shows. Please sign out and sign in again to schedule a meeting.');
        return null;
      }
    } catch (e) {
      // If the session check itself fails, fall through to the save —
      // the save will fail honestly and the catch below translates it.
    }
    try {
      const newDbMeet: any = {
        user_id: user.id,
        title: meet.title,
        time: meet.time,
        duration: meet.duration,
        status: 'Scheduled',
        host: user.name || 'You',
        require_waiting_room: meet.requireWaitingRoom ?? true,
        passcode: meet.passcode
      };
      // Round 9 (9C): the expiry travels with the meeting. createMeeting
      // probe-gates the columns (they only exist once
      // giinmeet_link_expiry.sql runs) and keeps the choice in
      // localStorage until then.
      if (meet.linkExpiry) {
        newDbMeet.link_expiry_mode = meet.linkExpiry.mode;
        newDbMeet.link_expires_at = meet.linkExpiry.expiresAt;
      }
      // Phase 1 — the reminder setting travels the same way (createMeeting
      // probe-gates the reminder columns, localStorage until then).
      if (meet.reminder) {
        newDbMeet.reminder_enabled = meet.reminder.enabled;
        newDbMeet.reminder_minutes_before = meet.reminder.minutesBefore;
      }
      // Phase 1 — the recurring-series link travels the same way.
      if (meet.series) {
        newDbMeet.series_id = meet.series.id;
        newDbMeet.recurrence_rule = meet.series.rule;
        newDbMeet.recurrence_count = meet.series.count;
      }
      const savedMeet = await giinApi.createMeeting(newDbMeet);

      const finalMeet: Meeting = {
        id: savedMeet.id,
        title: savedMeet.title,
        time: savedMeet.time,
        duration: savedMeet.duration || '40m limit',
        status: 'Scheduled',
        host: savedMeet.host || 'You',
        passcode: savedMeet.passcode,
        link_expires_at: savedMeet.link_expires_at || meet.linkExpiry?.expiresAt || null,
        link_expiry_mode: savedMeet.link_expiry_mode || meet.linkExpiry?.mode || 'on-end',
        // Phase 1 — reminder setting, so the dashboard can show it without
        // a re-read (the columns may not exist yet — see createMeeting).
        reminder_enabled: (savedMeet as any).reminder_enabled ?? meet.reminder?.enabled ?? true,
        reminder_minutes_before: (savedMeet as any).reminder_minutes_before ?? meet.reminder?.minutesBefore ?? 15,
        // Phase 1 — series link, so the dashboard can badge and cancel the
        // series without a re-read.
        series_id: (savedMeet as any).series_id ?? meet.series?.id ?? null,
        recurrence_rule: (savedMeet as any).recurrence_rule ?? meet.series?.rule ?? null,
        recurrence_count: (savedMeet as any).recurrence_count ?? meet.series?.count ?? null
      };

      setMeetingHistory(prev => [finalMeet, ...prev]);

      const newNotif = {
        id: Math.random().toString(36).substr(2, 9),
        text: `Scheduled new meeting: "${finalMeet.title}"`,
        time: 'Just now',
        read: false,
        meetingId: finalMeet.id,
        meetingTitle: finalMeet.title,
      };
      setNotifications(prev => [newNotif, ...prev]);

      return finalMeet;
    } catch (err: any) {
      console.error('Failed to schedule meeting in database:', err);
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('row-level security')) {
        window.alert('Could not schedule the meeting: your session has expired. Please sign in again and try scheduling once more.');
        return null;
      }
      window.alert(`Could not schedule the meeting: ${err?.message || 'the meeting could not be saved.'} Please check your connection and try again.`);
      return null;
    }
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
      read: false,
        targetView: 'dashboard',
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
      read: false,
        targetView: 'dashboard',
    };
    setNotifications(prev => [newNotif, ...prev]);

    if (activeMeetingId) {
      try {
        await giinApi.updateMeetingNotes(activeMeetingId, notes, actionItemsCount);
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

  const handleUpdateProfile = async (
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
  ) => {
    setUserName(name);
    setUserEmail(email);
    localStorage.setItem('giin_name', name);
    localStorage.setItem('giin_email', email);

    if (user && user.id) {
      try {
        await giinApi.updateProfile(user.id, name, email, avatarUrl, role, timezone, location, skills, phone, workspaceName, domain, socialHandles);
        const updatedUser = {
          ...user,
          name,
          email,
          avatar_url: avatarUrl !== undefined ? avatarUrl : user.avatar_url,
          role: role !== undefined ? role : user.role,
          timezone: timezone !== undefined ? timezone : user.timezone,
          location: location !== undefined ? location : user.location,
          skills: skills !== undefined ? skills : user.skills,
          phone: phone !== undefined ? phone : user.phone,
          workspaceName: workspaceName !== undefined ? workspaceName : user.workspaceName,
          domain: domain !== undefined ? domain : user.domain,
          social_handles: socialHandles !== undefined ? socialHandles : user.social_handles
        };
        setUser(updatedUser);
        localStorage.setItem('giin_user', JSON.stringify(updatedUser));
      } catch (err) {
        console.error('Failed to update profile in database:', err);
      }
    }
  };

  const handleDowngrade = () => {
    setIsPremium(false);
  };

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  // Bell notification tap: open what the notification is about. A meeting
  // notification starts/opens that meeting through the same path as the
  // dashboard Start Call button; anything else goes to its view (dashboard
  // by default). Always closes the dropdown and marks the item read.
  const handleNotificationClick = (n: { id: string; meetingId?: string; meetingTitle?: string; targetView?: string }) => {
    setShowNotifDropdown(false);
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    if (n.meetingId) {
      handleStartCall(n.meetingTitle, undefined, true, n.meetingId);
    } else {
      setCurrentView((n.targetView as any) || 'dashboard');
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const unreadNotifCount = notifications.filter(n => !n.read).length;

  // Phase 1 — personal room link resolving: show an opening card instead
  // of the dashboard while the slug is resolved to its session meeting.
  if (resolvingPersonalRoom) {
    return (
      <div style={{ width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-app)', padding: '1.5rem' }}>
        <div className="glass-panel" style={{ padding: '2rem', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontFamily: 'var(--font-heading)' }}>Opening your personal room…</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Finding the room and starting your session. This takes a moment.</p>
        </div>
      </div>
    );
  }

  if (currentView === 'join' && joinMeetingData) {
    // Pre-join prerequisite check FIRST (defect #1): guests who follow a
    // WhatsApp link used to go Waitroom -> MeetingRoom and never see any
    // device check. The check runs before the passcode gate and the
    // waiting room; the host never reaches this view (hash-router bypass
    // sends the host straight into the room). The auto-admit path still
    // runs the check first, because the Waitroom only mounts afterwards.
    if (!preJoinDone) {
      return (
        <PreJoinCheck
          meetingId={joinMeetingData.meetingId}
          meetingTitle={joinMeetingTitle}
          user={user}
          onComplete={(displayName, videoOn, audioOn) => {
            setPreJoinName(displayName);
            setPreJoinVideoOn(videoOn);
            setPreJoinAudioOn(audioOn);
            setPreJoinDone(true);
          }}
          onBack={() => {
            setCurrentView(user ? 'dashboard' : 'auth');
          }}
        />
      );
    }
    return (
      <Waitroom 
        meetingId={joinMeetingData.meetingId}
        initialPasscode={joinMeetingData.passcode}
        initialDisplayName={preJoinName}
        user={user}
        onAdmitted={(title, _participantId, displayName) => {
          setIsP2PCall(false);
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
      <div style={{ width: '100vw', height: '100dvh', backgroundColor: 'var(--bg-app)' }}>
        <MeetingRoom 
          meetingId={activeMeetingId}
          meetingTitle={activeCallTitle || 'GIIN MEET Video Room'}
          onEndMeeting={handleEndMeeting}
          onRejoinMeeting={handleRejoinMeeting}
          onSaveWorkspaceData={handleSaveWorkspaceData}
          currentUser={guestUser}
          initialVideoState={preJoinVideoOn}
          initialMutedState={!preJoinAudioOn}
          isP2PCall={false}
          isHost={false}
        />
      </div>
    );
  }

  if (passwordRecovery) {
    return (
      <Auth
        initialMode="recover"
        onAuthSuccess={handleAuthSuccess}
        onPasswordResetDone={() => setPasswordRecovery(false)}
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
      height: '100dvh',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-app)'
    }}>
      
      {/* Sidebar Navigation */}
      {currentView !== 'meeting' && (
        <aside className="sidebar-desktop" style={{
        width: isSidebarCollapsed ? '72px' : '260px',
        backgroundColor: 'var(--bg-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: isSidebarCollapsed ? '2rem 0.5rem' : '2rem 1.5rem',
        borderRight: '1px solid var(--border-color)',
        zIndex: 50,
        color: 'white',
        flexShrink: 0,
        position: 'relative',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1), padding 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        {/* Collapse/Expand Toggle Button */}
        <button 
          onClick={() => {
            const next = !isSidebarCollapsed;
            setIsSidebarCollapsed(next);
            localStorage.setItem('giin_sidebar_collapsed', String(next));
          }}
          style={{
            position: 'absolute',
            right: '-12px',
            top: '32px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 100,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Upper Logo Section */}
        <div>
          <div 
            onClick={() => {
              setTargetContactId(null);
              setCurrentView('dashboard');
            }}
            style={{
              display: 'flex',
              flexDirection: isSidebarCollapsed ? 'column' : 'row',
              alignItems: 'center',
              gap: isSidebarCollapsed ? '0.5rem' : '0.75rem',
              marginBottom: '3rem',
              paddingLeft: isSidebarCollapsed ? '0' : '0.5rem',
              cursor: 'pointer',
              justifyContent: 'center'
            }}
            title="Go to Dashboard"
          >
            <img 
              src={logoUrl} 
              alt="GIIN MEET Logo" 
              style={{
                width: isSidebarCollapsed ? '36px' : '48px',
                height: isSidebarCollapsed ? '36px' : '48px',
                objectFit: 'contain',
                borderRadius: '8px',
                filter: 'brightness(0) invert(1)'
              }} 
            />
            {!isSidebarCollapsed && (
              <div>
                <span style={{ 
                  fontFamily: 'var(--font-heading)', 
                  fontWeight: 800, 
                  fontSize: '1.25rem', 
                  letterSpacing: '0.05em',
                  color: 'white'
                }}>
                  {brandName}
                </span>
                <span style={{
                  display: 'block',
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  color: 'var(--color-secondary)'
                }}>
                  {brandSlogan}
                </span>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Dashboard Link */}
            <button 
              onClick={() => {
                setTargetContactId(null);
                setCurrentView('dashboard');
              }}
              className={`sidebar-btn ${currentView === 'dashboard' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                gap: isSidebarCollapsed ? '0' : '0.75rem',
                padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
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
              title="Dashboard"
            >
              <Home size={18} />
              {!isSidebarCollapsed && <span>Dashboard</span>}
            </button>

            {/* Chats Link */}
            <button 
              onClick={() => setCurrentView('chats')}
              className={`sidebar-btn ${currentView === 'chats' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'space-between',
                padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
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
              title="Chat Center"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: isSidebarCollapsed ? '0' : '0.75rem', position: 'relative' }}>
                <MessageSquare size={18} />
                {!isSidebarCollapsed && <span>Chat Center</span>}
                {isSidebarCollapsed && totalUnreadMessages > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-8px',
                    backgroundColor: '#EF4444',
                    color: 'white',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    padding: '0.05rem 0.25rem',
                    borderRadius: '9999px',
                    minWidth: '12px',
                    textAlign: 'center'
                  }}>
                    {totalUnreadMessages}
                  </span>
                )}
              </div>
              {!isSidebarCollapsed && totalUnreadMessages > 0 && (
                <span className="badge-pulse-red" style={{
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
              className={`sidebar-btn ${currentView === 'contacts' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                gap: isSidebarCollapsed ? '0' : '0.75rem',
                padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
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
              title="Contacts"
            >
              <Users size={18} />
              {!isSidebarCollapsed && <span>Contacts</span>}
            </button>

            {/* Private Space Link */}
            <button 
              onClick={() => setCurrentView('private')}
              className={`sidebar-btn ${currentView === 'private' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                gap: isSidebarCollapsed ? '0' : '0.75rem',
                padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: currentView === 'private' ? 'var(--color-secondary)' : 'transparent',
                color: currentView === 'private' ? 'white' : 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                textAlign: 'left',
                fontWeight: currentView === 'private' ? 600 : 400,
                fontSize: '0.95rem',
                width: '100%',
                transition: 'all var(--transition-fast)'
              }}
              title="Private Vault"
            >
              <Shield size={18} />
              {!isSidebarCollapsed && <span>Private Vault</span>}
            </button>

            {/* Help Center Link */}
            <button 
              onClick={() => setCurrentView('help')}
              className={`sidebar-btn ${currentView === 'help' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                gap: isSidebarCollapsed ? '0' : '0.75rem',
                padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
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
              title="Help & Support"
            >
              <HelpCircle size={18} />
              {!isSidebarCollapsed && <span>Help & Support</span>}
            </button>

            {/* Superadmin Portal Link */}
            {user?.is_superadmin && (
              <button 
                onClick={() => setCurrentView('superadmin')}
                className={`sidebar-btn ${currentView === 'superadmin' ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                  gap: isSidebarCollapsed ? '0' : '0.75rem',
                  padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
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
                {!isSidebarCollapsed && <span>Superadmin Portal</span>}
              </button>
            )}

            {/* Settings Link */}
            <button 
              onClick={() => setCurrentView('settings')}
              className={`sidebar-btn ${currentView === 'settings' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                gap: isSidebarCollapsed ? '0' : '0.75rem',
                padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
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
              title="Settings"
            >
              <SettingsIcon size={18} />
              {!isSidebarCollapsed && <span>Settings</span>}
            </button>
          </nav>
        </div>

        {/* Lower Sidebar: Upgrade details & logout */}
        <div>
          {/* Plan badge */}
          {isSidebarCollapsed ? (
            <div 
              onClick={() => setCurrentView('billing')}
              className="sidebar-upgrade-card"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                marginBottom: '1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 'auto',
                marginRight: 'auto'
              }}
              title="Upgrade Account"
            >
              <CreditCard size={18} color="var(--color-accent)" />
            </div>
          ) : (
            <div 
              onClick={() => setCurrentView('billing')}
              className="sidebar-upgrade-card"
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
          )}

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
            className="sidebar-reset-btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
              gap: isSidebarCollapsed ? '0' : '0.75rem',
              padding: isSidebarCollapsed ? '0.75rem 0' : '0.75rem 1rem',
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              fontSize: '0.9rem',
              width: '100%',
              textAlign: 'left'
            }}
            title="Reset Demo Data"
          >
            <LogOut size={16} />
            {!isSidebarCollapsed && <span>Reset Demo Data</span>}
          </button>
        </div>
      </aside>
      )}

      {/* Main Framework Container */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        
        {/* Top Header Row */}
        {currentView !== 'meeting' && (
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
              <div 
                className="mobile-brand-container" 
                onClick={() => {
                  setTargetContactId(null);
                  setCurrentView('dashboard');
                }}
                style={{
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer'
                }}
                title="Go to Dashboard"
              >
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
                <span className="mobile-hidden" style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 800,
                  fontSize: '1.1rem',
                  letterSpacing: '0.03em',
                  color: 'var(--text-main)'
                }}>
                  {brandName}
                </span>
                <span className="mobile-hidden" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0.25rem' }}>|</span>
              </div>

              <h2 className="header-title" style={{ fontWeight: 700, textTransform: 'capitalize', fontFamily: 'var(--font-heading)' }}>
                {currentView === 'help' ? 'Help Center & Support' : currentView === 'chats' ? 'Chat Center' : currentView === 'meeting' ? 'Active Call Room' : currentView}
              </h2>
            </div>

            <div className="header-actions">
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
                className="header-icon-btn theme-toggle-btn"
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
                  className="header-icon-btn notif-toggle-btn"
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
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleNotificationClick(n)}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '0.5rem', borderRadius: '8px', cursor: 'pointer' }}
                        >
                          <div style={{ marginTop: '0.15rem' }}><CheckCircle2 size={12} color="#10B981" /></div>
                          <div>
                            <p style={{ color: 'var(--text-main)', margin: 0 }}>{n.text}</p>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{n.time}</span>
                          </div>
                        </button>
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
                  className="header-profile-trigger"
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
        )}

        {/* Dynamic Inner Panel viewport */}
        <main style={{
          flex: 1,
          padding: (currentView === 'meeting' || currentView === 'dashboard') && activeMeetingId ? '0' : '2.5rem',
          overflowY: currentView === 'meeting' ? 'hidden' : 'auto',
          backgroundColor: 'transparent'
        }}>
          {currentView === 'dashboard' && (
            <Dashboard 
              isPremium={isPremium}
              onNavigate={setCurrentView}
              onStartMeeting={handleStartCall}
              meetingHistory={meetingHistory}
              onCancelMeeting={handleCancelMeeting}
              onCancelSeries={handleCancelSeries}
              onAddMeeting={handleAddMeeting}
              userName={user?.name || userName}
              userDomain={user?.domain}
            />
          )}

          {currentView === 'lobby' && lobbyMeetingData && (
            <MeetingLobby
              meetingId={lobbyMeetingData.id}
              meetingTitle={lobbyMeetingData.title}
              passcode={lobbyMeetingData.passcode}
              hostName={lobbyMeetingData.host}
              currentUser={user}
              onJoin={(videoOn, audioOn) => {
                setActiveCallTitle(lobbyMeetingData.title);
                setActiveMeetingId(lobbyMeetingData.id);
                setActiveCallVideoState(videoOn);
                setActiveCallMuted(!audioOn);
                setCurrentView('meeting');
                setLobbyMeetingData(null);
              }}
              onCancel={() => {
                setLobbyMeetingData(null);
                setCurrentView('dashboard');
              }}
            />
          )}

          {activeMeetingId && (
            <MeetingRoom 
              meetingId={activeMeetingId}
              meetingTitle={activeCallTitle || 'GIIN MEET Video Room'}
              onEndMeeting={handleEndMeeting}
          onRejoinMeeting={handleRejoinMeeting}
              onSaveWorkspaceData={handleSaveWorkspaceData}
              currentUser={user}
              initialVideoState={activeCallVideoState}
              initialMutedState={activeCallMuted}
              isP2PCall={isP2PCall}
              isHost={createdMeetings.includes(activeMeetingId) || meetingHistory.some(m => m.id === activeMeetingId && (m.host === 'You' || m.host === user?.name))}
              isMinimized={currentView !== 'meeting'}
              onMinimizeToggle={(minimized) => {
                setCurrentView(minimized ? 'dashboard' : 'meeting');
              }}
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
              onStartCall={(title, targetId) => {
                if (user && targetId) {
                  const dmThreadId = 'dm_' + [user.id, targetId].sort().join('_');
                  handleStartCall(title, dmThreadId);
                } else {
                  handleStartCall(title);
                }
              }}
            />
          )}

          {currentView === 'chats' && (
            <Chats 
              initialTargetContactId={targetContactId}
              onClearTargetContact={() => setTargetContactId(null)}
              onStartMeeting={handleStartCall}
              onJoinCall={(meetingId, passcode) => {
                setJoinMeetingData({ meetingId, passcode });
                setCurrentView('join');
              }}
              user={user}
              threads={threads}
              setThreads={setThreads}
              activeThreadId={activeThreadId}
              setActiveThreadId={setActiveThreadId}
              typingStatuses={typingStatuses}
              onSendTypingStatus={handleSendTypingStatus}
            />
          )}

          {currentView === 'settings' && (
            <Settings 
              isDarkMode={isDarkMode}
              onToggleTheme={handleToggleTheme}
              userName={userName}
              userEmail={userEmail}
              userAvatarUrl={user?.avatar_url || ''}
              userPhone={user?.phone || ''}
              userRole={user?.role || ''}
              userTimezone={user?.timezone || 'UTC'}
              userLocation={user?.location || ''}
              userSkills={user?.skills || []}
              userWorkspaceName={user?.workspaceName || 'Personal Workspace'}
              userDomain={user?.domain || 'personal'}
              userSocialHandles={user?.social_handles || {}}
              onUpdateProfile={handleUpdateProfile}
            />
          )}

          {currentView === 'billing' && (
            <Billing
              isPremium={isPremium}
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
              <span className="badge-pulse-red" style={{
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

      {dialingState && (
        <div className="calling-overlay-container">
          <div className="calling-overlay-card">
            <div className="calling-overlay-avatar" style={{ backgroundColor: 'var(--color-primary)' }}>
              <div className="calling-avatar-ring" style={{ color: 'var(--color-secondary)' }} />
              {dialingState.targetUserName.split(' ').map(n => n[0]).join('').toUpperCase()}
            </div>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'white', fontFamily: 'var(--font-heading)' }}>
              Calling {dialingState.targetUserName}
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
              Connecting secure call...
            </p>
            <div className="calling-overlay-buttons">
              <button onClick={handleCancelCall} className="calling-overlay-btn calling-btn-decline" style={{ margin: '0 auto', maxWidth: '200px' }}>
                <PhoneOff size={18} />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {incomingCall && (
        <div className="calling-overlay-container">
          <div className="calling-overlay-card">
            <div className="calling-overlay-avatar" style={{ backgroundColor: '#10B981' }}>
              <div className="calling-avatar-ring-incoming" style={{ color: '#10B981' }} />
              {incomingCall.callerName.split(' ').map(n => n[0]).join('').toUpperCase()}
            </div>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'white', fontFamily: 'var(--font-heading)' }}>
              Incoming Call
            </h3>
            <p style={{ fontSize: '1rem', color: 'white', fontWeight: 600, margin: '0 0 0.25rem 0' }}>
              {incomingCall.callerName}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Secure Meeting Room
            </p>
            <div className="calling-overlay-buttons">
              <button onClick={handleDeclineCall} className="calling-overlay-btn calling-btn-decline">
                <PhoneOff size={18} />
                <span>Decline</span>
              </button>
              <button onClick={handleAcceptCall} className="calling-overlay-btn calling-btn-accept">
                <Phone size={18} />
                <span>Accept</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
