import React, { useEffect, useRef, useState } from 'react';
import { 
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, Users, MessageSquare, PhoneOff, 
  SendHorizontal, Edit2
} from 'lucide-react';
import { ScreenAnnotation } from './ScreenAnnotation';
import { WorkspacePanel } from './WorkspacePanel';

interface Participant {
  id: string;
  name: string;
  avatar: string;
  role: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isVideoOn: boolean;
  avatarBg: string;
}

// Screen Share WebRTC resolution optimizations
export const getWebRTCScreenshareConstraints = () => {
  return {
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { max: 15 } // 4K/1080p high resolution static text focus
    },
    audio: true
  };
};

interface MeetingRoomProps {
  meetingTitle: string;
  onEndMeeting: () => void;
  onSaveWorkspaceData?: (notes: string, actionItemsCount: number) => void;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ meetingTitle, onEndMeeting, onSaveWorkspaceData }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [isColleagueSharing, setIsColleagueSharing] = useState(false);
  const [activePanel, setActivePanel] = useState<'none' | 'chat' | 'participants' | 'workspace'>('none');
  
  const colleagueCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Chat state
  const [messages, setMessages] = useState<{ sender: string; text: string; time: string; self: boolean }[]>([
    { sender: 'Lucas Lima', text: 'Welcome everyone! Let us review the virtualization project details.', time: '10:02 AM', self: false },
    { sender: 'Mariana Santos', text: 'Sounds good. Sarah, do you have the wireframes ready?', time: '10:03 AM', self: false },
  ]);
  const [chatInput, setChatInput] = useState('');
  
  // Camera video ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initial participants
  const [participants, setParticipants] = useState<Participant[]>([
    { id: '1', name: 'Sarah Jenkins', role: 'UI/UX Designer', avatar: 'SJ', isMuted: false, isSpeaking: true, isVideoOn: true, avatarBg: '#7082BE' },
    { id: '2', name: 'Lucas Lima', role: 'Tech Lead', avatar: 'LL', isMuted: false, isSpeaking: false, isVideoOn: true, avatarBg: '#00205B' },
    { id: '3', name: 'Mariana Santos', role: 'Product Manager', avatar: 'MS', isMuted: true, isSpeaking: false, isVideoOn: false, avatarBg: '#FABD02' },
    { id: '4', name: 'David Chen', role: 'QA Engineer', avatar: 'DC', isMuted: false, isSpeaking: false, isVideoOn: true, avatarBg: '#10B981' },
    { id: '5', name: 'Sofia Brant', role: 'Marketing Specialist', avatar: 'SB', isMuted: true, isSpeaking: false, isVideoOn: true, avatarBg: '#EC4899' },
  ]);

  // Handle media devices (webcam)
  useEffect(() => {
    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.warn('Camera access denied or unavailable. Running in simulated fallback mode.', err);
      }
    }

    if (isVideoOn) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isVideoOn]);

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  // Toggle buttons
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = isMuted; // set track audio enabled state (opposite of state before toggle)
      });
    }
  };

  const toggleVideo = () => {
    setIsVideoOn(!isVideoOn);
  };

  // Simulated Speaking status fluctuations
  useEffect(() => {
    const interval = setInterval(() => {
      setIsSpeaking(Math.random() > 0.7);
      setParticipants(prev => 
        prev.map(p => {
          if (p.isMuted) return { ...p, isSpeaking: false };
          // Random speaking state change
          const shouldSpeak = Math.random() > 0.65;
          return { ...p, isSpeaking: shouldSpeak };
        })
      );
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Screen Share Canvas Animation Simulation
  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (isScreenSharing && canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        let frame = 0;
        const draw = () => {
          frame++;
          ctx.fillStyle = '#0B0F19';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw grid patterns
          ctx.strokeStyle = 'rgba(112, 130, 190, 0.15)';
          ctx.lineWidth = 1;
          for (let i = 0; i < canvas.width; i += 40) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, canvas.height);
            ctx.stroke();
          }
          for (let j = 0; j < canvas.height; j += 40) {
            ctx.beginPath();
            ctx.moveTo(0, j);
            ctx.lineTo(canvas.width, j);
            ctx.stroke();
          }

          // Draw sample presentation chart
          ctx.fillStyle = '#FABD02';
          ctx.font = 'bold 16px sans-serif';
          ctx.fillText('GIIN MEET VIRTUALIZATION REPORT', 24, 40);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '12px sans-serif';
          ctx.fillText('Active Analytics Presentation Share (Live Feed)', 24, 65);

          // Draw bar chart
          const data = [120, 190, 80, 250, 160, 210];
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#7082BE';
          
          data.forEach((val, index) => {
            const x = 50 + index * 60;
            const y = canvas.height - 40;
            const h = (val * (Math.sin(frame * 0.05) + 2)) / 3;
            
            // Bar
            ctx.fillStyle = 'rgba(112, 130, 190, 0.3)';
            ctx.fillRect(x, y - h, 35, h);
            ctx.strokeStyle = '#7082BE';
            ctx.strokeRect(x, y - h, 35, h);

            // Gold indicator line
            ctx.fillStyle = '#FABD02';
            ctx.fillRect(x + 10, y - h - 5, 15, 3);
          });

          // Pulse screen share outline
          ctx.strokeStyle = `rgba(250, 189, 2, ${Math.abs(Math.sin(frame * 0.07))})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(0, 0, canvas.width, canvas.height);

          animationId = requestAnimationFrame(draw);
        };
        draw();
      }
    }
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isScreenSharing]);

  // Colleague Screenshare Canvas Animation (VS Code mock presentation)
  useEffect(() => {
    let animationId: number;
    const canvas = colleagueCanvasRef.current;
    if (isColleagueSharing && canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        let frame = 0;
        const draw = () => {
          frame++;
          ctx.fillStyle = '#1E1E1E';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.fillStyle = '#858585';
          ctx.font = '11px monospace';
          ctx.fillText('index.css - GiinMeet - Visual Studio Code', 15, 20);

          const lines = [
            '/* Next-Gen Style Override */',
            ':root {',
            '  --color-primary: #00205B;',
            '  --color-secondary: #7082BE;',
            '  --color-accent: #FABD02;',
            '}',
            '',
            'body {',
            '  font-family: var(--font-sans);',
            '  background: var(--bg-app);',
            '}'
          ];

          lines.forEach((line, idx) => {
            let color = '#D4D4D4';
            if (line.startsWith('/*')) color = '#6A9955';
            else if (line.includes(':root') || line.includes('body')) color = '#DCDCAA';
            else if (line.includes('--') || line.includes('font-family')) color = '#9CDCFE';
            else if (line.includes('#') || line.includes('var')) color = '#CE9178';
            
            ctx.fillStyle = color;
            ctx.font = '13px Consolas, monospace';
            ctx.fillText(line, 30, 50 + idx * 20);
          });

          // Draw laser cursor
          const cy = 100 + Math.sin(frame * 0.05) * 50;
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(150, cy, 6, 0, 2 * Math.PI);
          ctx.fill();

          ctx.fillStyle = '#EF4444';
          ctx.font = '10px sans-serif';
          ctx.fillText('Lucas pointing...', 160, cy + 3);

          ctx.strokeStyle = `rgba(112, 130, 190, ${Math.abs(Math.sin(frame * 0.07))})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(0, 0, canvas.width, canvas.height);

          animationId = requestAnimationFrame(draw);
        };
        draw();
      }
    }
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isColleagueSharing]);


  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const newMsg = {
      sender: 'You',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: true
    };

    setMessages(prev => [...prev, newMsg]);
    setChatInput('');

    // Simulate participant response
    setTimeout(() => {
      const responseMsg = {
        sender: 'Sarah Jenkins',
        text: 'Awesome screenshare! That looks solid.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        self: false
      };
      setMessages(prev => [...prev, responseMsg]);
    }, 1500);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 80px)',
      backgroundColor: '#07090E', // Dark screen for immersive meeting
      color: 'white',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      position: 'relative',
      border: '1px solid #1E293B',
      animation: 'pop-in var(--transition-normal)'
    }}>
      {/* Upper Status Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid #1E293B',
        backgroundColor: 'rgba(11, 15, 25, 0.9)',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="badge badge-premium" style={{ color: '#000', backgroundColor: 'var(--color-accent)', border: 'none' }}>
            LIVE
          </span>
          <h3 style={{ fontSize: '1.1rem', color: 'white', fontFamily: 'var(--font-heading)' }}>
            {meetingTitle}
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <span>Encryption Active</span>
          <span>&bull;</span>
          <span style={{ color: 'var(--color-secondary)' }}>HD Call</span>
        </div>
      </div>

      {/* Main workspace (Grid & Panels) */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
        
        {/* Grid Container */}
        <div style={{
          flex: 1,
          display: 'grid',
          // If screen sharing is on, we give it a large top space or double column
          gridTemplateColumns: (isScreenSharing && isColleagueSharing) ? '1fr 1fr' : (isScreenSharing || isColleagueSharing) ? '2fr 1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
          padding: '1.25rem',
          overflowY: 'auto',
          alignContent: 'center',
          backgroundColor: '#07090E'
        }}>
          {/* Screenshare simulation card */}
          {isScreenSharing && (
            <div style={{
              gridRow: 'span 2',
              position: 'relative',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              border: '2px solid var(--color-accent)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#0B0F19'
            }}>
              <canvas 
                ref={canvasRef} 
                width={640} 
                height={400} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
              
              {isAnnotating && (
                <ScreenAnnotation 
                  isPresenter={true} 
                  onClose={() => setIsAnnotating(false)} 
                />
              )}
              
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                backgroundColor: 'rgba(0,0,0,0.75)',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                zIndex: 25
              }}>
                <Monitor size={14} color="var(--color-accent)" />
                <span>You are sharing your screen</span>
              </div>
            </div>
          )}

          {/* Colleague Screenshare simulation card */}
          {isColleagueSharing && (
            <div style={{
              gridRow: 'span 2',
              position: 'relative',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              border: '2px solid var(--color-secondary)',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#1E1E1E'
            }}>
              <canvas 
                ref={colleagueCanvasRef} 
                width={640} 
                height={400} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                backgroundColor: 'rgba(0,0,0,0.75)',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                zIndex: 25
              }}>
                <Monitor size={14} color="var(--color-secondary)" />
                <span>Lucas Lima is sharing screen</span>
              </div>
            </div>
          )}

          {/* User local webcam view */}
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            backgroundColor: '#1E293B',
            aspectRatio: '16/9',
            border: isSpeaking && !isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
            boxShadow: isSpeaking && !isMuted ? '0 0 15px rgba(250, 189, 2, 0.4)' : 'none',
            transition: 'all 0.2s ease'
          }}>
            {isVideoOn ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} 
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
                backgroundColor: '#111827'
              }}>
                <div style={{
                  width: '70px',
                  height: '70px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color: 'white'
                }}>
                  U
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Camera Off</span>
              </div>
            )}

            {/* Speaking Wave overlay if speaking */}
            {isSpeaking && !isMuted && (
              <div style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                display: 'flex',
                gap: '3px',
                alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.6)',
                padding: '6px',
                borderRadius: '6px'
              }}>
                <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.8s ease infinite', transformOrigin: 'bottom' }} />
                <span style={{ width: '3px', height: '18px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.5s ease infinite', transformOrigin: 'bottom' }} />
                <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.9s ease infinite', transformOrigin: 'bottom' }} />
              </div>
            )}

            {/* Bottom info banner */}
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              backgroundColor: 'rgba(0,0,0,0.7)',
              padding: '0.3rem 0.6rem',
              borderRadius: '4px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}>
              <span>You (Host)</span>
              {isMuted ? <MicOff size={12} color="#EF4444" /> : <Mic size={12} color="#10B981" />}
            </div>
          </div>

          {/* Simulated Participants */}
          {participants.map(p => (
            <div key={p.id} style={{
              position: 'relative',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              backgroundColor: '#111827',
              aspectRatio: '16/9',
              border: p.isSpeaking && !p.isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
              boxShadow: p.isSpeaking && !p.isMuted ? '0 0 15px rgba(250, 189, 2, 0.4)' : 'none',
              transition: 'all 0.2s ease'
            }}>
              {p.isVideoOn ? (
                <div style={{
                  width: '100%',
                  height: '100%',
                  position: 'relative',
                  backgroundColor: '#1E293B'
                }}>
                  {/* Mock live video graphic using CSS animation */}
                  <div style={{
                    width: '100%',
                    height: '100%',
                    background: `linear-gradient(135deg, ${p.avatarBg}33 0%, #111827 100%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}>
                    {/* Simulated visual motion */}
                    <div style={{
                      position: 'absolute',
                      width: '60px',
                      height: '60px',
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.1)',
                      animation: 'pulse-ring 3s infinite'
                    }} />
                    <div style={{
                      width: '60px',
                      height: '60px',
                      borderRadius: '50%',
                      backgroundColor: p.avatarBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.25rem',
                      fontWeight: 700
                    }}>
                      {p.avatar}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1rem',
                  backgroundColor: '#090D16'
                }}>
                  <div style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    backgroundColor: '#1E293B',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                    fontWeight: 700
                  }}>
                    {p.avatar}
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Camera Off</span>
                </div>
              )}

              {/* Speaker Indicator */}
              {p.isSpeaking && !p.isMuted && (
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  display: 'flex',
                  gap: '3px',
                  alignItems: 'center',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  padding: '6px',
                  borderRadius: '6px'
                }}>
                  <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.7s ease infinite', transformOrigin: 'bottom' }} />
                  <span style={{ width: '3px', height: '18px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.4s ease infinite', transformOrigin: 'bottom' }} />
                  <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.8s ease infinite', transformOrigin: 'bottom' }} />
                </div>
              )}

              {/* Bottom tag */}
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                backgroundColor: 'rgba(0,0,0,0.7)',
                padding: '0.3rem 0.6rem',
                borderRadius: '4px',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}>
                <span>{p.name} ({p.role})</span>
                {p.isMuted ? <MicOff size={12} color="#EF4444" /> : <Mic size={12} color="#10B981" />}
              </div>
            </div>
          ))}
        </div>

        {/* Collapsible Panels */}
        {activePanel === 'chat' && (
          <div style={{
            width: '320px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>Meeting Chat</h4>
              <button 
                onClick={() => setActivePanel('none')}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
            
            {/* Messages Feed */}
            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {messages.map((m, idx) => (
                <div key={idx} style={{
                  alignSelf: m.self ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.self ? 'flex-end' : 'flex-start'
                }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>
                    {m.sender} &bull; {m.time}
                  </span>
                  <div style={{
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    backgroundColor: m.self ? 'var(--color-primary)' : '#1E293B',
                    color: 'white',
                    fontSize: '0.85rem',
                    lineHeight: 1.3
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={sendChatMessage} style={{ padding: '0.75rem', borderTop: '1px solid #1E293B', display: 'flex', gap: '0.5rem' }}>
              <input 
                type="text" 
                placeholder="Send message to everyone..." 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '4px',
                  backgroundColor: '#090D16',
                  border: '1px solid #1E293B',
                  color: 'white',
                  fontSize: '0.85rem'
                }}
              />
              <button type="submit" style={{
                background: 'var(--color-primary)',
                border: 'none',
                borderRadius: '4px',
                width: '34px',
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer'
              }}>
                <SendHorizontal size={16} />
              </button>
            </form>
          </div>
        )}

        {activePanel === 'participants' && (
          <div style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>Participants ({participants.length + 1})</h4>
              <button 
                onClick={() => setActivePanel('none')}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Host */}
              <div className="flex-between">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.85rem' }}>
                    Y
                  </div>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>You</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Host</div>
                  </div>
                </div>
                <div>
                  {isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />}
                </div>
              </div>

              {/* Other participants */}
              {participants.map(p => (
                <div key={p.id} className="flex-between">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: p.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.85rem' }}>
                      {p.avatar}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.role}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {p.isSpeaking && !p.isMuted && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', animation: 'pulse-ring 2s infinite' }} />}
                    {p.isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activePanel === 'workspace' && (
          <WorkspacePanel 
            workspaceUsers={participants.map(p => ({ name: p.name, role: p.role }))}
            onSaveWorkspaceData={(notes, itemsCount) => {
              if (onSaveWorkspaceData) {
                onSaveWorkspaceData(notes, itemsCount);
              }
              setActivePanel('none');
            }}
            onClose={() => setActivePanel('none')}
          />
        )}
      </div>

      {/* Toolbar / Controls */}
      <div style={{
        padding: '1.25rem 2rem',
        borderTop: '1px solid #1E293B',
        backgroundColor: '#090D16',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        {/* Left Side details */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <span>ID: </span>
          <span style={{ color: 'white', fontWeight: 500 }}>giin-abc-xyz</span>
        </div>

        {/* Center Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Mute Audio */}
          <button 
            onClick={toggleMute}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: isMuted ? '#EF4444' : '#1E293B',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)'
            }}
          >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          {/* Stop Video */}
          <button 
            onClick={toggleVideo}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: !isVideoOn ? '#EF4444' : '#1E293B',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)'
            }}
          >
            {isVideoOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
          </button>

          {/* Screen Share */}
          <button 
            onClick={() => setIsScreenSharing(!isScreenSharing)}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: isScreenSharing ? 'var(--color-accent)' : '#1E293B',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isScreenSharing ? 'black' : 'white',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)'
            }}
            title="Toggle Screenshare"
          >
            <Monitor size={18} />
          </button>

          {/* Annotate Screen */}
          {isScreenSharing && (
            <button 
              onClick={() => setIsAnnotating(!isAnnotating)}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: isAnnotating ? 'var(--color-primary)' : '#1E293B',
                border: isAnnotating ? '1px solid var(--color-accent)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isAnnotating ? 'var(--color-accent)' : 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title="Draw Annotations"
            >
              <Edit2 size={18} />
            </button>
          )}

          {/* Simulate Colleague Share */}
          <button 
            onClick={() => setIsColleagueSharing(!isColleagueSharing)}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: isColleagueSharing ? 'var(--color-secondary)' : '#1E293B',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)'
            }}
            title="Simulate Remote Share"
          >
            <Users size={18} />
          </button>
        </div>

        {/* Right Side Options & Leave */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button 
            onClick={() => setActivePanel(activePanel === 'participants' ? 'none' : 'participants')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: activePanel === 'participants' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
              border: '1px solid #1E293B',
              padding: '0.5rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              color: activePanel === 'participants' ? 'var(--color-accent)' : 'white',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            <Users size={16} />
            <span>Participants</span>
          </button>

          <button 
            onClick={() => setActivePanel(activePanel === 'workspace' ? 'none' : 'workspace')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: activePanel === 'workspace' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
              border: '1px solid #1E293B',
              padding: '0.5rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              color: activePanel === 'workspace' ? 'var(--color-accent)' : 'white',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
            title="Meeting Workspace Notes"
          >
            <Edit2 size={16} />
            <span>Workspace</span>
          </button>

          <button 
            onClick={() => setActivePanel(activePanel === 'chat' ? 'none' : 'chat')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: activePanel === 'chat' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
              border: '1px solid #1E293B',
              padding: '0.5rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              color: activePanel === 'chat' ? 'var(--color-accent)' : 'white',
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            <MessageSquare size={16} />
            <span>Chat</span>
          </button>

          <button 
            onClick={onEndMeeting}
            className="premium-btn premium-btn-danger"
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              gap: '0.35rem'
            }}
          >
            <PhoneOff size={16} />
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
};
