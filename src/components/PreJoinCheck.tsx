import React, { useEffect, useRef, useState } from 'react';
import {
  Video, VideoOff, Mic, MicOff, Volume2, CheckCircle2, XCircle, AlertTriangle,
  ArrowLeft, ArrowRight, RefreshCw, Wifi, WifiOff, User, ShieldCheck, Loader2,
} from 'lucide-react';

// Pre-join prerequisite check. Runs BEFORE the passcode gate and the
// waiting room for everyone who follows a join link (guests and signed-in
// non-hosts alike). The host never sees it — the hash router sends the host
// straight into the room.
//
// Checks, each with its own pass/fail verdict and plain-language fix:
//   1. Camera — live preview + a working verdict (track live + frames moving)
//   2. Microphone — live level meter (AnalyserNode, same technique as the
//      in-room speaking indicator) + a working verdict
//   3. Speaker — a real test sound the user confirms they heard
//   4. Display name — the single source the Waitroom then uses (passed up
//      via onComplete; nothing else stores the name)
//   5. Browser/device permissions — camera + microphone permission state
//   6. Connection / network — online state + a round-trip probe
//
// The Proceed button is gated on the essentials: a display name, a live
// network, and no hard camera/mic failure — unless the user explicitly
// chooses "join without camera/microphone", in which case they enter with
// those devices off and the room is told so. The speaker test NEVER gates
// proceeding: it cannot auto-pass (only the user knows if they heard the
// tone), so it resolves to "played, awaiting your answer" instead.
//
// Every check is BOUNDED (Fix Round 5, item 4): a permission prompt, a
// network probe or a getUserMedia call that never settles used to leave
// this screen stuck on "Checking…" forever — on a phone, where a dismissed
// permission prompt or a saved desktop deviceId can stall it, with no
// escape. Each step now resolves to pass/fail within a fixed timeout, and
// a failed/timed-out camera/mic always offers the join-without-devices
// escape. The screen is also its own scroll container (see the return
// JSX): html/body have overflow:hidden and a vertically-centred flex box
// pushed tall content above the viewport on a ~390px phone with no way to
// scroll to the Continue button.

type CheckStatus = 'checking' | 'pass' | 'warn' | 'fail';

interface PreJoinCheckProps {
  meetingId: string;
  meetingTitle: string;
  user: { id: string; name: string; email: string } | null;
  initialDisplayName?: string;
  onComplete: (displayName: string, videoOn: boolean, audioOn: boolean) => void;
  onBack: () => void;
}

const fixFor = (kind: 'camera' | 'mic', errName?: string): string => {
  if (errName === 'NotAllowedError')
    return kind === 'camera'
      ? 'Camera blocked — click the camera icon in the browser address bar, allow the camera, then press Retry. On a phone, use the browser site settings (the lock/tune icon by the address) instead.'
      : 'Microphone blocked — click the microphone icon in the browser address bar, allow the microphone, then press Retry. On a phone, use the browser site settings (the lock/tune icon by the address) instead.';
  if (errName === 'NotFoundError')
    return kind === 'camera'
      ? 'No camera was found on this device — plug one in or join without a camera below.'
      : 'No microphone was found on this device — plug one in or join without a microphone below.';
  if (errName === 'NotReadableError')
    return kind === 'camera'
      ? 'Your camera is in use by another app — close that app (or the other browser tab using it), then press Retry.'
      : 'Your microphone is in use by another app — close that app, then press Retry.';
  if (errName === 'OverconstrainedError')
    return 'Your browser refused the camera settings — try another browser (Chrome or Edge on a laptop works best).';
  return kind === 'camera'
    ? 'The camera could not be started — check the browser permission in the address bar, then press Retry.'
    : 'The microphone could not be started — check the browser permission in the address bar, then press Retry.';
};

