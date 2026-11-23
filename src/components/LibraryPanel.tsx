import React, { useState } from 'react';
import { Library, Search } from 'lucide-react';
import { giinApi } from '../supabaseClient';

// Phase C1 (28), recordings and notes library, search.
//
// One grouped section: one search box over everything the library
// holds for this user (transcripts, summaries, notes, registered files),
// grouped by meeting. Tapping a result opens that meeting's record in
// the list below. The search runs server-side over the user's own
// meetings only.
interface Props {
  onOpenRecord: (meetingId: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  transcript: 'Transcript',
  summary: 'Summary',
  note: 'Note',
  file: 'File',
};

export const LibraryPanel: React.FC<Props> = ({ onOpenRecord }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const runSearch = async (value: string) => {
    const q = value.trim();
    setQuery(value);
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setNote(null);
      return;
    }
    setSearching(true);
    const result: any = await giinApi.searchLibrary(q);
    setSearching(false);
    setSearched(true);
    if (result?.ok) {
      setResults(result.results || []);
      setNote(null);
    } else {
      setResults([]);
      setNote(
        result?.reason === 'NO_SESSION'
          ? 'Sign in to search your library.'
          : 'Search could not run right now.',
      );
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <Library size={18} color="var(--color-accent)" />
        <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('dash.library')}</h3>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0.75rem' }}>
        {t('dash.libraryHint')}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Search size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          type="search"
          value={query}
          onChange={(e) => void runSearch(e.target.value)}
          placeholder={t('lib.search_transcripts_summaries_notes_files')}
          maxLength={200}
          aria-label={t('lib.search_the_library')}
          style={{ flex: '1 1 auto', minWidth: 0, padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
        />
      </div>
      {searching && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>Searching…</p>}
      {note && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>{note}</p>}
      {searched && !searching && !note && (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {results.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              Nothing in your library matches “{query.trim()}”.
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.meetingId}-${r.kind}-${i}`}
                type="button"
                onClick={() => onOpenRecord(r.meetingId)}
                style={{
                  display: 'block',
                  textAlign: 'left',
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{r.meetingTitle}</span>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-accent)' }}>
                    {KIND_LABEL[r.kind] || r.kind}
                  </span>
                </span>
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.45 }}>
                  {r.snippet}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
