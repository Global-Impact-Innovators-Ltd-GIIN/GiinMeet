import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, ChevronUp, Bot, Send, HelpCircle } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

interface Message {
  sender: 'User' | 'Bot';
  text: string;
  time: string;
}

export const HelpCenter: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFAQIndex, setExpandedFAQIndex] = useState<number | null>(null);
  
  // Bot Chat States
  const [botMessages, setBotMessages] = useState<Message[]>([
    { sender: 'Bot', text: 'Hello! I am GIIN Bot, your virtual assistant. How can I help you today? You can ask me about upgrading to Pro, screen sharing, or security features.', time: 'Just now' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const botChatEndRef = useRef<HTMLDivElement | null>(null);

  const faqs: FAQItem[] = [
    {
      category: 'General',
      question: 'What is GIIN MEET Video Conferencing?',
      answer: 'GIIN MEET is a premium, next-generation video conferencing and virtualization platform designed for startups and high-fidelity collaboration.'
    },
    {
      category: 'Meetings',
      question: 'How do I share my screen in an active meeting?',
      answer: 'To share your screen, click the Monitor icon in the control bar at the bottom center of the active meeting room. You can simulate canvas presentation slides instantly.'
    },
    {
      category: 'Billing',
      question: 'How do I upgrade my account to Pro?',
      answer: 'Go to the Upgrade to Pro tab in the sidebar navigation, choose the tier (Pro or Enterprise), and follow the multi-step checkout wizard. Your account will be upgraded instantly.'
    },
    {
      category: 'Security',
      question: 'Are GIIN MEET video tunnels encrypted?',
      answer: 'Yes! All calls, audio feeds, and text chat channels inside GIIN MEET use end-to-end security virtualization protocols. We do not store streams on servers.'
    },
    {
      category: 'General',
      question: 'Is there a limit on meeting durations for free users?',
      answer: 'Free users can host meetings for up to 40 minutes with 100 participants. Pro users enjoy unlimited session lengths (up to 24 hours) and up to 300 participants.'
    }
  ];

  const filteredFaqs = faqs.filter(faq => 
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggleFAQ = (index: number) => {
    setExpandedFAQIndex(expandedFAQIndex === index ? null : index);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg: Message = {
      sender: 'User',
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setBotMessages(prev => [...prev, userMsg]);
    const questionText = chatInput.toLowerCase();
    setChatInput('');
    setIsBotTyping(true);

    // Simulate bot answering based on keywords
    setTimeout(() => {
      setIsBotTyping(false);
      let replyText = "I'm sorry, I didn't quite catch that. Could you please specify if you're asking about 'Pro upgrade', 'pricing', 'screen sharing', or 'security'?";

      if (questionText.includes('pro') || questionText.includes('upgrade') || questionText.includes('premium')) {
        replyText = "To upgrade, navigate to the Billing tab. We offer two premium tiers: the Pro Plan at $9.99/mo (up to 300 participants) and the Enterprise Plan at $19.99/mo (up to 1000 participants). Checkout is secure and immediate!";
      } else if (questionText.includes('screen') || questionText.includes('share') || questionText.includes('monitor')) {
        replyText = "During any active meeting, look at the bottom control bar and click the Monitor icon. This will activate a canvas-animated report presentation to simulate sharing your desktop window with other participants.";
      } else if (questionText.includes('price') || questionText.includes('cost') || questionText.includes('money')) {
        replyText = "Our pricing is transparent: Pro is $9.99/mo and Enterprise is $19.99/mo. We support Credit/Debit Cards, PayPal, and Apple/Google Pay. You can complete this via the Billing sidebar panel.";
      } else if (questionText.includes('security') || questionText.includes('private') || questionText.includes('encrypt')) {
        replyText = "All call audio/video streams use top-tier virtualization security. We establish point-to-point connections so that your team data remains completely encrypted and private.";
      } else if (questionText.includes('hello') || questionText.includes('hi') || questionText.includes('hey')) {
        replyText = "Hello! How can I help you today? Ask me anything about GIIN MEET functions or subscription billing.";
      }

      const botReply: Message = {
        sender: 'Bot',
        text: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setBotMessages(prev => [...prev, botReply]);
    }, 1500);
  };

  useEffect(() => {
    botChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [botMessages, isBotTyping]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2.5rem',
      height: 'calc(100vh - 120px)',
      animation: 'slide-in var(--transition-normal)'
    }} className="grid-2">
      
      {/* Left Column: FAQ Search & Accordion */}
      <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', marginBottom: '0.25rem' }}>Frequently Asked Questions</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Browse common user issues or use the search bar to find answers.</p>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Search FAQs..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="premium-input"
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        {/* FAQ Accordion List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredFaqs.map((faq, index) => {
            const isExpanded = expandedFAQIndex === index;
            return (
              <div 
                key={index} 
                style={{ 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-md)', 
                  backgroundColor: 'var(--bg-card)', 
                  overflow: 'hidden',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <button
                  onClick={() => handleToggleFAQ(index)}
                  style={{
                    width: '100%',
                    padding: '1rem 1.25rem',
                    background: 'none',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    color: 'var(--text-main)'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <HelpCircle size={16} color="var(--color-secondary)" />
                    <span>{faq.question}</span>
                  </span>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {isExpanded && (
                  <div style={{ 
                    padding: '0 1.25rem 1.25rem 2.25rem', 
                    fontSize: '0.85rem', 
                    color: 'var(--text-muted)', 
                    lineHeight: 1.5,
                    animation: 'slide-in 0.2s ease'
                  }}>
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
          {filteredFaqs.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
              No matches found for your query.
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Customer Service Chatbot */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Support Room Header */}
        <div style={{
          padding: '1.25rem 2rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          backgroundColor: 'rgba(var(--color-secondary-rgb), 0.05)'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            backgroundColor: 'var(--color-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white'
          }}>
            <Bot size={22} color="var(--color-accent)" />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)' }}>Customer Service Bot</h3>
            <span style={{ fontSize: '0.75rem', color: '#10B981', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Helper Bot Online</span>
            </span>
          </div>
        </div>

        {/* Messaging Area */}
        <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {botMessages.map((m, idx) => (
            <div 
              key={idx}
              style={{
                alignSelf: m.sender === 'User' ? 'flex-end' : 'flex-start',
                maxWidth: '75%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.sender === 'User' ? 'flex-end' : 'flex-start'
              }}
            >
              <div style={{
                padding: '0.65rem 0.95rem',
                borderRadius: m.sender === 'User' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                backgroundColor: m.sender === 'User' ? 'var(--color-primary)' : 'var(--bg-app)',
                color: m.sender === 'User' ? 'white' : 'var(--text-main)',
                fontSize: '0.85rem',
                lineHeight: 1.4,
                border: m.sender === 'User' ? 'none' : '1px solid var(--border-color)'
              }}>
                {m.text}
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                {m.sender} &bull; {m.time}
              </span>
            </div>
          ))}

          {/* Typing simulation */}
          {isBotTyping && (
            <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.85rem', borderRadius: '12px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Bot is typing</span>
              <div style={{ display: 'flex', gap: '2px' }}>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', animation: 'wave-animation 1s infinite' }} />
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', animation: 'wave-animation 1s infinite 0.2s' }} />
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--text-muted)', animation: 'wave-animation 1s infinite 0.4s' }} />
              </div>
            </div>
          )}

          <div ref={botChatEndRef} />
        </div>

        {/* Input Chat Tray */}
        <form onSubmit={handleSendMessage} style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.75rem' }}>
          <input 
            type="text" 
            placeholder="Ask GIIN Bot a question..." 
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            className="premium-input"
            style={{ flex: 1, borderRadius: '9999px', fontSize: '0.85rem' }}
          />
          <button type="submit" className="premium-btn premium-btn-primary" style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0, justifyContent: 'center' }}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};
