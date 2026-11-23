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
// Graceful failure is the point: if the CDN cannot be reached, the model
// fails to load, or the device is too slow, startBackgroundFx rejects
// with a plain message and the caller keeps the normal camera — the call
// is never broken by an effect. Low-bandwidth mode (feature 21) and the
// Phase A quality step-down both turn the effect off first, because
// segmentation costs CPU and uplink that a weak connection cannot spare.

export type BackgroundFxMode = 'none' | 'blur' | 'giin';

const SEGMENTATION_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/selfie_segmentation.js';
const SEGMENTATION_VERSION = '0.1';

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
  const settings = sourceTrack.getSettings();
  const width = settings.width || 640;
  const height = settings.height || 360;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Background effects are not available in this browser — your video stays normal.');

  // The source video element the model reads from. It is never shown.
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([sourceTrack]);
  await video.play().catch(() => {
    throw new Error('Background effects could not start — your video stays normal.');
  });

  // Offscreen canvas holding the blurred background frame.
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = width;
  bgCanvas.height = height;
  const bgCtx = bgCanvas.getContext('2d');
  if (!bgCtx) throw new Error('Background effects are not available in this browser — your video stays normal.');

  let stopped = false;
  let frameErrorReported = false;
  let rafId = 0;

  const segmenter = new SelfieSegmentation({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@${SEGMENTATION_VERSION}/${file}`,
  });
  segmenter.setOptions({ modelSelection: 1 });
  segmenter.onResults((results: any) => {
    if (stopped) return;
    try {
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      if (mode === 'blur') {
        // Background: the frame, blurred. Person: drawn sharp on top
        // using the segmentation mask.
        bgCtx.save();
        bgCtx.clearRect(0, 0, width, height);
        bgCtx.filter = 'blur(14px)';
        bgCtx.drawImage(results.image, 0, 0, width, height);
        bgCtx.restore();
        ctx.drawImage(bgCanvas, 0, 0, width, height);
      } else {
        drawGiinBackdrop(ctx, width, height);
      }
      // Person: composite the camera image through the mask. The mask
      // is white where the person is; drawing the image with the mask
      // as its alpha keeps only the person.
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(results.segmentationMask, 0, 0, width, height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(results.image, 0, 0, width, height);
      ctx.restore();
    } catch (e) {
      if (!frameErrorReported) {
        frameErrorReported = true;
        onFrameError?.();
      }
    }
  });

  const loop = async () => {
    if (stopped) return;
    try {
      await segmenter.send({ image: video });
    } catch (e) {
      if (!frameErrorReported) {
        frameErrorReported = true;
        onFrameError?.();
      }
      return;
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  const outStream = canvas.captureStream(30);
  const outTrack = outStream.getVideoTracks()[0];
  if (!outTrack) {
    stopped = true;
    cancelAnimationFrame(rafId);
    throw new Error('Background effects could not start — your video stays normal.');
  }

  return {
    track: outTrack,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      try { segmenter.close(); } catch (e) { /* already closed */ }
      try { video.pause(); } catch (e) { /* ignore */ }
      try { outTrack.stop(); } catch (e) { /* ignore */ }
    },
  };
};
