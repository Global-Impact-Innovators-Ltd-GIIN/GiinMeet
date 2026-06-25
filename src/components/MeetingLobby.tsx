import React, { useEffect, useRef, useState } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, Copy, Check, ShieldCheck, 
  Sparkles, ArrowRight, ArrowLeft 
} from 'lucide-react';

interface MeetingLobbyProps {
  meetingId: string;
  meetingTitle: string;
  passcode: string;
  hostName: string;
  currentUser: { name: string; email: string } | null;
  onJoin: (videoOn: boolean, audioOn: boolean) => void;
  onCancel: () => void;
}

export const MeetingLobby: React.FC<MeetingLobbyProps> = ({
  meetingId,
  meetingTitle,
  passcode,
  hostName,
  currentUser,
  onJoin,
  onCancel
}) => {
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Get shareable join link
  const shareableLink = `${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareableLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Manage camera preview stream
  useEffect(() => {
    if (isVideoOn) {
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(stream => {
          setLocalStream(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(err => {
          console.warn('Camera preview not available:', err);
          setIsVideoOn(false);
        });
    } else {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
      }
    }

    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isVideoOn]);

  const handleJoinClick = () => {
    // Stop local preview stream before entering the room to release the camera
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    onJoin(isVideoOn, isAudioOn);
  };

  return (
    <div style={{
      maxWidth: '1000px',
      margin: '0 auto',
      padding: '2rem 1.5rem',
      animation: 'slide-in var(--transition-normal)',
      display: 'flex',
      flexDirection: 'column',
      gap: '2rem'
    }}>
      {/* Header back button & title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button 
          onClick={onCancel}
          className="premium-btn premium-btn-secondary"
          style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} />
          <span>Exit Lobby</span>
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10B981', fontSize: '0.8rem', fontWeight: 700 }}>
          <ShieldCheck size={16} />
          <span>SECURE END-TO-END ENCRYPTED MEETING</span>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '2.5rem',
        alignItems: 'start'
      }} className="grid-2">
        
        {/* Left Column: Camera Preview Box */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            position: 'relative',
            aspectRatio: '16/9',
            backgroundColor: '#0F172A',
            border: '2px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-premium)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {isVideoOn ? (
              <video 
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)' // Mirror preview
                }}
              />
            ) : (
              <div style={{
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
                color: 'var(--text-muted)'
              }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2rem',
                  fontWeight: 700,
                  color: 'var(--color-secondary)'
                }}>
                  {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('') : 'G'}
                </div>
                <div>
                  <h4 style={{ color: 'white', fontSize: '1rem', margin: '0 0 0.25rem 0' }}>Camera is Off</h4>
                  <p style={{ fontSize: '0.8rem', margin: 0 }}>Configure devices before entering</p>
                </div>
              </div>
            )}

            {/* Quick settings floating overlay */}
            <div style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '1rem',
              zIndex: 20
            }}>
              <button
                type="button"
                onClick={() => setIsAudioOn(!isAudioOn)}
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: isAudioOn ? 'rgba(255, 255, 255, 0.15)' : '#EF4444',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s'
                }}
                title={isAudioOn ? 'Mute Microphone' : 'Unmute Microphone'}
              >
                {isAudioOn ? <Mic size={20} /> : <MicOff size={20} />}
              </button>

              <button
                type="button"
                onClick={() => setIsVideoOn(!isVideoOn)}
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: isVideoOn ? 'rgba(255, 255, 255, 0.15)' : '#EF4444',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s'
                }}
                title={isVideoOn ? 'Disable Camera' : 'Enable Camera'}
              >
                {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            </div>

            {/* Premium Seal Emblem */}
            <div style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              backgroundColor: 'rgba(0, 32, 91, 0.8)',
              color: 'var(--color-accent)',
              padding: '0.35rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.65rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(250, 189, 2, 0.3)'
            }}>
              <Sparkles size={10} />
              <span>GIIN PRE-JOIN PRO</span>
            </div>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Verify your microphone and webcam settings before entering the virtualization grid.
          </span>
        </div>

        {/* Right Column: Branded Meeting Info & Joins */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-panel" style={{
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                Virtual Meeting Room
              </span>
              <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', marginTop: '0.25rem', marginBottom: '0.5rem' }}>
                {meetingTitle}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <span>Host: <strong>{hostName}</strong></span>
                <span>&bull;</span>
                <span>ID: {meetingId.slice(0, 8)}...</span>
              </div>
            </div>

            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: 0 }} />

            {/* Sharing link card */}
            <div style={{
              backgroundColor: 'rgba(var(--color-secondary-rgb), 0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Share Invitation Link</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input 
                  type="text" 
                  value={shareableLink} 
                  readOnly 
                  className="premium-input"
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.4rem 0.75rem',
                    flex: 1,
                    backgroundColor: 'rgba(0,0,0,0.1)',
                    borderColor: 'var(--border-color)'
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`premium-btn ${copied ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                  style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', height: '34px', flexShrink: 0 }}
                  title="Copy Meeting Link"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Passcode is integrated into link for instant access.
              </span>
            </div>

            <button
              onClick={handleJoinClick}
              className="premium-btn premium-btn-primary"
              style={{
                width: '100%',
                padding: '0.9rem',
                fontSize: '1rem',
                fontWeight: 700,
                borderRadius: 'var(--radius-md)',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: 'var(--shadow-premium)'
              }}
            >
              <span>Join Meeting Room</span>
              <ArrowRight size={18} />
            </button>
          </div>

          {/* Secure fintech checkoff list */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '0.5rem 1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Fintech-Standard AES-256 GCM Cryptography</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Pre-Admission Waitroom & Privacy Controls</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Real-Time WebRTC Peer Network Infrastructure</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
