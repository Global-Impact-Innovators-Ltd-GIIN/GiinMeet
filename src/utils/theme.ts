// GiinMeet theme helpers — SINGLE canonical copy.
//
// These were previously duplicated in App.tsx and Settings.tsx and drifted
// apart (e.g. Settings' applyUiStyle had no minimalism/maximalism branches,
// the glass levels were backwards, the accent applier never touched
// --color-accent). Both files must import from here so a fix lands once,
// everywhere. Used by the App mount effect (persisted settings) and by
// Settings (live switching).

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.substring(0, 2), 16),
    g: parseInt(full.substring(2, 4), 16),
    b: parseInt(full.substring(4, 6), 16),
  };
};

/** Darken (negative pct) or lighten (positive pct) a #rrggbb colour. */
export const shadeHex = (hex: string, pct: number): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const f = (100 + pct) / 100;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(c(rgb.r))}${toHex(c(rgb.g))}${toHex(c(rgb.b))}`;
};

/** True when a colour is light enough that dark text reads better on it. */
export const isLightColor = (hex: string): boolean => {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  // Perceived brightness (ITU-R BT.601 weights). Gold #FABD02 scores ~186
  // (light -> dark text); brand blue #2563EB scores ~96 (dark -> white text).
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 150;
};

// ---------------------------------------------------------------------------
// Accent colour — re-themes the ENTIRE platform.
//
// Previously only --color-primary / --color-primary-hover /
// --color-primary-rgb were set, so most highlights (which use
// --color-accent, e.g. .premium-btn-accent, active nav icons, speaking
// borders, premium badges) never changed. The chosen colour now drives
// BOTH the primary and accent families, plus a darkened accent-hover and
// a luminance-derived on-accent text colour (black on light accents,
// white on dark ones) so accent buttons stay readable.
// ---------------------------------------------------------------------------

export const applyAccentColor = (primary: string, hover: string) => {
  const root = document.documentElement;
  const rgb = hexToRgb(primary);
  root.style.setProperty('--color-primary', primary);
  root.style.setProperty('--color-primary-hover', hover);
  root.style.setProperty('--color-accent', primary);
  root.style.setProperty('--color-accent-hover', shadeHex(hover || primary, -10));
  root.style.setProperty('--color-on-accent', isLightColor(primary) ? '#0B0F19' : '#FFFFFF');
  if (rgb) {
    root.style.setProperty('--color-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty('--color-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }
};

// ---------------------------------------------------------------------------
// Glassmorphism opacity levels.
//
// The old levels were backwards and weak: 'ultra-clear' was 8px blur on a
// nearly-solid 0.9/0.15 background (barely different from frosted), and
// 'frosted' removed the inline vars entirely. Levels are now distinct and
// ordered: none = solid, no blur; frosted = 12px blur, mostly opaque;
// ultra-clear = 24px blur, mostly see-through (the strongest glass look).
// ---------------------------------------------------------------------------

export type GlassLevel = 'none' | 'frosted' | 'ultra-clear';

export const applyGlassOpacity = (level: string, isDark: boolean) => {
  const root = document.documentElement;
  if (level === 'none') {
    root.style.setProperty('--glass-bg', 'var(--bg-card)');
    root.style.setProperty('--glass-border', '1px solid var(--border-color)');
    root.style.setProperty('--glass-blur', '0px');
  } else if (level === 'ultra-clear') {
    root.style.setProperty('--glass-bg', isDark ? 'rgba(18, 24, 38, 0.25)' : 'rgba(255, 255, 255, 0.25)');
    root.style.setProperty('--glass-border', isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.6)');
    root.style.setProperty('--glass-blur', '24px');
  } else {
    // frosted (default)
    root.style.setProperty('--glass-bg', isDark ? 'rgba(18, 24, 38, 0.7)' : 'rgba(255, 255, 255, 0.7)');
    root.style.setProperty('--glass-border', isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.45)');
    root.style.setProperty('--glass-blur', '12px');
  }
};

// ---------------------------------------------------------------------------
// UI style (theme effect). Sets the data-ui-style attribute (drives the
// [data-ui-style="..."] rule sets in index.css) and the inline glass /
// shadow vars the effects need. For glassmorphism it re-applies the SAVED
// glass level (localStorage giin_glass_opacity) AFTER clearing the inline
// vars — the old App mount effect applied the glass level BEFORE
// applyUiStyle, which then removed the vars and clobbered the choice on
// every reload.
// ---------------------------------------------------------------------------

export const applyUiStyle = (style: string, isDark: boolean) => {
  document.documentElement.setAttribute('data-ui-style', style);
  // Remove temporary inline properties to avoid clashing with the stylesheet rule sets
  document.documentElement.style.removeProperty('--bg-app');
  document.documentElement.style.removeProperty('--bg-sidebar');
  document.documentElement.style.removeProperty('--bg-card');
  document.documentElement.style.removeProperty('--border-color');
  document.documentElement.style.removeProperty('--radius-md');
  document.documentElement.style.removeProperty('--radius-lg');
  document.documentElement.style.removeProperty('--glass-bg');
  document.documentElement.style.removeProperty('--glass-border');
  document.documentElement.style.removeProperty('--glass-blur');
  document.documentElement.style.removeProperty('--shadow-premium');
  document.documentElement.style.removeProperty('--shadow-sm');
  document.documentElement.style.removeProperty('--shadow-md');

  if (style === 'neumorphism') {
    const shadowDark = isDark ? '#070a10' : '#b8c2d0';
    const shadowLight = isDark ? '#1d273c' : '#ffffff';
    document.documentElement.style.setProperty('--glass-bg', 'var(--bg-card)');
    document.documentElement.style.setProperty('--glass-border', 'none');
    document.documentElement.style.setProperty('--glass-blur', '0px');
    document.documentElement.style.setProperty('--shadow-premium', `8px 8px 16px ${shadowDark}, -8px -8px 16px ${shadowLight}`);
    document.documentElement.style.setProperty('--shadow-sm', `3px 3px 6px ${shadowDark}, -3px -3px 6px ${shadowLight}`);
    document.documentElement.style.setProperty('--shadow-md', `6px 6px 12px ${shadowDark}, -6px -6px 12px ${shadowLight}`);
    document.documentElement.style.setProperty('--shadow-inset', `inset 4px 4px 8px ${shadowDark}, inset -4px -4px 8px ${shadowLight}`);
  } else if (style === 'cyberpunk-glow') {
    document.documentElement.style.setProperty('--glass-bg', isDark ? '#080c16' : '#f0f4ff');
    document.documentElement.style.setProperty('--glass-border', '2px solid var(--color-primary)');
    document.documentElement.style.setProperty('--glass-blur', '0px');
    document.documentElement.style.setProperty('--shadow-premium', '0 0 15px rgba(var(--color-primary-rgb), 0.35)');
    document.documentElement.style.setProperty('--shadow-sm', '0 0 5px rgba(var(--color-primary-rgb), 0.2)');
    document.documentElement.style.setProperty('--shadow-md', '0 0 8px rgba(var(--color-primary-rgb), 0.3)');
  } else if (style === 'flat-minimal') {
    document.documentElement.style.setProperty('--glass-bg', 'var(--bg-card)');
    document.documentElement.style.setProperty('--glass-border', '1px solid var(--border-color)');
    document.documentElement.style.setProperty('--glass-blur', '0px');
    document.documentElement.style.setProperty('--shadow-premium', 'none');
    document.documentElement.style.setProperty('--shadow-sm', 'none');
    document.documentElement.style.setProperty('--shadow-md', 'none');
  } else if (style === 'glassmorphism') {
    document.documentElement.style.setProperty('--shadow-premium', isDark
      ? '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)'
      : '0 20px 25px -5px rgba(0, 32, 91, 0.08), 0 10px 10px -5px rgba(0, 32, 91, 0.04)');
    // Apply the SAVED glass level after the removeProperty() calls above,
    // so the user's blur choice survives a reload / style switch.
    const savedLevel = localStorage.getItem('giin_glass_opacity') || 'frosted';
    applyGlassOpacity(savedLevel, isDark);
  }
};

// ---------------------------------------------------------------------------
// Typography. Sets --font-heading / --font-sans AND loads the webfonts.
//
// The old loader requested EVERY family in one css2 URL — including
// Georgia, which is NOT a Google Font — so the whole request failed for
// the 'Classic Serif' pairing (Playfair Display + Georgia) and no font
// loaded at all. Now only families hosted on Google Fonts are requested;
// Georgia (a system font) is served from the local stack instead. Vars
// carry full fallback stacks, so headings/body always resolve even if the
// webfont request fails, and a global rule in index.css applies
// --font-sans to buttons/inputs/selects/textareas too (previously only
// <body> used it, so form controls kept the browser default).
// ---------------------------------------------------------------------------

const GOOGLE_FONT_FAMILIES = new Set([
  'Outfit', 'Inter', 'Playfair Display', 'Fira Code', 'Montserrat', 'Orbitron', 'Rajdhani',
  'Poppins', 'Space Grotesk', 'Lora', 'Merriweather', 'Quicksand', 'Nunito',
]);

const FONT_STACKS: Record<string, string> = {
  'Outfit': `'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Inter': `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Playfair Display': `'Playfair Display', Georgia, 'Times New Roman', serif`,
  'Georgia': `Georgia, 'Times New Roman', serif`,
  'Fira Code': `'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace`,
  'Montserrat': `'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Orbitron': `'Orbitron', 'Rajdhani', system-ui, sans-serif`,
  'Rajdhani': `'Rajdhani', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Poppins': `'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Space Grotesk': `'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Lora': `'Lora', Georgia, 'Times New Roman', serif`,
  'Merriweather': `'Merriweather', Georgia, 'Times New Roman', serif`,
  'Quicksand': `'Quicksand', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Nunito': `'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif`,
};

