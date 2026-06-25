import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Star, MessageSquare, Phone, Calendar, Mail, Smartphone, 
  Briefcase, ArrowLeft, BarChart2, MapPin, Clock, Plus, 
  Paperclip, Lock, Shield
} from 'lucide-react';
import { mockAuth, supabase } from '../supabaseClient';
import { encryptMessage } from '../services/e2ee';

interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  avatar: string;
  avatarBg: string;
  isStarred: boolean;
  status: 'Online' | 'Offline' | 'In a Meeting';
  history: { type: string; date: string; duration?: string }[];
  timezone?: string;
  location?: string;
  skills?: string[];
}

interface ContactsProps {
  userDomain?: string;
  userWorkspaceName?: string;
  onNavigateToChat: (contactName: string) => void;
  onStartCall: (title: string, targetContactId?: string) => void;
}

export const Contacts: React.FC<ContactsProps> = ({ 
  userDomain = 'giinmeet.com', 
  userWorkspaceName = 'GIIN Workspace', 
  onNavigateToChat, 
  onStartCall 
}) => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'starred'>('all');
  const [showDetailsMobile, setShowDetailsMobile] = useState(false);
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const selectedContact = contacts.find(c => c.id === selectedContactId) || contacts[0];
  const [onlinePresences, setOnlinePresences] = useState<{ [key: string]: string }>({});
  
  // Insights Dashboard State
  const [showInsights, setShowInsights] = useState(false);

  // Time-Slot Meeting Scheduler State
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [meetingAgenda, setMeetingAgenda] = useState('');

  // Private Notes & Skills State
  const [contactNotes, setContactNotes] = useState('');
  const [contactSkills, setContactSkills] = useState<string[]>([]);
  const [newSkillTag, setNewSkillTag] = useState('');

  // E2EE Drop Box drag-over state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Success Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    const saved = localStorage.getItem('giin_user');
    if (saved) {
      setCurrentUser(JSON.parse(saved));
    }
  }, []);

  // Timezone and Location mapping helper
  const getContactMetadata = (id: string) => {
    const locations = [
      { location: 'New York, USA', timezone: 'America/New_York' },
      { location: 'London, UK', timezone: 'Europe/London' },
      { location: 'Berlin, Germany', timezone: 'Europe/Berlin' },
      { location: 'Tokyo, Japan', timezone: 'Asia/Tokyo' },
      { location: 'San Francisco, USA', timezone: 'America/Los_Angeles' },
      { location: 'Singapore', timezone: 'Asia/Singapore' }
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return locations[Math.abs(hash) % locations.length];
  };

  const getContactRole = (name: string, email: string) => {
    const n = name.toLowerCase();
    if (n.includes('sofia') || n.includes('brant')) return 'UI/UX Lead Designer';
    if (n.includes('esther') || n.includes('howard')) return 'Director of Engineering';
    if (n.includes('amara') || n.includes('okafor')) return 'Senior Frontend Engineer';
    if (n.includes('yuki') || n.includes('tanaka')) return 'Product Manager';
    if (n.includes('li') || n.includes('wei')) return 'Cloud Architect & DevOps';
    if (n.includes('nimda') || email.includes('admin')) return 'Workspace Administrator';
    return 'Systems Engineer';
  };

  const getContactHistory = (id: string) => {
    const histories = [
      [
        { type: 'Incoming Video Call', date: 'Yesterday, 4:15 PM', duration: '14 mins' },
        { type: 'Secure E2EE File Received', date: '3 days ago' },
        { type: 'Outgoing Video Call', date: 'Last Tuesday', duration: '28 mins' }
      ],
      [
        { type: 'Video Meeting', date: 'Monday, 10:30 AM', duration: '45 mins' },
        { type: 'Outgoing Voice Call', date: 'Last Thursday', duration: '8 mins' }
      ],
      [
        { type: 'E2EE File Vault Drop', date: 'Yesterday, 11:02 AM' },
        { type: 'Incoming Call', date: 'Last Friday', duration: '19 mins' }
      ]
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return histories[Math.abs(hash) % histories.length];
  };

  useEffect(() => {
    const loadWorkspaceContacts = async () => {
      if (!userDomain) return;
      try {
        const dbProfiles = await mockAuth.getContacts(userDomain);
        if (dbProfiles) {
          const mapped: Contact[] = dbProfiles.map((p: any) => {
            const avatar = p.avatar_url || (p.name ? p.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U');
            
            // Generate a consistent HSL background color based on name/id hash
            let hash = 0;
            const nameToHash = p.name || 'User';
            for (let i = 0; i < nameToHash.length; i++) {
              hash = nameToHash.charCodeAt(i) + ((hash << 5) - hash);
            }
            const hue = Math.abs(hash % 360);
            const avatarBg = `hsl(${hue}, 60%, 40%)`;

            const meta = getContactMetadata(p.id);
            const role = getContactRole(p.name || 'User', p.email || '');
            const history = getContactHistory(p.id);

            return {
              id: p.id,
              name: p.name || 'Phone User',
              role: role,
              email: p.email || `${(p.name || 'user').toLowerCase().replace(/\s+/g, '')}@${userDomain}`,
              phone: p.phone || 'N/A',
              avatar: avatar,
              avatarBg: avatarBg,
              isStarred: false,
              status: 'Online',
              history: history,
              timezone: meta.timezone,
              location: meta.location
            };
          });
          setContacts(mapped);
          if (mapped.length > 0) {
            setSelectedContactId(mapped[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to query workspace contacts:', err);
      }
    };

    loadWorkspaceContacts();
  }, [userDomain]);

  // Real-time Presence sync with Supabase
  useEffect(() => {
    if (!currentUser || !userDomain) return;

    const channel = supabase.channel(`presence-workspace-${userDomain}`, {
      config: {
        presence: {
          key: currentUser.id,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const activeUsers: { [key: string]: string } = {};
        Object.keys(state).forEach(userId => {
          const userPresence = state[userId]?.[0] as any;
          if (userPresence) {
            activeUsers[userId] = userPresence.status || 'Online';
          }
        });
        setOnlinePresences(activeUsers);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: currentUser.id,
            name: currentUser.name,
            status: 'Online',
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, userDomain]);

  const getContactStatus = (c: Contact) => {
    if (c.id === currentUser?.id) return 'Online';
    if (onlinePresences[c.id]) {
      return onlinePresences[c.id] as 'Online' | 'Offline' | 'In a Meeting';
    }
    // Fallback status based on hashing id
    let hash = 0;
    for (let i = 0; i < c.id.length; i++) {
      hash = c.id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const val = Math.abs(hash) % 100;
    if (val < 40) return 'Online';
    if (val < 65) return 'In a Meeting';
    return 'Offline';
  };

  const getLocalTime = (timezone: string) => {
    try {
      return new Date().toLocaleTimeString([], { 
        timeZone: timezone, 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  };

  const isOffHours = (timezone: string) => {
    try {
      const formatter = new Intl.DateTimeFormat([], {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
      });
      const hour = parseInt(formatter.format(new Date()), 10);
      return hour < 8 || hour >= 19;
    } catch (e) {
      return false;
    }
  };

  // Toggle favorite/starred
  const toggleStarred = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setContacts(prev =>
      prev.map(c => (c.id === id ? { ...c, isStarred: !c.isStarred } : c))
    );
  };

  // Load Private Notes when selected contact changes
  useEffect(() => {
    if (!selectedContactId || !currentUser) return;
    const key = `giin_contact_notes_${currentUser.id}_${selectedContactId}`;
    const saved = localStorage.getItem(key);
    setContactNotes(saved || '');
  }, [selectedContactId, currentUser]);

  const handleNotesChange = (val: string) => {
    setContactNotes(val);
    if (selectedContactId && currentUser) {
      const key = `giin_contact_notes_${currentUser.id}_${selectedContactId}`;
      localStorage.setItem(key, val);
    }
  };

  // Load and fallback skills tags
  const getFallbackSkills = (role: string) => {
    const r = role.toLowerCase();
    if (r.includes('design') || r.includes('ui') || r.includes('ux')) return ['Figma', 'UI/UX Design', 'CSS Grid', 'Typography'];
    if (r.includes('engineer') || r.includes('qa') || r.includes('lead') || r.includes('developer')) return ['React', 'TypeScript', 'WebRTC', 'Supabase Realtime'];
    if (r.includes('product')) return ['Agile', 'Product Spec', 'Analytics', 'A/B Testing'];
    if (r.includes('marketing') || r.includes('growth')) return ['SEO', 'Google Analytics', 'Lead Gen', 'Content'];
    return ['Workspace Core', 'General Support'];
  };

  useEffect(() => {
    if (!selectedContactId) return;
    const saved = localStorage.getItem(`giin_contact_skills_${selectedContactId}`);
    if (saved) {
      setContactSkills(JSON.parse(saved));
    } else {
      const defaultSkills = getFallbackSkills(selectedContact?.role || 'General Workspace');
      setContactSkills(defaultSkills);
    }
  }, [selectedContactId, selectedContact]);

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newSkillTag.trim();
    if (tag && !contactSkills.includes(tag)) {
      const updated = [...contactSkills, tag];
      setContactSkills(updated);
      localStorage.setItem(`giin_contact_skills_${selectedContactId}`, JSON.stringify(updated));
      setNewSkillTag('');
    }
  };

  const handleRemoveSkill = (tagToRemove: string) => {
    const updated = contactSkills.filter(t => t !== tagToRemove);
    setContactSkills(updated);
    localStorage.setItem(`giin_contact_skills_${selectedContactId}`, JSON.stringify(updated));
  };

  // Scheduler Confirm
  const handleConfirmSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledDate || !scheduledTime || !selectedContactId || !currentUser || !selectedContact) {
      showToast('Please select a date and time slot.');
      return;
    }

    try {
      // 1. Create meeting in Database
      const meetingId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' 
        ? crypto.randomUUID() 
        : Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
      
      const passcode = Math.random().toString(36).substr(2, 6).toUpperCase();
      
      const dbMeet = {
        id: meetingId,
        user_id: currentUser.id,
        title: meetingAgenda.trim() || `Meeting with ${selectedContact.name}`,
        time: new Date(`${scheduledDate}T${convertTimeTo24h(scheduledTime)}`).toISOString(),
        duration: '30 mins',
        status: 'Scheduled' as const,
        host: currentUser.name,
        passcode,
        admin_id: currentUser.id
      };

      // Create meeting in Supabase
      await supabase.from('meetings').insert([dbMeet]);

      // Register both current user and target contact in waitroom
      await mockAuth.joinMeetingRoom(meetingId, currentUser.name, currentUser.id, 'Admin', 'Admitted');
      await mockAuth.joinMeetingRoom(meetingId, selectedContact.name, selectedContactId, 'Participant', 'Waiting');

      // 2. Format custom invite payload
      const invitePayload = `[MEET_INVITE:${dbMeet.title}|${scheduledDate}|${scheduledTime}|${meetingId}|${passcode}]`;

      // Encrypt message for DM thread
      const dmThreadId = 'dm_' + [currentUser.id, selectedContactId].sort().join('_');
      const dbText = await encryptMessage(invitePayload, dmThreadId);

      // Send to messages
      await mockAuth.sendMessage({
        thread_id: dmThreadId,
        sender_name: currentUser.name || 'You',
        text: dbText,
        user_id: currentUser.id
      });

      showToast(`Invitation sent to ${selectedContact.name}!`);
      setShowScheduler(false);
      setMeetingAgenda('');
      setScheduledDate('');
      setScheduledTime('');
    } catch (err) {
      console.error('Failed to schedule meeting:', err);
      showToast('Error scheduling meeting.');
    }
  };

  const convertTimeTo24h = (time12h: string) => {
    const [time, modifier] = time12h.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') {
      hours = '00';
    }
    if (modifier === 'PM') {
      hours = (parseInt(hours, 10) + 12).toString();
    }
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`;
  };

  // E2EE File Upload and Drop Handlers
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (!currentUser || !selectedContactId) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processAndSendFile(files[0]);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentUser || !selectedContactId) return;
    const files = e.target.files;
    if (files && files.length > 0) {
      await processAndSendFile(files[0]);
    }
  };

  const processAndSendFile = (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;
          const filePayload = `[FILE:${file.name}|${file.type}|${base64Data}]`;
          
          const dmThreadId = 'dm_' + [currentUser.id, selectedContactId].sort().join('_');
          const dbText = await encryptMessage(filePayload, dmThreadId);

          await mockAuth.sendMessage({
            thread_id: dmThreadId,
            sender_name: currentUser.name || 'You',
            text: dbText,
            user_id: currentUser.id
          });

          showToast(`Encrypted file "${file.name}" sent to chat!`);
          resolve();
        } catch (err) {
          console.error('Failed to send file:', err);
          showToast('Failed to send encrypted file.');
          reject(err);
        }
      };
      reader.onerror = (err) => {
        showToast('Error reading file.');
        reject(err);
      };
      reader.readAsDataURL(file);
    });
  };

  const filteredContacts = contacts.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'all' || c.isStarred;
    return matchesSearch && matchesTab;
  });


  // Group by department
  const depts: { [key: string]: Contact[] } = {};
  filteredContacts.forEach(c => {
    let d = 'General Team';
    if (c.role.toLowerCase().includes('design')) d = 'Design Department';
    else if (c.role.toLowerCase().includes('lead') || c.role.toLowerCase().includes('engineer')) d = 'Engineering & QA';
    else if (c.role.toLowerCase().includes('marketing')) d = 'Marketing & Growth';
    else if (c.role.toLowerCase().includes('product')) d = 'Product Management';

    if (!depts[d]) depts[d] = [];
    depts[d].push(c);
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '320px 1fr',
      gap: '1.5rem',
      height: 'calc(100vh - 120px)',
      animation: 'slide-in var(--transition-normal)'
    }} className="grid-2">
      
      {/* Left panel: Contacts list */}
      <div className={`glass-panel ${showDetailsMobile ? 'mobile-hidden' : ''}`} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
              {userWorkspaceName}
            </h2>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-secondary)', fontWeight: 600 }}>
              @{userDomain} Directory
            </span>
          </div>
          <button 
            type="button"
            onClick={() => setShowInsights(!showInsights)}
            className={`premium-btn ${showInsights ? 'premium-btn-primary' : 'premium-btn-secondary'}`}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px', height: '28px' }}
          >
            <BarChart2 size={12} />
            <span>{showInsights ? 'Contacts' : 'Insights'}</span>
          </button>
        </div>
        
        {/* Search bar */}
        {!showInsights && (
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search name or role..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="premium-input"
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>
        )}

        {showInsights ? (
          /* Directory Insights Dashboard Panel */
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'pop-in 0.2s ease' }}>
            <div style={{ padding: '1rem', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(var(--color-secondary-rgb), 0.04)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>DIRECTORY HEALTH</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{contacts.length} Members</span>
                <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 600 }}>
                  {Math.round((contacts.filter(c => getContactStatus(c) !== 'Offline').length / (contacts.length || 1)) * 100)}% Active
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>STATUS OVERVIEW</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <div style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center', backgroundColor: 'var(--bg-card)' }}>
                  <span style={{ display: 'block', fontSize: '1rem', fontWeight: 700, color: '#10B981' }}>
                    {contacts.filter(c => getContactStatus(c) === 'Online').length}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Online</span>
                </div>
                <div style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center', backgroundColor: 'var(--bg-card)' }}>
                  <span style={{ display: 'block', fontSize: '1rem', fontWeight: 700, color: '#FABD02' }}>
                    {contacts.filter(c => getContactStatus(c) === 'In a Meeting').length}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Busy</span>
                </div>
                <div style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center', backgroundColor: 'var(--bg-card)' }}>
                  <span style={{ display: 'block', fontSize: '1rem', fontWeight: 700, color: '#94A3B8' }}>
                    {contacts.filter(c => getContactStatus(c) === 'Offline').length}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Offline</span>
                </div>
              </div>
            </div>

            {/* Department Split progress bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>TEAM DISTRIBUTION</span>
              {Object.entries(
                contacts.reduce((acc, c) => {
                  let d = 'General Team';
                  if (c.role.toLowerCase().includes('design')) d = 'Design Department';
                  else if (c.role.toLowerCase().includes('lead') || c.role.toLowerCase().includes('engineer')) d = 'Engineering & QA';
                  else if (c.role.toLowerCase().includes('marketing')) d = 'Marketing & Growth';
                  else if (c.role.toLowerCase().includes('product')) d = 'Product Management';
                  acc[d] = (acc[d] || 0) + 1;
                  return acc;
                }, {} as { [key: string]: number })
              ).map(([dept, count]) => {
                const percentage = Math.round((count / (contacts.length || 1)) * 100);
                return (
                  <div key={dept} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                      <span style={{ fontWeight: 600 }}>{dept}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{count} ({percentage}%)</span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '999px', backgroundColor: 'var(--border-color)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percentage}%`, backgroundColor: 'var(--color-primary)', borderRadius: '999px' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Timezone Split */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>TIMEZONE LOGISTICS</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                {Object.entries(
                  contacts.reduce((acc, c) => {
                    const tz = c.timezone || 'Europe/Berlin';
                    acc[tz] = (acc[tz] || 0) + 1;
                    return acc;
                  }, {} as { [key: string]: number })
                ).map(([tz, count]) => {
                  const localTimeStr = getLocalTime(tz);
                  return (
                    <div key={tz} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-card)', fontSize: '0.7rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600 }}>{tz.split('/')[1]?.replace('_', ' ') || tz}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{count} members</span>
                      </div>
                      <span style={{ fontWeight: 700, color: 'var(--color-secondary)' }}>{localTimeStr}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Star Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>
              <button 
                onClick={() => setActiveTab('all')}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'all' ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: activeTab === 'all' ? 'var(--color-primary)' : 'var(--text-muted)',
                  fontWeight: activeTab === 'all' ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                All Contacts
              </button>
              <button 
                onClick={() => setActiveTab('starred')}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'starred' ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: activeTab === 'starred' ? 'var(--color-primary)' : 'var(--text-muted)',
                  fontWeight: activeTab === 'starred' ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Starred
              </button>
            </div>

            {/* Contacts scrolling list */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {Object.keys(depts).map(deptName => (
                <div key={deptName} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <span style={{ 
                    fontSize: '0.65rem', 
                    fontWeight: 700, 
                    letterSpacing: '0.05em', 
                    color: 'var(--text-muted)', 
                    textTransform: 'uppercase',
                    paddingLeft: '0.25rem',
                    borderLeft: '2px solid var(--color-secondary)'
                  }}>
                    {deptName}
                  </span>
                  
                  {depts[deptName].map(c => (
                    <div 
                      key={c.id}
                      onClick={() => {
                        setSelectedContactId(c.id);
                        setShowDetailsMobile(true);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'between',
                        padding: '0.65rem',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: selectedContactId === c.id ? 'rgba(112, 130, 190, 0.12)' : 'transparent',
                        border: selectedContactId === c.id ? '1px solid var(--color-secondary)' : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'all var(--transition-fast)'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedContactId !== c.id) {
                          e.currentTarget.style.backgroundColor = 'rgba(112, 130, 190, 0.05)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedContactId !== c.id) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: c.avatarBg,
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 600,
                            fontSize: '0.85rem',
                            overflow: 'hidden'
                          }}>
                            {c.avatar && (c.avatar.startsWith('http') || c.avatar.startsWith('data:image')) ? (
                              <img src={c.avatar} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              c.avatar
                            )}
                          </div>
                          {/* Status indicator dot */}
                          <span style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: '9px',
                            height: '9px',
                            borderRadius: '50%',
                            backgroundColor: getContactStatus(c) === 'Online' ? '#10B981' : getContactStatus(c) === 'In a Meeting' ? '#FABD02' : '#94A3B8',
                            border: '2px solid var(--bg-card)'
                          }} />
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.role}</div>
                        </div>
                      </div>

                      <button 
                        onClick={(e) => toggleStarred(c.id, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', flexShrink: 0 }}
                      >
                        <Star size={14} fill={c.isStarred ? 'var(--color-accent)' : 'none'} color={c.isStarred ? 'var(--color-accent)' : 'var(--text-muted)'} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              {filteredContacts.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0', fontSize: '0.9rem' }}>
                  No contacts found
                </div>
              )}
            </div>
          </>
        )}
      </div>


      {/* Right panel: Contact Details */}
      {selectedContact ? (
        <div className={`glass-panel ${!showDetailsMobile ? 'mobile-hidden' : ''}`} style={{ padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem', overflowY: 'auto' }}>
          
          {/* Mobile Back Button */}
          <button
            className="mobile-only-back"
            onClick={() => setShowDetailsMobile(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-main)',
              cursor: 'pointer',
              display: 'none',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.9rem',
              fontWeight: 600,
              padding: '0.5rem 0',
              alignSelf: 'flex-start'
            }}
          >
            <ArrowLeft size={20} />
            <span>Back to Contacts</span>
          </button>
          
          {/* Header info */}
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <div style={{
              width: '90px',
              height: '90px',
              borderRadius: '24px',
              backgroundColor: selectedContact.avatarBg,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              fontWeight: 800,
              overflow: 'hidden',
              flexShrink: 0
            }}>
              {selectedContact.avatar && (selectedContact.avatar.startsWith('http') || selectedContact.avatar.startsWith('data:image')) ? (
                <img src={selectedContact.avatar} alt={selectedContact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                selectedContact.avatar
              )}
            </div>
            
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-heading)' }}>{selectedContact.name}</h2>
                <span className={`badge ${
                  getContactStatus(selectedContact) === 'Online' ? 'badge-success' :
                  getContactStatus(selectedContact) === 'In a Meeting' ? 'badge-warning' : 'badge-danger'
                }`}>
                  {getContactStatus(selectedContact)}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.25rem' }}>{selectedContact.role}</p>

              {/* Timezone display metadata */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <MapPin size={12} />
                <span>{selectedContact.location || 'Remote'}</span>
                <span style={{ margin: '0 0.25rem' }}>•</span>
                <Clock size={12} />
                <span>{selectedContact.timezone ? getLocalTime(selectedContact.timezone) : 'N/A'} ({selectedContact.timezone?.split('/')[1]?.replace('_', ' ') || 'Local'})</span>
              </div>
              {selectedContact.timezone && isOffHours(selectedContact.timezone) && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  borderRadius: '4px',
                  padding: '0.2rem 0.5rem',
                  fontSize: '0.65rem',
                  color: '#EF4444',
                  marginTop: '0.35rem',
                  fontWeight: 600
                }}>
                  <span>⚠️ OUTSIDE BUSINESS HOURS</span>
                </div>
              )}
            </div>

            <button 
              onClick={(e) => toggleStarred(selectedContact.id, e)}
              className="premium-btn premium-btn-secondary" 
              style={{ padding: '0.5rem', borderRadius: '50%' }}
            >
              <Star size={20} fill={selectedContact.isStarred ? 'var(--color-accent)' : 'none'} color={selectedContact.isStarred ? 'var(--color-accent)' : 'var(--text-muted)'} />
            </button>
          </div>

          <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />

          {/* Action Grid Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <button 
              onClick={() => onNavigateToChat(selectedContact.id)}
              className="premium-btn premium-btn-primary" 
              style={{ justifyContent: 'center', height: '46px' }}
            >
              <MessageSquare size={18} />
              <span>Send Message</span>
            </button>

            <button 
              onClick={() => onStartCall(`Call with ${selectedContact.name}`, selectedContact.id)}
              className="premium-btn premium-btn-accent" 
              style={{ justifyContent: 'center', height: '46px' }}
            >
              <Phone size={18} />
              <span>Call Video</span>
            </button>

            <button 
              type="button"
              onClick={() => {
                setShowScheduler(!showScheduler);
              }}
              className={`premium-btn ${showScheduler ? 'premium-btn-primary' : 'premium-btn-secondary'}`}
              style={{ justifyContent: 'center', height: '46px' }}
            >
              <Calendar size={18} />
              <span>{showScheduler ? 'Close Scheduler' : 'Schedule Meet'}</span>
            </button>
          </div>

          {showScheduler ? (
            /* Meeting Scheduler Form Card */
            <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'pop-in 0.2s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={20} color="var(--color-primary)" />
                <h3 style={{ fontSize: '1.05rem', fontFamily: 'var(--font-heading)', margin: 0 }}>Schedule an Encryption-Safe Meeting</h3>
              </div>

              <form onSubmit={handleConfirmSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>SELECT DATE</label>
                    <input 
                      type="date" 
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="premium-input"
                      required
                      min={new Date().toISOString().split('T')[0]}
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>TIME SLOT</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
                      {['09:00 AM', '11:30 AM', '02:00 PM', '04:15 PM'].map(slot => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setScheduledTime(slot)}
                          style={{
                            padding: '0.35rem',
                            fontSize: '0.7rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: scheduledTime === slot ? 'var(--color-primary)' : 'rgba(255,255,255,0.02)',
                            color: scheduledTime === slot ? 'white' : 'var(--text-main)',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                          }}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>MEETING AGENDA / TOPIC</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Q3 Roadmap review or UX Alignment"
                    value={meetingAgenda}
                    onChange={(e) => setMeetingAgenda(e.target.value)}
                    className="premium-input"
                    required
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button 
                    type="submit" 
                    className="premium-btn premium-btn-primary" 
                    style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', height: '36px' }}
                  >
                    Send Meeting Invitation
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setShowScheduler(false);
                      setScheduledTime('');
                      setScheduledDate('');
                      setMeetingAgenda('');
                    }}
                    className="premium-btn premium-btn-secondary" 
                    style={{ justifyContent: 'center', fontSize: '0.8rem', height: '36px' }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* Detailed Info Cards */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }} className="grid-2">
              
              {/* Contact Details Card */}
              <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-card)' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Contact Information</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Mail size={16} color="var(--text-muted)" />
                    <div>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Email Address</span>
                      <a href={`mailto:${selectedContact.email}`} style={{ fontSize: '0.9rem', color: 'var(--color-secondary)', textDecoration: 'none' }}>
                        {selectedContact.email}
                      </a>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Smartphone size={16} color="var(--text-muted)" />
                    <div>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mobile Number</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{selectedContact.phone}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Briefcase size={16} color="var(--text-muted)" />
                    <div>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Department</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{selectedContact.role?.split(' ')[0]} Department</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interaction History Card */}
              <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-card)' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', fontFamily: 'var(--font-heading)' }}>Interaction History</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {selectedContact.history.map((hist, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div style={{
                        marginTop: '0.2rem',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--color-secondary)'
                      }} />
                      <div>
                        <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>{hist.type}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {hist.date} {hist.duration && `| Duration: ${hist.duration}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Private Annotations notes */}
              <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-card)' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Lock size={16} color="var(--color-accent)" />
                  <span>Private Memo & CRM</span>
                </h3>
                <textarea 
                  value={contactNotes}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  placeholder="Write private notes, alignment details, or conversation action items here..."
                  style={{
                    width: '100%',
                    height: '100px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'rgba(0,0,0,0.15)',
                    color: 'var(--text-main)',
                    padding: '0.5rem',
                    fontSize: '0.8rem',
                    resize: 'none',
                    outline: 'none',
                    lineHeight: 1.4
                  }}
                />
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                  🔒 Invisible to others, persisted locally.
                </span>
              </div>

              {/* E2EE File Drop Box zone */}
              <div 
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleFileDrop}
                style={{
                  padding: '1.5rem',
                  border: isDraggingFile ? '2px dashed var(--color-primary)' : '2px dashed var(--border-color)',
                  borderRadius: 'var(--radius-lg)',
                  backgroundColor: isDraggingFile ? 'rgba(var(--color-primary-rgb), 0.06)' : 'var(--bg-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.15s ease',
                  cursor: 'pointer',
                  position: 'relative'
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelected} 
                  style={{ display: 'none' }} 
                />
                <Paperclip size={24} style={{ color: isDraggingFile ? 'var(--color-primary)' : 'var(--text-muted)' }} />
                <h4 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>E2EE Secure Vault Drop</h4>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 }}>
                  {isDraggingFile ? 'Drop file here to send' : 'Drag & drop file or click to upload'}
                </p>
                <span style={{ fontSize: '0.6rem', color: 'var(--color-secondary)' }}>
                  Encrypted client-side in transit
                </span>
              </div>

              {/* Skills Tags Organizer */}
              <div style={{ padding: '1.5rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--bg-card)', gridColumn: 'span 2' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Shield size={16} color="var(--color-primary)" />
                  <span>Skills & Expertise Routing</span>
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {contactSkills.map(tag => (
                    <span 
                      key={tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        backgroundColor: 'rgba(var(--color-secondary-rgb), 0.08)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '9999px',
                        padding: '0.2rem 0.6rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-main)',
                        fontWeight: 600
                      }}
                    >
                      <span>{tag}</span>
                      <button 
                        type="button" 
                        onClick={() => handleRemoveSkill(tag)}
                        style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '0.8rem', padding: 0, display: 'flex', alignItems: 'center' }}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  {contactSkills.length === 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No tags added yet.</span>
                  )}
                </div>
                
                <form onSubmit={handleAddSkill} style={{ display: 'flex', gap: '0.5rem', maxWidth: '300px' }}>
                  <input 
                    type="text" 
                    placeholder="Add tag (e.g. Figma, WebRTC)"
                    value={newSkillTag}
                    onChange={(e) => setNewSkillTag(e.target.value)}
                    className="premium-input"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', height: '28px' }}
                  />
                  <button 
                    type="submit" 
                    className="premium-btn premium-btn-primary" 
                    style={{ padding: '0 0.75rem', fontSize: '0.75rem', height: '28px', justifyContent: 'center' }}
                  >
                    <Plus size={12} />
                    <span>Add</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="glass-panel flex-center" style={{ color: 'var(--text-muted)' }}>
          Select a contact to view details.
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
    </div>
  );
};
