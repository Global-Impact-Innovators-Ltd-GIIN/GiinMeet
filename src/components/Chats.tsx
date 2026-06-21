import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Smile, Paperclip, Search, PlusCircle, MoreVertical, 
  Video, CheckCheck, ArrowLeft
} from 'lucide-react';

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
}

interface ChatsProps {
  initialTargetContact?: string | null;
  onClearTargetContact?: () => void;
  onStartMeeting: (title: string) => void;
}

export const Chats: React.FC<ChatsProps> = ({ 
  initialTargetContact, 
  onClearTargetContact,
  onStartMeeting
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeThreadId, setActiveThreadId] = useState<string>('group');
  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [showConversationMobile, setShowConversationMobile] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [threads, setThreads] = useState<ChatThread[]>([
    {
      id: 'group',
      name: 'My Project Team',
      avatar: 'PT',
      avatarBg: '#00205B',
      isGroup: true,
      status: 'Online',
      messages: [
        { id: '1', sender: 'Lucas Lima', text: 'Hey team, how are we looking for the GIIN MEET release?', time: '09:30 AM', self: false },
        { id: '2', sender: 'Sarah Jenkins', text: 'Completed the core design system styling in index.css. It looks premium!', time: '09:35 AM', self: false },
        { id: '3', sender: 'David Chen', text: 'Running regression testing on the video feeds. Latency is extremely low.', time: '09:42 AM', self: false },
        { id: '4', sender: 'You', text: 'Awesome progress. Let\'s keep it up!', time: '09:45 AM', self: true },
      ]
    },
    {
      id: 'theresa',
      name: 'Theresa Watson',
      avatar: 'TW',
      avatarBg: '#7082BE',
      isGroup: false,
      status: 'Online',
      messages: [
        { id: '1', sender: 'Theresa Watson', text: 'Hi! Did you review the billing checkout details for the pro plans?', time: 'Yesterday', self: false },
        { id: '2', sender: 'You', text: 'Yes, the multi-step payment wizard looks very intuitive. Love the congratulations screen.', time: 'Yesterday', self: true },
        { id: '3', sender: 'Theresa Watson', text: 'Great. Let\'s sync up today about the final demo.', time: '08:15 AM', self: false },
      ]
    },
    {
      id: 'lucas',
      name: 'Lucas Lima',
      avatar: 'LL',
      avatarBg: '#FABD02',
      isGroup: false,
      status: 'Online',
      messages: [
        { id: '1', sender: 'Lucas Lima', text: 'Did we check the webcam getUserMedia permission logic on Safari?', time: 'Wednesday', self: false },
        { id: '2', sender: 'You', text: 'Yes, it triggers the browser default prompt correctly, with custom layout fallback.', time: 'Wednesday', self: true },
      ]
    },
    {
      id: 'sarah',
      name: 'Sarah Jenkins',
      avatar: 'SJ',
      avatarBg: '#10B981',
      isGroup: false,
      status: 'Offline',
      messages: [
        { id: '1', sender: 'Sarah Jenkins', text: 'I updated the color variables for Sol de Minas to match #FABD02. Let me know what you think.', time: 'Monday', self: false },
      ]
    }
  ]);

  // Handle redirect from Contacts click
  useEffect(() => {
    if (initialTargetContact) {
      const existingThread = threads.find(t => t.name.toLowerCase() === initialTargetContact.toLowerCase());
      if (existingThread) {
        setActiveThreadId(existingThread.id);
        setShowConversationMobile(true);
      } else {
        // Create new simulated thread
        const newId = initialTargetContact.toLowerCase().replace(/\s+/g, '-');
        const newThread: ChatThread = {
          id: newId,
          name: initialTargetContact,
          avatar: initialTargetContact.split(' ').map(n => n[0]).join(''),
          avatarBg: '#8B5CF6',
          isGroup: false,
          status: 'Online',
          messages: [
            { id: '1', sender: initialTargetContact, text: `Hello! Nice to connect with you. Let me know if we need a video call.`, time: 'Now', self: false }
          ]
        };
        setThreads(prev => [newThread, ...prev]);
        setActiveThreadId(newId);
        setShowConversationMobile(true);
      }
      if (onClearTargetContact) {
        onClearTargetContact();
      }
    }
  }, [initialTargetContact, threads, onClearTargetContact]);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [threads, isTyping]);

  const activeThread = threads.find(t => t.id === activeThreadId) || threads[0];

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const newMsg: Message = {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'You',
      text: chatInput,
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
    setChatInput('');

    // Trigger typing simulation
    setIsTyping(true);

    // Simulated responses based on the message content and thread
    setTimeout(() => {
      setIsTyping(false);
      
      let botResponse = 'Thank you for reaching out! Let\'s discuss this in detail.';
      if (activeThread.id === 'group') {
        botResponse = 'Got it! I will push my branch soon so we can inspect the styling updates.';
      } else if (activeThread.id === 'theresa') {
        botResponse = 'Perfect! Let\'s coordinate our agenda. I can hop on a video call whenever you are ready.';
      } else if (activeThread.id === 'lucas') {
        botResponse = 'Awesome. I will notify the QA team to confirm. Thanks for the quick update!';
      }

      const replyMsg: Message = {
        id: Math.random().toString(36).substr(2, 9),
        sender: activeThread.name === 'My Project Team' ? 'Sarah Jenkins' : activeThread.name,
        text: botResponse,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        self: false
      };

      setThreads(prev => 
        prev.map(t => {
          if (t.id === activeThreadId) {
            return { ...t, messages: [...t.messages, replyMsg] };
          }
          return t;
        })
      );
    }, 2000);
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
          <button style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer' }}>
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
                  marginRight: '0.75rem'
                }}>
                  {t.avatar}
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
                  <p style={{ 
                    fontSize: '0.8rem', 
                    color: 'var(--text-muted)', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis' 
                  }}>
                    {lastMsg ? `${lastMsg.sender}: ${lastMsg.text}` : 'No messages'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Conversation Window */}
      <div className={`glass-panel ${!showConversationMobile ? 'mobile-hidden' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        
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
              fontWeight: 700
            }}>
              {activeThread.avatar}
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

          {/* Typing Indicator */}
          {isTyping && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{activeThread.name} is typing</span>
              <div style={{ display: 'flex', gap: '2px' }}>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', animation: 'wave-animation 1s infinite' }} />
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', animation: 'wave-animation 1s infinite 0.2s' }} />
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', animation: 'wave-animation 1s infinite 0.4s' }} />
              </div>
            </div>
          )}
          
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
      </div>
    </div>
  );
};
