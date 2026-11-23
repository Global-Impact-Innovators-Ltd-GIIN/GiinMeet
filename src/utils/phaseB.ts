// Phase B shared helpers (features 9, 12, 14, 15, 21). Pure functions
// only — no React, no network — so they are trivially testable and the
// MeetingRoom stays the only place that touches live state.

export interface HandRaiseEntry {
  userId: string;
  name: string;
  timestamp: number;
  reason?: string | null;
}

// Feature 12: the hand-raise queue is ALWAYS in the order hands went up.
// Raises arrive over the broadcast channel, so arrival order can differ
// from raise order after a rejoin — sort by timestamp, oldest first.
export const sortHandRaiseQueue = (raises: HandRaiseEntry[]): HandRaiseEntry[] =>
  [...raises].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

export const handRaisePosition = (raises: HandRaiseEntry[], userId: string): number => {
  const sorted = sortHandRaiseQueue(raises);
  const idx = sorted.findIndex((r) => r.userId === userId);
  return idx >= 0 ? idx + 1 : 0;
};

// Feature 9: live captions run on the browser's built-in speech
// recognition (no key, no account). It only exists in Chromium-based
// browsers (and Safari); everywhere else captions simply are not
// available and the UI says so in plain words — never a technical error.
export const isCaptionEngineAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
};

// Feature 21: low-bandwidth mode. The mode is audio-first: the local
// camera goes off, the uplink steps down, and the screen share (if any)
// is republished at its low encoding. Remote video is left to LiveKit's
// adaptive streaming, which already turns it down on a weak link.
export const LOW_BANDWIDTH_LABEL = 'Low-bandwidth mode';

// Feature 15: layout cycle order for the toolbar button.
export type MeetingLayoutMode = 'grid' | 'speaker' | 'side';

export const nextLayoutMode = (mode: MeetingLayoutMode): MeetingLayoutMode =>
  mode === 'grid' ? 'speaker' : mode === 'speaker' ? 'side' : 'grid';

export const layoutModeLabel = (mode: MeetingLayoutMode): string =>
  mode === 'grid' ? 'Speaker' : mode === 'speaker' ? 'Side-by-side' : 'Grid';

export const layoutModeHint = (mode: MeetingLayoutMode): string =>
  mode === 'grid'
    ? 'Switch to Speaker view (spotlight on the speaker)'
    : mode === 'speaker'
      ? 'Switch to Side-by-side view (spotlight beside the others)'
      : 'Switch to Grid view';
