import React, { useState, useEffect, useRef } from 'react';
import { Key, EyeOff, Send, Lock, ShieldAlert, PhoneOff } from 'lucide-react';

interface E2EEMessage {
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

export const PrivateSpace: React.FC<PrivateSpaceProps> = ({
  viewerName,
  viewerEmail,
  meetingTitle,
  onExit
}) => {
  const [messages, setMessages] = useState<E2EEMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [handshakeLogs, setHandshakeLogs] = useState<string[]>([]);
  const [handshakeStep, setHandshakeStep] = useState<1 | 2 | 3 | 4>(1);
  const [isE2EEReady, setIsE2EEReady] = useState(false);
  const [watermarkPos, setWatermarkPos] = useState({ x: 20, y: 40 });
  const [securityLog, setSecurityLog] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Simulated peer IP
  const simulatedIP = '192.168.4.112';

  // E2EE Handshake sequence visualization using Web Crypto API concepts
  useEffect(() => {
    const logs = [
      '⚡ [WebCrypto] Initializing peer-to-peer secure socket...',
      '🔑 [WebCrypto] Generating ECDH local keypair (curve P-256)...',
      '📦 [WebCrypto] local publicKey derived: 04a8b7c2d9e3f8a5c...',
      '🔄 [WebCrypto] Initiating peer Diffie-Hellman key exchange...',
      '📥 [WebCrypto] Remote publicKey received from Lucas Lima...',
      '🔗 [WebCrypto] Deriving shared secret encryption key...',
      '🔐 [WebCrypto] AES-GCM 256-bit symmetric session key established.',
      '💎 [E2EE] Communication channel fully encrypted.'
    ];

    let logIdx = 0;
    const interval = setInterval(() => {
      if (logIdx < logs.length) {
        setHandshakeLogs(prev => [...prev, logs[logIdx]]);
        logIdx++;
        setHandshakeStep(Math.min(Math.ceil(logIdx / 2), 4) as any);
      } else {
        clearInterval(interval);
        setIsE2EEReady(true);
        // Load initial secure messages
        setMessages([
          { 
            id: 'm1', 
            sender: 'Lucas Lima', 
            text: 'Sensitive parameters: our Q3 pricing variables are restricted to this room.', 
            timestamp: new Date(), 
            expiresIn: 60 
          }
        ]);
      }
    }, 900);

    return () => clearInterval(interval);
  }, []);

  // DRM Safeguards: Block Right-Click and Copy listeners
  useEffect(() => {
    const blockContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerSecurityToast('Right-click is restricted in Ephemeral Spaces.');
    };

    const blockCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerSecurityToast('Text copying is restricted inside E2EE rooms.');
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
    if (!isE2EEReady) return;

    const interval = setInterval(() => {
      setMessages(prev => 
        prev
          .map(msg => ({ ...msg, expiresIn: msg.expiresIn - 1 }))
          .filter(msg => msg.expiresIn > 0)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isE2EEReady]);

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
    if (!chatInput.trim() || !isE2EEReady) return;

    const newMsg: E2EEMessage = {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'You',
      text: chatInput,
      timestamp: new Date(),
      expiresIn: 60
    };

    setMessages(prev => [...prev, newMsg]);
    setChatInput('');

    // Simulate reply
    setTimeout(() => {
      const botReply: E2EEMessage = {
        id: Math.random().toString(36).substr(2, 9),
        sender: 'Lucas Lima',
        text: 'Acknowledged. Ephemeral copy received, destroying logs...',
        timestamp: new Date(),
        expiresIn: 60
      };
      setMessages(prev => [...prev, botReply]);
    }, 1500);
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
      border: '2px solid #EF4444', // Red border indicating confidential security E2EE
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
        CONFIDENTIAL &bull; {viewerEmail} &bull; IP: {simulatedIP}
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
            BLACK BOX VAULT
          </span>
          <h3 style={{ fontSize: '1.1rem', color: 'white', fontFamily: 'var(--font-heading)' }}>
            E2EE: {meetingTitle}
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: '#EF4444' }}>
          <Lock size={14} />
          <span>E2EE Active (AES-GCM)</span>
        </div>
      </div>

      {/* Main split work space */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left pane: Crypto Logs / Key Exchanges */}
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
              <Key size={18} color="var(--color-accent)" />
              <span>Cryptographic Handshake Status</span>
            </h4>

            {/* Steps visual badges */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {[1, 2, 3, 4].map(s => (
                <div 
                  key={s}
                  style={{
                    flex: 1,
                    height: '6px',
                    borderRadius: '3px',
                    backgroundColor: handshakeStep >= s ? '#10B981' : '#1E293B',
                    transition: 'all 0.4s ease'
                  }}
                />
              ))}
            </div>

            {/* Handshake logger console */}
            <div style={{
              backgroundColor: '#020305',
              border: '1px solid #1E293B',
              borderRadius: '6px',
              padding: '1rem',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              color: '#34D399',
              minHeight: '200px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              overflowY: 'auto'
            }}>
              {handshakeLogs.map((log, idx) => (
                <div key={idx}>{log}</div>
              ))}
              {!isE2EEReady && (
                <div style={{ color: 'var(--text-muted)', animation: 'pulse-ring 1s infinite' }}>
                  Connecting peer tunnels...
                </div>
              )}
            </div>
          </div>

          {/* Secure details card */}
          <div style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            <h5 style={{ color: 'white', fontWeight: 600, fontSize: '0.9rem' }}>Room Security Guardrails</h5>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}>Active session: {viewerName}</span>
            <ul style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <li>Direct P2P communication (No logs stored on server)</li>
              <li>Right-click, copy-paste, and key screenshots disabled</li>
              <li>Chat logs automatically vanish 60 seconds after delivery</li>
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
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Secured chat channel</span>
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
            {isE2EEReady && messages.length === 0 && (
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
              placeholder={isE2EEReady ? "Write secure message..." : "Handshaking..."}
              disabled={!isE2EEReady}
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
              disabled={!isE2EEReady}
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
                cursor: isE2EEReady ? 'pointer' : 'not-allowed',
                opacity: isE2EEReady ? 1 : 0.6
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
          <span>Session Key Ref: ECDH-256-AES-GCM-TOKEN</span>
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
