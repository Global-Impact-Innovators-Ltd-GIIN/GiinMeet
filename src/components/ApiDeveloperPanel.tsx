import React, { useState, useEffect, useCallback } from 'react';
import { KeyRound, Webhook, Plus, Trash2, Copy, Check, RefreshCw, AlertCircle } from 'lucide-react';
import { giinApi, PHASED_NOT_SET_UP_MESSAGE } from '../supabaseClient';

// Phase D (42), Developer panel: API keys and webhooks, in the
// dashboard. A key is shown exactly once, at creation, then never
// again, so the panel keeps the new key on screen until the user
// copies it. A webhook secret is the same: shown once, then gone.
// Full documentation lives in docs/API.md, linked below.
const WEBHOOK_EVENT_OPTIONS = ['meeting.created', 'meeting.started', 'meeting.ended'];

export const ApiDeveloperPanel: React.FC = () => {
  const [keys, setKeys] = useState<{ id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[]>([]);
  const [webhooks, setWebhooks] = useState<{ id: string; url: string; events: string[]; active: boolean; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [copied, setCopied] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([...WEBHOOK_EVENT_OPTIONS]);
  const [newSecret, setNewSecret] = useState('');
  const [deliveries, setDeliveries] = useState<{ id: string; meeting_id: string | null; event: string; status_code: number | null; ok: boolean; attempted_at: string }[]>([]);
  const [deliveriesFor, setDeliveriesFor] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, w] = await Promise.all([giinApi.getApiKeys(), giinApi.getWebhooks()]);
      setKeys(k);
      setWebhooks(w);
      setNotice(null);
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || PHASED_NOT_SET_UP_MESSAGE });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    } catch (e) { /* clipboard unavailable */ }
  };

  const createKey = async () => {
    setNotice(null);
    try {
      const data = await giinApi.createApiKey(newKeyName.trim() || 'GiinMeet API key');
      setNewKeyValue(data.key);
      setNewKeyName('');
      await load();
      setNotice({ kind: 'ok', text: 'Key created. Copy it now, it will never be shown again.' });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not create the key.' });
    }
  };

  const createWebhook = async () => {
    setNotice(null);
    try {
      const data = await giinApi.createWebhook(webhookUrl.trim(), webhookEvents);
      setNewSecret(data.secret);
      setWebhookUrl('');
      await load();
      setNotice({ kind: 'ok', text: 'Webhook created. Copy the secret now, it will never be shown again.' });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not create the webhook.' });
    }
  };

  const showDeliveries = async (webhookId: string) => {
    if (deliveriesFor === webhookId) { setDeliveriesFor(''); setDeliveries([]); return; }
    try {
      const rows = await giinApi.getWebhookDeliveries(webhookId);
      setDeliveries(rows);
      setDeliveriesFor(webhookId);
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not load deliveries.' });
    }
  };

  const inputStyle: React.CSSProperties = {
    height: '40px', padding: '0 0.75rem', borderRadius: '8px',
    border: '1px solid var(--border-color)', background: 'var(--bg-app)',
    color: 'var(--text-main)', fontSize: '0.9rem', fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <KeyRound size={18} color="var(--color-accent)" />
        <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)', fontFamily: 'var(--font-heading)' }}>Developer: API keys and webhooks</h3>
        <button
          onClick={() => void load()}
          disabled={loading}
          title="Refresh"
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Let other apps create GiinMeet meetings automatically. Keys are secret: keep them on a server, never in a web page or a mobile app. Webhooks tell your server when a meeting is created, started, or ended. Full guide: docs/API.md in the repo.
      </p>

      {notice && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: notice.kind === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', border: `1px solid ${notice.kind === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'}`, color: notice.kind === 'error' ? '#FCA5A5' : '#6EE7B7' }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{notice.text}</span>
        </div>
      )}

      {loading ? (
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading keys and webhooks...</p>
      ) : (
        <>
          {/* API keys */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>API keys</h4>
            {newKeyValue && (
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.4)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6EE7B7' }}>Your new key (shown once, copy it now):</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <code style={{ flex: 1, fontSize: '0.8rem', wordBreak: 'break-all', color: 'var(--text-main)' }}>{newKeyValue}</code>
                  <button onClick={() => void copyText(newKeyValue, 'key')} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-main)', cursor: 'pointer', padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                    {copied === 'key' ? <Check size={14} /> : <Copy size={14} />} {copied === 'key' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                maxLength={60}
                placeholder="Key name, for example School website"
                style={{ ...inputStyle, flex: '1 1 220px' }}
              />
              <button onClick={() => void createKey()} className="premium-btn premium-btn-primary" style={{ height: '40px', padding: '0 1rem', fontSize: '0.85rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={15} /> Create key
              </button>
            </div>
            {keys.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No API keys yet.</p>
            ) : (
              keys.map((k) => (
                <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <code style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>{k.key_prefix}...</code>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 600 }}>{k.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {k.revoked_at ? 'Revoked' : k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'Never used'}
                  </span>
                  {!k.revoked_at && (
                    <button
                      onClick={async () => { if (confirm(`Revoke the key "${k.name}"? Apps using it will stop working at once.`)) { await giinApi.revokeApiKey(k.id); await load(); } }}
                      style={{ marginLeft: 'auto', background: 'rgba(239,68,68,0.1)', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <Trash2 size={13} /> Revoke
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Webhooks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>Webhooks</h4>
            {newSecret && (
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.4)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6EE7B7' }}>Your webhook secret (shown once, copy it now):</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <code style={{ flex: 1, fontSize: '0.8rem', wordBreak: 'break-all', color: 'var(--text-main)' }}>{newSecret}</code>
                  <button onClick={() => void copyText(newSecret, 'secret')} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-main)', cursor: 'pointer', padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}>
                    {copied === 'secret' ? <Check size={14} /> : <Copy size={14} />} {copied === 'secret' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                maxLength={500}
                placeholder="https://your-server.example.com/giinmeet-events"
                style={{ ...inputStyle, flex: '1 1 260px' }}
              />
              <button onClick={() => void createWebhook()} className="premium-btn premium-btn-primary" style={{ height: '40px', padding: '0 1rem', fontSize: '0.85rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Webhook size={15} /> Add webhook
              </button>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {WEBHOOK_EVENT_OPTIONS.map((ev) => (
                <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={webhookEvents.includes(ev)}
                    onChange={(e) => setWebhookEvents((prev) => e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev))}
                  />
                  {ev}
                </label>
              ))}
            </div>
            {webhooks.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>No webhooks yet.</p>
            ) : (
              webhooks.map((w) => (
                <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.6rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 600, wordBreak: 'break-all' }}>{w.url}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{w.events.join(', ')}</span>
                    <button onClick={() => void showDeliveries(w.id)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-main)', cursor: 'pointer', padding: '0.3rem 0.6rem', fontSize: '0.75rem', fontWeight: 600 }}>
                      {deliveriesFor === w.id ? 'Hide deliveries' : 'Deliveries'}
                    </button>
                    <button
                      onClick={async () => { if (confirm('Delete this webhook? GiinMeet will stop sending it events.')) { await giinApi.deleteWebhook(w.id); await load(); } }}
                      style={{ background: 'rgba(239,68,68,0.1)', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                  {deliveriesFor === w.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingLeft: '0.25rem' }}>
                      {deliveries.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No deliveries yet.</span>
                      ) : (
                        deliveries.map((d) => (
                          <span key={d.id} style={{ fontSize: '0.8rem', color: d.ok ? '#6EE7B7' : '#FCA5A5' }}>
                            {d.ok ? 'Delivered' : 'Failed'} {d.event} {d.status_code ? `(HTTP ${d.status_code})` : ''} at {new Date(d.attempted_at).toLocaleString()}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