export const PreJoinCheck: React.FC<PreJoinCheckProps> = ({
  meetingId,
  meetingTitle,
  user,
  initialDisplayName = '',
  onComplete,
  onBack,
}) => {
  const [displayName, setDisplayName] = useState(initialDisplayName || user?.name || '');
  const [cameraStatus, setCameraStatus] = useState<CheckStatus>('checking');
  const [micStatus, setMicStatus] = useState<CheckStatus>('checking');
  // Speaker starts as 'warn' ("not tested yet"), NOT 'checking': nothing
  // has played yet, so showing "Checking…" on load was a lie that never
  // resolved until the user pressed a button. It only reads 'checking'
  // while a tone is actually playing, and leaves that state on a timer.
  const [speakerStatus, setSpeakerStatus] = useState<CheckStatus>('warn');
  const [speakerPlayed, setSpeakerPlayed] = useState(false);
  const [speakerSkipped, setSpeakerSkipped] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<CheckStatus>('checking');
  const [cameraPerm, setCameraPerm] = useState('unknown');
  const [micPerm, setMicPerm] = useState('unknown');
  const [cameraError, setCameraError] = useState('');
  const [micError, setMicError] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [micHeard, setMicHeard] = useState(false);
  const [speakerHeard, setSpeakerHeard] = useState(false);
  const [speakerFailed, setSpeakerFailed] = useState(false);
  const [networkMs, setNetworkMs] = useState<number | null>(null);
  const [videoOn, setVideoOn] = useState(true);
  const [audioOn, setAudioOn] = useState(true);
  const [joinWithoutDevices, setJoinWithoutDevices] = useState(false);
  // Fix Round 7 (#11): the guest chose to proceed despite a failed
  // network probe - the probe can fail while the meeting works fine.
  const [proceedDespiteNetwork, setProceedDespiteNetwork] = useState(false);
  const [runId, setRunId] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const speakerTimerRef = useRef<number | null>(null);

  const stopStream = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (speakerTimerRef.current) {
      window.clearTimeout(speakerTimerRef.current);
      speakerTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  };

  // Run all device + network checks. Re-runnable with Retry.
  // EVERY step is bounded: a permission prompt, a network probe or a
  // getUserMedia call that never settles used to leave camera/mic/network
  // on "Checking…" forever (notably on phones, where a dismissed
  // permission prompt or a saved desktop deviceId can stall it), with the
  // "join without devices" escape hidden because it only appeared on
  // 'fail'. Each step now resolves to pass/fail within a fixed timeout.
  useEffect(() => {
    let active = true;

    // getUserMedia with a hard timeout. If the prompt is dismissed or the
    // browser stalls, the promise may never settle — so a late-arriving
    // stream is stopped immediately instead of leaking a live camera.
    const timeoutError = () => Object.assign(new Error('getUserMedia timed out'), { name: 'TimeoutError' });
    const boundedGum = (useSaved: boolean): Promise<MediaStream> => {
      const savedCam = useSaved ? localStorage.getItem('giin_selected_camera') || '' : '';
      const savedMic = useSaved ? localStorage.getItem('giin_selected_mic') || '' : '';
      const p = navigator.mediaDevices.getUserMedia({
        video: savedCam ? { deviceId: { exact: savedCam }, width: 640, height: 480 } : { width: 640, height: 480 },
        audio: savedMic
          ? { deviceId: { exact: savedMic }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } },
      });
      let settled = false;
      p.then((s) => { if (settled) s.getTracks().forEach((t) => t.stop()); }).catch(() => {});
      return new Promise<MediaStream>((resolve, reject) => {
        const to = window.setTimeout(() => {
          if (!settled) { settled = true; reject(timeoutError()); }
        }, 15000);
        p.then((s) => {
          if (!settled) { settled = true; window.clearTimeout(to); resolve(s); }
        }).catch((e) => {
          if (!settled) { settled = true; window.clearTimeout(to); reject(e); }
        });
      });
    };

    const runChecks = async () => {
      setCameraStatus('checking');
      setMicStatus('checking');
      setNetworkStatus('checking');
      setCameraError('');
      setMicError('');
      setMicHeard(false);

      // Permissions state (best-effort: not every browser supports it).
      // Bounded: on some mobile browsers permissions.query never settles,
      // which used to stall every check below it.
      try {
        const nav: any = navigator as any;
        if (nav.permissions?.query) {
          const permTimeout = new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error('permissions-timeout')), 3000));
          const [cam, mic] = await Promise.race([
            Promise.all([
              nav.permissions.query({ name: 'camera' as any }),
              nav.permissions.query({ name: 'microphone' as any }),
            ]),
            permTimeout,
          ]) as any;
          if (active) {
            setCameraPerm(cam.state);
            setMicPerm(mic.state);
          }
        }
      } catch (e) { /* permission state is advisory only */ }

      // Network: online state + a real round-trip probe.
      // Bounded (8 s): an unsettled fetch used to leave the network check
      // on "Checking…" forever, and Proceed requires a network pass.
      const t0 = performance.now();
      const ctrl = new AbortController();
      const netTimer = window.setTimeout(() => ctrl.abort(), 8000);
      try {
        await fetch(window.location.origin, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
        if (!active) return;
        setNetworkMs(Math.round(performance.now() - t0));
        setNetworkStatus(navigator.onLine ? 'pass' : 'fail');
      } catch (e) {
        if (!active) return;
        setNetworkStatus('fail');
      } finally {
        window.clearTimeout(netTimer);
      }

      // Camera + microphone, together.
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!active) return;
        const msg = 'This browser cannot access a camera or microphone here — join without camera/microphone below, or try Chrome on this phone.';
        setCameraStatus('fail');
        setMicStatus('fail');
        setCameraError(msg);
        setMicError(msg);
        return;
      }
      try {
        let stream: MediaStream;
        try {
          stream = await boundedGum(true);
        } catch (firstErr: any) {
          // A deviceId saved on another device (e.g. the desktop) makes a
          // phone reject with OverconstrainedError/NotFoundError. Retry
          // once with the phone's own default devices before failing.
          const savedAny = localStorage.getItem('giin_selected_camera') || localStorage.getItem('giin_selected_mic');
          const retryable = savedAny && (firstErr?.name === 'OverconstrainedError' || firstErr?.name === 'NotFoundError');
          if (!retryable) throw firstErr;
          stream = await boundedGum(false);
        }
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        const vTrack = stream.getVideoTracks()[0];
        const aTrack = stream.getAudioTracks()[0];
        setCameraStatus(vTrack && vTrack.readyState === 'live' ? 'pass' : 'fail');
        if (!vTrack) setCameraError(fixFor('camera'));
        setMicStatus(aTrack && aTrack.readyState === 'live' ? 'pass' : 'fail');
        if (!aTrack) setMicError(fixFor('mic'));

        // Live mic level meter (AnalyserNode, as in the room).
        if (aTrack) {
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(new MediaStream([aTrack]));
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;
            const buf = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              if (!active) return;
              analyser.getByteFrequencyData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) sum += buf[i];
              const avg = sum / buf.length;
              setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
              if (avg > 10) setMicHeard(true);
              rafRef.current = requestAnimationFrame(tick);
            };
            tick();
          } catch (e) {
            // Meter failure is not a mic failure — the track itself works.
          }
        }
      } catch (err: any) {
        if (!active) return;
        const name = err?.name || '';
        // getUserMedia fails as a whole, so we cannot tell which device
        // failed from the error alone: mark both as failed with the
        // specific fix, and let Retry re-run after the user fixes it.
        // A denial is usually both devices at once (same permission prompt).
        setCameraStatus('fail');
        setMicStatus('fail');
        if (name === 'TimeoutError') {
          const msg = 'The camera/microphone check timed out — the browser may still be waiting for permission, or the device is busy. Press Retry, or join without camera/microphone below.';
          setCameraError(msg);
          setMicError(msg);
        } else {
          setCameraError(fixFor('camera', name));
          setMicError(fixFor('mic', name));
        }
      }
    };

    runChecks();
    return () => {
      active = false;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // The camera preview <video> only mounts once the camera passes, which
  // is AFTER runChecks tries to assign srcObject (at that point the
  // element does not exist yet, so the preview stayed black even on a
  // pass). Attach the live stream when the element actually exists.
  useEffect(() => {
    if (cameraStatus === 'pass' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraStatus]);

  const playSpeakerTest = () => {
    if (speakerTimerRef.current) window.clearTimeout(speakerTimerRef.current);
    setSpeakerFailed(false);
    setSpeakerSkipped(false);
    setSpeakerPlayed(false);
    setSpeakerStatus('checking');
    // Bounded: if the audio context cannot start (mobile browsers suspend
    // it, the tab is muted, …) the row must not sit on "Checking…"
    // forever — after 3 s it reports honestly instead.
    speakerTimerRef.current = window.setTimeout(() => {
      setSpeakerStatus((s) => (s === 'checking' ? 'warn' : s));
    }, 3000);
    try {
      let ctx = audioCtxRef.current;
      if (!ctx || ctx.state === 'closed') {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
      }
      const play = async () => {
        try {
          if (ctx!.state === 'suspended') {
            await Promise.race([ctx!.resume(), new Promise((r) => window.setTimeout(r, 2000))]);
          }
          const osc = ctx!.createOscillator();
          const gain = ctx!.createGain();
          osc.connect(gain);
          gain.connect(ctx!.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx!.currentTime);
          gain.gain.setValueAtTime(0.12, ctx!.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx!.currentTime + 0.9);
          osc.start();
          osc.stop(ctx!.currentTime + 0.9);
          setSpeakerPlayed(true);
          // The tone lasts 0.9 s. The test can never auto-pass — only the
          // user knows if they heard it — so once the tone has played the
          // row stops saying "Checking…" and waits for the user's answer.
          if (speakerTimerRef.current) window.clearTimeout(speakerTimerRef.current);
          speakerTimerRef.current = window.setTimeout(() => {
            setSpeakerStatus((s) => (s === 'checking' ? 'warn' : s));
          }, 1200);
        } catch (e) {
          setSpeakerStatus('fail');
        }
      };
      void play();
    } catch (e) {
      setSpeakerStatus('fail');
    }
  };

  const resolveSpeaker = (heard: boolean) => {
    if (speakerTimerRef.current) window.clearTimeout(speakerTimerRef.current);
    setSpeakerHeard(heard);
    setSpeakerFailed(!heard);
    setSpeakerStatus(heard ? 'pass' : 'fail');
  };

  // Honest skip: speakers are not required to join, and a skipped test is
  // recorded as skipped ('warn'), never as a pass.
  const skipSpeaker = () => {
    if (speakerTimerRef.current) window.clearTimeout(speakerTimerRef.current);
    setSpeakerSkipped(true);
    setSpeakerHeard(false);
    setSpeakerFailed(false);
    setSpeakerStatus('warn');
  };

  const canProceed =
    displayName.trim().length > 0 &&
    (networkStatus === 'pass' || proceedDespiteNetwork) &&
    (joinWithoutDevices ||
      (cameraStatus !== 'fail' && micStatus !== 'fail' && cameraStatus !== 'checking' && micStatus !== 'checking'));

  const proceed = () => {
    stopStream();
    try {
      localStorage.setItem(`giin_display_name_${meetingId}`, displayName.trim());
    } catch (e) {}
    onComplete(
      displayName.trim(),
      joinWithoutDevices ? false : videoOn && cameraStatus === 'pass',
      joinWithoutDevices ? false : audioOn && micStatus === 'pass',
    );
  };

  const Row = ({
    icon,
    title,
    status,
    detail,
    fix,
    children,
  }: {
    icon: React.ReactNode;
    title: string;
    status: CheckStatus;
    detail: string;
    fix?: string;
    children?: React.ReactNode;
  }) => (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        padding: '0.85rem 1rem',
        borderRadius: '10px',
        border: `1px solid ${status === 'fail' ? 'rgba(239,68,68,0.5)' : status === 'pass' ? 'rgba(16,185,129,0.4)' : 'var(--border-color)'}`,
        backgroundColor: status === 'fail' ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ color: status === 'fail' ? '#EF4444' : status === 'pass' ? '#10B981' : 'var(--text-muted)', marginTop: '2px' }}>
        {status === 'checking' ? <Loader2 size={18} style={{ animation: 'spin 1.5s linear infinite' }} /> : status === 'pass' ? <CheckCircle2 size={18} /> : status === 'fail' ? <XCircle size={18} /> : <AlertTriangle size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
          {icon}
          <span>{title}</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: status === 'fail' ? '#EF4444' : status === 'pass' ? '#10B981' : 'var(--text-muted)' }}>
            {status === 'checking' ? 'Checking…' : status === 'pass' ? 'Passed' : status === 'fail' ? 'Failed' : 'Check'}
          </span>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.45 }}>{detail}</div>
        {fix && <div style={{ fontSize: '0.8rem', color: '#FCA5A5', marginTop: '0.35rem', lineHeight: 1.45 }}>{fix}</div>}
        {children}
      </div>
    </div>
  );

  return (
    // Own scroll container, NOT a vertically-centred flex box: html/body
    // have overflow:hidden (index.css) and .flex-center uses
    // align-items:center, so on a ~390px phone this screen's tall content
    // was centred past the top of the viewport with no way to scroll down
    // to the Continue button. This div scrolls itself (height 100dvh +
    // overflow-y:auto) and stacks from the top, so every row and the
    // Continue button are reachable on a phone.
    <div style={{ height: '100dvh', overflowY: 'auto', padding: '1rem 1rem 2rem', backgroundColor: 'var(--bg-app)' }}>
      <div style={{ maxWidth: '640px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button onClick={onBack} className="premium-btn premium-btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10B981', fontSize: '0.8rem', fontWeight: 700 }}>
            <ShieldCheck size={16} />
            <span>CHECK BEFORE YOU JOIN</span>
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', margin: 0 }}>
            Check your setup — {meetingTitle}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
            A quick check so you join with working camera, microphone and sound. Nothing here joins the meeting yet.
          </p>
        </div>

        {/* Camera preview */}
        <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#0F172A', border: '2px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {cameraStatus === 'pass' ? (
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
              <VideoOff size={32} style={{ margin: '0 auto 0.5rem' }} />
              <div style={{ fontSize: '0.85rem' }}>
                {cameraStatus === 'checking' ? 'Starting your camera…' : 'Camera preview unavailable — see the camera check below.'}
              </div>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={() => setAudioOn(!audioOn)} title={audioOn ? 'Mute microphone' : 'Unmute microphone'} style={{ width: '42px', height: '42px', borderRadius: '50%', border: 'none', backgroundColor: audioOn ? 'rgba(255,255,255,0.15)' : '#EF4444', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {audioOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button type="button" onClick={() => setVideoOn(!videoOn)} title={videoOn ? 'Turn camera off' : 'Turn camera on'} style={{ width: '42px', height: '42px', borderRadius: '50%', border: 'none', backgroundColor: videoOn ? 'rgba(255,255,255,0.15)' : '#EF4444', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {videoOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          </div>
        </div>

        {/* Display name — the single source the Waitroom then uses */}
        <div>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
            <User size={14} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
            Your display name
          </label>
          <input
            type="text"
            className="premium-input"
            placeholder="Your name, as others will see it"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ height: '46px' }}
          />
          {!displayName.trim() && <span style={{ display: 'block', fontSize: '0.75rem', color: '#FCA5A5', marginTop: '0.4rem' }}>Enter a name to continue — the host and other participants will see this name.</span>}
        </div>

        {/* Checks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Row
            icon={<Video size={16} />}
            title="Camera"
            status={cameraStatus}
            detail={cameraStatus === 'pass' ? 'Camera is live and showing your preview above.' : cameraStatus === 'checking' ? 'Starting your camera…' : 'Your camera is not working.'}
            fix={cameraStatus === 'fail' ? cameraError : undefined}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>Browser permission: {cameraPerm}</div>
          </Row>

          <Row
            icon={<Mic size={16} />}
            title="Microphone"
            status={micStatus}
            detail={micStatus === 'pass' ? (micHeard ? 'Microphone is live — your voice is registering on the meter. Speak to test it.' : 'Microphone is live. Speak now — the meter below should move.') : micStatus === 'checking' ? 'Starting your microphone…' : 'Your microphone is not working.'}
            fix={micStatus === 'fail' ? micError : undefined}
          >
            {micStatus !== 'fail' && (
              <div style={{ marginTop: '0.5rem', height: '8px', borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${micLevel}%`, height: '100%', backgroundColor: micLevel > 5 ? '#10B981' : 'var(--color-secondary)', transition: 'width 80ms linear' }} />
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>Browser permission: {micPerm}</div>
          </Row>

          <Row
            icon={<Volume2 size={16} />}
            title="Speakers"
            status={speakerFailed ? 'fail' : speakerHeard ? 'pass' : speakerStatus}
            detail={speakerHeard ? 'You confirmed the test sound — your speakers work.' : speakerSkipped ? 'Speaker test skipped — speakers are not required to join.' : speakerPlayed ? "Test sound played — tap 'I heard it' or 'I didn't hear it' below." : 'Play the test sound and confirm you hear it.'}
            fix={speakerFailed ? 'You did not hear the test sound — check your volume, that the right speakers/headphones are selected, and that the browser tab is not muted, then play it again.' : undefined}
          >
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={playSpeakerTest}>
                <Volume2 size={14} /> Play test sound
              </button>
              <button type="button" className="premium-btn premium-btn-accent" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => resolveSpeaker(true)}>
                I heard it
              </button>
              <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => resolveSpeaker(false)}>
                I didn&apos;t hear it
              </button>
              <button type="button" className="premium-btn premium-btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={skipSpeaker}>
                Skip this test
              </button>
            </div>
          </Row>

          <Row
            icon={networkStatus === 'fail' ? <WifiOff size={16} /> : <Wifi size={16} />}
            title="Connection"
            status={networkStatus}
            detail={networkStatus === 'pass' ? `You are online${networkMs !== null ? ` — server answered in ${networkMs} ms` : ''}.` : networkStatus === 'checking' ? 'Checking your connection…' : 'You appear to be offline — check your Wi-Fi or mobile data, then press Retry.'}
          />
        </div>

        {/* Always offered, not only after a camera/mic failure: on a phone
            the checks can fail, time out, or the user may simply want to
            join audio-only — the escape must exist whatever state the
            checks are in. */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-main)' }}>
          <input type="checkbox" checked={joinWithoutDevices} onChange={() => setJoinWithoutDevices(!joinWithoutDevices)} style={{ marginTop: '3px' }} />
          <span>
            <strong>Join without camera / microphone</strong>
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>You will join with video and audio off. You can turn them on later from inside the meeting if the device starts working.</span>
          </span>
        </label>

        {/* Fix Round 7 (#11): a failed network probe warns instead of
            blocking - the probe can fail (firewall, IPv6-only path, a
            hiccup) while the meeting works fine. The guest may continue
            anyway. */}
        {networkStatus === 'fail' && !proceedDespiteNetwork && (
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', border: '1px solid #F59E0B', borderRadius: 8, background: '#FFFBEB', color: '#92400E', fontSize: '0.9rem' }}>
            <strong>Network check failed.</strong> We could not reach the video servers from this device, so the call may have trouble connecting - but the check itself can fail even when the meeting works. You can continue and try joining; if the video does not connect, check your connection and try again.
            <div style={{ marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setProceedDespiteNetwork(true)} style={{ padding: '0.5rem 0.9rem', borderRadius: 6, border: 'none', background: '#D97706', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                Continue anyway
              </button>
            </div>
          </div>
        )}

        {/* Sticky action bar: the Continue button stays pinned to the
            bottom of the phone screen while the checks scroll above it,
            so it is reachable without scrolling to the very end. */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', position: 'sticky', bottom: 0, backgroundColor: 'var(--bg-app)', paddingTop: '0.5rem', paddingBottom: '0.25rem', zIndex: 5 }}>
          <button type="button" className="premium-btn premium-btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setRunId((n) => n + 1)}>
            <RefreshCw size={16} /> Retry checks
          </button>
          <button
            type="button"
            className="premium-btn premium-btn-primary"
            style={{ flex: 2, justifyContent: 'center', padding: '0.9rem', fontSize: '1rem', fontWeight: 700, opacity: canProceed ? 1 : 0.5, cursor: canProceed ? 'pointer' : 'not-allowed' }}
            disabled={!canProceed}
            onClick={proceed}
            title={!canProceed ? 'Finish the checks above first — a name, a live connection, and a working camera/microphone (or choose to join without them).' : 'Continue to the meeting'}
          >
            <span>Continue</span>
            <ArrowRight size={18} />
          </button>
        </div>
        {!canProceed && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
            {displayName.trim() ? 'Fix the failed checks above (or choose to join without camera/microphone) to continue.' : 'Enter your display name to continue.'}
          </p>
        )}
      </div>
    </div>
  );
};
