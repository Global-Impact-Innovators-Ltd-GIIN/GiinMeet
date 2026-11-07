import React, { useState, useEffect, useRef } from 'react';
import { EyeOff, Send, Lock, ShieldAlert, PhoneOff } from 'lucide-react';

interface PrivateMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  expiresIn: number; // seconds remaining
}

interface PrivateSpaceProps {
  viewerName: string;
  viewerEmail: string;
  meetingTitle: string;
  onExit: () => void;
}

// A local-only ephemeral notes space. This is a DEMO, not a secure channel:
// messages stay in this browser, vanish 60 seconds after they are sent, and
// are never sent to anyone. There is no end-to-end encryption here — the
// "peer" and "handshake" the old version showed were simulated.
export const PrivateSpace: React.FC<PrivateSpaceProps> = ({
  viewerName,
  viewerEmail,
  meetingTitle,
  onExit
}) => {
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [watermarkPos, setWatermarkPos] = useState({ x: 20, y: 40 });
  const [securityLog, setSecurityLog] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // DRM Safeguards: Block Right-Click and Copy listeners
  useEffect(() => {
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerSecurityToast('Right-click is restricted in Ephemeral Spaces.');
    };

    const blockCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerSecurityToast('Text copying is restricted in this private space.');
    };

    const blockKeyDown = (e: KeyboardEvent) => {
      // Block PrintScreen or screenshots standard keys
      if (e.key === 'PrintScreen' || (e.ctrlKey && e.key === 'p') || (e.metaKey && e.shiftKey && e.key === 's')) {
        e.preventDefault();
        triggerSecurityToast('Screen Capture is restricted in Confidential zones.');
      }
    };

    window.addEventListener('contextmenu', blockContextMenu);
    window.addEventListener('copy', blockCopy);
    window.addEventListener('keydown', blockKeyDown);

    return () => {
      window.removeEventListener('contextmenu', blockContextMenu);
      window.removeEventListener('copy', blockCopy);
      window.removeEventListener('keydown', blockKeyDown);
    };
  }, []);

  // Drift watermark position update to deter screen photography captures
  useEffect(() => {
    const interval = setInterval(() => {
      // Random coordinates that drift around screenspace bounds
      const x = Math.floor(Math.random() * 50) + 15;
      const y = Math.floor(Math.random() * 60) + 20;
      setWatermarkPos({ x, y });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Ephemeral messaging 60-second deletion timer loop
  useEffect(() => {
    const interval = setInterval(() => {
      setMessages(prev =>
        prev
          .map(msg => ({ ...msg, expiresIn: msg.expiresIn - 1 }))
          .filter(msg => msg.expiresIn > 0)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Scroll chat bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const triggerSecurityToast = (msg: string) => {
    setSecurityLog(msg);
    setTimeout(() => setSecurityLog(null), 3000);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const newMsg: PrivateMessage = {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'You',
      text: chatInput,
      timestamp: new Date(),
      expiresIn: 60
    };

    setMessages(prev => [...prev, newMsg]);
    setChatInput('');
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 80px)',
      backgroundColor: '#05070C', // Immersive secure deep-black background
      color: 'white',
      borderRadius: 'var(--radius-lg)',
      position: 'relative',
      overflow: 'hidden',
      border: '2px solid #EF4444',
      userSelect: 'none', // Programmatic block text select CSS
      animation: 'pop-in var(--transition-normal)'
    }}>

      {/* DRM Watermark layer: drifts slowly */}
      <div style={{
        position: 'absolute',
        top: `${watermarkPos.y}%`,
        left: `${watermarkPos.x}%`,
        color: 'rgba(255,255,255,0.06)',
        fontSize: '1rem',
        fontWeight: 600,
        fontFamily: 'monospace',
        pointerEvents: 'none',
        zIndex: 50,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        transition: 'all 3.8s ease-in-out'
      }}>
        CONFIDENTIAL &bull; {viewerEmail}
      </div>

      {/* Security alert toast */}
      {securityLog && (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#EF4444',
          color: 'white',
          padding: '0.75rem 1.5rem',
          borderRadius: 'var(--radius-md)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem',
          fontWeight: 600,
          boxShadow: '0 10px 25px rgba(239, 68, 68, 0.3)',
          animation: 'pop-in 0.2s ease'
        }}>
          <ShieldAlert size={16} />
          <span>{securityLog}</span>
        </div>
      )}

      {/* Upper Status Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid rgba(239,68,68,0.2)',
        backgroundColor: 'rgba(5, 7, 12, 0.9)',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.4)' }}>
            PRIVATE SPACE
          </span>
          <h3 style={{ fontSize: '1.1rem', color: 'white', fontFamily: 'var(--font-heading)' }}>
            Private Space: {meetingTitle}
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#EF4444' }}>
          <Lock size={14} />
          <span>Local-only demo</span>
        </div>
      </div>

      {/* Main split work space */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left pane: About this space */}
        <div style={{
          flex: 1,
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          borderRight: '1px solid #1E293B',
          backgroundColor: '#07090F'
        }}>
          <div>
            <h4 style={{ fontSize: '1.1rem', fontFamily: 'var(--font-heading)', color: 'white', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={18} color="var(--color-accent)" />
              <span>About this space</span>
            </h4>

            <div style={{
              backgroundColor: '#020305',
              border: '1px solid #1E293B',
              borderRadius: '6px',
              padding: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <p style={{ margin: 0 }}>
                This is a local demo space. Notes you write here stay in this browser and
                disappear 60 seconds after you send them.
              </p>
              <p style={{ margin: 0 }}>
                They are not sent to anyone and are not end-to-end encrypted. There is no
                peer connected here.
              </p>
            </div>
          </div>

          {/* Guardrails card */}
          <div style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            <h5 style={{ color: 'white', fontWeight: 600, fontSize: '0.9rem' }}>Room Guardrails</h5>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}>Active session: {viewerName}</span>
            <ul style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <li>Notes stay in this browser only (nothing is sent anywhere)</li>
              <li>Right-click, copy-paste, and key screenshots disabled</li>
              <li>Notes automatically vanish 60 seconds after delivery</li>
              <li>Visible digital username watermarking enabled</li>
            </ul>
          </div>
        </div>

        {/* Right pane: Ephemeral messaging channel */}
        <div style={{
          width: '380px',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#05070C'
        }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1E293B', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Local notes</span>
          </div>

          {/* Message List */}
          <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.sender === 'You' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.sender === 'You' ? 'flex-end' : 'flex-start'
                }}
              >
                <div style={{
                  padding: '0.65rem 0.95rem',
                  borderRadius: '8px',
                  backgroundColor: m.sender === 'You' ? '#EF4444' : '#1E293B',
                  color: 'white',
                  fontSize: '0.85rem',
                  lineHeight: 1.35
                }}>
                  {m.text}
                </div>

                {/* Deletion Countdown timer badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.2rem', fontSize: '0.65rem', color: 'rgba(239, 68, 68, 0.7)' }}>
                  <EyeOff size={11} />
                  <span>Vanish in {m.expiresIn}s</span>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '2rem 0' }}>
                All logs vanished. Chat is empty.
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Form */}
          <form onSubmit={handleSendMessage} style={{ padding: '1rem', borderTop: '1px solid #1E293B', display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Write a note..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                backgroundColor: '#020305',
                border: '1px solid #1E293B',
                color: 'white',
                fontSize: '0.85rem'
              }}
            />
            <button
              type="submit"
              style={{
                backgroundColor: '#EF4444',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      </div>

      {/* Footer controls leave confidential mode */}
      <div style={{
        padding: '1.25rem 2rem',
        borderTop: '1px solid rgba(239,68,68,0.2)',
        backgroundColor: '#020305',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>Local-only demo — notes are not sent or encrypted end-to-end.</span>
        </div>

        <button
          onClick={onExit}
          className="premium-btn premium-btn-danger"
          style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
        >
          <PhoneOff size={15} />
          <span>Exit Private Space</span>
        </button>
      </div>
    </div>
  );
};
