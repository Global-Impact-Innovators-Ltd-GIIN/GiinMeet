import React, { useState } from 'react';
import { Video, UserPlus, Calendar, ArrowRight, Clock, CheckCircle2, Play, AlertCircle } from 'lucide-react';

interface Meeting {
  id: string;
  title: string;
  time: string;
  duration: string;
  status: 'Completed' | 'In Progress' | 'Scheduled';
  host: string;
}

interface DashboardProps {
  isPremium: boolean;
  onNavigate: (view: string) => void;
  onStartMeeting: (title?: string) => void;
  meetingHistory: Meeting[];
  onAddMeeting: (meeting: Meeting) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  isPremium,
  onNavigate,
  onStartMeeting,
  meetingHistory,
  onAddMeeting,
}) => {
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [joinError, setJoinError] = useState('');

  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingTitle || !meetingTime) return;

    const newMeeting: Meeting = {
      id: Math.random().toString(36).substr(2, 9),
      title: meetingTitle,
      time: new Date(meetingTime).toLocaleString(),
      duration: '40m limit',
      status: 'Scheduled',
      host: 'You',
    };

    onAddMeeting(newMeeting);
    setMeetingTitle('');
    setMeetingTime('');
    setShowScheduleModal(false);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingCode.trim()) {
      setJoinError('Please enter a valid meeting code.');
      return;
    }
    // Simulate joining
    onStartMeeting(`Meeting: ${meetingCode}`);
    setShowJoinModal(false);
    setMeetingCode('');
  };

  return (
    <div className="dashboard-container" style={{ animation: 'slide-in var(--transition-normal)' }}>
      {/* Welcome Banner */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.5rem', fontFamily: 'var(--font-heading)' }}>
          Welcome back, <span style={{ color: 'var(--color-secondary)' }}>Giin User</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem' }}>
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
          onClick={() => onStartMeeting('Instant Meeting')}
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
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
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
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'rgba(112, 130, 190, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
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
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            backgroundColor: 'rgba(250, 189, 2, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
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
                  justifyContent: 'between',
                  padding: '1rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-card)',
                  transition: 'border-color var(--transition-fast)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    backgroundColor: meeting.status === 'In Progress' ? 'rgba(16, 185, 129, 0.15)' : 
                                    meeting.status === 'Scheduled' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(100, 116, 139, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {meeting.status === 'Completed' && <CheckCircle2 size={20} color="#64748B" />}
                    {meeting.status === 'In Progress' && <Play size={18} className="mic-indicator" style={{ color: '#10B981', animation: 'pulse-ring 2s infinite' }} />}
                    {meeting.status === 'Scheduled' && <Clock size={20} color="#3B82F6" />}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{meeting.title}</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {meeting.time} &bull; {meeting.duration}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span className={`badge ${
                    meeting.status === 'Completed' ? 'badge-success' :
                    meeting.status === 'In Progress' ? 'badge-premium' : 'badge-info'
                  }`}>
                    {meeting.status}
                  </span>
                  
                  {meeting.status === 'In Progress' ? (
                    <button 
                      onClick={() => onStartMeeting(meeting.title)}
                      className="premium-btn premium-btn-accent" 
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                    >
                      Join Now
                    </button>
                  ) : meeting.status === 'Scheduled' ? (
                    <button 
                      onClick={() => onStartMeeting(meeting.title)}
                      className="premium-btn premium-btn-primary" 
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                    >
                      Start Call
                    </button>
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
    </div>
  );
};
