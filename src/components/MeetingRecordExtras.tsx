import React, { useEffect, useState } from 'react';
import { StickyNote, Film, Trash2, Plus } from 'lucide-react';
import { giinApi } from '../supabaseClient';

// Phase C1 (28), notes and files inside one meeting's Record panel.
//
// Two quiet sub-sections, not a wall of controls: "Notes" (shared notes
// for the meeting, add one, delete your own) and "Recordings and files"
// (register a local recording or a shared file so it can be found again).
// GiinMeet has no cloud recording, so a local recording is registered
// with its name, length and where it is kept, and the video itself stays
// on the host's device.
interface Props {
  meetingId: string;
}

export const MeetingRecordExtras: React.FC<Props> = ({ meetingId }) => {
  const [notes, setNotes] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [showFileForm, setShowFileForm] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileMinutes, setFileMinutes] = useState('');
  const [fileSizeMb, setFileSizeMb] = useState('');
  const [fileWhere, setFileWhere] = useState('');
  const [addingFile, setAddingFile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [n, f]: any[] = await Promise.all([
        giinApi.getMeetingNotes(meetingId),
        giinApi.getMeetingFiles(meetingId),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (n?.ok) setNotes(n.notes || []);
      if (f?.ok) setFiles(f.files || []);
      if (!n?.ok && !f?.ok) {
        setNote(
          n?.reason === 'NOT_CONFIGURED' || f?.reason === 'NOT_CONFIGURED'
            ? 'Notes and files need the Phase C1 database setup first (run giinmeet_phaseC1.sql).'
            : 'Notes and files could not be loaded right now.',
        );
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    const result: any = await giinApi.addMeetingNote(meetingId, newNote.trim());
    setAddingNote(false);
    if (result?.ok && result.note) {
      setNotes((prev) => [...prev, result.note]);
      setNewNote('');
      setNote(null);
    } else {
      setNote(result?.message || 'That note could not be saved.');
    }
  };

  const handleDeleteNote = async (id: string) => {
    const result: any = await giinApi.deleteMeetingNote(meetingId, id);
    if (result?.ok) setNotes((prev) => prev.filter((n) => n.id !== id));
    else setNote('That note could not be deleted.');
  };

  const handleAddFile = async () => {
    if (!fileName.trim()) return;
    setAddingFile(true);
    const mins = parseFloat(fileMinutes);
    const mb = parseFloat(fileSizeMb);
    const result: any = await giinApi.registerMeetingFile(meetingId, {
      kind: 'local-recording',
      name: fileName.trim(),
      durationSeconds: Number.isFinite(mins) && mins > 0 ? Math.round(mins * 60) : null,
      sizeBytes: Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : null,
      recordedAt: new Date().toISOString(),
      note: fileWhere.trim() || null,
    });
    setAddingFile(false);
    if (result?.ok && result.file) {
      setFiles((prev) => [result.file, ...prev]);
      setFileName('');
      setFileMinutes('');
      setFileSizeMb('');
      setFileWhere('');
      setShowFileForm(false);
      setNote(null);
    } else {
      setNote(result?.message || 'That recording could not be registered.');
    }
  };

  const handleDeleteFile = async (id: string) => {
    const result: any = await giinApi.deleteMeetingFile(meetingId, id);
    if (result?.ok) setFiles((prev) => prev.filter((f) => f.id !== id));
    else setNote('That file could not be removed.');
  };

  const fmtDuration = (secs: number | null) => {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  if (loading) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Loading notes and files…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {note && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{note}</p>}

      <div>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>NOTES</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          {notes.length === 0 && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>No notes yet. Add one below, it is shared with everyone who can read this meeting record.</p>
          )}
          {notes.map((n) => (
            <div key={n.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.8rem', lineHeight: 1.45 }}>
              <StickyNote size={14} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'pre-wrap' }}>{n.body}</span>
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#EF4444', flexShrink: 0 }}
                title="Delete this note"
                onClick={() => void handleDeleteNote(n.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note for this meeting…"
              maxLength={5000}
              rows={2}
              style={{ flex: '1 1 220px', minWidth: 0, padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem', resize: 'vertical' }}
            />
            <button
              type="button"
              className="premium-btn premium-btn-primary"
              style={{ padding: '0.5rem 0.9rem', fontSize: '0.8rem' }}
              disabled={addingNote || !newNote.trim()}
              onClick={() => void handleAddNote()}
            >
              {addingNote ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>RECORDINGS AND FILES</span>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.35rem 0 0.5rem', lineHeight: 1.5 }}>
          GiinMeet does not store cloud recordings. If you recorded this meeting on your own device,
          register it here so it can be found again.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {files.length === 0 && !showFileForm && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>No recordings or files registered for this meeting.</p>
          )}
          {files.map((f) => (
            <div key={f.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.8rem', lineHeight: 1.45 }}>
              <Film size={14} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)' }}>{f.name}</a>
                  ) : f.name}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {' '}· {f.kind === 'local-recording' ? 'Local recording' : 'File'}
                  {fmtDuration(f.duration_seconds) ? ` · ${fmtDuration(f.duration_seconds)}` : ''}
                  {fmtSize(f.size_bytes) ? ` · ${fmtSize(f.size_bytes)}` : ''}
                  {f.note ? ` · kept: ${f.note}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#EF4444', flexShrink: 0 }}
                title="Remove this entry"
                onClick={() => void handleDeleteFile(f.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {showFileForm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem' }}>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Recording file name, e.g. team-standup-2026-11-23.mp4"
                maxLength={300}
                style={{ padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min={0}
                  value={fileMinutes}
                  onChange={(e) => setFileMinutes(e.target.value)}
                  placeholder="Length (minutes)"
                  style={{ flex: '1 1 120px', minWidth: 0, padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                />
                <input
                  type="number"
                  min={0}
                  value={fileSizeMb}
                  onChange={(e) => setFileSizeMb(e.target.value)}
                  placeholder="Size (MB)"
                  style={{ flex: '1 1 120px', minWidth: 0, padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                />
              </div>
              <input
                type="text"
                value={fileWhere}
                onChange={(e) => setFileWhere(e.target.value)}
                placeholder="Where it is kept, e.g. Laptop, Videos folder (optional)"
                maxLength={500}
                style={{ padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="premium-btn premium-btn-primary"
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                  disabled={addingFile || !fileName.trim()}
                  onClick={() => void handleAddFile()}
                >
                  {addingFile ? 'Registering…' : 'Register recording'}
                </button>
                <button
                  type="button"
                  className="premium-btn premium-btn-secondary"
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                  onClick={() => setShowFileForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="premium-btn premium-btn-secondary"
              style={{ alignSelf: 'flex-start', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
              onClick={() => setShowFileForm(true)}
            >
              <Plus size={13} /> Register a local recording
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
