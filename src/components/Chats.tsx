import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Smile, Paperclip, Search, PlusCircle, MoreVertical, 
  Video, CheckCheck, ArrowLeft, MessageSquare, Globe, Languages, Copy, Check, Sparkles,
  Volume2, VolumeX, BarChart2, FolderOpen, Info, FileText, Image, File,
  ExternalLink, Minimize2, Paintbrush, Calendar, Phone, Users, Lock, Plus
} from 'lucide-react';
import { mockAuth, supabase } from '../supabaseClient';
import { encryptMessage, decryptMessage } from '../services/e2ee';

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  self: boolean;
  reactions?: MessageReaction[];
  translation?: string;
  whisperToId?: string | null;
}

const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      backgroundColor: '#0F172A',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      margin: '0.5rem 0',
      overflow: 'hidden',
      fontFamily: 'Consolas, Monaco, "Andale Mono", monospace',
      fontSize: '0.8rem',
      textAlign: 'left'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.35rem 0.75rem',
        backgroundColor: '#1E293B',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        color: '#94A3B8',
        fontSize: '0.7rem',
        textTransform: 'uppercase',
        fontWeight: 600
      }}>
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? '#10B981' : '#94A3B8',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            fontSize: '0.7rem'
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre style={{
        margin: 0,
        padding: '0.75rem',
        overflowX: 'auto',
        color: '#E2E8F0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all'
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
};

const renderItalicOnly = (text: string, baseKey: string) => {
  const italicParts = text.split(/(\*[^*]+\*)/g);
  return (
    <span key={baseKey}>
      {italicParts.map((italicPart, idx) => {
        if (italicPart.startsWith('*') && italicPart.endsWith('*')) {
          return <em key={idx}>{italicPart.slice(1, -1)}</em>;
        } else {
          return italicPart;
        }
      })}
    </span>
  );
};

const renderBoldItalic = (text: string, baseKey: string) => {
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span key={baseKey}>
      {boldParts.map((boldPart, idx) => {
        if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
          const content = boldPart.slice(2, -2);
          return (
            <strong key={idx}>
              {renderItalicOnly(content, `${baseKey}-${idx}-b`)}
            </strong>
          );
        } else {
          return renderItalicOnly(boldPart, `${baseKey}-${idx}-n`);
        }
      })}
    </span>
  );
};

