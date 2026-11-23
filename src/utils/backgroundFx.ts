// Phase B (16): blur and virtual backgrounds — real background
// segmentation in the browser, not a CSS blur over the whole video.
//
// How it works: the local camera track is fed through MediaPipe Selfie
// Segmentation (loaded at runtime from the jsDelivr CDN — no new npm
// dependency, no key, no account). Each frame is composited on a canvas:
// the person stays sharp and the background is either blurred or replaced
// with the GIIN branded backdrop. The canvas stream is published as the
// camera track, so everyone else in the room sees the effect.
//
// The camera must never go black because of an effect, so a session
// only starts after proof, not on hope:
//   1. The source video must be ready (real dimensions, frames flowing)
//      before the first frame is sent to the model. play() alone can
//      resolve before the first frame arrives, and sending an empty
//      video to the model produces no results at all, which used to
//      publish a black canvas track while the room showed
//      "Background blur is on".
//   2. startBackgroundFx resolves only after the first frame has been
//      composited onto the canvas. Until then the caller still shows
//      the normal camera, so a model that never produces a frame can
//      never publish a black track. If no frame arrives within a few
//      seconds, the promise rejects and the caller keeps the normal
//      camera with a plain message.
//   3. A watchdog watches for stalled frames mid-call: if the model
//      stops producing results, onFrameError fires once and the caller
//      falls back to the normal camera instead of a frozen or black
//      picture. A single bad frame never kills the loop, it just
//      retries on the next frame.
//   4. The person cutout uses the mask as an alpha (luminance) mask, so
//      it works whether the model returns a mask with a transparent
//      background or an opaque black one. The old composite drew the
//      mask over the already opaque background and then used source-in,
//      which drew the full sharp camera image over the whole frame, so
//      the blur was invisible even when the model worked.
// Low-bandwidth mode (feature 21) and the Phase A quality step-down
// both turn the effect off first, because segmentation costs CPU and
// uplink that a weak connection cannot spare.

export type BackgroundFxMode = 'none' | 'blur' | 'giin';

const SEGMENTATION_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/selfie_segmentation.js';
const SEGMENTATION_VERSION = '0.1';

// The first frame must arrive within this long, else the effect is
// unavailable and the caller keeps the normal camera.
const FIRST_FRAME_TIMEOUT_MS = 8000;
// Mid-call, this long without a frame means the model stalled.
const STALL_TIMEOUT_MS = 4000;
// The person cutout is composited at most this wide: the model output
// is low resolution anyway, and per-pixel alpha work at full camera
// resolution would burn CPU for no visible gain.
const PERSON_LAYER_MAX_WIDTH = 480;

