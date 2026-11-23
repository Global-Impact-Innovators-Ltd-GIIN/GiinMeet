// Phase C2b, shared room tools: live notes pad, document viewer,
// interpretation panel, remote control panel, organisation badge,
// voice note recorder, translated chat text.
//
// Each piece is small and self-contained; MeetingRoom places them in
// the right panel or menu and owns the two pieces of state that other
// parts of the room need (the interpretation channel, for audio
// muting, and the remote control grant, for the LiveKit data channel).
// No em dashes in any user-facing copy here: commas and periods only.
import { useEffect, useRef, useState } from 'react';
import {
  Building2, ChevronLeft, ChevronRight, FileText, Globe, Hand, Headphones,
  Languages, Lock, Mic, Monitor, Square, StickyNote, Volume2, X,
} from 'lucide-react';
import { giinApi, supabase } from '../supabaseClient';
import { LANGUAGES, t } from '../i18n';

export const LANG_LABEL: Record<string, string> = { en: 'English', fr: 'French', rw: 'Kinyarwanda' };

// ---------------------------------------------------------------------------
// 11. Organisation badge: small and calm, never invented.
// ---------------------------------------------------------------------------
export function OrgBadge({ org }: { org?: string | null }) {
  if (!org || !org.trim()) return null;
  return (
    <span
      title={org}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '3px',
        fontSize: '0.62rem', fontWeight: 700, lineHeight: 1,
        color: '#CBD5E1', backgroundColor: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: '20px', padding: '3px 7px', marginLeft: '6px',
        maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', verticalAlign: 'middle', flexShrink: 0,
      }}
    >
      <Building2 size={10} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// 2. Shared live notes pad. Everyone types in the same page; the text
