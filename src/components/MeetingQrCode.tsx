import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '../i18n';

// Phase C2a (2), QR code join. The code is drawn on this device from
// the meeting link (the short link where one exists), with the qrcode
// library, free and offline, no provider and no key. Scanning it with
// a phone camera takes the person straight to the meeting, no typing.
// The code is drawn on a white card with a quiet zone even in dark
// mode, because a QR code needs dark marks on a light background to
// scan reliably.
interface Props {
  value: string;
  size?: number;
}

export const MeetingQrCode: React.FC<Props> = ({ value, size = 160 }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setFailed(false);
    if (!value) return;
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: { dark: '#0B0F19', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!value) return null;
  if (failed) {
    return (
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
        {t('room.qrUnavailable')}
      </p>
    );
  }
  if (!dataUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '10px',
          backgroundColor: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.8rem',
          color: '#6B7280',
        }}
      >
        {t('common.loading')}
      </div>
    );
  }
  return (
    <img
      src={dataUrl}
      alt={t('room.scanToJoin')}
      width={size}
      height={size}
      style={{ borderRadius: '10px', backgroundColor: '#FFFFFF', padding: '6px', display: 'block' }}
    />
  );
};
