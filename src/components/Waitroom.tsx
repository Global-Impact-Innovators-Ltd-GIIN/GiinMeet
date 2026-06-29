import React, { useState, useEffect } from 'react';
import { ShieldAlert, ArrowLeft, Loader2, Sparkles, UserPlus, CheckCircle } from 'lucide-react';
import { mockAuth, supabase } from '../supabaseClient';

interface WaitroomProps {
  meetingId: string;
  initialPasscode?: string;
  user: { id: string; name: string; email: string } | null;
  onAdmitted: (meetingTitle: string, participantId: string, displayName: string) => void;
  onDeclined: () => void;
  onBack: () => void;
}

export const Waitroom: React.FC<WaitroomProps> = ({
  meetingId,
  initialPasscode = '',
  user,
  onAdmitted,
  onDeclined,
  onBack
}) => {
  const [meetingDetails, setMeetingDetails] = useState<{ title: string; passcode: string; require_waiting_room?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Passcode entry states
  const [passcode, setPasscode] = useState(initialPasscode);
  const [passcodeValidated, setPasscodeValidated] = useState(false);
  const [passcodeError, setPasscodeError] = useState('');

  // Profile entry states
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [participantId, setParticipantId] = useState<string>('');
  const [waitingStatus, setWaitingStatus] = useState<'Waiting' | 'Admitted' | 'Declined' | 'None'>('None');
  const [guestKey] = useState(() => user?.id || 'guest-' + Math.random().toString(36).substring(2, 11));

  // If already admitted once, bypass waitroom completely!
  useEffect(() => {
    if (localStorage.getItem(`admitted_meeting_${meetingId}`) === 'true') {
      const savedTitle = localStorage.getItem(`admitted_meeting_title_${meetingId}`) || 'GIIN MEET Call';
      const savedName = localStorage.getItem(`admitted_meeting_name_${meetingId}`) || displayName || user?.name || 'Guest';
      onAdmitted(savedTitle, user?.id || 'guest-' + Math.random().toString(36).substring(2, 11), savedName);
    }
  }, [meetingId, onAdmitted, user]);

  // Load meeting details on mount
  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const { data, error } = await mockAuth.getMeetingDetails(meetingId);
        if (error || !data) {
          setErrorMsg('Meeting does not exist or has been deleted.');
        } else {
          setMeetingDetails(data);
          // Auto-validate passcode so users never have to manually enter it when joining via link
          setPasscodeValidated(true);

          // If the meeting allows automatic join (bypass waiting room) and we have a name, admit immediately
          if (data.require_waiting_room === false && (user?.name || displayName)) {
            const finalName = user?.name || displayName || 'Participant';
            setWaitingStatus('Admitted');
            localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
            localStorage.setItem(`admitted_meeting_title_${meetingId}`, data.title || 'GIIN MEET Call');
            localStorage.setItem(`admitted_meeting_name_${meetingId}`, finalName);
            onAdmitted(data.title || 'GIIN MEET Call', user?.id || guestKey, finalName);
            return;
          }

          // If user is logged in, auto-join waitroom
          if (user?.name) {
            joinWaitingRoom(user.name, data.passcode);
          }
        }
      } catch (err) {
        console.error('Failed to load meeting details:', err);
        setErrorMsg('Unable to reach authentication servers.');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [meetingId, initialPasscode, user]);

  // Real-time waiting room status checking with fallback polling and instant broadcast channel
  useEffect(() => {
    if (waitingStatus !== 'Waiting') return;

    let active = true;

    // 1. Database fallback checking (if participantId is available)
    const checkStatus = async () => {
      if (!participantId || !active) return;
      try {
        const status = await mockAuth.checkParticipantStatus(participantId);
        if (status === 'Admitted' && active) {
          setWaitingStatus('Admitted');
          localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
          localStorage.setItem(`admitted_meeting_title_${meetingId}`, meetingDetails?.title || 'GIIN MEET Call');
          localStorage.setItem(`admitted_meeting_name_${meetingId}`, displayName);
          onAdmitted(meetingDetails?.title || 'GIIN MEET Call', participantId, displayName);
        } else if (status === 'Declined' && active) {
          setWaitingStatus('Declined');
          onDeclined();
        }
      } catch (err) {
        console.error('Waiting status check failure:', err);
      }
    };

    if (participantId) {
      checkStatus();
    }

    // 2. Instant Broadcast Channel subscription
    const waitChannel = supabase.channel(`sig-webrtc-${meetingId}`);
    
    waitChannel
      .on('broadcast', { event: 'waitroom-response' }, (payload: any) => {
        const data = payload.payload;
        if (data.targetKey === guestKey || (participantId && data.targetKey === participantId)) {
          if (data.status === 'Admitted' && active) {
            setWaitingStatus('Admitted');
            localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
            localStorage.setItem(`admitted_meeting_title_${meetingId}`, meetingDetails?.title || 'GIIN MEET Call');
            localStorage.setItem(`admitted_meeting_name_${meetingId}`, displayName);
            onAdmitted(meetingDetails?.title || 'GIIN MEET Call', data.targetKey, displayName);
          } else if (data.status === 'Declined' && active) {
            setWaitingStatus('Declined');
            onDeclined();
          }
        }
      })
      .subscribe();

    // 3. Broadcast presence request to host every 2 seconds
    const broadcastInterval = setInterval(() => {
      waitChannel.send({
        type: 'broadcast',
        event: 'waitroom-request',
        payload: {
          senderKey: guestKey,
          name: displayName
        }
      });
    }, 2000);

    // Standby database polling fallback every 4 seconds
    const pollInterval = setInterval(() => {
      if (participantId) {
        checkStatus();
      }
    }, 4000);

    return () => {
      active = false;
      supabase.removeChannel(waitChannel);
      clearInterval(broadcastInterval);
      clearInterval(pollInterval);
    };
  }, [participantId, waitingStatus, meetingDetails, displayName, onAdmitted, onDeclined, guestKey, meetingId]);

  // Handle Passcode Validation
  const handleVerifyPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingDetails) return;

    if (passcode.toUpperCase() === meetingDetails.passcode.toUpperCase()) {
      setPasscodeValidated(true);
      setPasscodeError('');
      if (user?.name) {
        joinWaitingRoom(user.name, meetingDetails.passcode);
      }
    } else {
      setPasscodeError('Invalid passcode. Please check and try again.');
    }
  };

  // Join wait list in database
  const joinWaitingRoom = async (name: string, _pcode?: string) => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      if (meetingDetails?.require_waiting_room === false) {
        // Immediately admit!
        setWaitingStatus('Admitted');
        localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
        localStorage.setItem(`admitted_meeting_title_${meetingId}`, meetingDetails.title || 'GIIN MEET Call');
        localStorage.setItem(`admitted_meeting_name_${meetingId}`, name);
        onAdmitted(meetingDetails.title || 'GIIN MEET Call', user?.id || guestKey, name);
        return;
      }

      setWaitingStatus('Waiting');
      const data = await mockAuth.joinMeetingRoom(meetingId, name, user?.id);
      if (data) {
        setParticipantId(data.id);
      }
    } catch (err) {
      console.warn('Database waitroom join failed, running in pure broadcast mode:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !meetingDetails) return;
    joinWaitingRoom(displayName, meetingDetails.passcode);
  };

  if (loading) {
    return (
      <div className="flex-center" style={{ minHeight: '80vh', flexDirection: 'column', gap: '1rem' }}>
        <Loader2 size={40} className="mic-indicator" color="var(--color-primary)" style={{ animation: 'spin 1.5s linear infinite' }} />
        <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>Configuring secure tunnel...</span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex-center" style={{ minHeight: '80vh', padding: '2rem' }}>
        <div className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '2.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ alignSelf: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#EF4444' }}>
            <ShieldAlert size={28} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', marginBottom: '0.5rem' }}>Connection Denied</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{errorMsg}</p>
          </div>
          <button onClick={onBack} className="premium-btn premium-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-center" style={{ minHeight: '80vh', padding: '2rem' }}>
      <div className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* Header Title details */}
        <div style={{ textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            <Sparkles size={12} />
            <span>GIIN MEET Security waitroom</span>
          </span>
          <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)' }}>
            {meetingDetails?.title || 'Active Video Call'}
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {meetingId.slice(0, 8)}...</span>
        </div>

        <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: 0 }} />

        {/* Step 1: Passcode Verification */}
        {!passcodeValidated && (
          <form onSubmit={handleVerifyPasscode} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Enter Meeting Passcode
              </label>
              <input 
                type="text" 
                className="premium-input" 
                placeholder="e.g. AB12CD" 
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.toUpperCase())}
                required
                style={{ textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '1.25rem', height: '50px' }}
              />
              {passcodeError && (
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#EF4444', marginTop: '0.5rem' }}>
                  {passcodeError}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={onBack} className="premium-btn premium-btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button type="submit" className="premium-btn premium-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Verify Code
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Name Entry (Guest display name setup) */}
        {passcodeValidated && waitingStatus === 'None' && (
          <form onSubmit={handleNameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Enter Your Display Name
              </label>
              <input 
                type="text" 
                className="premium-input" 
                placeholder="Your Name (e.g. John Doe)" 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                style={{ height: '46px' }}
              />
              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                This is how other participants and the host will identify you in the room.
              </span>
            </div>

            <button type="submit" className="premium-btn premium-btn-accent" style={{ width: '100%', justifyContent: 'center', height: '46px' }}>
              <UserPlus size={18} />
              <span>Ask to Join Meeting</span>
            </button>
          </form>
        )}

        {/* Step 3: Waiting in waitroom */}
        {waitingStatus === 'Waiting' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                border: '3px solid var(--border-color)',
                borderTopColor: 'var(--color-secondary)',
                animation: 'spin 1s linear infinite'
              }} />
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'var(--color-secondary)'
              }}>
                <CheckCircle size={24} />
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Waitroom Access Granted
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '300px', lineHeight: 1.45 }}>
                Waiting for the meeting host to admit you in... Please don't close this window.
              </p>
            </div>

            <div style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Connected as <strong style={{ color: 'var(--text-main)' }}>{displayName}</strong>
            </div>

            <button onClick={onBack} className="premium-btn premium-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
              Leave Waitroom
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
