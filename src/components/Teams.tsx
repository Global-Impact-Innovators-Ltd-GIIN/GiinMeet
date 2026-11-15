import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, LogOut, Clock, Play, CheckCircle2, UserPlus, AlertCircle, RefreshCw, Calendar } from 'lucide-react';
import { giinApi, generateMeetingPasscode, probeTeamsSupport, TEAMS_NOT_SET_UP_MESSAGE } from '../supabaseClient';
import type { Team, TeamMember, TeamSettings } from '../supabaseClient';
import { TIER_MAX_DURATION_MINUTES, clampDurationToTier, type PlanTier } from '../utils/tiers';

// Phase 3 (Feature 3) — Team workspaces.
// A team is a shared space: members, its own meetings, and shared
// settings. This view is the whole surface: create a team, add /
// remove members, leave or delete a team, change its shared settings,
// and schedule / join the team's meetings. The meetings themselves
// use the existing meeting engine (same LiveKit room, same waiting
// room / passcode rules) — nothing about the call is rebuilt here.
//
// Honesty rules, same as the rest of the app:
//  - A member must have a GiinMeet account: adding an email with no
//    account fails with a plain message, it never pretends it worked.
//  - Until giinmeet_phase3_teams.sql runs, this view says so plainly
//    and every team action refuses — nothing is faked locally.
//  - Only a team admin sees the member / settings controls; a plain
//    member sees the team, its meetings, and Leave. The server (RLS
//    + the token / admit routes) is the real boundary — these
//    controls are just the honest face of it.

interface TeamsProps {
  user: { id: string; email: string; name: string; domain: string } | null;
  onStartMeeting: (title?: string, dmThreadId?: string, isVideo?: boolean, existingMeetingId?: string, requireWaitingRoom?: boolean, passcode?: string | null) => void;
  // Returns true when the team meeting was scheduled (App's
  // handleAddMeeting already alerts on failure, so false means "the
  // caller already told the user").
  onScheduleTeamMeeting: (teamId: string, teamName: string, meeting: { title: string; time: string; duration: string; requireWaitingRoom?: boolean; passcode?: string | null }) => Promise<boolean>;
  // Host's plan tier — caps the duration choices. Optional: 'free'.
  planTier?: PlanTier;
}

