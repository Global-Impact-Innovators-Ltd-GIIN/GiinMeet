import React, { useEffect, useState } from 'react';
import { LayoutTemplate, Play, CalendarPlus, Trash2, Plus } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

// Phase C1 (24) — meeting templates.
//
// One grouped section: save a setup once (team standup, class, client
// call) and start it in one tap, or open it in the schedule form. The
// "save" form reuses the schedule form's current values, so there is no
// second form to fill in. Three example templates are offered the first
// time, so the section is useful before the user saves anything.
export interface MeetingTemplate {
  id: string;
  name: string;
  title: string;
  duration_minutes: number;
  require_waiting_room: boolean;
  passcode: string | null;
  attendee_emails: string[];
}

interface Props {
  // Current schedule-form values, offered as the new template's setup.
  currentTitle: string;
  currentDurationMinutes: number;
  currentRequireWaitingRoom: boolean;
  currentPasscode: string | null;
  onStartTemplate: (template: MeetingTemplate) => void;
  onScheduleTemplate: (template: MeetingTemplate) => void;
}

const STARTERS: Omit<MeetingTemplate, 'id'>[] = [
  { name: 'Team standup', title: t('dash.team_standup'), duration_minutes: 30, require_waiting_room: false, passcode: null, attendee_emails: [] },
  { name: 'Class', title: 'Class', duration_minutes: 60, require_waiting_room: true, passcode: null, attendee_emails: [] },
  { name: 'Client call', title: t('dash.client_call'), duration_minutes: 60, require_waiting_room: true, passcode: null, attendee_emails: [] },
];

export const TemplatesPanel: React.FC<Props> = ({
  currentTitle,
  currentDurationMinutes,
  currentRequireWaitingRoom,
  currentPasscode,
  onStartTemplate,
  onScheduleTemplate,
}) => {
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const result: any = await giinApi.getTemplates();
    setLoading(false);
    if (result?.ok) {
      setTemplates(result.templates || []);
      setNote(null);
    } else {
      setTemplates([]);
      setNote(
        result?.reason === 'NOT_CONFIGURED'
          ? 'Templates need the Phase C1 database setup first (run giinmeet_phaseC1.sql).'
          : result?.reason === 'NO_SESSION'
            ? 'Sign in to use templates.'
            : 'Templates could not be loaded right now.',
      );
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) {
      setNote(t('tpl.give_the_template_a_name'));
      return;
    }
    setSaving(true);
    const result: any = await giinApi.saveTemplate({
      name,
      title: currentTitle.trim() || name,
      durationMinutes: currentDurationMinutes,
      requireWaitingRoom: currentRequireWaitingRoom,
      passcode: currentPasscode || null,
    });
    setSaving(false);
    if (result?.ok && result.template) {
      setTemplates((prev) => [result.template, ...prev]);
      setSaveName('');
      setShowSave(false);
      setNote(null);
    } else {
      setNote(result?.message || 'That template could not be saved.');
    }
  };

  const handleSaveStarter = async (starter: Omit<MeetingTemplate, 'id'>) => {
    setSaving(true);
    const result: any = await giinApi.saveTemplate({
      name: starter.name,
      title: starter.title,
      durationMinutes: starter.duration_minutes,
      requireWaitingRoom: starter.require_waiting_room,
      passcode: starter.passcode,
    });
    setSaving(false);
    if (result?.ok && result.template) {
      setTemplates((prev) => [result.template, ...prev]);
      setNote(null);
    } else {
      setNote(result?.message || 'That template could not be saved.');
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const result: any = await giinApi.deleteTemplate(id);
    setDeletingId(null);
    if (result?.ok) setTemplates((prev) => prev.filter((t) => t.id !== id));
    else setNote(t('tpl.that_template_could_not_be'));
  };

  const durationLabel = (mins: number) =>
    mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;

  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <LayoutTemplate size={18} color="var(--color-accent)" />
        <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0, flex: '1 1 auto' }}>
          {t('tpl.meeting_templates')}
        </h3>
        <button
          type="button"
          className="premium-btn premium-btn-secondary"
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
          onClick={() => setShowSave((v) => !v)}
        >
          <Plus size={14} /> {t('tpl.save_current_setup')}
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
        {t('tpl.save_a_setup_once_then')}
      </p>

      {showSave && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem', alignItems: 'center' }}>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={t('tpl.template_name_e_g_team')}
            maxLength={80}
            style={{ flex: '1 1 200px', minWidth: 0, padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
          />
          <button
            type="button"
            className="premium-btn premium-btn-primary"
            style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }}
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Saves “{currentTitle.trim() || 'your meeting'}”, {durationLabel(currentDurationMinutes)}
            {currentRequireWaitingRoom ? ', waiting room on' : ', waiting room off'}
            {currentPasscode ? ', with passcode' : ', no passcode'}.
          </span>
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>{t('tpl.loading_templates')}</p>
      ) : templates.length === 0 ? (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {note && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{note}</p>}
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
            {t('tpl.no_templates_yet_start_with')}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {STARTERS.map((s) => (
              <button
                key={s.name}
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                disabled={saving}
                onClick={() => void handleSaveStarter(s)}
              >
                <Plus size={13} /> {s.name} ({durationLabel(s.duration_minutes)})
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {note && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{note}</p>}
          {templates.map((t) => (
            <div
              key={t.id}
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}
            >
              <span style={{ flex: '1 1 160px', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </span>
                <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {t.title} · {durationLabel(t.duration_minutes)}
                  {t.require_waiting_room ? ' · waiting room' : ' · open entry'}
                  {t.passcode ? ' · passcode' : ''}
                </span>
              </span>
              <button
                type="button"
                className="premium-btn premium-btn-primary"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                onClick={() => onStartTemplate(t)}
              >
                <Play size={13} /> {t('tpl.start_now')}
              </button>
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                onClick={() => onScheduleTemplate(t)}
              >
                <CalendarPlus size={13} /> {t('schedule.title')}
              </button>
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: '#EF4444' }}
                disabled={deletingId === t.id}
                title={t('tpl.delete_this_template')}
                onClick={() => void handleDelete(t.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
