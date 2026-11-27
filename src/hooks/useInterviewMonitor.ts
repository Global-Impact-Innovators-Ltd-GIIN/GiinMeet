// Live Interview Mode — candidate-side detection hook.
//
// A browser cannot prevent tab switching. No website can lock the
// browser. What this hook does is DETECT it at once and flag it, and
// the flag reaches the interviewers live (LiveKit data channel) and
// is written to the interview timeline (POST /api/interviews/events).
// It never promises prevention, and it never claims to detect a
// second screen: that cannot be detected from a browser, and the
// integrity report says so plainly.
//
// Events detected: tab hidden/visible (Page Visibility API), window
// blur/focus, fullscreen exit/enter, copy, paste, right click, new
// window attempts (window.open is wrapped while the hook is active),
// and screen-share attempts (reported by the room, see
// reportScreenShareAttempt). Connection drops are reported by the
// room through reportConnectionEvent.
//
// Severity: low = one short blur, a question, a pause. Medium = tab
// switch, fullscreen exit, long blur, right click, copy. High =
// paste, repeated events, long absence, screen-share attempt, new
// window attempt.
//
// Offline: events that cannot be posted are queued in localStorage
// with their original time and flushed on reconnect. A retry never
// double-logs: every event carries a client_id and the server
// ignores duplicates.
//
// A tab switch fires both visibilitychange and blur, so the hook
// suppresses the blur that follows a hide (and the focus that
// follows a show) within 1.5 seconds, so one switch is one flag.
import { useEffect, useRef, useCallback } from 'react';

export type InterviewSeverity = 'low' | 'medium' | 'high';

export interface InterviewFlagEvent {
  clientId: string;
  type: string;
  detail: string;
  severity: InterviewSeverity;
  occurredAt: string;
  awaySeconds?: number | null;
}

export interface UseInterviewMonitorOptions {
  enabled: boolean;
  interviewId: string | null;
  token: string | null;
  publishLive: (event: InterviewFlagEvent) => void;
  onFullscreenExit: (count: number) => void;
  onEvent?: (event: InterviewFlagEvent) => void;
}

const QUEUE_KEY = (interviewId: string) => `giin_interview_queue_${interviewId}`;
const LONG_BLUR_SECONDS = 3;
const LONG_ABSENCE_SECONDS = 60;

