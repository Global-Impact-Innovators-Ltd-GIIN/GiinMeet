import React, { useState, useEffect } from 'react';
import { Search, Star, MessageSquare, Phone, Calendar, Mail, Smartphone, Briefcase, ArrowLeft } from 'lucide-react';
import { mockAuth } from '../supabaseClient';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'starred'>('all');
  const [showDetailsMobile, setShowDetailsMobile] = useState(false);
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string>('');

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

            return {
              id: p.id,
              name: p.name || 'Phone User',
              role: 'Workspace Member',
              email: p.email || `${(p.name || 'user').toLowerCase().replace(/\s+/g, '')}@${userDomain}`,
              phone: p.phone || 'N/A',
              avatar: avatar,
              avatarBg: avatarBg,
              isStarred: false,
              status: 'Online',
              history: []
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

  // Toggle favorite/starred
  const toggleStarred = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setContacts(prev =>
      prev.map(c => (c.id === id ? { ...c, isStarred: !c.isStarred } : c))
    );
  };

  const filteredContacts = contacts.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'all' || c.isStarred;
    return matchesSearch && matchesTab;
  });

  const selectedContact = contacts.find(c => c.id === selectedContactId) || contacts[0];

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
        <div>
          <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)' }}>
            {userWorkspaceName}
          </h2>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-secondary)', fontWeight: 600 }}>
            @{userDomain} Directory
          </span>
        </div>
        
        {/* Search bar */}
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
                        backgroundColor: c.status === 'Online' ? '#10B981' : c.status === 'In a Meeting' ? '#FABD02' : '#94A3B8',
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
                  selectedContact.status === 'Online' ? 'badge-success' :
                  selectedContact.status === 'In a Meeting' ? 'badge-warning' : 'badge-danger'
                }`}>
                  {selectedContact.status}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.25rem' }}>{selectedContact.role}</p>
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
              onClick={() => onNavigateToChat(selectedContact.id)} // schedules or navigates
              className="premium-btn premium-btn-secondary" 
              style={{ justifyContent: 'center', height: '46px' }}
            >
              <Calendar size={18} />
              <span>Schedule Meet</span>
            </button>
          </div>

          {/* Detailed Info Cards */}
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
                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Engineering & Design</span>
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
          </div>
        </div>
      ) : (
        <div className="glass-panel flex-center" style={{ color: 'var(--text-muted)' }}>
          Select a contact to view details.
        </div>
      )}
    </div>
  );
};
