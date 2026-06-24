import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Smile, Paperclip, Search, PlusCircle, MoreVertical, 
  Video, CheckCheck, ArrowLeft, MessageSquare
} from 'lucide-react';
import { mockAuth } from '../supabaseClient';
import { encryptMessage, decryptMessage } from '../services/e2ee';

export interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  self: boolean;
}

export interface ChatThread {
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
  initialTargetContactId?: string | null;
  onClearTargetContact?: () => void;
  onStartMeeting: (title: string, dmThreadId?: string) => void;
  onJoinCall?: (meetingId: string, passcode: string) => void;
  user: { id: string; email: string; name: string; workspaceName: string; domain: string } | null;
  threads: ChatThread[];
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  activeThreadId: string;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string>>;
}

export const Chats: React.FC<ChatsProps> = ({ 
  initialTargetContactId, 
  onClearTargetContact,
  onStartMeeting,
  onJoinCall,
  user,
  threads,
  setThreads,
  activeThreadId,
  setActiveThreadId
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showConversationMobile, setShowConversationMobile] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add Contact states
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [queryAdd, setQueryAdd] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
  const [foundContacts, setFoundContacts] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState('');



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
    const dmId = 'dm_' + [user.id, contact.id].sort().join('_');
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
    if (initialTargetContactId && user) {
      const loadRedirect = async () => {
        const dmId = 'dm_' + [user.id, initialTargetContactId].sort().join('_');
        const existingThread = threads.find(t => t.id === dmId);
        if (existingThread) {
          setActiveThreadId(existingThread.id);
          setShowConversationMobile(true);
        } else {
          // Fetch contact details directly by profile ID
          const { data: contact } = await mockAuth.getProfile(initialTargetContactId);
          if (contact) {
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
          }
        }
        if (onClearTargetContact) {
          onClearTargetContact();
        }
      };
      loadRedirect();
    }
  }, [initialTargetContactId, threads, user, onClearTargetContact]);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [threads]);



  // Load messages from Supabase when activeThreadId changes
  useEffect(() => {
    const loadMessages = async () => {
      if (!activeThreadId) return;
      try {
        const dbMessages = await mockAuth.getMessages(activeThreadId);
        if (dbMessages && dbMessages.length > 0) {
          const decryptedMessages = await Promise.all(dbMessages.map(async (m: any) => {
            let text = m.text;
            if (activeThreadId.startsWith('dm_')) {
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
      if (activeThreadId.startsWith('dm_')) {
        dbText = await encryptMessage(currentText, activeThreadId);
      }
      await mockAuth.sendMessage({
        thread_id: activeThreadId,
        sender_name: user?.name || 'You',
        text: dbText,
        user_id: user?.id || undefined
      });
    } catch (err) {
      console.error('Failed to send user message to database:', err);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !activeThreadId) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Please select a file under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      const filePayload = `[FILE:${file.name}|${file.type}|${base64Data}]`;

      // Save user message to Supabase
      try {
        let dbText = filePayload;
        if (activeThreadId.startsWith('dm_')) {
          dbText = await encryptMessage(filePayload, activeThreadId);
        }
        
        // Add locally first for instant feedback
        const localId = Math.random().toString(36).substr(2, 9);
        const newMsg: Message = {
          id: localId,
          sender: 'You',
          text: filePayload,
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

        await mockAuth.sendMessage({
          thread_id: activeThreadId,
          sender_name: user.name || 'You',
          text: dbText,
          user_id: user.id
        });
      } catch (err) {
        console.error('Failed to send file attachment:', err);
      }
    };
    reader.readAsDataURL(file);
  };

  const renderMessageContent = (text: string, self: boolean) => {
    // Check for call invite card log
    const callInviteRegex = /^📞 CALL_INVITE:([^:]+):([^:]+):(.+)$/;
    const inviteMatch = text.match(callInviteRegex);
    if (inviteMatch) {
      const [, meetingId, passcode, callerName] = inviteMatch;
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '0.5rem 0.25rem',
          minWidth: '240px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: self ? 'rgba(250, 189, 2, 0.2)' : 'rgba(16, 185, 129, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: self ? '#FABD02' : '#10B981',
              fontSize: '1.25rem',
              animation: 'pulse-ring 2s infinite'
            }}>
              📞
            </div>
            <div>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0, color: self ? 'white' : 'var(--text-main)' }}>
                {self ? 'Outgoing Video Call' : `Incoming Call from ${callerName}`}
              </h4>
              <span style={{ fontSize: '0.7rem', color: self ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                Zero-Knowledge E2EE Call
              </span>
            </div>
          </div>
          <button 
            onClick={() => {
              if (onJoinCall) {
                onJoinCall(meetingId, passcode);
              }
            }}
            className="premium-btn premium-btn-accent"
            style={{
              padding: '0.4rem 1rem',
              fontSize: '0.8rem',
              width: '100%',
              justifyContent: 'center',
              fontWeight: 700,
              gap: '0.4rem'
            }}
          >
            <Video size={14} />
            <span>Join Video Call</span>
          </button>
        </div>
      );
    }

    const fileRegex = /^\[FILE:([^|]+)\|([^|]+)\|(.+)\]$/;
    const match = text.match(fileRegex);

    if (match) {
      const [, fileName, fileType, fileData] = match;

      if (fileType.startsWith('image/')) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
            <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', maxHeight: '200px', maxWidth: '300px' }}>
              <img 
                src={fileData} 
                alt={fileName} 
                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', transition: 'transform 0.2s' }} 
                onClick={() => {
                  const w = window.open();
                  if (w) w.document.write(`<img src="${fileData}" style="max-width:100%; max-height:100vh; display:block; margin:auto;" />`);
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              />
            </div>
            <a 
              href={fileData} 
              download={fileName} 
              style={{ fontSize: '0.75rem', color: self ? '#FABD02' : 'var(--color-primary)', textDecoration: 'underline', fontWeight: 600 }}
            >
              📥 Download {fileName}
            </a>
          </div>
        );
      } else if (fileType.startsWith('video/')) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
            <video 
              src={fileData} 
              controls 
              style={{ maxWidth: '300px', borderRadius: '8px', border: '1px solid var(--border-color)' }} 
            />
            <a 
              href={fileData} 
              download={fileName} 
              style={{ fontSize: '0.75rem', color: self ? '#FABD02' : 'var(--color-primary)', textDecoration: 'underline', fontWeight: 600 }}
            >
              📥 Download {fileName}
            </a>
          </div>
        );
      } else if (fileType.startsWith('audio/')) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
            <audio 
              src={fileData} 
              controls 
              style={{ maxWidth: '260px' }} 
            />
            <a 
              href={fileData} 
              download={fileName} 
              style={{ fontSize: '0.75rem', color: self ? '#FABD02' : 'var(--color-primary)', textDecoration: 'underline', fontWeight: 600 }}
            >
              📥 Download {fileName}
            </a>
          </div>
        );
      } else {
        return (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem', 
            padding: '0.75rem', 
            borderRadius: '8px', 
            border: self ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border-color)', 
            backgroundColor: self ? 'rgba(255,255,255,0.1)' : 'var(--bg-card)',
            marginTop: '0.25rem',
            minWidth: '220px'
          }}>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              borderRadius: '6px', 
              backgroundColor: self ? 'rgba(250,189,2,0.2)' : 'rgba(0,32,91,0.1)', 
              color: self ? '#FABD02' : 'var(--color-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.25rem',
              fontWeight: 700
            }}>
              📄
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ 
                fontSize: '0.8rem', 
                fontWeight: 600, 
                color: self ? 'white' : 'var(--text-main)', 
                margin: 0, 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis' 
              }}>
                {fileName}
              </p>
              <a 
                href={fileData} 
                download={fileName} 
                style={{ 
                  fontSize: '0.7rem', 
                  color: self ? '#FABD02' : 'var(--color-secondary)', 
                  textDecoration: 'underline',
                  fontWeight: 600
                }}
              >
                Download Document
              </a>
            </div>
          </div>
        );
      }
    }

    return text;
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
                      <span className="badge-pulse-red" style={{
                        backgroundColor: '#EF4444',
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
                  onClick={() => onStartMeeting(`Meeting with ${activeThread.name}`, activeThread.id)}
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
                    {renderMessageContent(m.text, m.self)}
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
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }} 
                />
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
                    onClick={() => fileInputRef.current?.click()}
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

    </div>
  );
};
