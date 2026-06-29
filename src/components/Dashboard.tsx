import React, { useState } from 'react';
import { Video, UserPlus, Calendar, ArrowRight, Clock, CheckCircle2, Play, AlertCircle, Copy, Check } from 'lucide-react';

interface Meeting {
  id: string;
  title: string;
  time: string;
  duration: string;
  status: 'Completed' | 'In Progress' | 'Scheduled';
  host: string;
  passcode?: string;
}

interface DashboardProps {
  isPremium: boolean;
  onNavigate: (view: string) => void;
  onStartMeeting: (title?: string, dmThreadId?: string, isVideo?: boolean, existingMeetingId?: string, requireWaitingRoom?: boolean) => void;
  meetingHistory: Meeting[];
  onAddMeeting: (meeting: { title: string; time: string; duration: string; requireWaitingRoom?: boolean }) => Promise<Meeting | null>;
  userName: string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  isPremium,
  onNavigate,
  onStartMeeting,
  meetingHistory,
  onAddMeeting,
  userName,
}) => {
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showInstantModal, setShowInstantModal] = useState(false);
  const [instantTitle, setInstantTitle] = useState('Instant Meeting');
  const [instantRequireWaitingRoom, setInstantRequireWaitingRoom] = useState(true);
  const [requireWaitingRoom, setRequireWaitingRoom] = useState(true);
  const [scheduledMeetingDetails, setScheduledMeetingDetails] = useState<Meeting | null>(null);
  const [copiedSuccessId, setCopiedSuccessId] = useState<'link' | 'details' | null>(null);
  
  // Track copying in history list
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null);

  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [joinError, setJoinError] = useState('');

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingTitle || !meetingTime) return;

    const saved = await onAddMeeting({
      title: meetingTitle,
      time: new Date(meetingTime).toISOString(),
      duration: '40m limit',
      requireWaitingRoom
    });

    if (saved) {
      setScheduledMeetingDetails(saved);
      setMeetingTitle('');
      setMeetingTime('');
      setRequireWaitingRoom(true);
      setShowScheduleModal(false);
      setShowSuccessModal(true);
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingCode.trim()) {
      setJoinError('Please enter a valid meeting code.');
      return;
    }
    // Join the existing meeting by code
    onStartMeeting(undefined, undefined, true, meetingCode.trim());
    setShowJoinModal(false);
    setMeetingCode('');
  };

  return (
    <div className="dashboard-container" style={{ 
      animation: 'slide-in var(--transition-normal)',
      flex: 1,
      overflowY: 'auto',
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Welcome Banner */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 className="welcome-heading">
          Welcome back, <span style={{ color: 'var(--color-secondary)' }}>{userName}</span>
        </h1>
        <p className="welcome-subtext">
          Connect, collaborate, and virtualize with HD audio and video.
        </p>
      </div>

      {/* Quick Action Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2.5rem'
      }}>
        {/* New Meeting */}
        <div 
          onClick={() => setShowInstantModal(true)}
          className="glass-panel" 
          style={{
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            background: 'linear-gradient(135deg, var(--color-primary) 0%, #001A4C 100%)',
            color: 'white',
            border: 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 12px 20px rgba(0,32,91,0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-premium)';
          }}
        >
          <div 
            className="dashboard-card-icon"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Video size={24} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ color: 'white', fontSize: '1.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>New Meeting</h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>Start an instant virtualization hub</p>
          </div>
        </div>

        {/* Join Meeting */}
        <div 
          onClick={() => setShowJoinModal(true)}
          className="glass-panel" 
          style={{
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div 
            className="dashboard-card-icon"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(112, 130, 190, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <UserPlus size={24} color="var(--color-primary)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>Join Meeting</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Enter a code or invitation link</p>
          </div>
        </div>

        {/* Schedule Meeting */}
        <div 
          onClick={() => setShowScheduleModal(true)}
          className="glass-panel" 
          style={{
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <div 
            className="dashboard-card-icon"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(250, 189, 2, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Calendar size={24} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>Schedule</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Plan your future team sync</p>
          </div>
        </div>
      </div>

      {/* Main Content Split: History & Upgrade Promo */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '2rem'
      }} className="grid-2">
        {/* Left Side: Meeting History */}
        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="flex-between">
            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)' }}>Meeting Logs & History</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{meetingHistory.length} total meetings</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.5rem' }}>
            {meetingHistory.map((meeting) => (
              <div 
                key={meeting.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card)',
                  transition: 'border-color var(--transition-fast)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                  <div 
                    className="history-icon-wrapper"
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: meeting.status === 'In Progress' ? 'rgba(16, 185, 129, 0.15)' : 
                                      meeting.status === 'Scheduled' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(100, 116, 139, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {meeting.status === 'Completed' && <CheckCircle2 size={20} color="#64748B" />}
                    {meeting.status === 'In Progress' && <Play size={18} className="mic-indicator" style={{ color: '#10B981', animation: 'pulse-ring 2s infinite' }} />}
                    {meeting.status === 'Scheduled' && <Clock size={20} color="#3B82F6" />}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{meeting.title}</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {(() => {
                        try {
                          return new Date(meeting.time).toLocaleString();
                        } catch (e) {
                          return meeting.time;
                        }
                      })()} &bull; {meeting.duration}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`badge ${
                    meeting.status === 'Completed' ? 'badge-success' :
                    meeting.status === 'In Progress' ? 'badge-premium' : 'badge-info'
                  }`}>
                    {meeting.status}
                  </span>
                  
                  {meeting.status === 'In Progress' ? (
                    <button 
                      onClick={() => onStartMeeting(meeting.title, undefined, true, meeting.id)}
                      className="premium-btn premium-btn-accent" 
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                    >
                      Join Now
                    </button>
                  ) : meeting.status === 'Scheduled' ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button 
                        onClick={() => {
                          const shareableLink = `${window.location.origin}/#/join?id=${meeting.id}&passcode=${meeting.passcode || 'ABCD'}`;
                          navigator.clipboard.writeText(shareableLink);
                          setCopiedHistoryId(meeting.id);
                          setTimeout(() => setCopiedHistoryId(null), 2000);
                        }}
                        className={`premium-btn ${copiedHistoryId === meeting.id ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title="Copy Join Link"
                      >
                        {copiedHistoryId === meeting.id ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedHistoryId === meeting.id ? 'Copied' : 'Copy Link'}</span>
                      </button>
                      <button 
                        onClick={() => onStartMeeting(meeting.title, undefined, true, meeting.id)}
                        className="premium-btn premium-btn-primary" 
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                      >
                        Start Call
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Host: {meeting.host}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Pro Promotion Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!isPremium ? (
            <div 
              className="glass-panel" 
              style={{
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--bg-app) 150%)',
                color: 'white',
                padding: '2rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: 'none',
                position: 'relative',
                overflow: 'hidden',
                minHeight: '340px'
              }}
            >
              {/* Gold sparkle background simulation */}
              <div style={{
                position: 'absolute',
                top: '-40px',
                right: '-40px',
                width: '150px',
                height: '150px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)',
                opacity: 0.15,
                pointerEvents: 'none'
              }} />
              
              <div style={{ zIndex: 1 }}>
                <span className="badge badge-premium" style={{ color: '#000', backgroundColor: 'var(--color-accent)', border: 'none', marginBottom: '1rem' }}>
                  GO PRO
                </span>
                <h3 style={{ color: 'white', fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.75rem', fontFamily: 'var(--font-heading)' }}>
                  Upgrade to Pro Tiers
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.4, marginBottom: '1.5rem' }}>
                  Unlock 24h meeting limits, customized backgrounds, virtualization overlays, interactive whiteboards, and priority support.
                </p>
                
                <ul style={{ color: 'white', fontSize: '0.85rem', paddingLeft: '1.25rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>Unlimited meeting durations (up to 24h)</li>
                  <li>Upt to 300 participant rooms</li>
                  <li>Pro customization virtualization tools</li>
                  <li>Direct AI chat assistant response</li>
                </ul>
              </div>

              <button 
                onClick={() => onNavigate('billing')}
                className="premium-btn premium-btn-accent" 
                style={{ width: '100%', justifyContent: 'space-between', padding: '0.85rem 1.25rem', zIndex: 1 }}
              >
                <span>Upgrade for $9.99/mo</span>
                <ArrowRight size={18} />
              </button>
            </div>
          ) : (
            <div 
              className="glass-panel" 
              style={{
                background: 'linear-gradient(135deg, #1E293B 0%, var(--bg-card) 100%)',
                border: '1px solid var(--color-accent)',
                padding: '2rem',
                minHeight: '340px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span className="badge badge-premium">PRO MEMBER</span>
                </div>
                <h3 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.75rem' }}>
                  You are a GIIN MEET Pro
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.4 }}>
                  Thank you for subscribing! Your account has unlocked all next-generation virtualization platforms and meeting tools.
                </p>
              </div>

              <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '1rem', marginTop: '1rem' }}>
                <div className="flex-between" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status</span>
                  <span style={{ fontWeight: 600, color: '#10B981' }}>Active</span>
                </div>
                <div className="flex-between" style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Next billing date</span>
                  <span>July 21, 2026</span>
                </div>
                
                <button 
                  onClick={() => onNavigate('billing')}
                  className="premium-btn premium-btn-secondary" 
                  style={{ width: '100%' }}
                >
                  Manage Subscription
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '450px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Schedule a Meeting</h3>
            
            <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Meeting Title</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder="e.g. Weekly Operations Sync"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Date & Time</label>
                <input 
                  type="datetime-local" 
                  className="premium-input" 
                  value={meetingTime}
                  onChange={(e) => setMeetingTime(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Security & Admission</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="requireWaitingRoom" 
                      checked={requireWaitingRoom} 
                      onChange={() => setRequireWaitingRoom(true)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Host Admission (Waiting Room)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Participants must wait to be admitted by the host.</span>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="requireWaitingRoom" 
                      checked={!requireWaitingRoom} 
                      onChange={() => setRequireWaitingRoom(false)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Bypass Waiting Room (Auto-Join)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Anyone with the meeting link joins automatically.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => setShowScheduleModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="premium-btn premium-btn-primary">
                  Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {showJoinModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '400px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Join a Meeting</h3>
            
            <form onSubmit={handleJoinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Meeting Code or Link</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  placeholder="e.g. giin-abc-xyz"
                  value={meetingCode}
                  onChange={(e) => {
                    setMeetingCode(e.target.value);
                    setJoinError('');
                  }}
                  required
                />
                {joinError && (
                  <div style={{ color: '#EF4444', fontSize: '0.8rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <AlertCircle size={14} />
                    <span>{joinError}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => {
                    setShowJoinModal(false);
                    setJoinError('');
                    setMeetingCode('');
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="premium-btn premium-btn-accent">
                  Join Meeting
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccessModal && scheduledMeetingDetails && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{
            width: '500px',
            backgroundColor: 'var(--bg-card)',
            padding: '2rem',
            animation: 'pop-in var(--transition-normal)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <CheckCircle2 size={32} color="#10B981" />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
                Meeting Scheduled Successfully
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                Your professional GIIN Meet room is ready.
              </p>
            </div>

            <div style={{
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Topic</span>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>{scheduledMeetingDetails.title}</div>
              </div>

              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Time</span>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  {(() => {
                    try {
                      return new Date(scheduledMeetingDetails.time).toLocaleString();
                    } catch (e) {
                      return scheduledMeetingDetails.time;
                    }
                  })()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Meeting ID</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-secondary)' }}>
                    {scheduledMeetingDetails.id}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Passcode</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                    {scheduledMeetingDetails.passcode || 'ABCD'}
                  </div>
                </div>
              </div>
            </div>

            {/* Sharing Link Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Meeting Join Link</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  readOnly 
                  className="premium-input"
                  style={{ fontSize: '0.8rem', backgroundColor: 'rgba(0,0,0,0.1)', flex: 1 }}
                  value={`${window.location.origin}/#/join?id=${scheduledMeetingDetails.id}&passcode=${scheduledMeetingDetails.passcode || 'ABCD'}`}
                />
                <button
                  onClick={() => {
                    const link = `${window.location.origin}/#/join?id=${scheduledMeetingDetails.id}&passcode=${scheduledMeetingDetails.passcode || 'ABCD'}`;
                    navigator.clipboard.writeText(link);
                    setCopiedSuccessId('link');
                    setTimeout(() => setCopiedSuccessId(null), 2000);
                  }}
                  className={`premium-btn ${copiedSuccessId === 'link' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                  style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
                >
                  {copiedSuccessId === 'link' ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedSuccessId === 'link' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Copy Invitation Details Button */}
            <button
              onClick={() => {
                const link = `${window.location.origin}/#/join?id=${scheduledMeetingDetails.id}&passcode=${scheduledMeetingDetails.passcode || 'ABCD'}`;
                const timeStr = (() => {
                  try {
                    return new Date(scheduledMeetingDetails.time).toLocaleString();
                  } catch (e) {
                    return scheduledMeetingDetails.time;
                  }
                })();
                const invitation = `Please join my GIIN Meet video conference:
Topic: ${scheduledMeetingDetails.title}
Time: ${timeStr}

Join Meeting Link: ${link}

Meeting ID: ${scheduledMeetingDetails.id}
Passcode: ${scheduledMeetingDetails.passcode || 'ABCD'}

Securely encrypted under Fintech AES-256 standard.`;
                navigator.clipboard.writeText(invitation);
                setCopiedSuccessId('details');
                setTimeout(() => setCopiedSuccessId(null), 2000);
              }}
              className={`premium-btn ${copiedSuccessId === 'details' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem' }}
            >
              {copiedSuccessId === 'details' ? <Check size={16} /> : <Copy size={16} />}
              <span>{copiedSuccessId === 'details' ? 'Invitation Details Copied' : 'Copy Invitation Email'}</span>
            </button>

            <button
              onClick={() => {
                setShowSuccessModal(false);
                setScheduledMeetingDetails(null);
              }}
              className="premium-btn premium-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', marginTop: '0.5rem' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {/* Instant Meeting Modal */}
      {showInstantModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(8px)'
        }}>
          <div className="glass-panel" style={{
            maxWidth: '450px',
            width: '100%',
            padding: '2.5rem',
            animation: 'pop-in 0.3s ease',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            border: '1px solid var(--border-color)'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)', color: 'white' }}>Start a New Meeting</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Configure your instant meeting preferences before launching.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Meeting Title</label>
                <input 
                  type="text" 
                  className="premium-input" 
                  value={instantTitle}
                  onChange={(e) => setInstantTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>Security & Admission</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="instantRequireWaitingRoom" 
                      checked={instantRequireWaitingRoom} 
                      onChange={() => setInstantRequireWaitingRoom(true)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Host Admission (Waiting Room)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Participants must wait to be admitted by the host.</span>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'white' }}>
                    <input 
                      type="radio" 
                      name="instantRequireWaitingRoom" 
                      checked={!instantRequireWaitingRoom} 
                      onChange={() => setInstantRequireWaitingRoom(false)} 
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <strong style={{ display: 'block' }}>Bypass Waiting Room (Auto-Join)</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Anyone with the meeting link joins automatically.</span>
                    </div>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button 
                  type="button" 
                  className="premium-btn premium-btn-secondary" 
                  onClick={() => setShowInstantModal(false)}
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    onStartMeeting(instantTitle, undefined, true, undefined, instantRequireWaitingRoom);
                    setShowInstantModal(false);
                  }}
                  className="premium-btn premium-btn-primary"
                >
                  Start Meeting
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
