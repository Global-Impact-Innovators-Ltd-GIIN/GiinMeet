import React, { useEffect, useState } from 'react';
import { Library, Award, FileText, RotateCcw } from 'lucide-react';
import { LibraryPanel } from './LibraryPanel';
import { giinApi } from '../supabaseClient';
import { t } from '../i18n';

// Phase C2a (9), Library side-panel section.
//
// One home for everything a meeting produces: recordings, notes,
// transcripts, shared files and attendance certificates. This is the
// side-panel home for feature 28 (built in C1). It takes the place of
// part of the space the Privacy Vault occupied, under the clean-design
// rule: one grouped home, search on top, certificates and recent files
// below, nothing else.
//
// States are all explicit: loading, empty when nothing is there yet,
// error with a retry.
interface CertificateFile {
  id: string;
  name: string;
  meetingTitle: string;
  created_at: string;
}

interface RecentFile {
  id: string;
  kind: string;
  name: string;
  meetingTitle: string;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  'local-recording': 'Recording',
  file: 'File',
  certificate: 'Certificate',
};

export const LibrarySection: React.FC = () => {
  const [certificates, setCertificates] = useState<CertificateFile[] | null>(null);
  const [files, setFiles] = useState<RecentFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [certRes, filesRes] = await Promise.all([
      giinApi.listCertificates(),
      giinApi.listRecentLibraryFiles(),
    ]);
    setLoading(false);
    if ((certRes as any)?.ok || (filesRes as any)?.ok) {
      setCertificates((certRes as any)?.ok ? (certRes as any).certificates || [] : []);
      setFiles((filesRes as any)?.ok ? (filesRes as any).files || [] : []);
    } else {
      setError(t('library.unavailable'));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem 2rem', maxWidth: '960px' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Library size={20} color="var(--color-accent)" />
          <h2 style={{ fontSize: '1.35rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('library.title')}</h2>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
          {t('library.hint')}
        </p>
      </div>

      <LibraryPanel
        onOpenRecord={() => {
          // The full record lives on the dashboard meeting history.
          // The search result opens it there.
          try {
            document.getElementById('meeting-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } catch (e) {
            // Scrolling is best effort.
          }
        }}
      />

      {loading && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{t('library.loading')}</p>}
      {error && (
        <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', alignItems: 'flex-start' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
          <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => void load()}>
            <RotateCcw size={13} /> {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Award size={18} color="var(--color-accent)" />
              <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('library.certificates')}</h3>
            </div>
            {!certificates || certificates.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{t('library.noCertificates')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '0.5rem' }}>
                {certificates.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {c.meetingTitle} {fmtDate(c.created_at) ? `, ${fmtDate(c.created_at)}` : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' }}>
              Certificates download from the meeting record on the dashboard.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <FileText size={18} color="var(--color-accent)" />
              <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-heading)', margin: 0 }}>{t('library.recentFiles')}</h3>
            </div>
            {!files || files.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{t('library.noFiles')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '0.5rem' }}>
                {files.map((f) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0', borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ flex: '1 1 180px', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {KIND_LABEL[f.kind] || f.kind} {f.meetingTitle ? `, ${f.meetingTitle}` : ''} {fmtDate(f.created_at) ? `, ${fmtDate(f.created_at)}` : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
