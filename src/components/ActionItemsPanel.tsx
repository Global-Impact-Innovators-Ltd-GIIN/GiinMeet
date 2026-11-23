// Phase C1 (35), Action item tracker, shown in the dashboard Record
// view for one meeting.
//
// Tracked items (from the AI summary, added by hand, or carried in
// from an earlier meeting) stay open until the host marks them done.
// The host ticks the checkbox; anyone else sees the list read-only
// (the server rejects non-host writes with a plain message). When the
// Phase C1 table is not set up yet, the summary's own action items
// are shown instead as a read-only fallback, so the record never
// looks empty for a reason the user cannot see.
import React, { useEffect, useState } from 'react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

export default function ActionItemsPanel({
  meetingId,
  fallbackItems,
}: {
  meetingId: string;
  fallbackItems?: { text: string; owner?: string }[];
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[] | null>(null);
  const [notice, setNotice] = useState('');
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const res: any = await giinApi.getActionItems(meetingId);
    if (res?.ok && Array.isArray(res.items)) {
      setItems(res.items);
    } else {
      setItems(null);
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const toggle = async (item: any) => {
    const done = item.status !== 'done';
    setItems((prev) => (prev || []).map((i) => (i.id === item.id ? { ...i, status: done ? 'done' : 'open' } : i)));
    const res: any = await giinApi.toggleActionItem(item.id, done);
    if (!res?.ok) {
      setNotice(res?.message || 'Only the host can mark action items done.');
      void load();
    } else {
      setNotice('');
    }
  };

  const addItem = async () => {
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    const res: any = await giinApi.createActionItem({ meetingId, text });
    setAdding(false);
    if (!res?.ok) {
      setNotice(res?.message || 'Only the host can add action items.');
      return;
    }
    setNewText('');
    setNotice('');
    void load();
  };

  if (loading) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('act.loading_action_items')}</p>;
  }
  const openCount = (items || []).filter((i) => i.status !== 'done').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
        ACTION ITEMS{items && items.length > 0 ? t('act.open_count', { v1: openCount }) : ''}
      </span>
      {items === null || items.length === 0 ? (
        (fallbackItems || []).length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {fallbackItems.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', justifyContent: 'space-between', fontSize: '0.8rem', lineHeight: 1.45 }}>
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>{a.text}</span>
                {a.owner && a.owner !== 'Unassigned' && (
                  <span style={{ flexShrink: 0, backgroundColor: 'rgba(250,189,2,0.15)', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{a.owner}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('act.no_action_items_yet')}</p>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {items.map((item) => (
            <label key={item.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem', lineHeight: 1.45, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={item.status === 'done'}
                onChange={() => void toggle(item)}
                style={{ marginTop: '3px', flexShrink: 0 }}
              />
              <span style={{ flex: '1 1 auto', minWidth: 0, textDecoration: item.status === 'done' ? 'line-through' : 'none', opacity: item.status === 'done' ? 0.6 : 1 }}>
                {item.text}
                {item.source === 'carried' && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> {t('act.carried_in')}</span>
                )}
              </span>
              {item.owner && item.owner !== 'Unassigned' && (
                <span style={{ flexShrink: 0, backgroundColor: 'rgba(250,189,2,0.15)', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{item.owner}</span>
              )}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addItem();
            }
          }}
          placeholder={t('act.add_an_action_item')}
          style={{ flex: '1 1 auto', minWidth: 0, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
        />
        <button
          type="button"
          className="premium-btn premium-btn-secondary"
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', flexShrink: 0 }}
          disabled={adding || !newText.trim()}
          onClick={() => void addItem()}
        >
          {t('act.add')}
        </button>
      </div>
      {notice && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{notice}</p>}
    </div>
  );
}