/** Weights each family actually ships. A weight a family does not ship
    (e.g. 500/600 for Merriweather, which only has 300/400/700/900) makes
    Google Fonts reject the WHOLE css2 request, so each family requests
    only the weights it has — see applyFont below. */
const FONT_WEIGHTS: Record<string, string> = {
  'Merriweather': '400;700',
};

const fontStack = (name: string): string =>
  FONT_STACKS[name] || `'${name}', system-ui, -apple-system, 'Segoe UI', sans-serif`;

export const applyFont = (fontFamilyHeading: string, fontFamilyBody: string) => {
  document.documentElement.style.setProperty('--font-heading', fontStack(fontFamilyHeading));
  document.documentElement.style.setProperty('--font-sans', fontStack(fontFamilyBody));
  // Request only Google-hosted families — a non-Google name (e.g. Georgia)
  // in the css2 URL fails the ENTIRE request, so it must be excluded.
  const webfonts = [fontFamilyHeading, fontFamilyBody].filter((f) => GOOGLE_FONT_FAMILIES.has(f));
  if (webfonts.length === 0) return;
  const slug = (s: string) => s.replace(/\s+/g, '-').toLowerCase();
  const fontId = `google-font-${slug(fontFamilyHeading)}-${slug(fontFamilyBody)}`;
  if (!document.getElementById(fontId)) {
    const link = document.createElement('link');
    link.id = fontId;
    link.rel = 'stylesheet';
    const families = [...new Set(webfonts)]
      .map((f) => `family=${f.replace(/\s+/g, '+')}:wght@${FONT_WEIGHTS[f] || '400;500;600;700'}`)
      .join('&');
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }
};

// ---------------------------------------------------------------------------
// Corner radius.
// ---------------------------------------------------------------------------

export const applyBorderRadius = (radius: number) => {
  document.documentElement.style.setProperty('--radius-sm', `${radius * 0.5}px`);
  document.documentElement.style.setProperty('--radius-md', `${radius}px`);
  document.documentElement.style.setProperty('--radius-lg', `${radius * 2}px`);
  document.documentElement.style.setProperty('--radius-xl', `${radius * 3}px`);
};
