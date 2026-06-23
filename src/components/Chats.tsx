import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Smile, Paperclip, Search, PlusCircle, MoreVertical, 
  Video, CheckCheck, ArrowLeft, MessageSquare
} from 'lucide-react';
import { mockAuth, supabase } from '../supabaseClient';
import { encryptMessage, decryptMessage } from '../services/e2ee';

interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  self: boolean;
}

interface ChatThread {
  id: string;
  name: string;
  avatar: string;
  avatarBg: string;
  isGroup: boolean;
  status: 'Online' | 'Offline' | 'typing...';
  messages: Message[];
  unreadCount?: number;
}

interface ChatsProps {
  initialTargetContact?: string | null;
  onClearTargetContact?: () => void;
  onStartMeeting: (title: string) => void;
  user: { id: string; email: string; name: string; workspaceName: string; domain: string } | null;
}

export const Chats: React.FC<ChatsProps> = ({ 
  initialTargetContact, 
  onClearTargetContact,
  onStartMeeting,
  user
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showConversationMobile, setShowConversationMobile] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [threads, setThreads] = useState<ChatThread[]>([]);

  // Add Contact states
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [queryAdd, setQueryAdd] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
  const [foundContacts, setFoundContacts] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState('');
  const [activeNotification, setActiveNotification] = useState<{ sender: string; text: string } | null>(null);

  // Dynamically load threads based on database messages
  useEffect(() => {
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

          const mappedThreadsPromises = Object.keys(threadGroups).map(async (threadId) => {
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
            } else if (user && threadId.startsWith('dm-')) {
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
                      unreadCount: activeThreadId !== newMsg.thread_id ? 1 : 0,
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
                if (t.messages.some(m => m.id === mappedMsg.id)) return t;

                const isCurrent = t.id === activeThreadId;
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
  }, [user, activeThreadId]);

  // Search profiles database for new contact
  const handleSearchContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryAdd.trim()) return;

    setSearchStatus('searching');
    try {
      const { data } = await mockAuth.searchProfile(queryAdd);
      if (data && data.length > 0) {
        setFoundContacts(data);
        setSearchStatus('found');
      } else {
        setFoundContacts([]);
        setSearchStatus('not_found');
      }
    } catch (err) {
      console.error('Error searching contact:', err);
      setFoundContacts([]);
      setSearchStatus('not_found');
    }
  };

  const handleStartChatWithContact = (contact: any) => {
    if (!user) return;
    const dmId = ['dm', user.id, contact.id].sort().join('-');
    const existingThread = threads.find(t => t.id === dmId);
    if (existingThread) {
      setActiveThreadId(existingThread.id);
    } else {
      const initials = contact.name ? contact.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U';
      let hash = 0;
      for (let i = 0; i < (contact.name || '').length; i++) {
        hash = (contact.name || '').charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash % 360);
      const avatarBg = `hsl(${hue}, 60%, 40%)`;

      const newThread: ChatThread = {
        id: dmId,
        name: contact.name || 'User',
        avatar: contact.avatar_url ? contact.avatar_url : initials,
        avatarBg: avatarBg,
        isGroup: false,
        status: 'Online',
        unreadCount: 0,
        messages: []
      };
      setThreads(prev => [newThread, ...prev]);
      setActiveThreadId(dmId);
    }
    setShowAddContactModal(false);
    setQueryAdd('');
    setSearchStatus('idle');
    setFoundContacts([]);
    setShowConversationMobile(true);
  };

  // Generate invitation link for non-registered contacts
  const handleCopyInviteLink = () => {
    const inviteLink = `${window.location.origin}/#/join`;
    const inviteText = `Hey! Join me on GiinMeet for secure virtual meetings and instant chats. Sign up here: ${inviteLink}`;
    navigator.clipboard.writeText(inviteText);
    setToastMessage('Invitation copied to clipboard!');
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Handle redirect from Contacts click
  useEffect(() => {
    if (initialTargetContact && user) {
      const loadRedirect = async () => {
        const existingThread = threads.find(t => t.name.toLowerCase() === initialTargetContact.toLowerCase());
        if (existingThread) {
          setActiveThreadId(existingThread.id);
          setShowConversationMobile(true);
        } else {
          // Fetch contact details by name to get contact.id
          const { data } = await mockAuth.searchProfile(initialTargetContact);
          const contact = data && data.length > 0 ? data[0] : null;
          if (contact) {
            const dmId = ['dm', user.id, contact.id].sort().join('-');
            const initials = contact.name ? contact.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U';
            let hash = 0;
            for (let i = 0; i < (contact.name || '').length; i++) {
              hash = (contact.name || '').charCodeAt(i) + ((hash << 5) - hash);
            }
            const avatarBg = `hsl(${Math.abs(hash % 360)}, 60%, 40%)`;

            const newThread: ChatThread = {
              id: dmId,
              name: contact.name || 'User',
              avatar: contact.avatar_url ? contact.avatar_url : initials,
              avatarBg: avatarBg,
              isGroup: false,
              status: 'Online',
              unreadCount: 0,
              messages: []
            };
            setThreads(prev => [newThread, ...prev]);
            setActiveThreadId(dmId);
            setShowConversationMobile(true);
          } else {
            // Fallback to simulated ID
            const newId = initialTargetContact.toLowerCase().replace(/\s+/g, '-');
            const newThread: ChatThread = {
              id: newId,
              name: initialTargetContact,
              avatar: initialTargetContact.split(' ').map(n => n[0]).join(''),
              avatarBg: '#8B5CF6',
              isGroup: false,
              status: 'Online',
              unreadCount: 0,
              messages: [
                { id: '1', sender: initialTargetContact, text: `Hello! Nice to connect with you. Let me know if we need a video call.`, time: 'Now', self: false }
              ]
            };
            setThreads(prev => [newThread, ...prev]);
            setActiveThreadId(newId);
            setShowConversationMobile(true);
          }
        }
        if (onClearTargetContact) {
          onClearTargetContact();
        }
      };
      loadRedirect();
    }
  }, [initialTargetContact, threads, user, onClearTargetContact]);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [threads]);

  // Clear unread counts for the active thread when activeThreadId changes
  useEffect(() => {
    if (activeThreadId) {
      setThreads(prev => 
        prev.map(t => t.id === activeThreadId && (t.unreadCount || 0) > 0 ? { ...t, unreadCount: 0 } : t)
      );
    }
  }, [activeThreadId]);

  // Load messages from Supabase when activeThreadId changes
  useEffect(() => {
    const loadMessages = async () => {
      if (!activeThreadId) return;
      try {
        const dbMessages = await mockAuth.getMessages(activeThreadId);
        if (dbMessages && dbMessages.length > 0) {
          const decryptedMessages = await Promise.all(dbMessages.map(async (m: any) => {
            let text = m.text;
            if (activeThreadId.startsWith('dm-')) {
              text = await decryptMessage(m.text, activeThreadId);
            }
            return {
              id: m.id,
              sender: m.sender_name,
              text: text,
              time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              self: m.sender_name === 'You' || !!(user && m.user_id === user.id)
            };
          }));
          
          setThreads(prev => 
            prev.map(t => t.id === activeThreadId ? { ...t, messages: decryptedMessages } : t)
          );
        }
      } catch (err) {
        console.error('Error fetching messages from database:', err);
      }
    };
    
    loadMessages();
  }, [activeThreadId, user]);

  const activeThread = threads.find(t => t.id === activeThreadId) || threads[0];

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeThreadId) return;

    const currentText = chatInput;
    setChatInput('');

    // Generate unique random string for message ID (used locally before database saves)
    const localId = Math.random().toString(36).substr(2, 9);
    const newMsg: Message = {
      id: localId,
      sender: 'You',
      text: currentText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: true
    };

    setThreads(prev => 
      prev.map(t => {
        if (t.id === activeThreadId) {
          return { ...t, messages: [...t.messages, newMsg] };
        }
        return t;
      })
    );

    // Save user message to Supabase
    try {
      let dbText = currentText;
      if (activeThreadId.startsWith('dm-')) {
        dbText = await encryptMessage(currentText, activeThreadId);
      }
      await mockAuth.sendMessage({
        thread_id: activeThreadId,
        sender_name: 'You',
        text: dbText,
        user_id: user?.id || undefined
      });
    } catch (err) {
      console.error('Failed to send user message to database:', err);
    }
  };

  const handleAddEmoji = (emoji: string) => {
    setChatInput(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const filteredThreads = threads.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '320px 1fr',
      gap: '1.5rem',
      height: 'calc(100vh - 120px)',
      animation: 'slide-in var(--transition-normal)'
    }} className="grid-2">
      
      {/* Sidebar List */}
      <div className={`glass-panel ${showConversationMobile ? 'mobile-hidden' : ''}`} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
        <div className="flex-between">
          <h2 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-heading)' }}>Conversations</h2>
          <button 
            onClick={() => setShowAddContactModal(true)}
            style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer' }}
          >
            <PlusCircle size={20} />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Search conversations..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="premium-input"
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        {/* Chat Thread List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {filteredThreads.map(t => {
            const lastMsg = t.messages[t.messages.length - 1];
            return (
              <div 
                key={t.id}
                onClick={() => {
                  setActiveThreadId(t.id);
                  setShowConversationMobile(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: activeThreadId === t.id ? 'rgba(112, 130, 190, 0.12)' : 'transparent',
                  border: activeThreadId === t.id ? '1px solid var(--color-secondary)' : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: t.avatarBg,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  marginRight: '0.75rem',
                  overflow: 'hidden'
                }}>
                  {t.avatar && (t.avatar.startsWith('http') || t.avatar.startsWith('data:image')) ? (
                    <img src={t.avatar} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    t.avatar
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex-between" style={{ marginBottom: '0.15rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {lastMsg ? lastMsg.time : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <p style={{ 
                      fontSize: '0.8rem', 
                      color: 'var(--text-muted)', 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis',
                      flex: 1
                    }}>
                      {lastMsg ? `${lastMsg.sender}: ${lastMsg.text}` : 'No messages'}
                    </p>
                    {t.unreadCount && t.unreadCount > 0 ? (
                      <span style={{
                        backgroundColor: 'var(--color-secondary)',
                        color: 'white',
                        fontSize: '0.7rem',
                        fontWeight: 'bold',
                        padding: '0.15rem 0.4rem',
                        borderRadius: '9999px',
                        minWidth: '18px',
                        height: '18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                        flexShrink: 0
                      }}>
                        {t.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Conversation Window */}
      <div className={`glass-panel ${!showConversationMobile ? 'mobile-hidden' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {activeThread ? (
          <>
            {/* Chat Room Header */}
            <div style={{
              padding: '1.25rem 2rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(var(--color-primary-rgb), 0.02)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  className="mobile-only-back"
                  onClick={() => setShowConversationMobile(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                    display: 'none',
                    alignItems: 'center',
                    padding: '0.25rem'
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: activeThread.avatarBg,
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  overflow: 'hidden'
                }}>
                  {activeThread.avatar && (activeThread.avatar.startsWith('http') || activeThread.avatar.startsWith('data:image')) ? (
                    <img src={activeThread.avatar} alt={activeThread.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    activeThread.avatar
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)' }}>{activeThread.name}</h3>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                    <span>{activeThread.isGroup ? 'Group Active' : 'Online'}</span>
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button 
                  onClick={() => onStartMeeting(`Meeting with ${activeThread.name}`)}
                  className="premium-btn premium-btn-secondary" 
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
                >
                  <Video size={16} />
                  <span>Call Video</span>
                </button>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <MoreVertical size={20} />
                </button>
              </div>
            </div>

            {/* Messaging Logs Area */}
            <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              <div style={{ textAlign: 'center', margin: '0.5rem 0' }}>
                <span style={{ 
                  fontSize: '0.75rem', 
                  color: 'var(--text-muted)', 
                  backgroundColor: 'rgba(var(--color-secondary-rgb), 0.1)', 
                  padding: '0.25rem 0.75rem',
                  borderRadius: '9999px',
                  border: '1px solid var(--border-color)'
                }}>
                  Messages are end-to-end encrypted
                </span>
              </div>

              {activeThread.messages.map((m) => (
                <div 
                  key={m.id}
                  style={{
                    alignSelf: m.self ? 'flex-end' : 'flex-start',
                    maxWidth: '65%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: m.self ? 'flex-end' : 'flex-start'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {m.sender}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {m.time}
                    </span>
                  </div>
                  <div style={{
                    padding: '0.75rem 1rem',
                    borderRadius: m.self ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                    backgroundColor: m.self ? 'var(--color-primary)' : 'var(--bg-app)',
                    color: m.self ? 'white' : 'var(--text-main)',
                    fontSize: '0.9rem',
                    lineHeight: 1.45,
                    border: m.self ? 'none' : '1px solid var(--border-color)',
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    {m.text}
                  </div>
                  {m.self && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--color-secondary)', fontSize: '0.65rem', marginTop: '0.15rem' }}>
                      <CheckCheck size={12} />
                      <span>Delivered</span>
                    </span>
                  )}
                </div>
              ))}


              
              <div ref={messagesEndRef} />
            </div>

            {/* Input Tray */}
            <div style={{ padding: '1.25rem 2rem', borderTop: '1px solid var(--border-color)', position: 'relative' }}>
              
              {/* Emoji Picker Tray (Simulated) */}
              {showEmojiPicker && (
                <div className="glass-panel" style={{
                  position: 'absolute',
                  bottom: '80px',
                  left: '20px',
                  width: '260px',
                  padding: '1rem',
                  backgroundColor: 'var(--bg-card)',
                  zIndex: 100,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: '0.5rem',
                  animation: 'pop-in 0.15s ease'
                }}>
                  {['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜'].map((emoji, index) => (
                    <button 
                      key={index} 
                      onClick={() => handleAddEmoji(emoji)}
                      style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', transition: 'transform 0.1s' }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendMessage} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    type="button" 
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <Smile size={22} />
                  </button>
                  <button 
                    type="button" 
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    <Paperclip size={22} />
                  </button>
                </div>

                <input 
                  type="text" 
                  placeholder={`Write your message to ${activeThread.name}...`}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="premium-input"
                  style={{ flex: 1, borderRadius: '9999px', padding: '0.75rem 1.5rem' }}
                />

                <button 
                  type="submit" 
                  className="premium-btn premium-btn-primary" 
                  style={{ borderRadius: '50%', width: '46px', height: '46px', padding: 0, justifyContent: 'center' }}
                >
                  <Send size={18} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            padding: '2rem',
            textAlign: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(112, 130, 190, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-secondary)'
            }}>
              <MessageSquare size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.25rem', color: 'var(--text-main)', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>No Active Chat</h3>
              <p style={{ fontSize: '0.85rem', maxWidth: '300px', margin: '0 auto' }}>Select a contact from the Contacts tab to start a secure encrypted direct message.</p>
            </div>
          </div>
        )}
      </div>
      {/* Add Contact Modal */}
      {showAddContactModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '440px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            position: 'relative',
            animation: 'pop-in 0.25s ease'
          }}>
            <div className="flex-between">
              <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)' }}>Start a Chat</h3>
              <button 
                onClick={() => {
                  setShowAddContactModal(false);
                  setQueryAdd('');
                  setSearchStatus('idle');
                  setFoundContacts([]);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSearchContact} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Search by Name, Email, or Phone number
                </label>
                <input 
                  type="text" 
                  placeholder="e.g. Sofia Brant, Sofia@gmail.com, or +15550192834" 
                  value={queryAdd}
                  onChange={(e) => setQueryAdd(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <button type="submit" className="premium-btn premium-btn-primary" style={{ justifyContent: 'center' }}>
                Search
              </button>
            </form>

            {searchStatus === 'searching' && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Searching profiles directory...
              </div>
            )}

            {searchStatus === 'found' && foundContacts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '200px', overflowY: 'auto' }}>
                {foundContacts.map(contact => (
                  <div key={contact.id} style={{ 
                    padding: '0.75rem 1rem', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid var(--border-color)', 
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        overflow: 'hidden',
                        flexShrink: 0
                      }}>
                        {contact.avatar_url ? (
                          <img src={contact.avatar_url} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          (contact.name || 'User').split(' ').map((n: string) => n[0]).join('').toUpperCase()
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name || 'Phone User'}</h4>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {contact.email || contact.phone || 'GiinMeet Member'}
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleStartChatWithContact(contact)}
                      className="premium-btn premium-btn-accent" 
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: '28px' }}
                    >
                      Chat
                    </button>
                  </div>
                ))}
              </div>
            )}

            {searchStatus === 'not_found' && (
              <div style={{ 
                padding: '1rem', 
                borderRadius: 'var(--radius-md)', 
                border: '1px solid var(--border-color)', 
                backgroundColor: 'rgba(239,68,68,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                textAlign: 'center'
              }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  This contact is not currently using GiinMeet.
                </p>
                <button 
                  onClick={handleCopyInviteLink}
                  className="premium-btn premium-btn-secondary" 
                  style={{ justifyContent: 'center', width: '100%' }}
                >
                  Copy Invitation Link
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating success toast */}
      {toastMessage && (
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
          animation: 'slide-in 0.2s ease'
        }}>
          {toastMessage}
        </div>
      )}

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
};
