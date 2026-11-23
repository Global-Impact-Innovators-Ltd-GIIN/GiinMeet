import React from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGES, t, useUiLanguage } from '../i18n';

// Phase C2a (3), the language switch. One control, in the app header:
// the person picks English, French or Kinyarwanda and the entire
// interface changes at once. The choice is stored on this device.
export const LanguageSwitcher: React.FC = () => {
  const { lang, setLang } = useUiLanguage();
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.35rem 0.6rem',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-card)',
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        cursor: 'pointer',
        flexShrink: 0,
      }}
      title={t('common.language')}
    >
      <Languages size={15} color="var(--text-muted)" />
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }} className="hide-mobile-text">
        {t('common.language')}
      </span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as 'en' | 'fr' | 'rw')}
        aria-label={t('common.language')}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
          outline: 'none',
          maxWidth: '130px',
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );
};
