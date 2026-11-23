import React, { useState } from 'react';
import { Star, CheckCircle2 } from 'lucide-react';
import { giinApi } from '../supabaseClient';

// Phase D (46), feedback after every meeting: one tap, nothing more.
// A 1 to 5 star tap plus an optional one-line comment, shown when a
// meeting ends. The rating goes to the host (and to the superadmin
// analytics); there is no long survey, and nothing is asked twice:
// once sent, this widget thanks the user and stays sent.
interface MeetingFeedbackProps {
  meetingId: string;
  guestName?: string;
}

export const MeetingFeedback: React.FC<MeetingFeedbackProps> = ({ meetingId, guestName }) => {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (rating < 1 || rating > 5 || sending || sent) return;
    setSending(true);
    setError('');
    try {
      await giinApi.submitFeedback(meetingId, rating, comment.trim() || undefined, guestName);
      setSent(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save your rating. You can still go back to the dashboard.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', fontSize: '0.9rem', color: '#10B981', fontWeight: 600 }}>
        <CheckCircle2 size={18} />
        <span>Thanks for rating this meeting.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', width: '100%', maxWidth: '420px' }}>
      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'white' }}>How was this meeting?</span>
      <div style={{ display: 'flex', gap: '0.35rem' }} role="radiogroup" aria-label="Rate this meeting from 1 to 5 stars">
        {[1, 2, 3, 4, 5].map((stars) => (
          <button
            key={stars}
            type="button"
            onClick={() => setRating(stars)}
            onMouseEnter={() => setHover(stars)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${stars} star${stars === 1 ? '' : 's'}`}
            aria-checked={rating === stars}
            role="radio"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              color: (hover || rating) >= stars ? '#FABD02' : '#475569',
              transition: 'color 0.15s',
            }}
          >
            <Star size={30} fill={(hover || rating) >= stars ? '#FABD02' : 'none'} />
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={280}
            placeholder="One line, optional (what worked, or what did not)"
            className="premium-input"
            style={{ width: '100%', height: '40px', fontSize: '0.85rem' }}
          />
          <button
            onClick={submit}
            disabled={sending}
            className="premium-btn premium-btn-primary"
            style={{ height: '40px', padding: '0 1.5rem', fontSize: '0.9rem', fontWeight: 700, borderRadius: '8px', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.6 : 1 }}
          >
            {sending ? 'Sending...' : 'Send rating'}
          </button>
        </>
      )}
      {error && (
        <span style={{ fontSize: '0.8rem', color: '#FCA5A5', textAlign: 'center' }}>{error}</span>
      )}
    </div>
  );
};