export const Teams: React.FC<TeamsProps> = ({ user, onStartMeeting, onScheduleTeamMeeting, planTier = 'free' }) => {
  // Duration choices for a team default, capped by the admin's tier.
  // Values stay the historic display strings so settings saved before
  // tiers existed keep matching the select.
  const TEAM_DURATION_OPTIONS: { value: string; maxMinutes: number }[] = [
    { value: '30 minutes', maxMinutes: 30 },
    { value: '40m limit', maxMinutes: 40 },
    { value: '60 minutes', maxMinutes: 60 },
    { value: '90 minutes', maxMinutes: 90 },
    { value: '2 hours', maxMinutes: 120 },
    { value: '4 hours', maxMinutes: 240 },
    { value: '8 hours', maxMinutes: 480 },
    { value: 'up to 24h', maxMinutes: 1440 },
  ];
  const durationOptions = TEAM_DURATION_OPTIONS.filter((o) => o.maxMinutes <= TIER_MAX_DURATION_MINUTES[planTier]).map((o) => o.value);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const [teamMeetings, setTeamMeetings] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const [createName, setCreateName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [schedTitle, setSchedTitle] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [schedPasscodeEnabled, setSchedPasscodeEnabled] = useState(true);
  const [schedPasscode, setSchedPasscode] = useState('');

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || null;
  const isAdmin = selectedTeam?.myRole === 'admin';
  const isCreator = !!user && !!selectedTeam && selectedTeam.created_by === user.id;
  const canSchedule = !!selectedTeam && (settings?.who_can_start !== 'admin_only' || isAdmin);

  const loadTeams = useCallback(async () => {
    const list = await giinApi.getMyTeams();
    setTeams(list);
    if (list.length > 0 && !list.some((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(list[0].id);
    } else if (list.length === 0) {
      setSelectedTeamId(null);
    }
    return list;
  }, [selectedTeamId]);

  const loadTeamDetail = useCallback(async (teamId: string) => {
    const [mem, set, meets] = await Promise.all([
      giinApi.getTeamMembers(teamId),
      giinApi.getTeamSettings(teamId),
      giinApi.getMeetingsForTeam(teamId),
    ]);
    setMembers(mem);
    setSettings(set);
    setTeamMeetings(meets);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ok = await probeTeamsSupport();
      if (cancelled) return;
      setSupported(ok);
      if (ok) {
        await loadTeams();
        if (user?.domain) {
          try { setContacts((await giinApi.getContacts(user.domain)) || []); } catch (e) { /* contacts are a convenience, not a dependency */ }
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedTeamId) void loadTeamDetail(selectedTeamId);
    else { setMembers([]); setSettings(null); setTeamMeetings([]); }
  }, [selectedTeamId, loadTeamDetail]);

  const fail = (e: any, fallback: string) => {
    setNotice({ kind: 'error', text: e?.message || fallback });
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const team = await giinApi.createTeam(createName.trim());
      setCreateName('');
      const list = await loadTeams();
      setSelectedTeamId(team.id);
      if (!list.some((t) => t.id === team.id)) setTeams((prev) => [...prev, team]);
      setNotice({ kind: 'ok', text: `Team “${team.name}” created — you are its admin.` });
    } catch (err: any) {
      fail(err, 'Could not create the team.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam || !addEmail.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const added = await giinApi.addTeamMember(selectedTeam.id, addEmail.trim());
      setAddEmail('');
      await loadTeamDetail(selectedTeam.id);
      setNotice({ kind: 'ok', text: `${added.name || added.email} joined “${selectedTeam.name}”.` });
    } catch (err: any) {
      fail(err, 'Could not add the member.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (m: TeamMember) => {
    if (!selectedTeam) return;
    if (!window.confirm(`Remove ${m.name || m.email} from “${selectedTeam.name}”? They will no longer see or join the team's meetings.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await giinApi.removeTeamMember(selectedTeam.id, m.user_id);
      await loadTeamDetail(selectedTeam.id);
      setNotice({ kind: 'ok', text: `${m.name || m.email} was removed from the team.` });
    } catch (err: any) {
      fail(err, 'Could not remove the member.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!selectedTeam) return;
    if (!window.confirm(`Leave “${selectedTeam.name}”? You will no longer see or join its meetings.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await giinApi.leaveTeam(selectedTeam.id);
      setNotice({ kind: 'ok', text: `You left “${selectedTeam.name}”.` });
      setSelectedTeamId(null);
      await loadTeams();
    } catch (err: any) {
      fail(err, 'Could not leave the team.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!selectedTeam) return;
    if (!window.confirm(`Delete “${selectedTeam.name}” for everyone? Its members lose access, and its past meetings become ordinary personal meetings of their hosts.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await giinApi.deleteTeam(selectedTeam.id);
      setNotice({ kind: 'ok', text: `Team “${selectedTeam.name}” deleted.` });
      setSelectedTeamId(null);
      await loadTeams();
    } catch (err: any) {
      fail(err, 'Could not delete the team.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (patch: Partial<Pick<TeamSettings, 'who_can_start' | 'default_require_waiting_room' | 'default_duration'>>) => {
    if (!selectedTeam) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await giinApi.updateTeamSettings(selectedTeam.id, patch);
      setSettings(next);
      setNotice({ kind: 'ok', text: 'Team settings saved — they apply to meetings scheduled from now on.' });
    } catch (err: any) {
      fail(err, 'Could not save the team settings.');
    } finally {
      setBusy(false);
    }
  };

  const handleScheduleTeamMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam || !schedTitle.trim() || !schedTime) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await onScheduleTeamMeeting(selectedTeam.id, selectedTeam.name, {
        title: schedTitle.trim(),
        time: new Date(schedTime).toISOString(),
        duration: clampDurationToTier(settings?.default_duration || '40m limit', planTier),
        requireWaitingRoom: settings?.default_require_waiting_room ?? true,
        passcode: schedPasscodeEnabled ? (schedPasscode || generateMeetingPasscode()) : null,
      });
      if (ok) {
        setSchedTitle('');
        setSchedTime('');
        setSchedPasscode('');
        await loadTeamDetail(selectedTeam.id);
        setNotice({ kind: 'ok', text: `Team meeting scheduled — every member of “${selectedTeam.name}” can see it on their dashboard.` });
      }
    } catch (err: any) {
      fail(err, 'Could not schedule the team meeting.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-container" style={{ flex: 1, padding: '1.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading your teams…</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={{ animation: 'slide-in var(--transition-normal)', flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={22} /> Team Workspaces
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          Shared spaces for a team — its members, its meetings, and its settings. Team meetings use the same video call as a personal meeting; only team members can see or join them.
        </p>
      </div>

      {supported === false && (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', border: '1px solid rgba(250, 189, 2, 0.4)', backgroundColor: 'rgba(250, 189, 2, 0.08)' }}>
          <p style={{ fontSize: '0.9rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <AlertCircle size={16} color="var(--color-accent)" /> {TEAMS_NOT_SET_UP_MESSAGE}
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            The Teams view is ready, but the database tables do not exist yet — so no team can be created or listed until then. Nothing here is faked.
          </p>
        </div>
      )}

      {notice && (
        <div className="glass-panel" style={{ padding: '0.85rem 1.25rem', border: `1px solid ${notice.kind === 'error' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.5)'}`, backgroundColor: notice.kind === 'error' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)' }}>
          <p style={{ fontSize: '0.9rem' }}>{notice.text}</p>
        </div>
      )}

      {/* Create a team */}
      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Create a team</h3>
        <form onSubmit={handleCreateTeam} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="premium-input"
            placeholder="Team name — e.g. GIIN Engineering"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            disabled={supported === false || busy}
            style={{ flex: 1, minWidth: '220px', height: '44px' }}
          />
          <button type="submit" className="premium-btn premium-btn-primary" disabled={supported === false || busy || !createName.trim()} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Plus size={16} /> Create team
          </button>
        </form>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>You become the team's admin. Admins add and remove members and change the team's settings.</p>
      </div>

      {supported !== false && teams.length === 0 && (
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>You are not in any team yet. Create one above, or ask a team admin to add you with your GiinMeet email.</p>
        </div>
      )}

      {teams.length > 0 && (
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Team list */}
          <div className="glass-panel" style={{ padding: '1.25rem', flex: '0 0 280px', minWidth: '240px' }}>
            <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Your teams ({teams.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {teams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTeamId(t.id)}
                  className="premium-btn premium-btn-secondary"
                  style={{
                    justifyContent: 'flex-start', textAlign: 'left', padding: '0.6rem 0.85rem', fontSize: '0.9rem',
                    backgroundColor: t.id === selectedTeamId ? 'var(--color-secondary)' : undefined,
                    color: t.id === selectedTeamId ? 'white' : undefined,
                  }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{t.myRole === 'admin' ? 'Admin' : 'Member'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected team detail */}
          {selectedTeam && (
            <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '1.15rem' }}>{selectedTeam.name}</h3>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} disabled={busy} onClick={() => void loadTeamDetail(selectedTeam.id)}>
                      <RefreshCw size={14} /> Refresh
                    </button>
                    {!isCreator && (
                      <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }} disabled={busy} onClick={() => void handleLeave()}>
                        <LogOut size={14} /> Leave team
                      </button>
                    )}
                    {isCreator && (
                      <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', color: '#FCA5A5' }} disabled={busy} onClick={() => void handleDeleteTeam()}>
                        <Trash2 size={14} /> Delete team
                      </button>
                    )}
                  </div>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  You are {isAdmin ? 'an admin' : 'a member'} of this team{isCreator ? ' (you created it)' : ''}. {members.length} member{members.length === 1 ? '' : 's'}.
                </p>

                {/* Members */}
                <h4 style={{ fontSize: '0.95rem', marginTop: '1.25rem', marginBottom: '0.5rem' }}>Members</h4>
                {members.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No members loaded.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {members.map((m) => (
                      <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.email || m.user_id}</div>
                          {m.email && m.name && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.email}</div>}
                        </div>
                        <span className={`badge ${m.role === 'admin' ? 'badge-premium' : 'badge-info'}`}>{m.role === 'admin' ? 'Admin' : 'Member'}</span>
                        {isAdmin && user?.id !== m.user_id && selectedTeam.created_by !== m.user_id && (
                          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }} disabled={busy} onClick={() => void handleRemoveMember(m)} title={`Remove ${m.name || m.email} from the team`}>
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add member (admin only) */}
                {isAdmin && (
                  <form onSubmit={handleAddMember} style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Add a member by email</label>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        className="premium-input"
                        type="email"
                        placeholder="teammate@example.com"
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                        disabled={busy}
                        style={{ flex: 1, minWidth: '220px', height: '44px' }}
                      />
                      <button type="submit" className="premium-btn premium-btn-primary" disabled={busy || !addEmail.trim()} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <UserPlus size={16} /> Add member
                      </button>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      They must already have a GiinMeet account — if the email has no account, you will be told so instead of the invite vanishing.
                      {contacts.length > 0 && ' Or pick a contact:'}
                    </p>
                    {contacts.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {contacts.filter((c: any) => c.email && !members.some((m) => m.email === c.email)).slice(0, 8).map((c: any) => (
                          <button key={c.id || c.email} type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} disabled={busy} onClick={() => setAddEmail(c.email)}>
                            {c.name || c.email}
                          </button>
                        ))}
                      </div>
                    )}
                  </form>
                )}
                {!isAdmin && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>Only a team admin can add or remove members.</p>
                )}
              </div>

              {/* Shared settings */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>Shared settings</h4>
                {settings ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '560px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600 }}>
                      Who can start meetings in this team
                      <select
                        className="premium-input"
                        value={settings.who_can_start}
                        disabled={!isAdmin || busy}
                        onChange={(e) => void handleSaveSettings({ who_can_start: e.target.value as 'any_member' | 'admin_only' })}
                        style={{ height: '44px' }}
                      >
                        <option value="any_member">Any member</option>
                        <option value="admin_only">Admins only</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', fontWeight: 600, cursor: isAdmin ? 'pointer' : 'default' }}>
                      <input
                        type="checkbox"
                        checked={settings.default_require_waiting_room}
                        disabled={!isAdmin || busy}
                        onChange={(e) => void handleSaveSettings({ default_require_waiting_room: e.target.checked })}
                      />
                      New team meetings use a waiting room by default
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 600 }}>
                      Default meeting duration
                      <select
                        className="premium-input"
                        value={clampDurationToTier(settings.default_duration, planTier)}
                        disabled={!isAdmin || busy}
                        onChange={(e) => void handleSaveSettings({ default_duration: e.target.value })}
                        style={{ height: '44px' }}
                      >
                        {durationOptions.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    {!isAdmin && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Only a team admin can change these settings.</p>}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Settings could not be loaded.</p>
                )}
              </div>

              {/* Schedule a team meeting */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>Schedule a team meeting</h4>
                {!canSchedule ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    This team only lets admins start meetings, and you are a member. Ask an admin to schedule it, or to change the setting above.
                  </p>
                ) : (
                  <form onSubmit={handleScheduleTeamMeeting} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '560px' }}>
                    <input
                      className="premium-input"
                      placeholder="Meeting title"
                      value={schedTitle}
                      onChange={(e) => setSchedTitle(e.target.value)}
                      disabled={busy}
                      style={{ height: '44px' }}
                    />
                    <input
                      className="premium-input"
                      type="datetime-local"
                      value={schedTime}
                      onChange={(e) => setSchedTime(e.target.value)}
                      disabled={busy}
                      style={{ height: '44px' }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={schedPasscodeEnabled}
                        onChange={(e) => {
                          setSchedPasscodeEnabled(e.target.checked);
                          if (e.target.checked && !schedPasscode) setSchedPasscode(generateMeetingPasscode());
                        }}
                      />
                      Protect with a passcode
                    </label>
                    {schedPasscodeEnabled && (
                      <input
                        className="premium-input"
                        value={schedPasscode}
                        onChange={(e) => setSchedPasscode(e.target.value.toUpperCase())}
                        disabled={busy}
                        placeholder="Passcode"
                        style={{ height: '44px' }}
                      />
                    )}
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Uses the team's defaults — waiting room {settings?.default_require_waiting_room ? 'on' : 'off'}, duration {settings?.default_duration || '40m limit'}. Every member sees it on their dashboard.
                    </p>
                    <div>
                      <button type="submit" className="premium-btn premium-btn-primary" disabled={busy || !schedTitle.trim() || !schedTime} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={16} /> Schedule in “{selectedTeam.name}”
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Team meetings */}
              <div className="glass-panel" style={{ padding: '1.25rem' }}>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>Team meetings ({teamMeetings.length})</h4>
                {teamMeetings.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No meetings in this team yet — schedule one above.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {teamMeetings.map((m: any) => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-card)' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: m.status === 'In Progress' ? 'rgba(16, 185, 129, 0.15)' : m.status === 'Scheduled' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(100, 116, 139, 0.1)' }}>
                          {m.status === 'Completed' ? <CheckCircle2 size={18} color="#64748B" /> : m.status === 'In Progress' ? <Play size={16} style={{ color: '#10B981' }} /> : <Clock size={18} color="#3B82F6" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {(() => { try { return new Date(m.time).toLocaleString(); } catch (e) { return m.time; } })()} &bull; {m.duration} &bull; Host: {m.host || '—'}
                          </div>
                        </div>
                        <span className={`badge ${m.status === 'Completed' ? 'badge-success' : m.status === 'In Progress' ? 'badge-premium' : 'badge-info'}`}>{m.status}</span>
                        {m.status !== 'Completed' && (
                          <button
                            type="button"
                            className="premium-btn premium-btn-accent"
                            style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', borderRadius: '4px' }}
                            onClick={() => onStartMeeting(m.title, undefined, true, m.id)}
                          >
                            {m.status === 'In Progress' ? 'Join Now' : 'Join'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