declare global {
  interface Window {
    SelfieSegmentation?: any;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

const loadSegmentationScript = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.reject(new Error('Background effects need a browser.'));
  if ((window as any).SelfieSegmentation) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SEGMENTATION_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Background effects could not be loaded — check your connection and try again. Your video stays normal.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
};

// The GIIN branded backdrop, drawn on the canvas behind the person:
// deep navy-to-blue gradient, the GIIN wordmark and the gold accent.
const drawGiinBackdrop = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0B1E3A');
  grad.addColorStop(0.55, '#12294D');
  grad.addColorStop(1, '#1D4ED8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  // Soft gold arc, bottom-right — the brand accent, kept subtle.
  ctx.beginPath();
  ctx.arc(width * 0.92, height * 1.05, width * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(250, 189, 2, 0.14)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width * 0.06, -height * 0.08, width * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fill();
  // Wordmark.
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${Math.round(height * 0.11)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('GIIN', width * 0.06, height * 0.16);
  ctx.fillStyle = '#FABD02';
  ctx.font = `600 ${Math.round(height * 0.045)}px sans-serif`;
  ctx.fillText('MEET', width * 0.06, height * 0.16 + Math.round(height * 0.07));
};

export interface BackgroundFxSession {
  /** The processed track to publish/show instead of the raw camera. */
  track: MediaStreamTrack;
  stop: () => void;
}

// Feed `sourceTrack` through segmentation and return a processed track.
// The caller owns publishing the track and restoring the raw track on
// stop. `onFrameError` fires (once) if the model fails mid-call, so the
// caller can fall back to the normal camera instead of a frozen frame.
//
// The promise only resolves after the first frame has been composited,
// so the caller never publishes an empty (black) canvas. It rejects
// when the model cannot start, and the caller then keeps the normal
// camera.
export const startBackgroundFx = async (
  sourceTrack: MediaStreamTrack,
  mode: Exclude<BackgroundFxMode, 'none'>,
  onFrameError?: () => void
): Promise<BackgroundFxSession> => {
  await loadSegmentationScript();
  const SelfieSegmentation = (window as any).SelfieSegmentation;
  if (!SelfieSegmentation) {
    throw new Error('Background effects could not be loaded — your video stays normal.');
  }

  // The source video element the model reads from. It is never shown.
  // Wait until it really has frames: play() alone can resolve before
  // the first frame arrives, and sending an empty video to the model
  // produces no results at all.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([sourceTrack]);
  const videoReady = await new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 5000);
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        window.clearTimeout(timer);
        resolve(true);
      }
    };
    video.addEventListener('loadedmetadata', check);
    video.addEventListener('canplay', check);
    video.play().then(check).catch(() => {
      window.clearTimeout(timer);
      resolve(false);
    });
    // The track may already be flowing, so check right away too.
    check();
  });
  if (!videoReady) {
    try { video.pause(); } catch (e) { /* ignore */ }
    throw new Error('Background effects could not start, your video stays normal.');
  }
  // Size the canvas from the video that is actually flowing, not just
  // from the track settings, which can be 0 before the first frame.
  const width = video.videoWidth;
  const height = video.videoHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Background effects are not available in this browser, your video stays normal.');

  // Offscreen canvas holding the blurred background frame.
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = width;
  bgCanvas.height = height;
  const bgCtx = bgCanvas.getContext('2d');
  if (!bgCtx) throw new Error('Background effects are not available in this browser, your video stays normal.');

  // Person layer, capped resolution: the cutout of the person with the
  // background removed, drawn over the background each frame. A second
  // canvas holds the mask at the same size for the alpha pass.
  const personScale = Math.min(1, PERSON_LAYER_MAX_WIDTH / width);
  const personWidth = Math.max(2, Math.round(width * personScale));
  const personHeight = Math.max(2, Math.round(height * personScale));
  const personCanvas = document.createElement('canvas');
  personCanvas.width = personWidth;
  personCanvas.height = personHeight;
  const personCtx = personCanvas.getContext('2d', { willReadFrequently: true });
  if (!personCtx) throw new Error('Background effects are not available in this browser, your video stays normal.');
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = personWidth;
  maskCanvas.height = personHeight;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) throw new Error('Background effects are not available in this browser, your video stays normal.');

  let stopped = false;
  let frameErrorReported = false;
  let firstFrameDone = false;
  let lastResultAt = 0;
  let rafId = 0;
  let sendInFlight = false;

  let firstFrameResolve!: () => void;
  let firstFrameReject!: (err: Error) => void;
  const firstFramePromise = new Promise<void>((resolve, reject) => {
    firstFrameResolve = resolve;
    firstFrameReject = reject;
  });
  const firstFrameTimer = window.setTimeout(() => {
    if (!firstFrameDone) {
      firstFrameReject(new Error('Background effects did not start, your video stays normal.'));
    }
  }, FIRST_FRAME_TIMEOUT_MS);

  const reportFrameError = () => {
    if (frameErrorReported) return;
    frameErrorReported = true;
    onFrameError?.();
  };

  const segmenter = new SelfieSegmentation({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${SEGMENTATION_VERSION}/${file}`,
  });
  segmenter.setOptions({ modelSelection: 1 });
  segmenter.onResults((results: any) => {
    if (stopped) return;
    try {
      // Background first, at full resolution.
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      if (mode === 'blur') {
        bgCtx.save();
        bgCtx.clearRect(0, 0, width, height);
        bgCtx.filter = 'blur(14px)';
        bgCtx.drawImage(results.image, 0, 0, width, height);
        bgCtx.restore();
        ctx.drawImage(bgCanvas, 0, 0, width, height);
      } else {
        drawGiinBackdrop(ctx, width, height);
      }
      // Person cutout: the mask decides the alpha of every pixel, so
      // this works whether the mask background is transparent or an
      // opaque black. Drawing the mask over an already opaque
      // background and then using source-in cannot work: the whole
      // frame is opaque by then, so the full sharp image lands on top
      // and the effect vanishes.
      personCtx.clearRect(0, 0, personWidth, personHeight);
      personCtx.drawImage(results.image, 0, 0, personWidth, personHeight);
      const personData = personCtx.getImageData(0, 0, personWidth, personHeight);
      maskCtx.clearRect(0, 0, personWidth, personHeight);
      maskCtx.drawImage(results.segmentationMask, 0, 0, personWidth, personHeight);
      const maskData = maskCtx.getImageData(0, 0, personWidth, personHeight);
      const personPixels = personData.data;
      const maskPixels = maskData.data;
      for (let i = 0; i < personPixels.length; i += 4) {
        // The mask is greyscale: white where the person is, black
        // elsewhere. Use its brightness as the alpha.
        personPixels[i + 3] = maskPixels[i];
      }
      personCtx.putImageData(personData, 0, 0);
      ctx.drawImage(personCanvas, 0, 0, width, height);
      ctx.restore();
      lastResultAt = Date.now();
      if (!firstFrameDone) {
        firstFrameDone = true;
        window.clearTimeout(firstFrameTimer);
        firstFrameResolve();
      }
    } catch (e) {
      reportFrameError();
    }
  });

  // One send at a time, driven by animation frames. A single failed
  // send never kills the loop: it just retries on the next frame, and
  // the watchdog below decides when the model has truly stalled.
  const loop = () => {
    if (stopped) return;
    if (sendInFlight || video.readyState < 2 || video.videoWidth === 0) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    sendInFlight = true;
    segmenter.send({ image: video }).catch(() => {
      // A bad frame is not a dead model, keep trying.
    }).finally(() => {
      sendInFlight = false;
    });
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  // Watchdog: no results for a while means the model stalled, so fall
  // back to the normal camera instead of a frozen or black picture.
  const watchdogId = window.setInterval(() => {
    if (stopped) return;
    if (firstFrameDone && Date.now() - lastResultAt > STALL_TIMEOUT_MS) {
      reportFrameError();
    }
  }, 1000);

  const outStream = canvas.captureStream(30);
  const outTrack = outStream.getVideoTracks()[0];
  if (!outTrack) {
    stopped = true;
    cancelAnimationFrame(rafId);
    window.clearInterval(watchdogId);
    window.clearTimeout(firstFrameTimer);
    throw new Error('Background effects could not start, your video stays normal.');
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    window.clearInterval(watchdogId);
    window.clearTimeout(firstFrameTimer);
    try { segmenter.close(); } catch (e) { /* already closed */ }
    try { video.pause(); } catch (e) { /* ignore */ }
    try { video.srcObject = null; } catch (e) { /* ignore */ }
    try { outTrack.stop(); } catch (e) { /* ignore */ }
  };

  // Only hand the track to the caller once the first frame has been
  // composited: until then the canvas is empty and the track is black.
  try {
    await firstFramePromise;
  } catch (e) {
    stop();
    throw e;
  }

  return {
    track: outTrack,
    stop,
  };
};