function makeClientId(): string {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return `ev-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  }
}

export function useInterviewMonitor({
  enabled,
  interviewId,
  token,
  publishLive,
  onFullscreenExit,
  onEvent,
}: UseInterviewMonitorOptions) {
  const hiddenAtRef = useRef<number | null>(null);
  const blurredAtRef = useRef<number | null>(null);
  const lastHiddenAtRef = useRef(0);
  const lastVisibleAtRef = useRef(0);
  const fullscreenExitCountRef = useRef(0);
  const eventCountRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const publishLiveRef = useRef(publishLive);
  publishLiveRef.current = publishLive;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onFullscreenExitRef = useRef(onFullscreenExit);
  onFullscreenExitRef.current = onFullscreenExit;

  const readQueue = useCallback((id: string): InterviewFlagEvent[] => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY(id));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }, []);

  const writeQueue = useCallback((id: string, events: InterviewFlagEvent[]) => {
    try {
      if (events.length === 0) localStorage.removeItem(QUEUE_KEY(id));
      else localStorage.setItem(QUEUE_KEY(id), JSON.stringify(events.slice(-200)));
    } catch (e) { /* queue is best-effort; the live channel still ran */ }
  }, []);

  const postEvents = useCallback(async (id: string, tk: string, events: InterviewFlagEvent[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/interviews/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: id, token: tk, events }),
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (!interviewId || !token) return;
    const queued = readQueue(interviewId);
    if (queued.length === 0) return;
    const ok = await postEvents(interviewId, token, queued);
    if (ok) writeQueue(interviewId, []);
  }, [interviewId, token, readQueue, writeQueue, postEvents]);

  const emit = useCallback((type: string, detail: string, severity: InterviewSeverity, awaySeconds?: number | null) => {
    if (!interviewId || !token) return;
    const event: InterviewFlagEvent = {
      clientId: makeClientId(),
      type,
      detail,
      severity,
      occurredAt: new Date().toISOString(),
      awaySeconds: typeof awaySeconds === 'number' ? awaySeconds : null,
    };
    eventCountRef.current += 1;
    // Live first: the interviewers see it within seconds.
    try { publishLiveRef.current(event); } catch (e) { /* poll fallback covers it */ }
    if (onEventRef.current) {
      try { onEventRef.current(event); } catch (e) { /* local UI only */ }
    }
    // Persisted second, queued when offline.
    void (async () => {
      const ok = await postEvents(interviewId, token, [event]);
      if (!ok) {
        const queued = readQueue(interviewId);
        queued.push(event);
        writeQueue(interviewId, queued);
      }
    })();
  }, [interviewId, token, postEvents, readQueue, writeQueue]);

  const reportEvent = useCallback((type: string, detail: string, severity: InterviewSeverity) => {
    emit(type, detail, severity, null);
  }, [emit]);

  const reportScreenShareAttempt = useCallback(() => {
    emit('screen-share-attempt', 'Candidate tried to share their screen', 'high', null);
  }, [emit]);

  const reportConnectionEvent = useCallback((lost: boolean) => {
    emit(lost ? 'connection-lost' : 'connection-restored', lost ? 'Candidate connection lost' : 'Candidate reconnected', 'low', null);
  }, [emit]);

  useEffect(() => {
    if (!enabled || !interviewId || !token) return;

    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.hidden) {
        lastHiddenAtRef.current = now;
        hiddenAtRef.current = now;
        emit('tab-hidden', 'Candidate switched tab', 'medium', null);
      } else {
        lastVisibleAtRef.current = now;
        const away = hiddenAtRef.current ? Math.round((now - hiddenAtRef.current) / 1000) : null;
        hiddenAtRef.current = null;
        const severity: InterviewSeverity = away !== null && away >= LONG_ABSENCE_SECONDS ? 'high' : 'low';
        emit('tab-visible', 'Candidate came back to the interview tab', severity, away);
      }
    };

    const onBlur = () => {
      const now = Date.now();
      // A tab switch also fires blur: the hide already flagged it.
      if (now - lastHiddenAtRef.current < 1500) return;
      blurredAtRef.current = now;
      emit('window-blur', 'Candidate clicked into another window or app', 'low', null);
    };

    const onFocus = () => {
      const now = Date.now();
      // Focus right after a show is the same return, not a new event.
      if (now - lastVisibleAtRef.current < 1500) return;
      const away = blurredAtRef.current ? Math.round((now - blurredAtRef.current) / 1000) : null;
      blurredAtRef.current = null;
      const severity: InterviewSeverity = away !== null && away >= LONG_BLUR_SECONDS ? 'medium' : 'low';
      emit('window-focus', 'Candidate came back to the interview window', severity, away);
    };

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        emit('fullscreen-enter', 'Candidate went back to full screen', 'low', null);
        return;
      }
      fullscreenExitCountRef.current += 1;
      const count = fullscreenExitCountRef.current;
      const severity: InterviewSeverity = count >= 2 ? 'high' : 'medium';
      emit('fullscreen-exit', 'Candidate left full screen', severity, null);
      onFullscreenExitRef.current(count);
    };

    const onCopy = () => emit('copy', 'Candidate copied text', 'medium', null);
    const onPaste = () => emit('paste', 'Candidate pasted text', 'high', null);
    const onContextMenu = () => emit('right-click', 'Candidate opened the right-click menu', 'medium', null);

    const originalOpen = window.open.bind(window);
    const wrappedOpen = (..._args: any[]) => {
      emit('new-window-attempt', 'Candidate tried to open a new tab or window', 'high', null);
      return null;
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContextMenu);
    (window as any).open = wrappedOpen;

    const onOnline = () => { void flushQueue(); };
    window.addEventListener('online', onOnline);
    flushTimerRef.current = window.setInterval(() => { void flushQueue(); }, 10000);
    void flushQueue();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContextMenu);
      (window as any).open = originalOpen;
      window.removeEventListener('online', onOnline);
      if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [enabled, interviewId, token, emit, flushQueue]);

  return { reportEvent, reportScreenShareAttempt, reportConnectionEvent, flushQueue };
}
