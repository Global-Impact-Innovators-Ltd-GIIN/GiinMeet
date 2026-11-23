// Feature 17: AI noise cleaning (noise suppression) — RNNoise.
//
// What it is: the open-source RNNoise noise suppression model
// (Mozilla / Xiph.Org, BSD-3-Clause — free for commercial use, no
// server, no per-minute charge, no sign-up, no key) compiled to
// WebAssembly, run in the browser in an AudioWorklet on the
// microphone audio before it reaches LiveKit. Street noise,
// generators, busy rooms, keyboards and fans are stripped out on
// the speaker's own device, before anyone else hears them; no audio
// ever leaves the device for this. About 10 ms latency, low CPU,
// works on low-end phones.
//
// How it is wired in: the compiled model and its worklet are
// vendored in public/rnnoise/ (served by Next.js as static files,
// so they work on every deploy with no build step and no CDN):
//   /rnnoise/rnnoise.wasm        — baseline model
//   /rnnoise/rnnoise_simd.wasm   — SIMD model (used when the browser
//                                  supports WASM SIMD, which is most
//                                  modern browsers and phones)
//   /rnnoise/rnnoiseWorklet.js   — the AudioWorklet processor
// The npm package @sapphi-red/web-noise-suppressor (MIT) only
// supplies the loader + worklet node wrapper; the model itself is
// RNNoise via @shiguredo/rnnoise-wasm (Apache-2.0). Full licence
// attributions live in public/rnnoise/NOTICE.md.
//
// Rules the MeetingRoom enforces (see the chain there):
//  - Per-participant: each person controls their own mic cleaning;
//    it is ON by default and remembered per browser.
//  - Exactly one suppressor in the path at a time: while RNNoise
//    runs, the browser's own noiseSuppression is switched off on
//    the live capture (applyConstraints); when RNNoise stops or
//    cannot start, the browser suppressor is switched back on.
//  - Fail gracefully: if the model or worklet cannot load (old
//    browser, no 48 kHz audio context, missing files), the normal
//    microphone carries on with the browser's own noise reduction
//    and the UI says so in plain words — the call never breaks.
//  - RNNoise assumes a 48 kHz sample rate, so its chain runs in a
//    dedicated 48 kHz AudioContext; a device that cannot provide
//    one counts as unavailable, not as garbled audio.
//  - Audio-first modes keep it: the Phase A quality step-down and
//    the Phase B low-bandwidth mode only ever touch video — the
//    noise-cleaning chain is audio-only and stays live in both.
//
// No database change: the preference is per-browser localStorage,
// the chain is per-session in-memory, and nothing about it is
// shared with other participants or the server.

export const NOISE_SUPPRESSION_STORAGE_KEY = 'giin_noise_suppression';

// Served from public/rnnoise/ — same origin, no CDN, no key.
export const NOISE_SUPPRESSION_WORKLET_URL = '/rnnoise/rnnoiseWorklet.js';
export const NOISE_SUPPRESSION_WASM_URL = '/rnnoise/rnnoise.wasm';
export const NOISE_SUPPRESSION_WASM_SIMD_URL = '/rnnoise/rnnoise_simd.wasm';

// idle: off, or on but no mic yet. loading: the model is starting.
// active: the denoised track is what others hear. unavailable: the
// model could not start on this device — the normal mic (with the
// browser's own noise reduction) carries on.
export type NoiseSuppressionStatus = 'idle' | 'loading' | 'active' | 'unavailable';

// On by default: anything other than an explicit 'off' means on,
// so a first-time user gets clean audio without finding a setting.
export const readNoiseSuppressionPreference = (): boolean => {
  try {
    return localStorage.getItem(NOISE_SUPPRESSION_STORAGE_KEY) !== 'off';
  } catch (e) {
    return true;
  }
};

export const saveNoiseSuppressionPreference = (on: boolean): void => {
  try {
    localStorage.setItem(NOISE_SUPPRESSION_STORAGE_KEY, on ? 'on' : 'off');
  } catch (e) {
    /* storage unavailable — the in-memory toggle still works */
  }
};

// The chain needs AudioWorklet + WebAssembly in a secure context.
// (getUserMedia already requires a secure context, so this is only
// the extra worklet check — an old browser fails here, plainly.)
export const isNoiseSuppressionSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return (
    window.isSecureContext === true &&
    Boolean(w.AudioContext || w.webkitAudioContext) &&
    typeof (w as any).AudioWorkletNode !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof WebAssembly.validate === 'function'
  );
};

// The model bytes, fetched once per page load and reused for every
// mic switch / toggle — a mic change must not re-download ~150 KB.
// The package picks the SIMD build when the browser supports it.
let cachedRnnoiseBinary: ArrayBuffer | null = null;
let cachedRnnoiseBinaryPromise: Promise<ArrayBuffer> | null = null;
export const loadRnnoiseBinary = async (): Promise<ArrayBuffer> => {
  if (cachedRnnoiseBinary) return cachedRnnoiseBinary;
  if (!cachedRnnoiseBinaryPromise) {
    cachedRnnoiseBinaryPromise = (async () => {
      const { loadRnnoise } = await import('@sapphi-red/web-noise-suppressor');
      const binary = await loadRnnoise({
        url: NOISE_SUPPRESSION_WASM_URL,
        simdUrl: NOISE_SUPPRESSION_WASM_SIMD_URL,
      });
      cachedRnnoiseBinary = binary;
      return binary;
    })().catch((e) => {
      cachedRnnoiseBinaryPromise = null;
      throw e;
    });
  }
  return cachedRnnoiseBinaryPromise;
};