// is saved to the library when the meeting ends (or from the Save
// button). Live keystrokes travel on a Supabase broadcast channel;
// the API route is the durable copy, saved a few seconds after typing.
// ---------------------------------------------------------------------------
export function LiveNotesPad({ meetingId, myKey }: { meetingId: string; myKey: string }) {
  const [body, setBody] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [libraryState, setLibraryState] = useState('');
  const versionRef = useRef(0);
  const lastLocalEditRef = useRef(0);
  const bodyRef = useRef('');
  const saveTimerRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  bodyRef.current = body;

  useEffect(() => {
    let alive = true;
    giinApi.getNotesPad(meetingId).then((res: any) => {
      if (!alive) return;
      if (res?.ok === false && res?.reason === 'NOT_CONFIGURED') { setNotConfigured(true); setLoaded(true); return; }
      if (typeof res?.body === 'string') setBody(res.body);
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    const channel = supabase
      .channel(`live-notes-${meetingId}`)
      .on('broadcast', { event: 'notes-edit' }, (payload: any) => {
        const data = payload?.payload;
        if (!data || data.by === myKey) return;
        if (typeof data.version !== 'number' || data.version <= versionRef.current) return;
        if (Date.now() - lastLocalEditRef.current < 1000) return;
        versionRef.current = data.version;
        setBody(typeof data.body === 'string' ? data.body : '');
        setSaveState('saved');
      })
      .subscribe();
    channelRef.current = channel;
    return () => { alive = false; channelRef.current = null; try { supabase.removeChannel(channel); } catch (e) { /* ignore */ } };
  }, [meetingId, myKey]);

  const handleChange = (value: string) => {
    setBody(value);
    lastLocalEditRef.current = Date.now();
    versionRef.current += 1;
    setSaveState('unsaved');
    try {
      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast', event: 'notes-edit',
          payload: { body: value, version: versionRef.current, by: myKey },
        });
      }
    } catch (e) { /* broadcast is best effort, the API save is the durable copy */ }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('saving');
    saveTimerRef.current = setTimeout(() => {
      giinApi.saveNotesPad(meetingId, bodyRef.current).then((res: any) => {
        if (res?.ok !== false) setSaveState('saved');
      }).catch(() => { /* next edit retries */ });
    }, 2500);
  };

  const handleSaveToLibrary = async () => {
    setLibraryState('Saving to the library...');
    try {
      await giinApi.saveNotesPad(meetingId, bodyRef.current);
      const res: any = await giinApi.saveNotesToLibrary(meetingId);
      setLibraryState(res?.saved ? 'Saved to the library.' : (res?.message || 'Saved to the library.'));
    } catch (e: any) {
      setLibraryState(e?.message || 'Could not save to the library.');
    }
  };

  if (!loaded) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>{t('c2b.loading_the_shared_notes')}</p>;
  }
  if (notConfigured) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>{t('c2b.shared_notes_need_the_phase')}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <StickyNote size={15} color="var(--color-accent)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white' }}>{t('c2b.shared_notes_pad')}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {saveState === 'saving' ? 'Saving...' : saveState === 'unsaved' ? 'Typing...' : 'Saved'}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
        {t('c2b.everyone_in_the_meeting_types')}
      </p>
      <textarea
        value={body}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={t('c2b.type_the_shared_notes_here')}
        aria-label={t('c2b.shared_notes_pad_2')}
        style={{
          flex: 1, minHeight: '220px', resize: 'vertical',
          padding: '0.75rem', borderRadius: '8px',
          backgroundColor: '#090D16', border: '1px solid #1E293B',
          color: 'white', fontSize: '0.85rem', lineHeight: 1.5,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button onClick={handleSaveToLibrary} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.8rem', padding: '0.45rem 0.7rem' }}>
          {t('c2b.save_to_library_now')}
        </button>
        {libraryState && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{libraryState}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Document viewer. PDF and images; the host turns the pages and
// everyone sees the same page. Slide decks need a PDF export first.
// ---------------------------------------------------------------------------
export function DocumentViewerPanel({ meetingId, isAdmin, canTurnExtra }: { meetingId: string; isAdmin: boolean; canTurnExtra: boolean }) {
  const [doc, setDoc] = useState<any>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [turning, setTurning] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      giinApi.getDocViewer(meetingId).then((res: any) => {
        if (!alive) return;
        if (res?.ok === false && res?.reason === 'NOT_CONFIGURED') { setNotConfigured(true); return; }
        setDoc(res?.open ? res : null);
      }).catch(() => { /* keep last known state, next poll retries */ });
    };
    load();
    const interval = setInterval(load, 3000);
    return () => { alive = false; clearInterval(interval); };
  }, [meetingId]);

  const estimatePdfPages = async (url: string): Promise<number> => {
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buf);
      const matches = text.match(/\/Type\s*\/Page[^s]/g);
      return matches && matches.length > 0 ? matches.length : 1;
    } catch (e) {
      return 1;
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isPdf = ext === 'pdf';
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    if (!isPdf && !isImage) {
      setError(t('c2b.that_file_cannot_be_shown'));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError(t('c2b.that_file_is_larger_than'));
      return;
    }
    setError('');
    setUploading(true);
    try {
      const { name, path, url } = await giinApi.uploadChatFile(meetingId, file);
      const pageCount = isPdf ? await estimatePdfPages(url) : 1;
      await giinApi.openDocViewer(meetingId, path, name, isPdf ? 'pdf' : 'image', pageCount);
      const res: any = await giinApi.getDocViewer(meetingId);
      if (res?.open) setDoc(res);
    } catch (err: any) {
      setError(err?.message || 'The document could not be opened.');
    } finally {
      setUploading(false);
    }
  };

  const turnPage = async (page: number) => {
    if (!doc || turning) return;
    setTurning(true);
    try {
      const res: any = await giinApi.setDocPage(meetingId, page);
      if (res?.ok) setDoc((d: any) => d ? { ...d, currentPage: res.currentPage } : d);
    } catch (err: any) {
      setError(err?.message || 'The page could not be turned.');
    } finally {
      setTurning(false);
    }
  };

  if (notConfigured) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('c2b.the_document_viewer_needs_the')}</p>;
  }
  if (!doc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileText size={15} color="var(--color-accent)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white' }}>{t('c2b.document_viewer')}</span>
        </div>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
          {t('c2b.show_slides_or_a_pdf')}
        </p>
        {isAdmin ? (
          <label className="premium-btn premium-btn-primary" style={{ fontSize: '0.8rem', padding: '0.5rem 0.7rem', cursor: 'pointer', justifyContent: 'center' }}>
            {uploading ? 'Uploading...' : 'Open a PDF or slides'}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" onChange={handleUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
        ) : (
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('c2b.no_document_is_open_right')}</p>
        )}
        <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('c2b.slide_decks_powerpoint_keynote_need')}</p>
        {error && <p style={{ margin: 0, fontSize: '0.75rem', color: '#F87171' }}>{error}</p>}
      </div>
    );
  }

  const canTurn = isAdmin || !!doc.viewersCanTurn || canTurnExtra;
  const pageUrl = doc.kind === 'pdf' ? `${doc.url}#page=${doc.currentPage}` : doc.url;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <FileText size={15} color="var(--color-accent)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{doc.title}</span>
        {isAdmin && (
          <button onClick={() => { giinApi.closeDocViewer(meetingId).then(() => setDoc(null)).catch(() => {}); }} aria-label={t('c2b.close_document')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
            <X size={15} />
          </button>
        )}
      </div>
      <div style={{ border: '1px solid #1E293B', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#090D16', minHeight: '220px', flex: 1 }}>
        {doc.kind === 'pdf' ? (
          <iframe key={`${doc.url}#page=${doc.currentPage}`} src={pageUrl} title={doc.title} style={{ width: '100%', height: '100%', minHeight: '220px', border: 'none', backgroundColor: 'white' }} />
        ) : (
          <img src={doc.url} alt={doc.title} style={{ width: '100%', height: 'auto', display: 'block' }} />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button onClick={() => turnPage(doc.currentPage - 1)} disabled={!canTurn || doc.currentPage <= 1 || turning} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', opacity: (!canTurn || doc.currentPage <= 1) ? 0.5 : 1 }}>
          <ChevronLeft size={14} /> {t('c2b.prev')}
        </button>
        <span style={{ fontSize: '0.8rem', color: 'white', flex: 1, textAlign: 'center' }}>Page {doc.currentPage} of {doc.pageCount}</span>
        <button onClick={() => turnPage(doc.currentPage + 1)} disabled={!canTurn || doc.currentPage >= doc.pageCount || turning} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', opacity: (!canTurn || doc.currentPage >= doc.pageCount) ? 0.5 : 1 }}>
          {t('c2b.next')} <ChevronRight size={14} />
        </button>
      </div>
      {!canTurn && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('c2b.the_host_turns_the_pages')}</p>}
      {isAdmin && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!doc.viewersCanTurn}
            onChange={async (e) => {
              const res: any = await giinApi.setDocViewerAllowTurn(meetingId, e.target.checked);
              if (res?.ok) setDoc((d: any) => d ? { ...d, viewersCanTurn: e.target.checked } : d);
            }}
          />
          {t('c2b.let_viewers_turn_pages_too')}
        </label>
      )}
      {error && <p style={{ margin: 0, fontSize: '0.75rem', color: '#F87171' }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Interpretation panel. Human interpreter only, no AI service.
// ---------------------------------------------------------------------------
export interface InterpretationState {
  active: boolean;
  interpreterKey?: string;
  interpreterName?: string;
  interpreterLang?: string;
}

export function InterpretationPanel({ meetingId, isAdmin, myKey, participants, state, listenMode, onListenModeChange, onChanged }: {
  meetingId: string;
  isAdmin: boolean;
  myKey: string;
  participants: { key: string; name: string }[];
  state: InterpretationState | null;
  listenMode: 'original' | 'interpretation';
  onListenModeChange: (mode: 'original' | 'interpretation') => void;
  onChanged: () => void;
}) {
  const [pickKey, setPickKey] = useState('');
  const [pickLang, setPickLang] = useState('rw');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amInterpreter = !!state?.active && state.interpreterKey === myKey;
  const others = participants.filter((p) => p.key !== myKey);

  const handleStart = async () => {
    if (!pickKey) { setError(t('c2b.pick_who_will_interpret')); return; }
    setBusy(true);
    setError('');
    try {
      await giinApi.setInterpretation(meetingId, pickKey, pickLang);
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Interpretation could not be started.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Languages size={15} color="var(--color-accent)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white' }}>{t('c2b.live_interpretation')}</span>
      </div>
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
        {t('c2b.a_human_interpreter_speaks_on')}
      </p>
      {!state?.active ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('c2b.no_interpreter_right_now_the')}</p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'white' }}>
            {state.interpreterName} is interpreting into {LANG_LABEL[state.interpreterLang || 'rw'] || 'Kinyarwanda'}.
          </p>
          {amInterpreter ? (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-accent)' }}>
              {t('c2b.you_are_the_interpreter_you')}
            </p>
          ) : (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={() => onListenModeChange('original')}
                className="premium-btn premium-btn-secondary"
                style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '0.45rem', backgroundColor: listenMode === 'original' ? 'var(--color-primary)' : undefined, color: listenMode === 'original' ? 'white' : undefined }}
              >
                <Volume2 size={14} /> {t('c2b.original_room')}
              </button>
              <button
                onClick={() => onListenModeChange('interpretation')}
                className="premium-btn premium-btn-secondary"
                style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '0.45rem', backgroundColor: listenMode === 'interpretation' ? 'var(--color-primary)' : undefined, color: listenMode === 'interpretation' ? 'white' : undefined }}
              >
                <Headphones size={14} /> {t('c2b.interpreter')}
              </button>
            </div>
          )}
          {listenMode === 'interpretation' && !amInterpreter && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('c2b.you_hear_the_interpreter_only')}</p>
          )}
          {isAdmin && (
            <button onClick={async () => { setBusy(true); await giinApi.stopInterpretation(meetingId); onChanged(); setBusy(false); }} disabled={busy} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.8rem', padding: '0.45rem 0.7rem', alignSelf: 'flex-start' }}>
              {t('c2b.stop_interpretation')}
            </button>
          )}
        </>
      )}
      {isAdmin && !state?.active && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid #1E293B', paddingTop: '0.6rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('c2b.host_pick_an_interpreter')}</span>
          <select value={pickKey} onChange={(e) => setPickKey(e.target.value)} aria-label={t('c2b.pick_an_interpreter')} style={{ height: '30px', fontSize: '0.8rem', backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid #1E293B', borderRadius: '4px' }}>
            <option value="" style={{ color: 'black' }}>{t('c2b.choose_a_person')}</option>
            {others.map((p) => (
              <option key={p.key} value={p.key} style={{ color: 'black' }}>{p.name}</option>
            ))}
          </select>
          <select value={pickLang} onChange={(e) => setPickLang(e.target.value)} aria-label={t('c2b.interpret_into_language')} style={{ height: '30px', fontSize: '0.8rem', backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid #1E293B', borderRadius: '4px' }}>
            {Object.entries(LANG_LABEL).map(([code, label]) => (
              <option key={code} value={code} style={{ color: 'black' }}>{label}</option>
            ))}
          </select>
          <button onClick={handleStart} disabled={busy || !pickKey} className="premium-btn premium-btn-primary" style={{ fontSize: '0.8rem', padding: '0.5rem', justifyContent: 'center' }}>
            {t('c2b.start_interpretation')}
          </button>
        </div>
      )}
      {error && <p style={{ margin: 0, fontSize: '0.75rem', color: '#F87171' }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Remote control panel: ask, allow, deny, revoke. The pointer and
// key events themselves travel on the LiveKit data channel (MeetingRoom
// owns that part); this panel is the permission UI around it.
// ---------------------------------------------------------------------------
export interface RemoteControlStatus {
  requests: { id: string; controller_key: string; controller_name: string }[];
  grant: { controller_key: string; controller_name: string; sharer_key: string } | null;
}

export function RemoteControlPanel({ meetingId, myKey, sharerKey, sharerName, status, onRefresh }: {
  meetingId: string;
  myKey: string;
  sharerKey: string | null;
  sharerName: string;
  status: RemoteControlStatus | null;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [asked, setAsked] = useState(false);

  if (!sharerKey) return null;
  const amSharer = sharerKey === myKey;
  const myGrant = status?.grant && status.grant.controller_key === myKey ? status.grant : null;
  const pendingForMe = amSharer ? (status?.requests || []) : [];

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try { await fn(); onRefresh(); } catch (e: any) { setError(e?.message || 'That did not go through.'); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.6rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid #1E293B', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Monitor size={14} color="var(--color-accent)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white' }}>{t('c2b.remote_control')}</span>
      </div>
      {amSharer ? (
        <>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {status?.grant
              ? t('c2b.is_controlling_your_shared_screen', { v1: status.grant.controller_name })
              : 'Nobody is controlling your screen. You approve anyone who asks.'}
          </p>
          {pendingForMe.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'white', flex: 1 }}>{r.controller_name} asks to control your screen</span>
              <button onClick={() => act(() => giinApi.remoteControl(meetingId, 'grant', { controllerKey: r.controller_key }))} disabled={busy} className="premium-btn premium-btn-primary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}>{t('c2b.allow')}</button>
              <button onClick={() => act(() => giinApi.remoteControl(meetingId, 'deny', { controllerKey: r.controller_key }))} disabled={busy} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}>{t('c2b.deny')}</button>
            </div>
          ))}
          {status?.grant && (
            <button onClick={() => act(() => giinApi.remoteControl(meetingId, 'revoke', { controllerKey: status.grant!.controller_key }))} disabled={busy} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.8rem', padding: '0.45rem 0.6rem', alignSelf: 'flex-start' }}>
              {t('c2b.take_control_back')}
            </button>
          )}
        </>
      ) : myGrant ? (
        <>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'white', lineHeight: 1.45 }}>
            You are controlling {sharerName}&#39;s shared screen. Move your pointer over the shared screen to point, click to act on it.
          </p>
          <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('c2b.control_works_on_the_shared')}</p>
          <button onClick={() => act(() => giinApi.remoteControl(meetingId, 'revoke'))} disabled={busy} className="premium-btn premium-btn-secondary" style={{ fontSize: '0.8rem', padding: '0.45rem 0.6rem', alignSelf: 'flex-start' }}>
            {t('c2b.stop_controlling')}
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {sharerName} is sharing. With their permission, you can click and type on the shared screen from your own computer.
          </p>
          <button
            onClick={() => act(async () => { await giinApi.remoteControl(meetingId, 'request', { sharerKey }); setAsked(true); })}
            disabled={busy || asked}
            className="premium-btn premium-btn-primary"
            style={{ fontSize: '0.8rem', padding: '0.45rem 0.6rem', alignSelf: 'flex-start' }}
          >
            <Hand size={14} /> {asked ? 'Request sent, waiting for the sharer' : 'Ask to control'}
          </button>
        </>
      )}
      {error && <p style={{ margin: 0, fontSize: '0.75rem', color: '#F87171' }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 9. Voice note recorder: hold to record, up to 60 seconds. Playback is
// private, on the listener's own device only.
// ---------------------------------------------------------------------------
export function VoiceNoteButton({ meetingId, disabled, onSent }: { meetingId: string; disabled?: boolean; onSent: (note: any) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const startRef = useRef(0);

  const stopAndSend = async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }));
    });
    try { rec.stop(); } catch (e) { return; }
    const blob = await done;
    const duration = Math.min(60, Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
    if (blob.size === 0) { setError(t('c2b.nothing_was_recorded')); return; }
    setBusy(true);
    setError('');
    try {
      const req: any = await giinApi.requestVoiceNoteUpload(meetingId, blob.size, duration);
      const res = await fetch(req.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/webm' }, body: blob });
      if (!res.ok) throw new Error(t('c2b.the_voice_note_upload_did'));
      const confirmed: any = await giinApi.confirmVoiceNote(meetingId, req.storagePath, duration);
      if (confirmed?.note) onSent(confirmed.note);
    } catch (e: any) {
      setError(e?.message || 'The voice note could not be sent.');
    } finally {
      setBusy(false);
      chunksRef.current = [];
    }
  };

  const startRecording = async () => {
    if (disabled || recording || busy) return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } };
      recorderRef.current = rec;
      startRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      rec.start(250);
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startRef.current) / 1000);
        setSeconds(s);
        if (s >= 60) void stopAndSend();
      }, 500);
    } catch (e) {
      setError(t('c2b.microphone_access_is_needed_to'));
    }
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }} title={t('c2b.hold_to_record_a_voice')}>
      {recording && <span style={{ fontSize: '0.7rem', color: '#F87171', fontWeight: 700 }}>{seconds}s / 60s</span>}
      <button
        type="button"
        disabled={!!disabled || busy}
        onPointerDown={(e) => { e.preventDefault(); void startRecording(); }}
        onPointerUp={() => void stopAndSend()}
        onPointerLeave={() => { if (recording) void stopAndSend(); }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={t('c2b.hold_to_record_a_voice_2')}
        style={{
          background: recording ? '#EF4444' : '#1E293B', border: 'none', borderRadius: '4px',
          width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled || busy ? 0.6 : 1,
          flexShrink: 0, touchAction: 'none',
        }}
      >
        {recording ? <Square size={16} /> : <Mic size={16} />}
      </button>
      {error && <span style={{ fontSize: '0.7rem', color: '#F87171' }}>{error}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 4. Chat auto-translation: one message rendered in the reader's chosen
// language, with the original one tap away. Results are cached per
// message and language for the life of the page. When no translation
// server is configured the original text shows, with a plain note.
// ---------------------------------------------------------------------------
const chatTranslationCache = new Map<string, string>();
const chatTranslationFailed = new Set<string>();

export function TranslatedChatText({ messageId, text, lang, meetingId, onUnavailable }: {
  messageId?: string;
  text: string;
  lang: 'en' | 'fr' | 'rw';
  meetingId?: string;
  onUnavailable: (reason: string) => void;
}) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setTranslated(null);
    setShowOriginal(false);
    setFailed(false);
    const key = `${messageId || text}:${lang}`;
    if (chatTranslationCache.has(key)) {
      setTranslated(chatTranslationCache.get(key) || null);
      return;
    }
    if (chatTranslationFailed.has(lang)) { setFailed(true); return; }
    let alive = true;
    giinApi.translateCaption(text, 'auto', lang, meetingId).then((res: any) => {
      if (!alive) return;
      if (res?.ok && res?.translatedText) {
        chatTranslationCache.set(key, res.translatedText);
        setTranslated(res.translatedText);
      } else if (res?.sameLanguage) {
        chatTranslationCache.set(key, text);
        setTranslated(text);
      } else {
        chatTranslationFailed.add(lang);
        onUnavailable(res?.reason || 'NO_TRANSLATE_KEY');
        setFailed(true);
      }
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, text, lang]);

  if (failed || !translated || translated === text) return <>{text}</>;
  return (
    <span>
      {showOriginal ? text : translated}
      <span
        onClick={() => setShowOriginal(!showOriginal)}
        style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.65rem', color: 'var(--color-accent)', cursor: 'pointer', fontWeight: 600 }}
      >
        {showOriginal ? 'Show translation' : 'Translated, show original'}
      </span>
    </span>
  );
}

// Small lock note used wherever a private item is shown.
export function PrivateNote({ text }: { text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.65rem', color: '#FBBF24', fontWeight: 700 }}>
      <Lock size={10} /> {text}
    </span>
  );
}

export function GlobeIcon() {
  return <Globe size={14} />;
}