const renderInlineMarkdown = (text: string, baseKey: number | string) => {
  const codeParts = text.split(/(`[^`\n]+`)/g);
  return (
    <span key={baseKey}>
      {codeParts.map((codePart, idx) => {
        if (codePart.startsWith('`') && codePart.endsWith('`')) {
          return (
            <code 
              key={idx}
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '0.1rem 0.3rem',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '0.85em',
                color: '#EF4444',
                margin: '0 2px'
              }}
            >
              {codePart.slice(1, -1)}
            </code>
          );
        } else {
          return renderBoldItalic(codePart, `${baseKey}-${idx}`);
        }
      })}
    </span>
  );
};

const parseMarkdownText = (text: string) => {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, index) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3);
      const lines = content.split('\n');
      let language = 'code';
      let code = content;
      if (lines.length > 0 && lines[0].trim().length > 0 && !lines[0].includes(' ') && !lines[0].includes(';') && !lines[0].includes('=')) {
        language = lines[0].trim();
        code = lines.slice(1).join('\n');
      }
      return <CodeBlock key={index} code={code} language={language} />;
    } else {
      return renderInlineMarkdown(part, index);
    }
  });
};

const DoodleSketchpad: React.FC<{ channelId: string; self: boolean }> = ({ channelId, self }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const channelRef = useRef<any>(null);
  const [brushColor, setBrushColor] = useState(self ? '#FABD02' : '#3B82F6');

  useEffect(() => {
    const channel = supabase.channel(`doodle-${channelId}`, {
      config: { broadcast: { self: false } }
    });

    channel
      .on('broadcast', { event: 'stroke' }, (payload: any) => {
        const { x0, y0, x1, y1, color } = payload.payload;
        drawStroke(x0, y0, x1, y1, color, false);
      })
      .on('broadcast', { event: 'clear' }, () => {
        clearLocalCanvas();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = 3;
      }
    }
  }, [brushColor]);

  const drawStroke = (x0: number, y0: number, x1: number, y1: number, color: string, broadcast = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.closePath();

    if (broadcast && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'stroke',
        payload: { x0, y0, x1, y1, color }
      });
    }
  };

  const clearLocalCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleClear = () => {
    clearLocalCanvas();
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'clear'
      });
    }
  };

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      if (e.touches.length === 0) return lastPosRef.current;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getCoords(e);
    lastPosRef.current = pos;
    isDrawingRef.current = true;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pos = getCoords(e);
    drawStroke(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y, brushColor, true);
    lastPosRef.current = pos;
  };

  const stopDraw = () => {
    isDrawingRef.current = false;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem',
      width: '240px',
      textAlign: 'left'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: self ? 'white' : 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span>🎨</span>
          <span>COLLABORATIVE DOODLE</span>
        </span>
        <button
          type="button"
          onClick={handleClear}
          style={{
            background: 'none',
            border: 'none',
            color: '#EF4444',
            fontSize: '0.7rem',
            cursor: 'pointer',
            fontWeight: 700
          }}
        >
          Clear
        </button>
      </div>

      <div style={{
        backgroundColor: '#0F172A',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        overflow: 'hidden',
        height: '140px',
        position: 'relative'
      }}>
        <canvas
          ref={canvasRef}
          width={240}
          height={140}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
          style={{
            width: '100%',
            height: '100%',
            cursor: 'crosshair',
            touchAction: 'none'
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        {['#FABD02', '#EF4444', '#3B82F6', '#10B981', '#FFFFFF'].map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setBrushColor(c)}
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              backgroundColor: c,
              border: brushColor === c ? '2.5px solid #E2E8F0' : '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer'
            }}
          />
        ))}
      </div>
    </div>
  );
};

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
  onStartMeeting: (title: string, dmThreadId?: string, isVideo?: boolean) => void;
  onJoinCall?: (meetingId: string, passcode: string) => void;
  user: { id: string; email: string; name: string; workspaceName: string; domain: string } | null;
  threads: ChatThread[];
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  activeThreadId: string;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string>>;
}

const getSmartReplies = (text: string): string[] => {
  if (!text) {
    return ["Hi! How are you?", "Let's catch up.", "Are we meeting today?"];
  }
  const txt = text.toLowerCase();
  
  if (txt.includes("[file:")) {
    return ["Thanks for sending the file!", "I'll review this now.", "Looks good!"];
  }
  if (txt.includes("call_invite:")) {
    return ["Joining now!", "Give me 2 minutes.", "Can we schedule for later?"];
  }
  if (txt.includes("meeting") || txt.includes("align")) {
    return ["Let's schedule a call.", "Sounds good, I'll join.", "Send me the invite link."];
  }
  if (txt.includes("help") || txt.includes("issue") || txt.includes("error")) {
    return ["Let's debug it together.", "What error do you see?", "I can help with that."];
  }
  if (txt.includes("perfect") || txt.includes("great") || txt.includes("awesome")) {
    return ["Awesome!", "Glad to hear that.", "Let's proceed."];
  }
  if (txt.includes("thank") || txt.includes("thanks")) {
    return ["You're welcome!", "Anytime.", "No problem!"];
  }
  if (txt.includes("hello") || txt.includes("hi") || txt.includes("hey")) {
    return ["Hey there!", "Hello! How can I help?", "Hi, good to connect!"];
  }
  
  return ["Understood.", "Sounds good!", "I will check and let you know."];
};

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
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showWhisperPicker, setShowWhisperPicker] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add Contact states
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [queryAdd, setQueryAdd] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'found' | 'not_found'>('idle');
  const [foundContacts, setFoundContacts] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState('');

  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [showCreatePollModal, setShowCreatePollModal] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const [isPoppedOut, setIsPoppedOut] = useState(false);
  const [hudPosition, setHudPosition] = useState({ x: 100, y: 100 });
  const [isHudMinimized, setIsHudMinimized] = useState(false);

  // Group creation & members state
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [allProfilesList, setAllProfilesList] = useState<any[]>([]);

  // Whispering & Mentions states
  const [whisperTargetUserId, setWhisperTargetUserId] = useState<string>('');
  const [activeGroupMembers, setActiveGroupMembers] = useState<any[]>([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearchText, setMentionSearchText] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);

  const handleAddReaction = (messageId: string, emoji: string) => {
    setThreads(prev => 
      prev.map(t => {
        if (t.id === activeThreadId) {
          return {
            ...t,
            messages: t.messages.map(m => {
              if (m.id === messageId) {
                const currentReactions = m.reactions || [];
                const existingReaction = currentReactions.find(r => r.emoji === emoji);
                let updatedReactions;
                if (existingReaction) {
                  const userIdx = existingReaction.users.indexOf(user?.name || 'You');
                  if (userIdx > -1) {
                    const updatedUsers = existingReaction.users.filter(u => u !== (user?.name || 'You'));
                    if (updatedUsers.length === 0) {
                      updatedReactions = currentReactions.filter(r => r.emoji !== emoji);
                    } else {
                      updatedReactions = currentReactions.map(r => 
                        r.emoji === emoji ? { ...r, count: r.count - 1, users: updatedUsers } : r
                      );
                    }
                  } else {
                    updatedReactions = currentReactions.map(r => 
                      r.emoji === emoji ? { ...r, count: r.count + 1, users: [...r.users, user?.name || 'You'] } : r
                    );
                  }
                } else {
                  updatedReactions = [...currentReactions, { emoji, count: 1, users: [user?.name || 'You'] }];
                }
                return { ...m, reactions: updatedReactions };
              }
              return m;
            })
          };
        }
        return t;
      })
    );
  };

  const handleTranslateMessage = (messageId: string, originalText: string) => {
    const activeMsg = activeThread?.messages.find(m => m.id === messageId);
    if (activeMsg?.translation) {
      setThreads(prev => 
        prev.map(t => {
          if (t.id === activeThreadId) {
            return {
              ...t,
              messages: t.messages.map(m => m.id === messageId ? { ...m, translation: undefined } : m)
            };
          }
          return t;
        })
      );
      return;
    }

    setTranslatingMessageId(messageId);
    
    setTimeout(() => {
      let translationText = "This is a secure translation of the encrypted text.";
      
      const textLower = originalText.toLowerCase();
      if (textLower.includes("welcome") || textLower.includes("hello")) {
        translationText = "Bienvenido a GiinMeet. Espero que nuestra alineación de hoy sea exitosa.";
      } else if (textLower.includes("perfect") || textLower.includes("great")) {
        translationText = "Perfecto, los nuevos controles flotantes se sienten muy fluidos.";
      } else if (textLower.includes("whiteboard") || textLower.includes("canvas")) {
        translationText = "Dibujaré el esquema en la pizarra colaborativa ahora.";
      } else if (textLower.includes("hola") || textLower.includes("bienvenido")) {
        translationText = "Hello! Welcome to GIIN MEET. Let's start the meeting.";
      } else if (textLower.includes("perfecto") || textLower.includes("bien")) {
        translationText = "Perfect, the new canvas looks amazing on mobile devices.";
      } else {
        if (/[a-zA-Z]/.test(originalText)) {
          translationText = `[Translated]: ${originalText} (Securely decrypted translation)`;
        } else {
          translationText = `[Translated]: Securely decrypted and translated message contents.`;
        }
      }

      setThreads(prev => 
        prev.map(t => {
          if (t.id === activeThreadId) {
            return {
              ...t,
              messages: t.messages.map(m => m.id === messageId ? { ...m, translation: translationText } : m)
            };
          }
          return t;
        })
      );
      setTranslatingMessageId(null);
    }, 600);
  };

  const handleSpeechMessage = (messageId: string, text: string) => {
    if (!('speechSynthesis' in window)) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }

    if (speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    
    const cleanedText = text
      .replace(/\[FILE:[^|]+\|[^|]+\|[^\]]+\]/g, "File shared.")
      .replace(/📞 CALL_INVITE:[^:]+:[^:]+:(.+)/g, "Video call invitation from $1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");

    const utterance = new SpeechSynthesisUtterance(cleanedText);
    
    utterance.onend = () => {
      setSpeakingMessageId(null);
    };

    utterance.onerror = () => {
      setSpeakingMessageId(null);
    };

    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const dragStartOffsetRef = useRef({ x: 0, y: 0 });

  const handleHudDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    let clientX, clientY;
    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    dragStartOffsetRef.current = {
      x: clientX - hudPosition.x,
      y: clientY - hudPosition.y
    };

    const handleDrag = (moveEvent: MouseEvent | TouchEvent) => {
      let currentX, currentY;
      if ('touches' in moveEvent) {
        if (moveEvent.touches.length === 0) return;
        currentX = moveEvent.touches[0].clientX;
        currentY = moveEvent.touches[0].clientY;
      } else {
        currentX = moveEvent.clientX;
        currentY = moveEvent.clientY;
      }

      setHudPosition({
        x: Math.max(10, Math.min(window.innerWidth - 380, currentX - dragStartOffsetRef.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 520, currentY - dragStartOffsetRef.current.y))
      });
    };

    const handleDragEnd = () => {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchmove', handleDrag);
      document.removeEventListener('touchend', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDrag, { passive: false });
    document.addEventListener('touchend', handleDragEnd);
  };

  const handleVotePoll = async (messageId: string, optionIndex: number) => {
    setThreads(prev => 
      prev.map(t => {
        if (t.id === activeThreadId) {
          return {
            ...t,
            messages: t.messages.map(m => {
              if (m.id === messageId) {
                const match = m.text.match(/^\[POLL:([^|]+)\|(.+)\]$/);
                if (match) {
                  const [, question, optionsRaw] = match;
                  const opts = optionsRaw.split('|').map((opt, idx) => {
                    const [name, countStr] = opt.split(',');
                    let count = parseInt(countStr, 10) || 0;
                    if (idx === optionIndex) {
                      count += 1;
                    }
                    return `${name},${count}`;
                  });
                  const updatedText = `[POLL:${question}|${opts.join('|')}]`;
                  
                  mockAuth.sendMessage({
                    thread_id: activeThreadId,
                    sender_name: m.sender,
                    text: updatedText,
                    user_id: user?.id
                  }).catch(err => console.error("Error updating poll database:", err));
                  
                  return { ...m, text: updatedText };
                }
              }
              return m;
            })
          };
        }
        return t;
      })
    );
  };

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOption1, setPollOption1] = useState('');
  const [pollOption2, setPollOption2] = useState('');
  const [pollOption3, setPollOption3] = useState('');
  const [pollOption4, setPollOption4] = useState('');

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pollQuestion.trim() || !pollOption1.trim() || !pollOption2.trim() || !activeThreadId) return;

    const options = [pollOption1.trim(), pollOption2.trim()];
    if (pollOption3.trim()) options.push(pollOption3.trim());
    if (pollOption4.trim()) options.push(pollOption4.trim());

    const optionsPayload = options.map(opt => `${opt},0`).join('|');
    const pollPayload = `[POLL:${pollQuestion.trim()}|${optionsPayload}]`;

    setPollQuestion('');
    setPollOption1('');
    setPollOption2('');
    setPollOption3('');
    setPollOption4('');
    setShowCreatePollModal(false);

    try {
      const localId = Math.random().toString(36).substr(2, 9);
      const newMsg: Message = {
        id: localId,
        sender: 'You',
        text: pollPayload,
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

      let dbText = pollPayload;
      if (activeThreadId.startsWith('dm_')) {
        dbText = await encryptMessage(pollPayload, activeThreadId);
      }
      await mockAuth.sendMessage({
        thread_id: activeThreadId,
        sender_name: user?.name || 'You',
        text: dbText,
        user_id: user?.id
      });
    } catch (err) {
      console.error('Failed to send poll message:', err);
    }
  };

  const handleLaunchDoodle = async () => {
    if (!activeThreadId) return;

    const doodleId = `doodle_${Math.random().toString(36).substr(2, 9)}`;
    const doodlePayload = `[DOODLE:${doodleId}]`;

    try {
      const localId = Math.random().toString(36).substr(2, 9);
      const newMsg: Message = {
        id: localId,
        sender: 'You',
        text: doodlePayload,
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

      let dbText = doodlePayload;
      if (activeThreadId.startsWith('dm_')) {
        dbText = await encryptMessage(doodlePayload, activeThreadId);
      }
      await mockAuth.sendMessage({
        thread_id: activeThreadId,
        sender_name: user?.name || 'You',
        text: dbText,
        user_id: user?.id
      });
    } catch (err) {
      console.error('Failed to send doodle message:', err);
    }
  };



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

  const handleCreateGroupChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupNameInput.trim() || !user) return;

    try {
      const { data: newGroup, error: groupErr } = await supabase
        .from('groups')
        .insert({
          name: groupNameInput.trim(),
          creator_id: user.id
        })
        .select()
        .single();

      if (groupErr || !newGroup) {
        throw new Error(groupErr?.message || 'Failed to create group record');
      }

      const membersToInsert = [
        { group_id: newGroup.id, user_id: user.id },
        ...selectedGroupMembers.map(userId => ({
          group_id: newGroup.id,
          user_id: userId
        }))
      ];

      const { error: membersErr } = await supabase
        .from('group_members')
        .insert(membersToInsert);

      if (membersErr) {
        throw membersErr;
      }

      const initials = newGroup.name ? newGroup.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'GP';
      const newThread: ChatThread = {
        id: `group_${newGroup.id}`,
        name: newGroup.name,
        avatar: initials,
        avatarBg: '#10B981',
        isGroup: true,
        status: 'Online',
        unreadCount: 0,
        messages: []
      };

      setThreads(prev => [newThread, ...prev]);
      setActiveThreadId(newThread.id);
      
      setShowCreateGroupModal(false);
      setGroupNameInput('');
      setSelectedGroupMembers([]);
      setToastMessage('Group created successfully!');
      setTimeout(() => setToastMessage(''), 3000);
      setShowConversationMobile(true);
    } catch (err: any) {
      console.error('Failed to create group chat:', err);
      alert('Failed to create group chat: ' + err.message);
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

  // Load all profiles for Create Group modal checklist
  useEffect(() => {
    const fetchAllProfiles = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, name, email, avatar_url');
        if (data) {
          // Exclude the current user from checklist
          const filtered = data.filter(p => p.id !== user?.id);
          setAllProfilesList(filtered);
        }
      } catch (err) {
        console.error('Error fetching profiles for checklist:', err);
      }
    };
    if (user) {
      fetchAllProfiles();
    }
  }, [user]);

  // Load active group members when activeThreadId changes
  useEffect(() => {
    const fetchGroupMembers = async () => {
      if (!activeThreadId || !activeThreadId.startsWith('group_')) {
        setActiveGroupMembers([]);
        setWhisperTargetUserId('');
        return;
      }
      const groupId = activeThreadId.substring(6);
      try {
        const { data } = await supabase
          .from('group_members')
          .select('user_id, profiles(id, name, email, avatar_url)')
          .eq('group_id', groupId);
        
        if (data) {
          const membersList = data.map((m: any) => m.profiles).filter(Boolean);
          setActiveGroupMembers(membersList);
        }
      } catch (err) {
        console.error('Error fetching group members:', err);
      }
    };
    fetchGroupMembers();
  }, [activeThreadId]);

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
        if (dbMessages) {
          const decryptedMessages = (await Promise.all(dbMessages.map(async (m: any) => {
            let text = m.text;
            let whisperToId: string | null = null;
            if (activeThreadId.startsWith('dm_')) {
              text = await decryptMessage(m.text, activeThreadId);
            } else if (activeThreadId.startsWith('group_')) {
              const match = text.match(/^\[WHISPER:([^:]+):([\s\S]*)\]$/);
              if (match) {
                const targetId = match[1];
                const whisperText = match[2];
                const isSender = m.user_id === user?.id;
                const isTarget = targetId === user?.id;
                if (!isSender && !isTarget) {
                  return null; // hide whisper from other users
                }
                text = whisperText;
                whisperToId = targetId;
              }
            }
            return {
              id: m.id,
              sender: m.sender_name,
              text: text,
              time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              self: m.sender_name === 'You' || !!(user && m.user_id === user.id),
              whisperToId
            };
          }))).filter(Boolean) as Message[];
          
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

    let textToSend = currentText;
    let whisperToId: string | null = null;
    if (activeThreadId.startsWith('group_') && whisperTargetUserId) {
      textToSend = `[WHISPER:${whisperTargetUserId}:${currentText}]`;
      whisperToId = whisperTargetUserId;
    }

    // Generate unique random string for message ID (used locally before database saves)
    const localId = Math.random().toString(36).substr(2, 9);
    const newMsg: Message = {
      id: localId,
      sender: 'You',
      text: currentText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: true,
      whisperToId
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
      let dbText = textToSend;
      if (activeThreadId.startsWith('dm_')) {
        dbText = await encryptMessage(textToSend, activeThreadId);
      }
      await mockAuth.sendMessage({
        thread_id: activeThreadId,
        sender_name: user?.name || 'You',
        text: dbText,
        user_id: user?.id || undefined
      });
      setWhisperTargetUserId('');
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

  const renderMessageContent = (text: string, self: boolean, mId: string) => {
    // Check for call invite card log
    const callInviteRegex = /^📞 CALL_INVITE:([^:]+):([^:]+):(.+)$/;
    const inviteMatch = text.match(callInviteRegex);
    
    // Check for inline calendar meeting invite card
    const meetInviteRegex = /^\[MEET_INVITE:([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\]$/;
    const meetInviteMatch = text.match(meetInviteRegex);
    if (meetInviteMatch) {
      const [, agenda, date, time, meetingId, passcode] = meetInviteMatch;
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '0.5rem 0.25rem',
          minWidth: '260px',
          color: self ? 'white' : 'var(--text-main)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              backgroundColor: self ? 'rgba(255,255,255,0.15)' : 'rgba(var(--color-primary-rgb), 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: self ? 'white' : 'var(--color-primary)'
            }}>
              <Calendar size={20} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: self ? 'rgba(255,255,255,0.75)' : 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Calendar Invitation
              </span>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={agenda}>
                {agenda}
              </h4>
            </div>
          </div>

          <div style={{
            fontSize: '0.75rem',
            padding: '0.5rem',
            borderRadius: '6px',
            backgroundColor: self ? 'rgba(255,255,255,0.08)' : 'rgba(0, 0, 0, 0.03)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}>
            <div><strong>Date:</strong> {date}</div>
            <div><strong>Time:</strong> {time}</div>
            <div style={{ fontSize: '0.65rem', color: self ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)' }}>
              E2EE Secure Meeting ID: {meetingId.substring(0, 8)}...
            </div>
          </div>

          <button
            type="button"
            onClick={() => onJoinCall?.(meetingId, passcode)}
            className="premium-btn premium-btn-primary"
            style={{
              width: '100%',
              height: '32px',
              justifyContent: 'center',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: self ? 'white' : 'var(--color-primary)',
              color: self ? 'var(--color-primary)' : 'white',
              border: 'none',
              borderRadius: '999px',
              cursor: 'pointer'
            }}
          >
            Join Video Call
          </button>
        </div>
      );
    }
    
    // Check for inline sketch doodle card
    const doodleRegex = /^\[DOODLE:([^\]]+)\]$/;
    const doodleMatch = text.match(doodleRegex);
    if (doodleMatch) {
      const [, channelId] = doodleMatch;
      return <DoodleSketchpad channelId={channelId} self={self} />;
    }
    
    // Check for interactive poll card
    const pollRegex = /^\[POLL:([^|]+)\|(.+)\]$/;
    const pollMatch = text.match(pollRegex);
    if (pollMatch) {
      const [, question, optionsRaw] = pollMatch;
      const options = optionsRaw.split('|').map((opt, idx) => {
        const [name, countStr] = opt.split(',');
        return { name, count: parseInt(countStr, 10) || 0, index: idx };
      });
      const totalVotes = options.reduce((sum, o) => sum + o.count, 0);

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          padding: '0.5rem 0.25rem',
          minWidth: '260px',
          textAlign: 'left'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>📊</span>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, color: self ? 'white' : 'var(--text-main)' }}>
              {question}
            </h4>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {options.map((opt) => {
              const pct = totalVotes > 0 ? Math.round((opt.count / totalVotes) * 100) : 0;
              return (
                <button
                  key={opt.index}
                  type="button"
                  onClick={() => handleVotePoll(mId, opt.index)}
                  style={{
                    position: 'relative',
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: self ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.02)',
                    color: self ? 'white' : 'var(--text-main)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.8rem',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${pct}%`,
                    backgroundColor: self ? 'rgba(255, 255, 255, 0.12)' : 'rgba(var(--color-secondary-rgb), 0.12)',
                    transition: 'width 0.3s ease',
                    zIndex: 0
                  }} />
                  <span style={{ zIndex: 1, fontWeight: 600 }}>{opt.name}</span>
                  <span style={{ zIndex: 1, color: self ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {opt.count} votes ({pct}%)
                  </span>
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: '0.7rem', color: self ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)', textAlign: 'right' }}>
            Total votes: {totalVotes}
          </span>
        </div>
      );
    }
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

    return parseMarkdownText(text);
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
      gridTemplateColumns: showRightPanel && activeThread && !isPoppedOut ? '320px 1fr 280px' : isPoppedOut ? '320px' : '320px 1fr',
      gap: '1.5rem',
      height: 'calc(100vh - 120px)',
      animation: 'slide-in var(--transition-normal)',
      transition: 'grid-template-columns var(--transition-normal)'
    }} className="grid-2">
      
      {/* Sidebar List */}
      <div className={`glass-panel ${showConversationMobile ? 'mobile-hidden' : ''}`} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
        <div className="flex-between">
          <h2 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-heading)' }}>Conversations</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button 
              onClick={() => {
                setGroupNameInput('');
                setSelectedGroupMembers([]);
                setShowCreateGroupModal(true);
              }}
              title="Create Group Chat"
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <Users size={20} />
            </button>
            <button 
              onClick={() => setShowAddContactModal(true)}
              title="Start Direct Chat"
              style={{ background: 'none', border: 'none', color: 'var(--color-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <PlusCircle size={20} />
            </button>
          </div>
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
                  overflow: 'hidden',
                  flexShrink: 0
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
      {!isPoppedOut && (
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
                  overflow: 'hidden',
                  flexShrink: 0
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

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button 
                  onClick={() => onStartMeeting(`Video Meet: ${activeThread.name}`, activeThread.id, true)}
                  className="premium-btn premium-btn-secondary" 
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Video size={16} />
                  <span className="room-header-btn-text">Call Video</span>
                </button>
                <button 
                  onClick={() => onStartMeeting(`Voice Call: ${activeThread.name}`, activeThread.id, false)}
                  className="premium-btn premium-btn-primary" 
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Phone size={16} />
                  <span className="room-header-btn-text">Call Voice</span>
                </button>
                <button 
                  onClick={() => setIsPoppedOut(!isPoppedOut)}
                  title={isPoppedOut ? "Dock Conversation" : "Pop Out Floating HUD"}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: isPoppedOut ? 'var(--color-accent)' : 'var(--text-muted)', 
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {isPoppedOut ? <Minimize2 size={18} /> : <ExternalLink size={18} />}
                </button>
                <button 
                  onClick={() => setShowRightPanel(!showRightPanel)}
                  title="Conversation Details & Shared Files"
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: showRightPanel ? 'var(--color-primary)' : 'var(--text-muted)', 
                    cursor: 'pointer',
                    transition: 'color 0.2s',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
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
                  onMouseEnter={() => setHoveredMessageId(m.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                  style={{
                    alignSelf: m.self ? 'flex-end' : 'flex-start',
                    maxWidth: '65%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: m.self ? 'flex-end' : 'flex-start',
                    position: 'relative',
                    padding: '0.25rem 0'
                  }}
                >
                  {/* Floating Action Popover on Hover */}
                  {hoveredMessageId === m.id && (
                    <div style={{
                      position: 'absolute',
                      top: '-15px',
                      left: m.self ? 'auto' : '10px',
                      right: m.self ? '10px' : 'auto',
                      display: 'flex',
                      gap: '0.35rem',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '9999px',
                      padding: '0.2rem 0.5rem',
                      boxShadow: 'var(--shadow-md)',
                      zIndex: 20,
                      animation: 'pop-in 0.1s ease',
                      alignItems: 'center'
                    }}>
                      {['👍', '❤️', '😂', '🎉', '😮', '💡'].map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleAddReaction(m.id, emoji)}
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            padding: '0.1rem',
                            transition: 'transform 0.1s ease'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.25)'}
                          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        >
                          {emoji}
                        </button>
                      ))}

                      <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-color)', margin: '0 0.15rem' }} />

                      <button
                        type="button"
                        onClick={() => handleTranslateMessage(m.id, m.text)}
                        title="Translate Message"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: m.translation ? 'var(--color-primary)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.15rem',
                          transition: 'transform 0.1s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        <Globe size={11} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSpeechMessage(m.id, m.text)}
                        title={speakingMessageId === m.id ? "Stop Reading" : "Read Aloud"}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: speakingMessageId === m.id ? '#10B981' : 'var(--text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.15rem',
                          transition: 'transform 0.1s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        {speakingMessageId === m.id ? <VolumeX size={11} /> : <Volume2 size={11} />}
                      </button>
                    </div>
                  )}

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
                    background: !!m.whisperToId 
                      ? (m.self ? 'linear-gradient(135deg, var(--color-primary) 0%, #4F46E5 100%)' : 'rgba(99, 102, 241, 0.12)')
                      : (user && m.text.toLowerCase().includes(`@${user.name.toLowerCase()}`) && !m.self
                        ? 'rgba(250, 189, 2, 0.12)' 
                        : (m.self ? 'var(--color-primary)' : 'var(--bg-app)')),
                    color: m.self ? 'white' : 'var(--text-main)',
                    fontSize: '0.9rem',
                    lineHeight: 1.45,
                    border: !!m.whisperToId
                      ? (m.self ? '1px dashed rgba(255,255,255,0.4)' : '1.5px dashed #6366F1')
                      : (user && m.text.toLowerCase().includes(`@${user.name.toLowerCase()}`) && !m.self
                        ? '1.5px solid #FABD02'
                        : (m.self ? 'none' : '1px solid var(--border-color)')),
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    {m.whisperToId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', fontWeight: 700, color: m.self ? '#FABD02' : '#6366F1', marginBottom: '4px' }}>
                        <Lock size={11} />
                        <span>
                          {m.self ? `Whisper to ${activeGroupMembers.find(member => member.id === m.whisperToId)?.name || 'Member'}` : 'Whisper to You'}
                        </span>
                      </div>
                    )}
                    {renderMessageContent(m.text, m.self, m.id)}

                    {/* Translating loader status */}
                    {translatingMessageId === m.id && (
                      <div style={{
                        marginTop: '0.4rem',
                        fontSize: '0.75rem',
                        color: m.self ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                        fontStyle: 'italic',
                        borderTop: m.self ? '1px solid rgba(255,255,255,0.15)' : '1px solid var(--border-color)',
                        paddingTop: '0.35rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <Languages size={10} className="animate-spin" />
                        <span>Translating...</span>
                      </div>
                    )}

                    {/* Translated body display */}
                    {m.translation && (
                      <div style={{
                        marginTop: '0.4rem',
                        fontSize: '0.75rem',
                        color: m.self ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)',
                        backgroundColor: m.self ? 'rgba(255,255,255,0.08)' : 'rgba(var(--color-secondary-rgb), 0.05)',
                        borderLeft: '2px solid var(--color-accent)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '2px',
                        borderTop: m.self ? '1px solid rgba(255,255,255,0.15)' : '1px solid var(--border-color)',
                        paddingTop: '0.35rem',
                        textAlign: 'left'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 700, fontSize: '0.65rem', marginBottom: '2px', color: '#FABD02' }}>
                          <Languages size={9} />
                          <span>SECURE TRANSLATION</span>
                        </div>
                        {m.translation}
                      </div>
                    )}
                  </div>

                  {/* Reaction Count Badges */}
                  {m.reactions && m.reactions.length > 0 && (
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.25rem',
                      marginTop: '0.25rem',
                      alignSelf: m.self ? 'flex-end' : 'flex-start'
                    }}>
                      {m.reactions.map((r, rIdx) => {
                        const hasReacted = r.users.includes(user?.name || 'You');
                        return (
                          <button
                            key={rIdx}
                            type="button"
                            onClick={() => handleAddReaction(m.id, r.emoji)}
                            title={`Reacted by: ${r.users.join(', ')}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              backgroundColor: hasReacted ? 'rgba(var(--color-secondary-rgb), 0.15)' : 'rgba(0, 0, 0, 0.03)',
                              border: hasReacted ? '1px solid var(--color-secondary)' : '1px solid var(--border-color)',
                              borderRadius: '9999px',
                              padding: '0.1rem 0.35rem',
                              fontSize: '0.7rem',
                              color: 'var(--text-main)',
                              cursor: 'pointer',
                              fontWeight: 600,
                              transition: 'all 0.1s ease'
                            }}
                          >
                            <span>{r.emoji}</span>
                            <span>{r.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

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

              {/* AI Smart Replies suggestions */}
              {activeThread && activeThread.messages.length > 0 && !activeThread.messages[activeThread.messages.length - 1].self && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.75rem',
                  flexWrap: 'wrap',
                  animation: 'slide-in var(--transition-normal)'
                }}>
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--color-primary)',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    marginRight: '0.25rem'
                  }}>
                    <Sparkles size={11} style={{ color: 'var(--color-accent)' }} />
                    <span>AI SUGGESTIONS:</span>
                  </span>
                  {getSmartReplies(activeThread.messages[activeThread.messages.length - 1].text).map((suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setChatInput(suggestion)}
                      style={{
                        padding: '0.25rem 0.75rem',
                        fontSize: '0.75rem',
                        borderRadius: '9999px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'rgba(var(--color-secondary-rgb), 0.05)',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        fontWeight: 500,
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(var(--color-secondary-rgb), 0.12)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(var(--color-secondary-rgb), 0.05)';
                        e.currentTarget.style.transform = 'none';
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {/* Mentions Autocomplete Popup */}
              {showMentionDropdown && activeThread.isGroup && (
                <div className="glass-panel" style={{
                  position: 'absolute',
                  bottom: '75px',
                  left: '120px',
                  width: '240px',
                  maxHeight: '160px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '0.25rem',
                  animation: 'pop-in 0.15s ease'
                }}>
                  <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                    Mention Group Member
                  </div>
                  {activeGroupMembers
                    .filter(member => member.name.toLowerCase().includes(mentionSearchText.toLowerCase()))
                    .map(member => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          const textBeforeAt = chatInput.slice(0, mentionStartIndex);
                          const textAfterCursor = chatInput.slice(mentionStartIndex + 1 + mentionSearchText.length);
                          setChatInput(`${textBeforeAt}@${member.name} ${textAfterCursor}`);
                          setShowMentionDropdown(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.5rem',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-main)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          borderRadius: '4px',
                          transition: 'background-color 0.15s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(var(--color-primary-rgb), 0.08)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--color-secondary)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.6rem'
                        }}>
                          {member.avatar_url ? (
                            <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            member.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
                          )}
                        </div>
                        <span style={{ fontWeight: 600 }}>{member.name}</span>
                      </button>
                    ))}
                  {activeGroupMembers.filter(member => member.name.toLowerCase().includes(mentionSearchText.toLowerCase())).length === 0 && (
                    <div style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                      No members match
                    </div>
                  )}
                </div>
              )}

              {whisperTargetUserId && activeThread.isGroup && (
                <div style={{
                  position: 'absolute',
                  top: '-32px',
                  left: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(99, 102, 241, 0.12)',
                  border: '1.5px dashed #6366F1',
                  borderRadius: '9999px',
                  padding: '0.2rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: '#6366F1',
                  animation: 'pop-in 0.15s ease',
                  zIndex: 10
                }}>
                  <Lock size={11} />
                  <span>Whispering to {activeGroupMembers.find(m => m.id === whisperTargetUserId)?.name}</span>
                  <button
                    type="button"
                    onClick={() => setWhisperTargetUserId('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6366F1',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      padding: '0 2px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    &times;
                  </button>
                </div>
              )}

              <form onSubmit={handleSendMessage} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }} 
                />
                
                {/* Plus Menu Button & Popover */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPlusMenu(!showPlusMenu);
                      setShowWhisperPicker(false);
                    }}
                    title="Add media & options"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: showPlusMenu ? 'var(--color-primary)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0.25rem',
                      transition: 'transform 0.2s ease',
                      transform: showPlusMenu ? 'rotate(45deg)' : 'none'
                    }}
                  >
                    <Plus size={24} />
                  </button>

                  {showPlusMenu && (
                    <div 
                      className="glass-panel"
                      style={{
                        position: 'absolute',
                        bottom: '45px',
                        left: '0',
                        width: '200px',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: 'var(--shadow-lg)',
                        padding: '0.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        zIndex: 150,
                        animation: 'pop-in 0.15s ease'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          setShowEmojiPicker(!showEmojiPicker);
                        }}
                        className="plus-menu-item"
                      >
                        <Smile size={16} />
                        <span>Emojis</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          fileInputRef.current?.click();
                        }}
                        className="plus-menu-item"
                      >
                        <Paperclip size={16} />
                        <span>Attachment</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          setShowCreatePollModal(true);
                        }}
                        className="plus-menu-item"
                      >
                        <BarChart2 size={16} />
                        <span>Create Poll</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          handleLaunchDoodle();
                        }}
                        className="plus-menu-item"
                      >
                        <Paintbrush size={16} />
                        <span>Doodle Board</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Globe & Lock Icons for Public/Whisper modes */}
                {activeThread.isGroup && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setWhisperTargetUserId('');
                        setShowWhisperPicker(false);
                        setShowPlusMenu(false);
                      }}
                      title="Send Public Message"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: !whisperTargetUserId ? 'var(--color-primary)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0.35rem',
                        borderRadius: '50%',
                        backgroundColor: !whisperTargetUserId ? 'rgba(var(--color-primary-rgb), 0.08)' : 'transparent',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Globe size={20} />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowWhisperPicker(!showWhisperPicker);
                        setShowPlusMenu(false);
                      }}
                      title="Send Private Whisper"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: whisperTargetUserId ? '#6366F1' : 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0.35rem',
                        borderRadius: '50%',
                        backgroundColor: whisperTargetUserId ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Lock size={20} />
                    </button>

                    {showWhisperPicker && (
                      <div 
                        className="glass-panel"
                        style={{
                          position: 'absolute',
                          bottom: '45px',
                          left: '0',
                          width: '240px',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-md)',
                          boxShadow: 'var(--shadow-lg)',
                          padding: '0.5rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                          zIndex: 150,
                          animation: 'pop-in 0.15s ease'
                        }}
                      >
                        <div style={{ 
                          padding: '0.35rem 0.5rem', 
                          fontSize: '0.7rem', 
                          fontWeight: 700, 
                          color: 'var(--text-muted)', 
                          textTransform: 'uppercase', 
                          borderBottom: '1px solid var(--border-color)',
                          marginBottom: '0.25rem'
                        }}>
                          Whisper Private To:
                        </div>
                        {activeGroupMembers
                          .filter(member => member.id !== user?.id)
                          .map(member => (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => {
                                setWhisperTargetUserId(member.id);
                                setShowWhisperPicker(false);
                              }}
                              className="plus-menu-item"
                              style={{
                                color: whisperTargetUserId === member.id ? '#6366F1' : 'var(--text-main)',
                                backgroundColor: whisperTargetUserId === member.id ? 'rgba(99, 102, 241, 0.08)' : 'transparent'
                              }}
                            >
                              <div style={{
                                width: '18px',
                                height: '18px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--color-secondary)',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '0.65rem',
                                overflow: 'hidden'
                              }}>
                                {member.avatar_url ? (
                                  <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  member.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
                                )}
                              </div>
                              <span style={{ fontSize: '0.8rem' }}>{member.name}</span>
                            </button>
                          ))}
                        {activeGroupMembers.filter(member => member.id !== user?.id).length === 0 && (
                          <div style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                            No other members
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <input 
                  type="text" 
                  placeholder={whisperTargetUserId 
                    ? `Whisper secretly to ${activeGroupMembers.find(m => m.id === whisperTargetUserId)?.name}...` 
                    : `Write your message to ${activeThread.name}...`}
                  value={chatInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChatInput(val);
                    if (activeThread.isGroup) {
                      const selectionStart = e.target.selectionStart || 0;
                      const textBeforeCursor = val.slice(0, selectionStart);
                      const lastAtIdx = textBeforeCursor.lastIndexOf('@');
                      if (lastAtIdx !== -1 && !textBeforeCursor.slice(lastAtIdx).includes(' ')) {
                        const search = textBeforeCursor.slice(lastAtIdx + 1);
                        setMentionSearchText(search);
                        setMentionStartIndex(lastAtIdx);
                        setShowMentionDropdown(true);
                      } else {
                        setShowMentionDropdown(false);
                      }
                    }
                  }}
                  className="premium-input"
                  style={{ flex: 1, borderRadius: '9999px', padding: '0.75rem 1.5rem', border: whisperTargetUserId ? '1.5px dashed #6366F1' : '1px solid var(--border-color)' }}
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
      )}

      {/* Slide-out Details Side Drawer */}
      {!isPoppedOut && showRightPanel && activeThread && (
        <div className="glass-panel conversation-details-panel" style={{
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          height: '100%',
          overflowY: 'auto',
          borderLeft: '1px solid var(--border-color)',
          animation: 'slide-in var(--transition-normal)'
        }}>
          <div className="flex-between">
            <h3 style={{ fontSize: '1.1rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Info size={16} />
              <span>Conversation Info</span>
            </h3>
            <button 
              onClick={() => setShowRightPanel(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
            >
              &times;
            </button>
          </div>

          {/* User profile detail card */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(var(--color-secondary-rgb), 0.04)',
            border: '1px solid var(--border-color)',
            gap: '0.5rem'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              backgroundColor: activeThread.avatarBg,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '1.4rem',
              overflow: 'hidden'
            }}>
              {activeThread.avatar && (activeThread.avatar.startsWith('http') || activeThread.avatar.startsWith('data:image')) ? (
                <img src={activeThread.avatar} alt={activeThread.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                activeThread.avatar
              )}
            </div>
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.1rem' }}>{activeThread.name}</h4>
              <span style={{ fontSize: '0.75rem', color: '#10B981', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                <span>{activeThread.isGroup ? 'Group Member' : 'Online'}</span>
              </span>
            </div>
            
            <button 
              onClick={() => onStartMeeting(`Meeting with ${activeThread.name}`, activeThread.id)}
              className="premium-btn premium-btn-secondary"
              style={{ width: '100%', padding: '0.35rem 0.75rem', fontSize: '0.75rem', marginTop: '0.25rem', justifyContent: 'center' }}
            >
              <Video size={12} />
              <span>Start Meet</span>
            </button>
          </div>

          {/* Group Members List (For Group Chats only) */}
          {activeThread.isGroup && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Users size={13} />
                <span>Group Members ({activeGroupMembers.length})</span>
              </h4>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: '180px',
                overflowY: 'auto',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '0.5rem',
                backgroundColor: 'rgba(0,0,0,0.01)'
              }}>
                {activeGroupMembers.map(member => (
                  <div key={member.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.7rem',
                        overflow: 'hidden',
                        flexShrink: 0
                      }}>
                        {member.avatar_url ? (
                          <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          member.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
                        )}
                      </div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={member.name}>
                        {member.name} {member.id === user?.id ? '(You)' : ''}
                      </span>
                    </div>

                    {member.id !== user?.id && (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          onClick={() => setWhisperTargetUserId(member.id)}
                          title="Whisper secretly"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#6366F1',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            fontWeight: 700
                          }}
                        >
                          Whisper
                        </button>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>|</span>
                        <button
                          type="button"
                          onClick={() => {
                            setChatInput(prev => `${prev}@${member.name} `);
                          }}
                          title="Mention in chat"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            fontWeight: 700
                          }}
                        >
                          Mention
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared Files List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
            <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <FolderOpen size={13} />
              <span>Shared Workspace Files</span>
            </h4>
            
            {(() => {
              const fileMessages = activeThread.messages.filter(m => m.text.includes('[FILE:'));
              if (fileMessages.length === 0) {
                return (
                  <div style={{
                    padding: '1.5rem 1rem',
                    textAlign: 'center',
                    border: '1px dashed var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-muted)',
                    fontSize: '0.75rem'
                  }}>
                    No documents or media shared yet.
                  </div>
                );
              }
              
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', maxHeight: '320px', paddingRight: '2px' }}>
                  {fileMessages.map((m) => {
                    const match = m.text.match(/^\[FILE:([^|]+)\|([^|]+)\|(.+)\]$/);
                    if (!match) return null;
                    const [, fileName, fileType, fileData] = match;
                    
                    let FileIcon = File;
                    if (fileType.startsWith('image/')) FileIcon = Image;
                    else if (fileType.startsWith('text/')) FileIcon = FileText;
                    else if (fileType.startsWith('audio/')) FileIcon = Volume2;
                    else if (fileType.startsWith('video/')) FileIcon = Video;
                    
                    return (
                      <div key={m.id} style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'rgba(255,255,255,0.01)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(var(--color-secondary-rgb), 0.04)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.01)'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                          <div style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center' }}>
                            <FileIcon size={16} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              margin: 0,
                              color: 'var(--text-main)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }} title={fileName}>
                              {fileName}
                            </p>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{m.time}</span>
                          </div>
                        </div>
                        <a 
                          href={fileData} 
                          download={fileName}
                          title="Download"
                          style={{
                            fontSize: '0.65rem',
                            color: 'var(--color-primary)',
                            fontWeight: 700,
                            textDecoration: 'underline',
                            flexShrink: 0
                          }}
                        >
                          Get
                        </a>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroupModal && (
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
            maxWidth: '480px',
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
              <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={20} color="var(--color-primary)" />
                <span>Create Group Chat</span>
              </h3>
              <button 
                onClick={() => {
                  setShowCreateGroupModal(false);
                  setGroupNameInput('');
                  setSelectedGroupMembers([]);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateGroupChat} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  GROUP CHAT NAME
                </label>
                <input 
                  type="text" 
                  placeholder="e.g. GIIN Marketing, Design Sync..." 
                  value={groupNameInput}
                  onChange={(e) => setGroupNameInput(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  SELECT MEMBERS
                </label>
                <div style={{
                  maxHeight: '200px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  backgroundColor: 'rgba(0,0,0,0.02)'
                }}>
                  {allProfilesList.map(profile => (
                    <label 
                      key={profile.id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.75rem', 
                        padding: '0.35rem 0.5rem', 
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(var(--color-secondary-rgb), 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <input 
                        type="checkbox" 
                        checked={selectedGroupMembers.includes(profile.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroupMembers(prev => [...prev, profile.id]);
                          } else {
                            setSelectedGroupMembers(prev => prev.filter(id => id !== profile.id));
                          }
                        }}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                      />
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-secondary)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        overflow: 'hidden'
                      }}>
                        {profile.avatar_url ? (
                          <img src={profile.avatar_url} alt={profile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          (profile.name || 'User').split(' ').map((n: string) => n[0]).join('').toUpperCase()
                        )}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', color: 'var(--text-main)' }}>{profile.name}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {profile.email || 'Workspace Member'}
                        </span>
                      </div>
                    </label>
                  ))}
                  {allProfilesList.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem 0' }}>
                      No workspace profiles found.
                    </div>
                  )}
                </div>
              </div>

              <button 
                type="submit" 
                className="premium-btn premium-btn-primary" 
                style={{ justifyContent: 'center', marginTop: '0.5rem', fontWeight: 700 }}
              >
                Create Group ({selectedGroupMembers.length} selected)
              </button>
            </form>
          </div>
        </div>
      )}

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

      {/* Create Poll Modal */}
      {showCreatePollModal && (
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
              <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📊</span>
                <span>Create a Quick Poll</span>
              </h3>
              <button 
                onClick={() => {
                  setShowCreatePollModal(false);
                  setPollQuestion('');
                  setPollOption1('');
                  setPollOption2('');
                  setPollOption3('');
                  setPollOption4('');
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreatePoll} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  POLL QUESTION
                </label>
                <input 
                  type="text" 
                  placeholder="e.g., Which timeline works best for the rollout?" 
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  OPTION 1 *
                </label>
                <input 
                  type="text" 
                  placeholder="e.g., Monday next week" 
                  value={pollOption1}
                  onChange={(e) => setPollOption1(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  OPTION 2 *
                </label>
                <input 
                  type="text" 
                  placeholder="e.g., Wednesday next week" 
                  value={pollOption2}
                  onChange={(e) => setPollOption2(e.target.value)}
                  className="premium-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  OPTION 3 (OPTIONAL)
                </label>
                <input 
                  type="text" 
                  placeholder="e.g., Friday next week" 
                  value={pollOption3}
                  onChange={(e) => setPollOption3(e.target.value)}
                  className="premium-input"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  OPTION 4 (OPTIONAL)
                </label>
                <input 
                  type="text" 
                  placeholder="e.g., Hold off on rollout" 
                  value={pollOption4}
                  onChange={(e) => setPollOption4(e.target.value)}
                  className="premium-input"
                />
              </div>

              <button type="submit" className="premium-btn premium-btn-primary" style={{ justifyContent: 'center', marginTop: '0.5rem', fontWeight: 700 }}>
                Launch Poll
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Floating HUD Chat Window overlay */}
      {isPoppedOut && activeThread && (
        <>
          {isHudMinimized ? (
            /* Pulsing Chat Head Bubble */
            <div 
              onClick={() => setIsHudMinimized(false)}
              title={`Expand Chat with ${activeThread.name}`}
              style={{
                position: 'fixed',
                left: `${hudPosition.x + 300}px`,
                top: `${hudPosition.y}px`,
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: activeThread.avatarBg,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-premium)',
                zIndex: 99999,
                fontWeight: 700,
                fontSize: '1.2rem',
                border: '3px solid var(--color-primary)',
                animation: 'pulse-ring 2s infinite, float 3s ease-in-out infinite',
                overflow: 'hidden'
              }}
            >
              {activeThread.avatar && (activeThread.avatar.startsWith('http') || activeThread.avatar.startsWith('data:image')) ? (
                <img src={activeThread.avatar} alt={activeThread.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                activeThread.avatar
              )}
              <span style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#EF4444',
                border: '2px solid white'
              }} />
            </div>
          ) : (
            /* Full Floating Draggable HUD Card */
            <div 
              style={{
                position: 'fixed',
                left: `${hudPosition.x}px`,
                top: `${hudPosition.y}px`,
                width: '360px',
                height: '520px',
                backgroundColor: 'var(--bg-card)',
                border: '2.5px solid var(--color-primary)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), var(--shadow-premium)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 99998,
                overflow: 'hidden',
                animation: 'pop-in 0.2s ease-out'
              }}
            >
              {/* Draggable HUD Header */}
              <div 
                onMouseDown={handleHudDragStart}
                onTouchStart={handleHudDragStart}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  userSelect: 'none',
                  flexShrink: 0
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: activeThread.avatarBg,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    border: '1.5px solid white',
                    overflow: 'hidden'
                  }}>
                    {activeThread.avatar && (activeThread.avatar.startsWith('http') || activeThread.avatar.startsWith('data:image')) ? (
                      <img src={activeThread.avatar} alt={activeThread.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      activeThread.avatar
                    )}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'white', margin: 0 }}>{activeThread.name}</h4>
                    <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.75)', display: 'block', lineHeight: 1 }}>Floating HUD</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button 
                    onClick={() => setIsHudMinimized(true)}
                    title="Minimize to Chat Head"
                    style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold', padding: '0.15rem' }}
                  >
                    &ndash;
                  </button>
                  <button 
                    onClick={() => setIsPoppedOut(false)}
                    title="Dock Chat back to layout"
                    style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '0.15rem', display: 'flex', alignItems: 'center' }}
                  >
                    <Minimize2 size={12} />
                  </button>
                  <button 
                    onClick={() => setIsPoppedOut(false)}
                    style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.1rem', padding: '0.15rem', display: 'flex', alignItems: 'center' }}
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* HUD Chat Content Area */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  <div style={{ textAlign: 'center', margin: '0.25rem 0' }}>
                    <span style={{ 
                      fontSize: '0.7rem', 
                      color: 'var(--text-muted)', 
                      backgroundColor: 'rgba(var(--color-secondary-rgb), 0.08)', 
                      padding: '0.2rem 0.5rem',
                      borderRadius: '9999px',
                      border: '1px solid var(--border-color)'
                    }}>
                      Messages are end-to-end encrypted
                    </span>
                  </div>

                  {activeThread.messages.map((m) => (
                    <div 
                      key={m.id}
                      onMouseEnter={() => setHoveredMessageId(m.id)}
                      onMouseLeave={() => setHoveredMessageId(null)}
                      style={{
                        alignSelf: m.self ? 'flex-end' : 'flex-start',
                        maxWidth: '75%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: m.self ? 'flex-end' : 'flex-start',
                        position: 'relative',
                        padding: '0.2rem 0'
                      }}
                    >
                      {hoveredMessageId === m.id && (
                        <div style={{
                          position: 'absolute',
                          top: '-15px',
                          left: m.self ? 'auto' : '10px',
                          right: m.self ? '10px' : 'auto',
                          display: 'flex',
                          gap: '0.3rem',
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '9999px',
                          padding: '0.15rem 0.4rem',
                          boxShadow: 'var(--shadow-md)',
                          zIndex: 20,
                          animation: 'pop-in 0.1s ease',
                          alignItems: 'center'
                        }}>
                          {['👍', '❤️', '😂', '🎉', '😮', '💡'].map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleAddReaction(m.id, emoji)}
                              style={{ background: 'none', border: 'none', fontSize: '0.8rem', cursor: 'pointer', padding: '0.05rem' }}
                            >
                              {emoji}
                            </button>
                          ))}
                          <div style={{ width: '1px', height: '12px', backgroundColor: 'var(--border-color)', margin: '0 0.1rem' }} />
                          <button
                            type="button"
                            onClick={() => handleTranslateMessage(m.id, m.text)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <Globe size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSpeechMessage(m.id, m.text)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <Volume2 size={10} />
                          </button>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.1rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{m.sender}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{m.time}</span>
                      </div>

                      <div style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: m.self ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                        background: !!m.whisperToId 
                          ? (m.self ? 'linear-gradient(135deg, var(--color-primary) 0%, #4F46E5 100%)' : 'rgba(99, 102, 241, 0.12)')
                          : (user && m.text.toLowerCase().includes(`@${user.name.toLowerCase()}`) && !m.self
                            ? 'rgba(250, 189, 2, 0.12)' 
                            : (m.self ? 'var(--color-primary)' : 'var(--bg-app)')),
                        color: m.self ? 'white' : 'var(--text-main)',
                        fontSize: '0.85rem',
                        lineHeight: 1.4,
                        border: !!m.whisperToId
                          ? (m.self ? '1px dashed rgba(255,255,255,0.4)' : '1.5px dashed #6366F1')
                          : (user && m.text.toLowerCase().includes(`@${user.name.toLowerCase()}`) && !m.self
                            ? '1.5px solid #FABD02'
                            : (m.self ? 'none' : '1px solid var(--border-color)')),
                      }}>
                        {m.whisperToId && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.65rem', fontWeight: 700, color: m.self ? '#FABD02' : '#6366F1', marginBottom: '3px' }}>
                            <Lock size={9} />
                            <span>
                              {m.self ? `Whisper to ${activeGroupMembers.find(member => member.id === m.whisperToId)?.name || 'Member'}` : 'Whisper to You'}
                            </span>
                          </div>
                        )}
                        {renderMessageContent(m.text, m.self, m.id)}

                        {translatingMessageId === m.id && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Translating...</div>
                        )}
                        {m.translation && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-accent)', marginTop: '0.25rem', borderTop: '1px solid var(--border-color)' }}>
                            {m.translation}
                          </div>
                        )}
                      </div>

                      {m.reactions && m.reactions.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.2rem', marginTop: '0.2rem' }}>
                          {m.reactions.map((r, rIdx) => (
                            <span key={rIdx} style={{ fontSize: '0.65rem', padding: '0.05rem 0.25rem', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '99px' }}>
                              {r.emoji} {r.count}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div ref={messagesEndRef} />
                </div>

                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.01)' }}>
                  {activeThread.messages.length > 0 && !activeThread.messages[activeThread.messages.length - 1].self && (
                    <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                      {getSmartReplies(activeThread.messages[activeThread.messages.length - 1].text).map((suggestion, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setChatInput(suggestion)}
                          style={{
                            padding: '0.15rem 0.5rem',
                            fontSize: '0.7rem',
                            borderRadius: '999px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'rgba(var(--color-secondary-rgb), 0.05)',
                            color: 'var(--text-main)',
                            cursor: 'pointer'
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleSendMessage} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
                    {/* Plus Menu Button & Popover */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(!showPlusMenu);
                          setShowWhisperPicker(false);
                        }}
                        title="Add media & options"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: showPlusMenu ? 'var(--color-primary)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.25rem',
                          transition: 'transform 0.2s ease',
                          transform: showPlusMenu ? 'rotate(45deg)' : 'none'
                        }}
                      >
                        <Plus size={20} />
                      </button>

                      {showPlusMenu && (
                        <div 
                          className="glass-panel"
                          style={{
                            position: 'absolute',
                            bottom: '40px',
                            left: '0',
                            width: '180px',
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            boxShadow: 'var(--shadow-lg)',
                            padding: '0.4rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.2rem',
                            zIndex: 150,
                            animation: 'pop-in 0.15s ease'
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setShowPlusMenu(false);
                              setShowEmojiPicker(!showEmojiPicker);
                            }}
                            className="plus-menu-item"
                          >
                            <Smile size={14} />
                            <span>Emojis</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPlusMenu(false);
                              fileInputRef.current?.click();
                            }}
                            className="plus-menu-item"
                          >
                            <Paperclip size={14} />
                            <span>Attachment</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPlusMenu(false);
                              setShowCreatePollModal(true);
                            }}
                            className="plus-menu-item"
                          >
                            <BarChart2 size={14} />
                            <span>Create Poll</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPlusMenu(false);
                              handleLaunchDoodle();
                            }}
                            className="plus-menu-item"
                          >
                            <Paintbrush size={14} />
                            <span>Doodle Board</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Globe & Lock Icons for Public/Whisper modes */}
                    {activeThread.isGroup && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', position: 'relative' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setWhisperTargetUserId('');
                            setShowWhisperPicker(false);
                            setShowPlusMenu(false);
                          }}
                          title="Send Public Message"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: !whisperTargetUserId ? 'var(--color-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0.25rem',
                            borderRadius: '50%',
                            backgroundColor: !whisperTargetUserId ? 'rgba(var(--color-primary-rgb), 0.08)' : 'transparent',
                            transition: 'all 0.2s'
                          }}
                        >
                          <Globe size={18} />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowWhisperPicker(!showWhisperPicker);
                            setShowPlusMenu(false);
                          }}
                          title="Send Private Whisper"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: whisperTargetUserId ? '#6366F1' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0.25rem',
                            borderRadius: '50%',
                            backgroundColor: whisperTargetUserId ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                            transition: 'all 0.2s'
                          }}
                        >
                          <Lock size={18} />
                        </button>

                        {showWhisperPicker && (
                          <div 
                            className="glass-panel"
                            style={{
                              position: 'absolute',
                              bottom: '40px',
                              left: '0',
                              width: '200px',
                              maxHeight: '180px',
                              overflowY: 'auto',
                              backgroundColor: 'var(--bg-card)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 'var(--radius-md)',
                              boxShadow: 'var(--shadow-lg)',
                              padding: '0.4rem',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.2rem',
                              zIndex: 150,
                              animation: 'pop-in 0.15s ease'
                            }}
                          >
                            <div style={{ 
                              padding: '0.25rem 0.4rem', 
                              fontSize: '0.65rem', 
                              fontWeight: 700, 
                              color: 'var(--text-muted)', 
                              textTransform: 'uppercase', 
                              borderBottom: '1px solid var(--border-color)',
                              marginBottom: '0.2rem'
                            }}>
                              Whisper Private To:
                            </div>
                            {activeGroupMembers
                              .filter(member => member.id !== user?.id)
                              .map(member => (
                                <button
                                  key={member.id}
                                  type="button"
                                  onClick={() => {
                                    setWhisperTargetUserId(member.id);
                                    setShowWhisperPicker(false);
                                  }}
                                  className="plus-menu-item"
                                  style={{
                                    color: whisperTargetUserId === member.id ? '#6366F1' : 'var(--text-main)',
                                    backgroundColor: whisperTargetUserId === member.id ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                    padding: '0.4rem'
                                  }}
                                >
                                  <div style={{
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--color-secondary)',
                                    color: 'white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: '0.6rem',
                                    overflow: 'hidden'
                                  }}>
                                    {member.avatar_url ? (
                                      <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                      member.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
                                    )}
                                  </div>
                                  <span style={{ fontSize: '0.75rem' }}>{member.name}</span>
                                </button>
                              ))}
                            {activeGroupMembers.filter(member => member.id !== user?.id).length === 0 && (
                              <div style={{ padding: '0.4rem', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                                No other members
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <input 
                      type="text" 
                      placeholder={whisperTargetUserId 
                        ? `Whisper secretly to ${activeGroupMembers.find(m => m.id === whisperTargetUserId)?.name}...` 
                        : `Write message...`}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="premium-input"
                      style={{ flex: 1, padding: '0.5rem 1rem', fontSize: '0.8rem', borderRadius: '9999px', border: whisperTargetUserId ? '1.5px dashed #6366F1' : '1px solid var(--border-color)' }}
                    />

                    <button type="submit" className="premium-btn premium-btn-primary" style={{ borderRadius: '50%', width: '32px', height: '32px', padding: 0, justifyContent: 'center' }}>
                      <Send size={12} />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </>
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
