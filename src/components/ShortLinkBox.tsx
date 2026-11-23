import React, { useEffect, useState } from 'react';
import { Copy, Check, Link2, RotateCcw } from 'lucide-react';
import { giinApi } from '../supabaseClient';
import { MeetingQrCode } from './MeetingQrCode';
import { t } from '../i18n';

// Phase C2a (1 + 2), short meeting link with its QR code.
//
// One short link per meeting, created on demand and reused after that.
// The code is unguessable and resolved server-side, and the link opens
// the same join flow as the full link: a passcode gate and the waiting
// room still apply where the meeting has them. The QR code is drawn
// from the short link, so scanning it joins the same way.
//
// States are all explicit: loading while the link is fetched, a plain
// error with a retry when the database setup is missing, and the link
// plus QR code when ready.
interface Props {
  meetingId: string;
  showQr?: boolean;
}

export const ShortLinkBox: React.FC<Props> = ({ meetingId, showQr = true }) => {
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyHost, setOnlyHost] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setOnlyHost(false);
    const result: any = await giinApi.getOrCreateShortLink(meetingId);
    setLoading(false);
    if (result?.ok && result.shortUrl) {
      setShortUrl(result.shortUrl);
    } else if (result?.error === 'FORBIDDEN') {
      // A guest or admitted participant sees this box in the record
      // view: a plain note, not an error, and no retry button.
      setOnlyHost(true);
    } else if (result?.reason === 'NO_SESSION') {
      setError(t('short.sign_in_to_create_a'));
    } else if (result?.reason === 'NOT_CONFIGURED') {
      setError(t('room.shortLinkUnavailable'));
    } else {
      setError(result?.message || 'The short link could not be created right now.');
    }
  };

  useEffect(() => {
    void load();
    // Only the meeting id drives a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const handleCopy = async () => {
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Copy is best effort, the link stays visible to copy by hand.
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        padding: '0.75rem',
        borderRadius: '10px',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Link2 size={15} color="var(--color-accent)" />
        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{t('room.shortLink')}</span>
      </div>
      {loading && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('common.loading')}</p>}
      {onlyHost && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{t('short.only_host_can_create')}</p>}
      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
          <button
            type="button"
            className="premium-btn premium-btn-secondary"
            style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}
            onClick={() => void load()}
          >
            <RotateCcw size={13} /> {t('common.retry')}
          </button>
        </div>
      )}
      {!loading && !error && shortUrl && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <code
              style={{
                fontSize: '0.8rem',
                padding: '0.5rem 0.6rem',
                borderRadius: '6px',
                backgroundColor: 'rgba(255,255,255,0.05)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: '1 1 160px',
                minWidth: 0,
              }}
            >
              {shortUrl}
            </code>
            <button
              type="button"
              className="premium-btn premium-btn-secondary"
              style={{ padding: '0.4rem 0.7rem', fontSize: '0.75rem', flexShrink: 0 }}
              onClick={() => void handleCopy()}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{t('room.shortLinkHint')}</p>
          {showQr && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <MeetingQrCode value={shortUrl} size={132} />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, flex: '1 1 140px', minWidth: 0 }}>
                {t('room.scanHint')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
