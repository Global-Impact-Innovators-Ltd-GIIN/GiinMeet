import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, AlertCircle } from 'lucide-react';
import { giinApi, PHASED_NOT_SET_UP_MESSAGE } from '../supabaseClient';
import { t } from '../i18n';

// Phase D (47), Organisations panel: create an organisation and set
// its brand (name, logo, colours, slogan). Only the organisation's
// owner or admin can change the brand, enforced server-side, and the
// brand then carries across its rooms, waiting room and invites, with
// a small powered by GiinMeet mark. Guests never set a brand.
type Org = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string | null;
  accentHover: string | null;
  slogan: string | null;
  role: string;
};

export const OrganisationsPanel: React.FC = () => {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [membersByOrg, setMembersByOrg] = useState<Record<string, { userId: string; email: string | null; role: string; joinedAt: string }[]>>({});
  const [membersOpenId, setMembersOpenId] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'member'>('member');
  const [draft, setDraft] = useState<{ name: string; logoUrl: string; accentColor: string; slogan: string }>({
    name: '', logoUrl: '', accentColor: '#3B82F6', slogan: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await giinApi.getMyOrganisations();
      setOrgs((list || []) as Org[]);
      setNotice(null);
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || PHASED_NOT_SET_UP_MESSAGE });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createOrg = async () => {
    if (!newName.trim() || !newSlug.trim()) {
      setNotice({ kind: 'error', text: t('org.give_the_organisation_a_name') });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await giinApi.createOrganisation(newName.trim(), newSlug.trim().toLowerCase());
      setNewName('');
      setNewSlug('');
      await load();
      setNotice({ kind: 'ok', text: t('org.organisation_created_you_are_its') });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not create the organisation.' });
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (org: Org) => {
    setEditingId(org.id);
    setDraft({
      name: org.name,
      logoUrl: org.logoUrl || '',
      accentColor: org.accentColor || '#3B82F6',
      slogan: org.slogan || '',
    });
  };

  const loadMembers = async (org: Org) => {
    if (membersOpenId === org.id) {
      setMembersOpenId('');
      return;
    }
    setMembersOpenId(org.id);
    try {
      const list = await giinApi.getOrganisationMembers(org.id);
      setMembersByOrg((prev) => ({ ...prev, [org.id]: list }));
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not load members.' });
    }
  };

  const addMember = async (org: Org) => {
    if (!newMemberEmail.trim()) {
      setNotice({ kind: 'error', text: t('org.enter_the_email_of_a') });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await giinApi.addOrganisationMember(org.id, newMemberEmail.trim(), newMemberRole);
      setNewMemberEmail('');
      const list = await giinApi.getOrganisationMembers(org.id);
      setMembersByOrg((prev) => ({ ...prev, [org.id]: list }));
      setNotice({ kind: 'ok', text: t('org.member_added', { v1: newMemberEmail.trim(), v2: newMemberRole, v3: org.name }) });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not add the member.' });
    } finally {
      setBusy(false);
    }
  };

  const saveBrand = async (org: Org) => {
    setBusy(true);
    setNotice(null);
    try {
      await giinApi.updateOrganisationBrand(org.id, {
        name: draft.name.trim() || undefined,
        logoUrl: draft.logoUrl.trim() || null,
        accentColor: draft.accentColor.trim() || undefined,
        slogan: draft.slogan.trim() || null,
      });
      setEditingId('');
      await load();
      setNotice({ kind: 'ok', text: t('org.brand_saved_for_its_waiting', { v1: org.name }) });
    } catch (e: any) {
      setNotice({ kind: 'error', text: e?.message || 'Could not save the brand.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Building2 size={18} /> {t('org.organisations')}
      </h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
        {t('org.your_clients_see_their_own')}
      </p>
      {notice && (
        <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem', color: notice.kind === 'error' ? '#FCA5A5' : '#6EE7B7', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {notice.kind === 'error' && <AlertCircle size={15} />} {notice.text}
        </p>
      )}
      {loading ? (
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('org.loading_your_organisations')}</p>
      ) : (
        <>
          {orgs.length === 0 ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('org.no_organisation_yet_create_one')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
              {orgs.map((org) => {
                const canEdit = org.role === 'owner' || org.role === 'admin';
                const editing = editingId === org.id;
                return (
                  <div key={org.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {org.logoUrl ? (
                        <img src={org.logoUrl} alt={`${org.name} logo`} style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '6px' }} />
                      ) : (
                        <span style={{ width: '32px', height: '32px', borderRadius: '6px', background: org.accentColor || '#3B82F6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem' }}>
                          {org.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{org.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {org.slug} · {org.role}{org.slogan ? ` · ${org.slogan}` : ''}
                        </div>
                      </div>
                      {canEdit && !editing && (
                        <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem' }} disabled={busy} onClick={() => startEditing(org)}>
                          {t('org.edit_brand')}
                        </button>
                      )}
                    </div>
                    {editing && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.75rem', maxWidth: '560px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600 }}>
                          {t('org.name')}
                          <input className="premium-input" value={draft.name} disabled={busy} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ height: '40px' }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600 }}>
                          {t('org.logo_url')}
                          <input className="premium-input" type="url" value={draft.logoUrl} disabled={busy} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="https://.../logo.png" style={{ height: '40px' }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600 }}>
                          {t('org.accent_colour')}
                          <input
                            type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(draft.accentColor) ? draft.accentColor : '#3B82F6'}
                            disabled={busy}
                            onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
                            style={{ width: '56px', height: '36px', padding: 0, border: '1px solid var(--border-color)', borderRadius: '6px', background: 'none', cursor: 'pointer' }}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 600 }}>
                          {t('org.slogan')}
                          <input className="premium-input" value={draft.slogan} disabled={busy} onChange={(e) => setDraft({ ...draft, slogan: e.target.value })} placeholder={t('org.one_line_under_the_name')} style={{ height: '40px' }} />
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="premium-btn premium-btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }} disabled={busy} onClick={() => void saveBrand(org)}>
                            {t('org.save_brand')}
                          </button>
                          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }} disabled={busy} onClick={() => setEditingId('')}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                    {canEdit && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                        <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem' }} disabled={busy} onClick={() => void loadMembers(org)}>
                          {membersOpenId === org.id ? 'Hide members' : `Members (${(membersByOrg[org.id] || []).length || '…'})`}
                        </button>
                        {membersOpenId === org.id && (
                          <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {(membersByOrg[org.id] || []).length === 0 ? (
                              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{t('org.no_members_listed_yet')}</p>
                            ) : (
                              membersByOrg[org.id].map((m) => (
                                <div key={m.userId} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem' }}>
                                  <span style={{ wordBreak: 'break-all' }}>{m.email || m.userId}</span>
                                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{m.role}</span>
                                </div>
                              ))
                            )}
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                              <input
                                className="premium-input"
                                type="email"
                                value={newMemberEmail}
                                disabled={busy}
                                onChange={(e) => setNewMemberEmail(e.target.value)}
                                placeholder={t('org.member_email_com_must_already')}
                                style={{ height: '40px', flex: '2 1 220px' }}
                              />
                              <select className="premium-input" value={newMemberRole} disabled={busy} onChange={(e) => setNewMemberRole(e.target.value as 'admin' | 'member')} style={{ height: '40px', flex: '0 1 120px' }}>
                                <option value="member">{t('org.member')}</option>
                                <option value="admin">{t('org.admin')}</option>
                              </select>
                              <button type="button" className="premium-btn premium-btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }} disabled={busy} onClick={() => void addMember(org)}>
                                {t('org.add_member')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '560px', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '0.95rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Plus size={15} /> {t('org.create_an_organisation')}
            </h4>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                className="premium-input"
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('org.organisation_name_e_g_kigali')}
                style={{ height: '44px', flex: '2 1 220px' }}
              />
              <input
                className="premium-input"
                value={newSlug}
                disabled={busy}
                onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder={t('org.short_name_e_g_kigali')}
                style={{ height: '44px', flex: '1 1 160px' }}
              />
              <button type="button" className="premium-btn premium-btn-primary" disabled={busy} onClick={() => void createOrg()} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t('org.the_short_name_is_3')}
            </span>
          </div>
        </>
      )}
    </div>
  );
};
