import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Room as LiveKitRoom, RoomEvent, Track } from 'livekit-client';
import { 
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, Users, MessageSquare, PhoneOff,
  Clock, Pin, LayoutGrid, LayoutList,
  SendHorizontal, Edit2, ShieldCheck, AlertTriangle, Copy, Check, Settings,
  MoreHorizontal, BarChart3, Volume2, VolumeX, Info, Languages, Sparkles, Sliders, Minimize2, Maximize2, Smile,
  LogOut, UserCheck, X, Hand, Paperclip
} from 'lucide-react';
import { ScreenAnnotation } from './ScreenAnnotation';
import { WorkspacePanel } from './WorkspacePanel';
import { DeviceSettingsModal } from './DeviceSettingsModal';
import { getParticipantInitials } from '../utils/getParticipantInitials';

// Web Audio API Synthesized sound effects
let audioCtx: AudioContext | null = null;
const getAudioCtx = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
};

let ringInterval: any = null;

// Dialing ringing sound (like WhatsApp call)
export const startRingSound = () => {
  if (ringInterval) return;
  try {
    const ctx = getAudioCtx();
    const playRing = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      gain.gain.setValueAtTime(0.015, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 1.5);
      
      osc.start();
      osc.stop(ctx.currentTime + 1.5);
    };
    playRing();
    ringInterval = setInterval(playRing, 2500);
  } catch (e) {
    console.warn('Audio play blocked:', e);
  }
};

export const stopRingSound = () => {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
};

// Handshake confirmation chime (silenced)
export const playHandshakeConfirmSound = () => {
  // Permanently silenced to prevent annoying background noise
};

export const playUserJoinSound = () => {
  // Silenced to prevent annoying background chime during reconnects
};

// Role labels shown on tiles / in the participants list. The database
// stores raw values ('HOST', 'GUEST', 'CoHost', 'Participant', ...);
// tiles must show the real role, never a hardcoded one.
export const displayRoleLabel = (role?: string | null): string => {
  const r = (role || '').toLowerCase().replace(/[-_\s]/g, '');
  if (r === 'host' || r === 'admin') return 'Host';
  if (r === 'cohost') return 'Co-host';
  if (r === 'guest') return 'Guest';
  if (r === 'speaker') return 'Speaker';
  return 'Participant';
};

// Hand-raise reasons arrive as the menu label ('🙋 Question') or the bare
// word ('Question'). Map either form to its sound key; anything else
// (including "Just Raise Hand") gets the neutral default.
export const handRaiseSoundKey = (reason?: string | null): string => {
  const r = (reason || '').toLowerCase();
  if (r.includes('urgent')) return 'hand-urgent';
  if (r.includes('question')) return 'hand-question';
  if (r.includes('comment')) return 'hand-comment';
  if (r.includes('idea')) return 'hand-idea';
  return 'hand-raise';
};

// Fix Round 6 (audio): ONE microphone capture recipe for the whole
// room. Every mic acquisition (first join, device switch, test) must
// request the same processing — echo cancellation, noise suppression,
// automatic gain control, mono voice capture — or a device switch
// silently changes what the other side hears. `ideal` (never `exact`)
// for channelCount, so a mono-only request can never fail a device.
export const micAudioConstraints = (deviceId?: string): MediaTrackConstraints => {
  const c: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
};

export interface ChatMessage {
  id?: string;
  sender: string;
  text: string;
  time: string;
  self: boolean;
  // Set only on a just-sent message rendered optimistically, until the
  // real database row for it shows up.
  pending?: boolean;
}

// Keep a just-sent (optimistic) message visible until the database row
// for it shows up, then let the real row replace it — so the same
// message never appears twice. Used by the chat poll, the post-send
// reload, and the file-share reload alike.
export const mergeChatWithPending = (dbMessages: ChatMessage[], prev: ChatMessage[]): ChatMessage[] => {
  const pending = prev.filter(m => m.pending && typeof m.id === 'string' && (m.id as string).startsWith('local-'));
  const unmatched = pending.filter(t => !dbMessages.some(d => d.sender === t.sender && d.text === t.text));
  return unmatched.length ? [...dbMessages, ...unmatched] : dbMessages;
};

interface Participant {
  id: string;
  userId?: string;
  name: string;
  avatar: string;
  role: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isVideoOn: boolean;
  avatarBg: string;
}

interface HandRaise {
  userId: string;
  name: string;
  timestamp: number;
  reason?: string;
}

export const getWebRTCScreenshareConstraints = () => {
  // Relax constraints to prevent mobile browsers (iOS/Android) from falling back
  // to the webcam or throwing OverconstrainedError when trying to capture screen display media.
  return {
    video: {
      frameRate: { max: 15 }
    },
    audio: false
  };
};

import { giinApi, supabase, ensureMeetingRoom, generateMeetingPasscode, buildJoinLink } from '../supabaseClient';

// Helper functions defined outside the component to satisfy purity rules
const generateRandomId = () => {
  return Math.random().toString(36).substr(2, 9);
};

const generateRandomOffset = () => {
  return Math.floor(Math.random() * 30 - 15);
};

interface MeetingRoomProps {
  meetingId: string;
  meetingTitle: string;
  onEndMeeting: (skipServerEnd?: boolean) => void;
  onSaveWorkspaceData?: (notes: string, actionItemsCount: number) => void;
  currentUser: { id: string; name: string; email: string } | null;
  initialVideoState?: boolean;
  initialMutedState?: boolean;
  isP2PCall?: boolean;
  isHost?: boolean;
  isMinimized?: boolean;
  onMinimizeToggle?: (minimized: boolean) => void;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ 
  meetingId, 
  meetingTitle, 
  onEndMeeting, 
  onSaveWorkspaceData, 
  currentUser,
  initialVideoState = true,
  initialMutedState = false,
  isP2PCall = false,
  isHost = false,
  isMinimized = false,
  onMinimizeToggle
}) => {
  const sigChannelRef = useRef<any>(null);
  // Fix Round 7 (#1): set once our own participant row has been seen
  // in a participants poll - the self-row-gone check only fires after
  // that, so a slow first load never ejects a fresh joiner.
  const seenOwnRowRef = useRef(false);
  // Fix Round 7 (#6): true while a lock persist is in flight, so the
  // meeting-watcher's lock sync cannot undo the host's own toggle.
  const lockWriteInFlightRef = useRef(false);
  const localAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const localVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  // Fix Round 6: the raw mic capture vs the track actually published.
  // When Studio Voice is on, the published track is the WebAudio
  // destination track and the raw capture feeds it — the two are
  // different objects and must never be confused (stopping the raw
  // track silences the enhancement; stopping the destination track
  // leaves the raw capture running with the mic light on).
  const localMicRawTrackRef = useRef<MediaStreamTrack | null>(null);
  const enhancerChainRef = useRef<{
    rawTrack: MediaStreamTrack;
    destTrack: MediaStreamTrack;
    nodes: { source: MediaStreamAudioSourceNode; highpass: BiquadFilterNode; bandpass: BiquadFilterNode; compressor: DynamicsCompressorNode; dest: MediaStreamAudioDestinationNode };
  } | null>(null);
  const isAudioEnhancedRef = useRef(false);
  // Speaking-indicator analysers, one per peer (plus the local mic).
  // A new analyser per ontrack / re-subscribe used to pile up rAF loops
  // that never stopped; the registry dedupes by stream and can stop them.
  const speakingAnalysersRef = useRef<{ [key: string]: { streamId: string; stopped: boolean; raf: number; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; extraNodes: AudioNode[] } }>({});
  // What media engine each peer is on, from their presence broadcasts.
  // Decides whether a P2P link to them is needed at all (see below).
  const peerEnginesRef = useRef<{ [peerKey: string]: string }>({});
  // Warn once per session if the browser reports mic processing off.
  const micProcessingWarnedRef = useRef(false);
  const reconnectTimersRef = useRef<{[key: string]: any}>({});

  // Minimized floating window dragging state
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: window.innerHeight - 220 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // --- CONSOLIDATED HOOK STATES & REFS BLOCK (Prevents TDZ errors) ---
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Local recording (free tier): records the local camera + mic stream on
  // this device with MediaRecorder and downloads a .webm file on stop.
  // It does not record remote participants (that needs cloud recording).
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const startRecording = () => {
    if (isRecording) return;
    if (typeof MediaRecorder === 'undefined') {
      triggerToast('Recording is not supported in this browser.');
      return;
    }
    if (!stream) {
      triggerToast('Turn your camera or mic on to record.');
      return;
    }
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
      recordedChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data); };
      rec.onstop = () => {
        try {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'giinmeet-recording-' + meetingId + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          triggerToast('Recording saved to your downloads.');
        } catch (e) {
          triggerToast('Could not save the recording.');
        }
      };
      rec.start(1000);
      mediaRecorderRef.current = rec;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
      triggerToast('Recording started. It saves on this device when you stop.');
    } catch (e) {
      triggerToast('Recording could not start in this browser.');
    }
  };
  const stopRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    } catch (e) {}
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };
  const [isMuted, setIsMuted] = useState(initialMutedState);
  const [isVideoOn, setIsVideoOn] = useState(initialVideoState);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [activePanel, setActivePanel] = useState<'none' | 'chat' | 'participants' | 'workspace' | 'host-settings' | 'polls' | 'filters' | 'soundboard' | 'info' | 'transcript'>('none');
  const [copiedInfo, setCopiedInfo] = useState<'link' | 'details' | null>(null);
  // In-room invite by email: no mail provider is configured, so this
  // opens the user's own mail app with the invitation pre-filled (a real
  // mailto:) and copies the link — it never claims an email was sent.
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [showMeetingInfo, setShowMeetingInfo] = useState(false);

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Ref mirrors of local media state. The WebRTC signalling effect
  // re-runs only when [passcode, stream, isMediaInitialized, breakoutRoom]
  // change, so the isScreenSharing / isVideoOn / isMuted values inside
  // its closures are frozen at the last run: every 6s its presence
  // broadcast would otherwise re-send a STALE isScreenSharing=false and
  // flip every receiver's screen-share layout back off, and mute/video
  // toggles would broadcast the same stale flag. Broadcasts read these
  // refs instead.
  const isScreenSharingRef = useRef(false);
  const isVideoOnRef = useRef(initialVideoState);
  const isMutedRef = useRef(initialMutedState);
  // Ref mirror of screenStream: stopScreenShare and initPeerConnection
  // close over stale state where the stream is still null (see below).
  const screenStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { isVideoOnRef.current = isVideoOn; }, [isVideoOn]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  const [meetingAdminId, setMeetingAdminId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>(() => generateMeetingPasscode());
  const [isMediaInitialized, setIsMediaInitialized] = useState(false);
  const [waitingList, setWaitingList] = useState<any[]>([]);
  const [initialNotes, setInitialNotes] = useState<string>('');
  const [localAdminId, setLocalAdminId] = useState<string>('');
  // Host truth: the meeting row's admin_id is the current host (it moves
  // on transfer). The isHost prop is only the fallback until the row
  // loads; localAdminId is the live override from host-transfer signals.
  // (Fix Round 6 / Phase 6: the old derivation never consulted the row,
  // so a transferred host gained no powers and the old host kept them.)
  const isAdmin = (meetingAdminId ? meetingAdminId === currentUser?.id : isHost) || (currentUser != null && localAdminId === currentUser.id);

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [selectedNewAdminId, setSelectedNewAdminId] = useState<string>('');
  const [leaveOption, setLeaveOption] = useState<'transfer' | 'end' | null>(null);

  // Fix Round 6 (Phase 6) — end-for-all state. endedState renders the
  // "meeting ended" screen; endedRef makes entering it idempotent so
  // the broadcast, the Realtime watcher and the poll cannot end the
  // meeting twice or fight the reconnect logic.
  // Round 9 (9A): 'removed' is a kicked participant; durationSeconds /
  // attendeeCount are captured when the room ends, for the ended screen.
  const [endedState, setEndedState] = useState<{ reason: 'host-ended' | 'you-ended' | 'removed'; detail?: string; durationSeconds?: number; attendeeCount?: number } | null>(null);
  const [endError, setEndError] = useState<string>('');
  const [endingInProgress, setEndingInProgress] = useState(false);
  const endedRef = useRef(false);
  const eventsChannelRef = useRef<any>(null);

  // Host Meeting Settings States
  const [isWaitingRoomEnabled, setIsWaitingRoomEnabled] = useState(true);
  const [isChatLocked, setIsChatLocked] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Floating Emoji Reactions State
  const [activeReactions, setActiveReactions] = useState<{ id: string; senderKey: string; emoji: string; offset: number }[]>([]);
  const [showEmojiReactions, setShowEmojiReactions] = useState(false);

  // Q&A Board States
  const [qaQuestions, setQaQuestions] = useState<{ id: string; text: string; author: string; upvotes: number; upvotedBy: string[] }[]>([]);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [isQAActive, setIsQAActive] = useState(false);

  // Handraise / Speaker Queue States
  const [handRaises, setHandRaises] = useState<HandRaise[]>([]);
  const [localHandRaised, setLocalHandRaised] = useState(false);
  const [handRaiseReason, setHandRaiseReason] = useState<string | null>(null);
  const [showHandRaiseMenu, setShowHandRaiseMenu] = useState(false);

  // Sound effects (hand-raise chimes + soundboard) on/off for this device.
  // Persisted locally; this is the "mute" for notification sounds — it
  // never touches the microphone or anyone else's audio. The long-lived
  // realtime handlers read it through the ref so they never see a stale
  // value.
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('giin_sound_effects') !== 'off'; } catch (e) { return true; }
  });
  const soundEffectsEnabledRef = useRef(soundEffectsEnabled);
  const toggleSoundEffects = () => {
    const next = !soundEffectsEnabledRef.current;
    soundEffectsEnabledRef.current = next;
    try { localStorage.setItem('giin_sound_effects', next ? 'on' : 'off'); } catch (e) { /* ignore */ }
    setSoundEffectsEnabled(next);
  };

  const [engineType, setEngineType] = useState<'LIVEKIT' | 'P2P'>('LIVEKIT');
  // Ref mirror: the signalling closures were created before the last
  // engine change, so they must read the live value from here.
  const engineTypeRef = useRef<'LIVEKIT' | 'P2P'>('LIVEKIT');
  useEffect(() => { engineTypeRef.current = engineType; }, [engineType]);
  const [livekitToken, setLivekitToken] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  // Bumped to force the LiveKit connect effect to re-run (disconnect +
  // reconnect with a fresh token) when the token nears expiry.
  const [livekitReconnectNonce, setLivekitReconnectNonce] = useState(0);
  // Fix Round 8 (#7/#8): the room's reconnect state, kept quiet. The
  // LiveKit SDK heals transient drops itself — the app must not tear
  // the room down on every wobble (that was the tile flicker AND the
  // "client initiated disconnect" that stranded rooms on P2P). This
  // flag only drives the gentle "Reconnecting..." overlay on the tiles
  // and the toolbar dot; participants never see an error about it.
  const [isLivekitReconnecting, setIsLivekitReconnecting] = useState(false);
  const livekitReconnectTimerRef = useRef<any>(null);
  // Bounded automatic LiveKit recovery while on the P2P fallback:
  // at most 5 silent retries, one a minute, plus one on 'online'.
  const p2pLivekitRetriesRef = useRef(0);
  const [livekitRemoteStreams, setLivekitRemoteStreams] = useState<{ [peerKey: string]: MediaStream }>({});
  // --- Fix Round 5: video stability -------------------------------------
  // LiveKit room membership, tracked SEPARATELY from media tracks. A
  // participant who publishes no tracks (no camera, no mic) never fires
  // TrackSubscribed, so the old code — which treated "has a MediaStream"
  // as "is connected" — left their tile on "Connecting..." forever. These
  // are keyed by LiveKit identity (for guests: the meeting_participants
  // row id — see the token route).
  const [livekitParticipantIds, setLivekitParticipantIds] = useState<Set<string>>(new Set<string>());
  // Peers with a published LiveKit CAMERA track (even if it is not
  // subscribed / has no live frames yet). "Connecting..." is only honest
  // while such a publication exists and no live video has arrived.
  const [livekitCameraPubs, setLivekitCameraPubs] = useState<{ [peerKey: string]: boolean }>({});
  // Peers whose LiveKit camera publication is muted at the source.
  const [livekitVideoMuted, setLivekitVideoMuted] = useState<{ [peerKey: string]: boolean }>({});
  // Remote publications by "<peerKey>:<trackSid>", for the watchdog's
  // re-subscribe recovery.
  const livekitPublicationsRef = useRef<{ [key: string]: any }>({});
  // Local camera liveness. `localVideoTrackRef` alone cannot drive the
  // tile: enabling an ENDED track is a no-op, so the tile must know
  // whether the track is actually live.
  const [localCameraLive, setLocalCameraLive] = useState(false);
  const [localCameraRecovering, setLocalCameraRecovering] = useState(false);
  const localCameraRecoverRef = useRef({ inFlight: false, attempts: 0, lastAt: 0 });
  const livekitRoomRef = useRef<any>(null);
  // The room slug/id of the LiveKit room we minted for, so the token
  // refresh can re-mint for the same room without re-running the whole
  // connect effect (and so leaving can free our capacity slot).
  const livekitRoomSlugRef = useRef<string | null>(null);
  const livekitRoomIdRef = useRef<string | null>(null);
  // Fix Round 6 (Phase 6) — enter the ended state. Disconnects the media
  // (LiveKit room + P2P links) and shows the "meeting ended" screen.
  // Idempotent: the broadcast, the Realtime watcher and the poll can all
  // fire, but the meeting only ends once. Audio capture/publish code is
  // untouched — this only disconnects the room and closes peer links;
  // track stopping happens on unmount as before.
  const enterEndedState = useCallback((reason: 'host-ended' | 'you-ended' | 'removed', detail?: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Round 9 (9A): capture the meeting length and headcount now — the
    // participant list is torn down with the room, so it cannot be read
    // later when the ended screen renders.
    const endedDurationSeconds = elapsedSecondsRef.current;
    const endedAttendeeCount = participantsRef.current.length + 1;
    try {
      if (livekitRoomRef.current) livekitRoomRef.current.disconnect();
    } catch (e) { /* already gone */ }
    livekitRoomRef.current = null;
    try {
      Object.keys(pcsRef.current).forEach(peerKey => {
        try { pcsRef.current[peerKey]?.close(); } catch (e) { /* already closed */ }
      });
    } catch (e) { /* already gone */ }
    pcsRef.current = {};
    setEndedState({ reason, detail, durationSeconds: endedDurationSeconds, attendeeCount: endedAttendeeCount });
  }, []);

  // Our server-derived role for this meeting (HOST / COHOST / GUEST).
  // Co-hosts get admit + mute powers; the token route is the authority.
  const [livekitRole, setLivekitRole] = useState<'HOST' | 'COHOST' | 'GUEST'>('GUEST');
  // Poll the co-host list: the host grants it from the participants panel
  // and the token route confirms it on the next mint.
  useEffect(() => {
    let active = true;
    const loadCoHosts = async () => {
      const rows = await giinApi.getCoHosts(meetingId);
      if (!active) return;
      const keys = new Set<string>();
      rows.forEach((r: any) => {
        if (r.user_id) keys.add(r.user_id);
        if (r.id) keys.add(r.id);
      });
      setCoHostKeys(keys);
    };
    loadCoHosts();
    const interval = setInterval(loadCoHosts, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [meetingId]);
  // Mint a fresh LiveKit token for a room slug. Shared by the connect
  // effect and the early token refresh, so both mint identically.
  const fetchLiveKitToken = async (roomSlug: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    // Fix Round 7 (#14): re-read the participant row id on every mint
    // - the mount-time value can go stale if the row was deleted and
    // re-created (kick + re-admit), and a stale id fails the refresh
    // with ADMISSION_REQUIRED.
    let freshRowId: string | undefined;
    try { freshRowId = localStorage.getItem(`giin_participant_row_${meetingId}`) || undefined; } catch (e) { /* storage unavailable */ }
    const res = await fetch('/api/livekit/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomSlug,
        userId: myKey,
        userName: currentUser?.name || 'Guest',
        role: isAdmin ? 'HOST' : 'GUEST',
        accessToken: session?.access_token || undefined,
        participantRowId: freshRowId || myParticipantRowId || undefined,
        meetingId
      })
    });
    return res.json();
  };
  // The LiveKit screen-share publication, so it can be unpublished when
  // sharing stops (and re-published after a token-refresh reconnect).
  const livekitScreenTrackRef = useRef<MediaStreamTrack | null>(null);
  // Guards the token-refresh reconnect so the 1s expiry interval cannot
  // start it twice.
  const tokenRefreshingRef = useRef(false);

  // Publish (or replace) one local track on the LiveKit room. This is the
  // single place that talks to LiveKit about local tracks: the connect
  // effect, device switches, and screen share all go through here, so a
  // camera/mic/screen change can never silently leave LiveKit serving a
  // stale (stopped) track. Safe to call when LiveKit is not connected —
  // it simply does nothing.
  const publishLiveKitTrack = async (track: MediaStreamTrack, source: any) => {
    const room = livekitRoomRef.current;
    if (!room || !track) return;
    try {
      // A camera re-acquired while the room is reconnecting used to be
      // silently dropped (early return, never retried) — the remote side
      // then never saw video again until the next toggle. Retry once
      // after a short delay instead.
      if (room.state !== 'connected') {
        setTimeout(() => {
          const retryRoom = livekitRoomRef.current;
          if (retryRoom && retryRoom.state === 'connected' && track.readyState === 'live') {
            void publishLiveKitTrack(track, source);
          }
        }, 2000);
        return;
      }
      const existing = room.localParticipant.getTrackPublication(source);
      if (existing && existing.track) {
        // An ended track is not "already published": unpublish it so the
        // fresh track below actually replaces it instead of early-returning.
        if (existing.track === track && existing.track.readyState === 'live') return; // already published
        const oldTrack = existing.track;
        await room.localParticipant.unpublishTrack(oldTrack);
        // The room runs with stopLocalTrackOnUnpublish:false (the Studio
        // Voice enhancer feeds off the raw mic track, so unpublishing it
        // must not stop it — the SDK default would kill the chain).
        // Stop a replaced track explicitly here instead — unless it is
        // the enhancer's live source, which the chain still needs.
        if (oldTrack !== enhancerChainRef.current?.rawTrack) {
          try { oldTrack.stop(); } catch (e) {}
        }
      }
      // Fix Round 8 (#4): on a phone, cap the camera uplink — a phone
      // camera can push 720p+ into a weak mobile connection and
      // saturate it, which reads as "very bad signal" for everyone.
      // Fix Round 8 (#9): publish an explicit 720p encoding with
      // simulcast on every camera uplink. The old code published the
      // raw 640x480 capture with SDK defaults, so on a weak connection
      // the room stayed on the lowest layer and the picture looked
      // dull from both sides. The phone cap stays (a phone camera can
      // saturate a weak link); LiveKit still adapts down gracefully.
      const isPhoneUplink = typeof window !== 'undefined' && window.innerWidth < 768;
      const publishOptions: any = source === Track.Source.Camera
        ? isPhoneUplink
          ? { source, videoEncoding: { maxBitrate: 800_000, maxFramerate: 24 }, simulcast: true }
          : { source, videoEncoding: { maxBitrate: 1_500_000, maxFramerate: 30 }, simulcast: true }
        : { source };
      await room.localParticipant.publishTrack(track, publishOptions);
    } catch (e) {
      console.warn('[LiveKit] Could not publish track:', e);
    }
  };

  // Unpublish one local track from the LiveKit room (device switch / stop).
  const unpublishLiveKitTrack = async (source: any) => {
    const room = livekitRoomRef.current;
    if (!room) return;
    try {
      const existing = room.localParticipant.getTrackPublication(source);
      if (existing && existing.track) {
        await room.localParticipant.unpublishTrack(existing.track);
      }
    } catch (e) {
      console.warn('[LiveKit] Could not unpublish track:', e);
    }
  };

  // Fix Round 6: requesting echo cancellation / noise suppression /
  // gain control is not the same as getting it — a browser may silently
  // ignore the request (notably on phones). Read the CAPTURE track's
  // real settings after every acquisition and say so, once per session,
  // when processing is actually off: the honest fix then is headphones,
  // not another toggle. Only an explicit `false` warns — `undefined`
  // means the browser does not report it, not that it is off.
  const verifyMicProcessing = (track: MediaStreamTrack) => {
    try {
      const s = track.getSettings() as any;
      const missing: string[] = [];
      if (s.echoCancellation === false) missing.push('echo cancellation');
      if (s.noiseSuppression === false) missing.push('noise suppression');
      if (s.autoGainControl === false) missing.push('automatic gain control');
      if (missing.length === 0) return;
      console.warn('[Audio] Browser did not apply mic processing:', missing, s);
      if (!micProcessingWarnedRef.current) {
        micProcessingWarnedRef.current = true;
        triggerToast(`Your browser could not enable ${missing.join(' and ')} on this microphone — use headphones to keep your speakers out of the mic.`);
      }
    } catch (e) { /* settings unreadable — capture itself still works */ }
  };

  // Fix Round 6: publish ONE mic track everywhere it must go (LiveKit
  // + every P2P sender + local stream + speaking detector). The single
  // funnel for mic-track swaps, so a device switch, a Studio Voice
  // toggle and the first acquisition cannot diverge into a different
  // track per engine — which is how the old toggle changed nothing on
  // LiveKit while swapping the P2P senders.
  const publishMicTrack = async (track: MediaStreamTrack) => {
    localAudioTrackRef.current = track;
    track.enabled = !isMutedRef.current;
    setStream(prev => {
      const newStream = prev || new MediaStream();
      newStream.getAudioTracks().forEach(t => newStream.removeTrack(t));
      newStream.addTrack(track);
      return newStream;
    });
    Object.values(pcsRef.current).forEach(pc => {
      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender) {
        audioSender.replaceTrack(track);
      } else {
        try { pc.addTrack(track, stream || new MediaStream([track])); } catch (e) {}
      }
    });
    setupSpeakingDetection(new MediaStream([track]), myKey, true);
    await publishLiveKitTrack(track, Track.Source.Microphone);
  };

  const [isFullscreen, setIsFullscreen] = useState(false);
  const meetingRoomRef = useRef<HTMLDivElement | null>(null);

  const [breakoutRoom, setBreakoutRoom] = useState<number | null>(null);
  const [breakoutTimeRemaining, setBreakoutTimeRemaining] = useState<number | null>(null);
  const [breakoutRoomsCount, setBreakoutRoomsCount] = useState(2);
  const [breakoutDurationMinutes, setBreakoutDurationMinutes] = useState(5);

  // Meeting timer, layout and pinning, unread chat badge.
  const [meetingJoinedAt] = useState(() => Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  // Round 9 (9A): ref mirror of the timer, so enterEndedState (a
  // useCallback with empty deps) can read the meeting length at end.
  const elapsedSecondsRef = useRef(0);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'speaker'>('grid');
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  // A ref mirror of activePanel so realtime handlers (which close over the
  // first render) can tell whether the chat panel is open right now.
  const activePanelRef = useRef(activePanel);
  // Round 9 (9A): participants the host removed, kept so the host can
  // re-invite them. Their meeting_participants row stays with status
  // 'Removed' (the rejoin block), so it is fetched separately from the
  // admitted list.
  const [removedParticipants, setRemovedParticipants] = useState<any[]>([]);
  const loadRemovedParticipants = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const list = await giinApi.getRemovedParticipants(meetingId);
      setRemovedParticipants(list || []);
    } catch (e) { /* best effort */ }
  }, [isAdmin, meetingId]);
  useEffect(() => {
    if (activePanel === 'participants') loadRemovedParticipants();
  }, [activePanel, loadRemovedParticipants]);
  const [admittedKeys, setAdmittedKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`admitted_keys_${meetingId}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
      return new Set();
    }
  });

  const [polls, setPolls] = useState<any[]>([]);
  const [userVotes, setUserVotes] = useState<{ [pollId: string]: number }>({});
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptions, setNewPollOptions] = useState(['', '']);
  const [videoFilter, setVideoFilter] = useState('none');

  const [isAudioEnhanced, setIsAudioEnhanced] = useState(false);
  // Ref mirror of the Studio Voice flag: mic swaps close over the flag
  // and must re-apply the chain, not silently drop it.
  useEffect(() => { isAudioEnhancedRef.current = isAudioEnhanced; }, [isAudioEnhanced]);
  const [isStudioLightEnabled, setIsStudioLightEnabled] = useState(false);
  
  const [isMeetingLocked, setIsMeetingLocked] = useState(false);
  const [isScreenShareBlockedForGuests, setIsScreenShareBlockedForGuests] = useState(false);
  // Fix Round 8 (#3): screen-share feedback state — a click that opens
  // nothing must never look dead again.
  const [screenShareStarting, setScreenShareStarting] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  // A share can end without the user stopping it: on iPhones the OS ends
  // the capture track when the broadcast is interrupted (app switch,
  // incoming call, screen lock, Control Centre). The track's onended
  // handler must tell that apart from a deliberate stop, or the share
  // silently vanishes. Set true before any deliberate stop.
  const screenShareStoppedByUserRef = useRef(false);
  const [isMuteOnEntryEnabled, setIsMuteOnEntryEnabled] = useState(false);

  const [isCaptionsEnabled, setIsCaptionsEnabled] = useState(false);
  const [transcripts, setTranscripts] = useState<{ name: string; text: string; time: string }[]>([]);
  const [activeCaption, setActiveCaption] = useState<{ name: string; text: string } | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Guests have no signed-in account, so they get a stable random UUID for
  // this visit. It must be a UUID: the token route registers the participant
  // by user_id, and a non-UUID guest key broke that upsert.
  const [myKey] = useState(() => currentUser?.id || crypto.randomUUID());
  // Our own meeting_participants row id (set when we joined via the
  // waiting room / host creation flow). Guests have user_id NULL in the
  // database, so this row id — not myKey — is the only reliable way to
  // identify our own row (e.g. when the host kicks us).
  const [myParticipantRowId] = useState<string | null>(() => {
    try { return localStorage.getItem(`giin_participant_row_${meetingId}`); } catch (e) { return null; }
  });
  // Co-host keys (user ids and participant row ids) granted by the host.
  // Derived AFTER myKey/myParticipantRowId exist (TDZ: these consts are
  // read during render, so they must sit below those declarations).
  const [coHostKeys, setCoHostKeys] = useState<Set<string>>(new Set());
  const isCoHost =
    livekitRole === 'COHOST' ||
    coHostKeys.has(myKey) ||
    (myParticipantRowId ? coHostKeys.has(myParticipantRowId) : false);
  // Hosts and co-hosts can admit from the waiting room and mute people.
  // Ending the meeting for everyone and transferring the host role stay
  // host-only.
  const canModerate = !!isAdmin || isCoHost;
  const pcsRef = useRef<{ [peerKey: string]: RTCPeerConnection }>({});
  const initPeerConnectionRef = useRef<((peerKey: string, forceAudioOnly?: boolean) => void) | null>(null);
  const makingOfferRef = useRef<{ [peerKey: string]: boolean }>({});
  const pcCandidatesRef = useRef<{ [peerKey: string]: any[] }>({});
  const [remoteStreams, setRemoteStreams] = useState<{ [peerKey: string]: MediaStream }>({});
  
  const [stickyNotes, setStickyNotes] = useState<{ id: string; x: number; y: number; text: string; color: string }[]>([]);
  const [whiteboardTool, setWhiteboardTool] = useState<'pen' | 'line' | 'rect' | 'circle' | 'sticky'>('pen');
  
  const [aiSummary, setAiSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSummaryTabActive, setIsSummaryTabActive] = useState(false);

  const [isSpatialAudioEnabled, setIsSpatialAudioEnabled] = useState(() => localStorage.getItem('giin_spatial_audio') === 'true');
  const spatialAudioNodesRef = useRef<{ [peerKey: string]: { source: MediaStreamAudioSourceNode; panner: StereoPannerNode } }>({});
  const spatialAudioCtxRef = useRef<AudioContext | null>(null);

  const [peerStates, setPeerStates] = useState<{ 
    [peerKey: string]: { 
      name: string; 
      isVideoOn: boolean; 
      isMuted: boolean; 
      isScreenSharing: boolean;
      screenTrackId?: string | null;
      isSpeaking: boolean;
      latency?: number; 
      videoFilter?: string;
      isStudioLightEnabled?: boolean;
      isReconnecting?: boolean;
    } 
  }>({});

  // Ref mirrors for the long-lived signalling handlers: ontrack and the
  // media-state / presence handlers close over stale state, so they read
  // peer state and remote streams through these refs instead.
  const peerStatesRef = useRef(peerStates);
  const remoteStreamsRef = useRef(remoteStreams);
  useEffect(() => { peerStatesRef.current = peerStates; }, [peerStates]);
  useEffect(() => { remoteStreamsRef.current = remoteStreams; }, [remoteStreams]);

  const [selectedCamera, setSelectedCamera] = useState(() => localStorage.getItem('giin_selected_camera') || '');
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem('giin_selected_mic') || '');
  const [selectedSpeaker, setSelectedSpeaker] = useState(() => localStorage.getItem('giin_selected_speaker') || '');
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Fix Round 8 (#10): a control call (kick) in flight. The button is
  // disabled while its request runs, so a second click cannot stack
  // another request on a degraded connection.
  const [busyControlKey, setBusyControlKey] = useState<string | null>(null);
  // Persistent banner shown whenever the call is running peer-to-peer because
  // the LiveKit server could not be reached. A degraded connection is never
  // silent: the user must know video quality may be lower.
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };


  const participantsRef = useRef<Participant[]>([]);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // --------------------------------------------------------------------

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      let newX = e.clientX - dragStart.current.x;
      let newY = e.clientY - dragStart.current.y;
      
      newX = Math.max(10, Math.min(window.innerWidth - 340, newX));
      newY = Math.max(10, Math.min(window.innerHeight - 200, newY));
      
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Picture-in-Picture API helper
  const handleTogglePictureInPicture = async () => {
    try {
      const videoEl = document.querySelector('.remote-video-feed') as HTMLVideoElement || document.querySelector('video') as HTMLVideoElement;
      if (!videoEl) {
        alert('No active video stream found to pop out.');
        return;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoEl.requestPictureInPicture();
      }
    } catch (error) {
      console.warn('Picture-in-Picture API failed:', error);
    }
  };

  // Relocated states to consolidated top block

  // Connect to LiveKit SFU Engine
  // Way back from P2P: once LiveKit fails the session is stuck on the
  // peer-to-peer mesh (the connect effect early-returns unless the engine
  // is LIVEKIT). The degraded banner offers this retry; it re-runs the
  // connect effect, which fetches a fresh token, so a fixed server is
  // picked up without rejoining the meeting.
  const handleRetryLiveKit = () => {
    // Fix Round 8 (#8): silent retry — no toast. The toolbar dot
    // shows whether the room is back on the video server.
    setConnectionNotice(null);
    setEngineType('LIVEKIT');
    setLivekitReconnectNonce(n => n + 1);
  };

  // Fix Round 8 (Evidence 1): the P2P fallback is a bridge, not a
  // destination. While the room is on P2P, silently retry LiveKit
  // once a minute (at most 5 times a session) and once when the
  // browser reports it is back online. A retry that lands returns
  // the room to LiveKit with no message; a retry that fails stays
  // on P2P just as quietly.
  useEffect(() => {
    if (engineType !== 'P2P' || endedRef.current) return;
    const tryLiveKitAgain = () => {
      if (endedRef.current) return;
      if (p2pLivekitRetriesRef.current >= 5) return;
      p2pLivekitRetriesRef.current += 1;
      setEngineType('LIVEKIT');
      setLivekitReconnectNonce(n => n + 1);
    };
    const onOnline = () => { tryLiveKitAgain(); };
    window.addEventListener('online', onOnline);
    const timer = setInterval(tryLiveKitAgain, 60000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [engineType]);

  // --- Fix Round 5: video-stability helpers ------------------------------
  // Keep the LiveKit membership set in sync.
  const markLivekitParticipant = (peerKey: string, present: boolean) => {
    setLivekitParticipantIds(prev => {
      const next = new Set(prev);
      if (present) next.add(peerKey); else next.delete(peerKey);
      return next;
    });
  };

  // Record / forget one remote LiveKit publication. Camera publications
  // are what make "Connecting..." honest; anything else is camera-off.
  const noteLivekitPublication = (publication: any, peerKey: string) => {
    if (!publication || !peerKey) return;
    livekitPublicationsRef.current[`${peerKey}:${publication.trackSid}`] = publication;
    if (publication.kind === 'video' && publication.source === Track.Source.Camera) {
      setLivekitCameraPubs(prev => (prev[peerKey] ? prev : { ...prev, [peerKey]: true }));
      if (publication.isMuted) setLivekitVideoMuted(prev => ({ ...prev, [peerKey]: true }));
    }
  };
  const forgetLivekitPublication = (publication: any, peerKey: string) => {
    if (!publication || !peerKey) return;
    delete livekitPublicationsRef.current[`${peerKey}:${publication.trackSid}`];
    if (publication.kind === 'video' && publication.source === Track.Source.Camera) {
      setLivekitCameraPubs(prev => {
        if (!prev[peerKey]) return prev;
        const next = { ...prev };
        delete next[peerKey];
        return next;
      });
      setLivekitVideoMuted(prev => {
        if (!prev[peerKey]) return prev;
        const next = { ...prev };
        delete next[peerKey];
        return next;
      });
    }
  };

  // Drop a LiveKit remote peer's streams entirely (leave / disconnect),
  // so no tile keeps showing a dead or empty stream as video.
  const clearLivekitPeerStreams = (peerKey: string) => {
    setLivekitRemoteStreams(prev => {
      if (!prev[peerKey]) return prev;
      const next = { ...prev };
      delete next[peerKey];
      return next;
    });
    setRemoteScreenStreams(prev => {
      if (!prev[peerKey]) return prev;
      const next = { ...prev };
      delete next[peerKey];
      return next;
    });
  };

  // Resume any <video> element in the room that the browser paused
  // (backgrounded tab, autoplay policy). Harmless on elements already playing.
  const resumeVideoElements = () => {
    try {
      const root = meetingRoomRef.current || document;
      root.querySelectorAll('video').forEach((el: any) => {
        if (el.srcObject && el.paused) el.play().catch(() => {});
      });
    } catch (e) { /* video resume is best-effort */ }
  };

  // Attach the liveness handler to a freshly acquired local camera track.
  // An ended camera used to stay "on" forever (enabling an ended track
  // does nothing) — now it triggers a reacquisition instead of a black tile.
  const attachLocalCameraTrack = (track: MediaStreamTrack) => {
    localVideoTrackRef.current = track;
    setLocalCameraLive(track.readyState === 'live');
    track.onended = () => {
      // Only the CURRENT track may trigger a reacquire: stopping a
      // superseded track (camera switch, unmount) must not spin up a
      // new camera.
      if (localVideoTrackRef.current !== track) return;
      setLocalCameraLive(false);
      if (isVideoOnRef.current) void reacquireLocalCamera('track-ended');
    };
  };

  // Re-acquire the local camera after it ended / went missing, with
  // backoff and a hard stop so a dead camera cannot spin getUserMedia
  // forever. On final failure the camera is honestly OFF (avatar + toast),
  // never a black tile.
  const reacquireLocalCamera = async (reason: string) => {
    const guard = localCameraRecoverRef.current;
    if (!isVideoOnRef.current || guard.inFlight) return;
    const now = Date.now();
    if (now - guard.lastAt < 1000) return; // backoff: at most one attempt/sec
    if (guard.attempts >= 3) {
      setIsVideoOn(false);
      setLocalCameraRecovering(false);
      triggerToast('Your camera stopped and could not be restarted — you are showing as camera off. Turn your camera on again to retry.');
      return;
    }
    guard.inFlight = true;
    guard.attempts += 1;
    guard.lastAt = now;
    setLocalCameraRecovering(true);
    try {
      const savedCam = localStorage.getItem('giin_selected_camera');
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: savedCam ? { deviceId: { exact: savedCam }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error('No video track acquired');
      const oldTrack = localVideoTrackRef.current;
      if (oldTrack && oldTrack !== videoTrack && oldTrack.readyState !== 'live') {
        try { oldTrack.stop(); } catch (e) {}
      }
      videoTrack.enabled = true;
      attachLocalCameraTrack(videoTrack);
      setStream(prev => {
        const newStream = prev || new MediaStream();
        newStream.getVideoTracks().forEach(t => newStream.removeTrack(t));
        newStream.addTrack(videoTrack);
        return newStream;
      });
      Object.values(pcsRef.current).forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) videoSender.replaceTrack(videoTrack).catch(() => {});
      });
      await publishLiveKitTrack(videoTrack, Track.Source.Camera);
      guard.attempts = 0;
      setLocalCameraRecovering(false);
      resumeVideoElements();
    } catch (err) {
      console.warn('[LiveKit] Camera reacquire failed (' + reason + '):', err);
      setLocalCameraRecovering(false);
      // Next watchdog tick / toggle retries (backed off); after 3
      // attempts the guard above turns the camera honestly off.
    } finally {
      guard.inFlight = false;
    }
  };

  // One honest tile state for a remote peer, used by the grid and the
  // direct-call view alike. A tile shows live video ONLY when a live
  // video track is actually flowing; "Connecting..." ONLY while a camera
  // publication exists but its frames have not arrived yet (or the P2P
  // handshake is still in flight). Everyone else is "Camera Off" —
  // including a participant who never publishes any track at all.
  const getRemoteTileState = (peerKey: string) => {
    const livekitStream = livekitRemoteStreams[peerKey];
    const p2pStream = remoteStreams[peerKey];
    const activeStreamObj = livekitStream || p2pStream;
    const liveVideoTracks = activeStreamObj
      ? activeStreamObj.getVideoTracks().filter((t: MediaStreamTrack) => t.readyState === 'live')
      : [];
    const hasLiveVideo = liveVideoTracks.length > 0;
    const ps = peerStates[peerKey];
    const peerStateKnown = !!ps;
    const signalledVideoOff = peerStateKnown && ps.isVideoOn === false;
    const videoMuted = !!livekitVideoMuted[peerKey];
    const hasCameraPub = !!livekitCameraPubs[peerKey];
    const isPresent = livekitParticipantIds.has(peerKey) || activePeerKeys.includes(peerKey) || peerStateKnown;
    const p2pConnecting = engineType !== 'LIVEKIT' && activePeerKeys.includes(peerKey) && !activeStreamObj;
    const connecting = (hasCameraPub && !hasLiveVideo) || p2pConnecting;
    const showVideo = hasLiveVideo && !videoMuted && !signalledVideoOff;
    return { activeStreamObj, hasLiveVideo, showVideo, connecting, isPresent, hasCameraPub };
  };

  useEffect(() => {
    if (!isMediaInitialized || engineType !== 'LIVEKIT') return;

    let active = true;
    const connectToLiveKit = async () => {
      try {
        // Find (or create) the LiveKit room for this meeting, then request a
        // token for that room. The token route looks the room up by its slug —
        // a meeting ID on its own is not a room.
        let videoRoom = await ensureMeetingRoom(meetingId, meetingTitle, currentUser?.id);
        if (!videoRoom) {
          // Fix Round 7 (#8): a guest can arrive before the host's room
          // row exists, or room creation can fail transiently - retry
          // once before giving up and falling back to peer-to-peer.
          await new Promise(r => setTimeout(r, 1500));
          videoRoom = await ensureMeetingRoom(meetingId, meetingTitle, currentUser?.id);
        }
        if (!videoRoom) {
          throw new Error('ROOM_NOT_FOUND');
        }

        // Server-side authorisation: send the signed-in user's session token
        // (verified server-side) plus the admitted participant row id.
        const data = await fetchLiveKitToken(videoRoom.slug);
        if (!active) return;
        livekitRoomSlugRef.current = videoRoom.slug;
        livekitRoomIdRef.current = videoRoom.id;
        if (data.error === 'MAX_CAPACITY_REACHED') {
          // Honest stop, NOT a silent P2P downgrade: a full room must not
          // pretend to work as a 5-way peer-to-peer mesh. The user stays
          // out of the media path with a clear message and a retry — the
          // capacity count is live now, so a slot frees as soon as
          // someone really leaves.
          setConnectionNotice('This meeting room is full (8 participants). You cannot join the video yet — wait for someone to leave, then press "Retry video server".');

          return;
        }
        if (data.error === 'UNAUTHORIZED' || data.error === 'ADMISSION_REQUIRED') {
          setConnectionNotice('You are not admitted to this meeting yet. Please wait for the host to admit you, then try again.');

          return;
        }
        if (data.error === 'MEETING_ENDED') {
          setConnectionNotice('This meeting has ended. The invite link no longer works.');

          return;
        }
        if (data.error === 'MEETING_LOCKED') {
          // Fix Round 7 (#6): a locked meeting is an honest stop, NOT a
          // silent peer-to-peer downgrade - a locked-out guest must not
          // end up in a P2P mesh with the room.
          setConnectionNotice('This meeting is locked by the host - new participants cannot join right now. Wait for the host to unlock it, then press "Retry video server".');

          return;
        }
        if (data.error === 'LINK_EXPIRED') {
          // Round 9 (9C): the link's time is up. Plain words, no jargon,
          // no toast — the centred card is the message.
          setConnectionNotice('This meeting link has expired. Ask the host for a new link.');
          return;
        }
        if (data.error || !data.token) {
          throw new Error(data.message || data.error || 'Could not get a video token.');
        }

        const { token, expiresAt: tokenExpiry, livekitUrl: serverLivekitUrl, role: serverRole } = data;
        setLivekitToken(token);
        setExpiresAt(tokenExpiry);
        if (serverRole === 'HOST' || serverRole === 'COHOST' || serverRole === 'GUEST') {
          setLivekitRole(serverRole);
        }

        // Fix Round 6: stopLocalTrackOnUnpublish:false. The SDK default
        // (true) stops a track the moment it is unpublished — which
        // would stop the raw mic track when Studio Voice publishes its
        // filtered track in its place, silencing the enhancer's own
        // input. Track lifecycle is explicit in this file instead
        // (publishLiveKitTrack stops a replaced track; stopScreenShare
        // and the unmount cleanup stop theirs), so nothing leaks.
        const room = new LiveKitRoom({
          adaptiveStream: true,
          dynacast: true,
          stopLocalTrackOnUnpublish: false
        });

        livekitRoomRef.current = room;

        // A dropped LiveKit connection is no longer silent. The SDK
        // auto-reconnects transient drops, but a disconnect it cannot heal
        // (token expiry, server gone) used to leave stale tiles with no
        // message and no retry. Now we say so, re-mint a fresh token and
        // reconnect — the user sees exactly what is happening.
        room.on(RoomEvent.Disconnected, () => {
          if (!active) return;
          // Fix Round 8 (#7/#8): a disconnect is usually transient and
          // the SDK heals it itself — the app must NOT tear the room
          // down here. The old code bumped the reconnect nonce on every
          // wobble, which disconnected the room itself ("client
          // initiated disconnect"), cleared every tile, and looped the
          // room into a permanent P2P fallback. Now: stay quiet, show
          // only the gentle tile overlay, and let the SDK reconnect.
          // Only if the room is STILL down after a few seconds do we
          // force one clean reconnect — and never for an ended meeting.
          void (async () => {
            try {
              const { data } = await giinApi.getMeetingDetails(meetingId);
              if (!active) return;
              if ((data as any)?.status === 'Completed') { enterEndedState('host-ended'); return; }
            } catch (e) { /* status check failed: fall through to quiet retry */ }
            if (!active) return;
            setIsLivekitReconnecting(true);
            if (livekitReconnectTimerRef.current) clearTimeout(livekitReconnectTimerRef.current);
            livekitReconnectTimerRef.current = setTimeout(() => {
              if (!active || endedRef.current) return;
              const r = livekitRoomRef.current;
              if (r && r.state === 'connected') { setIsLivekitReconnecting(false); return; }
              setLivekitReconnectNonce(n => n + 1);
            }, 6000);
          })();
        });

        // Fix Round 8 (#4): live connection quality for the local
        // participant. A weak mobile link used to look like a broken
        // app — now the toolbar shows the signal (excellent / good /
        // poor / lost) so a bad connection is visible, not mysterious.
        room.on(RoomEvent.ConnectionQualityChanged, (quality: any, participant: any) => {
          if (!active) return;
          if (participant && participant.isLocal) setConnectionQuality(String(quality));
        });

        // Fix Round 8 (#7): the SDK tells us when it is healing a drop
        // and when it has healed it. The tile overlay follows these —
        // never a banner, never a toast.
        room.on(RoomEvent.Reconnecting, () => {
          if (!active) return;
          setIsLivekitReconnecting(true);
        });
        room.on(RoomEvent.Reconnected, () => {
          if (!active) return;
          setIsLivekitReconnecting(false);
          if (livekitReconnectTimerRef.current) { clearTimeout(livekitReconnectTimerRef.current); livekitReconnectTimerRef.current = null; }
        });

        // Fix Round 5: room membership is NOT the same as media tracks.
        // ParticipantConnected/Disconnected tell us who is actually in
        // the room; TrackPublished/Unpublished tell us who HAS a camera
        // (even before it is subscribed); TrackMuted/Unmuted tell us
        // whose camera is muted at the source. Without these, a
        // participant publishing nothing looked identical to one whose
        // video was still on its way — hence the eternal "Connecting...".
        room.on(RoomEvent.ParticipantConnected, (participant: any) => {
          if (!active) return;
          markLivekitParticipant(participant.identity, true);
          participant.trackPublications.forEach((pub: any) => noteLivekitPublication(pub, participant.identity));
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
          if (!active) return;
          markLivekitParticipant(participant.identity, false);
          setLivekitCameraPubs(prev => {
            if (!prev[participant.identity]) return prev;
            const next = { ...prev };
            delete next[participant.identity];
            return next;
          });
          setLivekitVideoMuted(prev => {
            if (!prev[participant.identity]) return prev;
            const next = { ...prev };
            delete next[participant.identity];
            return next;
          });
          Object.keys(livekitPublicationsRef.current).forEach(k => {
            if (k.startsWith(`${participant.identity}:`)) delete livekitPublicationsRef.current[k];
          });
          clearLivekitPeerStreams(participant.identity);
        });

        room.on(RoomEvent.TrackPublished, (publication: any, participant: any) => {
          if (!active) return;
          noteLivekitPublication(publication, participant.identity);
          // A published camera that never got subscribed (adaptive
          // streaming / dynacast stall, or a subscribe that raced the
          // join) leaves the tile waiting forever — ask for it explicitly.
          if (publication.kind === 'video' && publication.source === Track.Source.Camera && !publication.isSubscribed) {
            try { publication.setSubscribed(true); } catch (e) { /* auto-subscribe will retry */ }
          }
        });

        room.on(RoomEvent.TrackUnpublished, (publication: any, participant: any) => {
          if (!active) return;
          forgetLivekitPublication(publication, participant.identity);
        });

        room.on(RoomEvent.TrackMuted, (publication: any, participant: any) => {
          if (!active) return;
          if (publication.source === Track.Source.Camera) {
            setLivekitVideoMuted(prev => ({ ...prev, [participant.identity]: true }));
          }
        });

        room.on(RoomEvent.TrackUnmuted, (publication: any, participant: any) => {
          if (!active) return;
          if (publication.source === Track.Source.Camera) {
            setLivekitVideoMuted(prev => {
              if (!prev[participant.identity]) return prev;
              const next = { ...prev };
              delete next[participant.identity];
              return next;
            });
          }
        });

        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          const peerKey = participant.identity;
          if (track.kind !== 'video' && track.kind !== 'audio') return;
          // Record the publication (camera or not) so the tile knows
          // whether video is actually on its way — see noteLivekitPublication.
          noteLivekitPublication(publication, peerKey);
          // A screen-share track is a separate stream from the person's
          // camera. Mixing it into the camera MediaStream would make the
          // video element show one track at random, so screen shares get
          // their own stream map (remoteScreenStreams).
          if (publication.source === Track.Source.ScreenShare) {
            setRemoteScreenStreams(prev => {
              const currentStream = prev[peerKey] || new MediaStream();
              if (!currentStream.getTracks().some(t => t.id === track.mediaStreamTrack.id)) {
                currentStream.addTrack(track.mediaStreamTrack);
              }
              return { ...prev, [peerKey]: currentStream };
            });
            return;
          }
          setLivekitRemoteStreams(prev => {
            const currentStream = prev[peerKey] || new MediaStream();
            if (!currentStream.getTracks().some(t => t.id === track.mediaStreamTrack.id)) {
              currentStream.addTrack(track.mediaStreamTrack);
            }
            return { ...prev, [peerKey]: currentStream };
          });
        });

        room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          const peerKey = participant.identity;
          if (publication.source === Track.Source.ScreenShare) {
            setRemoteScreenStreams(prev => {
              const currentStream = prev[peerKey];
              if (!currentStream) return prev;
              currentStream.removeTrack(track.mediaStreamTrack);
              // An entry with no tracks left is not a connection: drop
              // it, or the tile keeps a <video> on an empty stream
              // (black) instead of falling back to the avatar.
              if (currentStream.getTracks().length === 0) {
                const next = { ...prev };
                delete next[peerKey];
                return next;
              }
              return { ...prev };
            });
            return;
          }
          setLivekitRemoteStreams(prev => {
            const currentStream = prev[peerKey];
            if (!currentStream) return prev;
            currentStream.removeTrack(track.mediaStreamTrack);
            if (currentStream.getTracks().length === 0) {
              const next = { ...prev };
              delete next[peerKey];
              return next;
            }
            return { ...prev };
          });
        });

        const livekitUrl = serverLivekitUrl;
        if (!livekitUrl) {
          throw new Error('The video server address is missing.');
        }
        await room.connect(livekitUrl, token);
        // Fix Round 8 (#8): a connect that lands is silent. The old
        // toast announced the video engine by name on every reconnect.
        setConnectionNotice(null); // A retry that lands clears the join-error card.
        setIsLivekitReconnecting(false);

        // Seed membership from participants ALREADY in the room:
        // ParticipantConnected only fires for joins after ours, so
        // without this a peer who joined first would never count as
        // present and their trackless tile would say "Connecting..."
        // forever. Publications are seeded too, for the same reason.
        room.remoteParticipants.forEach((p: any) => {
          markLivekitParticipant(p.identity, true);
          p.trackPublications.forEach((pub: any) => noteLivekitPublication(pub, p.identity));
        });

        // Publish whatever local tracks we have right now (camera / mic /
        // an in-progress screen share). The helper skips anything already
        // published, so reconnects are safe.
        if (stream) {
          const videoTrack = stream.getVideoTracks()[0];
          const audioTrack = stream.getAudioTracks()[0];
          if (videoTrack) await publishLiveKitTrack(videoTrack, Track.Source.Camera);
          if (audioTrack) await publishLiveKitTrack(audioTrack, Track.Source.Microphone);
        }
        if (livekitScreenTrackRef.current) {
          await publishLiveKitTrack(livekitScreenTrackRef.current, Track.Source.ScreenShare);
        }

      } catch (err: any) {
        // Fix Round 8 (#7/#8 + Evidence 1): a disconnect caused by our
        // own teardown ("Client initiated disconnect") or by an
        // unmounted effect must never flip the room to P2P — that was
        // the silent permanent downgrade. Only a real server failure
        // falls back, quietly: the P2P mesh keeps the call alive, the
        // toolbar dot shows the state, and the room retries LiveKit on
        // its own (see the P2P recovery effect). Participants see no
        // error either way.
        if (!active) return;
        console.warn('[LiveKit Engine] Could not connect to the video server:', err);
        if (String(err?.message || '').includes('Client initiated disconnect')) return;
        setEngineType('P2P');
      }
    };

    connectToLiveKit();

    return () => {
      active = false;
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
        livekitRoomRef.current = null;
      }
      // The room is gone, so its tracks are ended. Clear them now so the
      // tiles fall back to avatars instead of holding a dead track — and so
      // a token-refresh reconnect does not mix ended tracks with fresh ones.
      setLivekitRemoteStreams({});
      setRemoteScreenStreams({});
      setLivekitParticipantIds(new Set<string>());
      setLivekitCameraPubs({});
      setLivekitVideoMuted({});
      livekitPublicationsRef.current = {};
    };
    // NOTE: `stream` is deliberately NOT a dependency. Every stream change
    // used to tear the LiveKit room down and reconnect it. Track changes
    // (device switch, camera on/off, screen share) are now published
    // directly via publishLiveKitTrack instead.
    // `livekitReconnectNonce` IS a dependency: bumping it is how the token
    // refresh forces a clean disconnect + reconnect with a fresh token.
  // Fix Round 8 (#2): depend on the user ID, not the whole user
  // object — the session restore replaces the object identity after
  // mount, and the old dependency tore the LiveKit room down and
  // reconnected it on every reload.
  }, [isMediaInitialized, engineType, meetingId, myKey, currentUser?.id, isAdmin, livekitReconnectNonce]);

  // Fix Round 6: when the engine becomes LiveKit, the P2P mesh is
  // redundant — tear it down (see teardownP2PMesh). The mesh rebuilds
  // itself from presence broadcasts if the engine ever falls back to
  // P2P (breakouts / LiveKit failure), so this cannot strand a call.
  useEffect(() => {
    if (engineType !== 'LIVEKIT') return;
    teardownP2PMesh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineType]);

  // Token expiry: refresh EARLY and WITHOUT dropping media. The token now
  // lasts 6 hours, but the refresh still fires at 15 minutes remaining —
  // not in a 60-second window a backgrounded tab can miss. It uses
  // room.updateToken(), so the call does not disconnect and reconnect (no
  // video/audio drop for anyone near 1h59m). Only if updateToken fails do
  // we fall back to the full reconnect. A `visibilitychange` listener
  // covers the backgrounded-tab case: Chrome throttles timers to ~1/min
  // in background tabs, so on return to the foreground we check the
  // remaining time immediately instead of waiting for the next tick.
  const refreshLiveKitToken = async () => {
    const room = livekitRoomRef.current;
    const slug = livekitRoomSlugRef.current;
    if (!room || !slug || tokenRefreshingRef.current) return;
    if (endedRef.current) return;
    tokenRefreshingRef.current = true;
    try {
      const data = await fetchLiveKitToken(slug);
      if (data.error || !data.token) throw new Error(data.message || data.error || 'Could not refresh the video token.');
      await room.updateToken(data.token);
      setExpiresAt(data.expiresAt);
      setLivekitToken(data.token);
    } catch (err: any) {
      console.warn('[LiveKit] Token refresh via updateToken failed, falling back to reconnect:', err);
      setLivekitReconnectNonce(n => n + 1);
    } finally {
      tokenRefreshingRef.current = false;
    }
  };

  useEffect(() => {
    const maybeRefresh = () => {
      if (!expiresAt || engineType !== 'LIVEKIT' || endedRef.current) return;
      const timeDiff = new Date(expiresAt).getTime() - Date.now();
      // 15 minutes remaining: refresh now, while there is still plenty
      // of time to retry if the first attempt fails.
      if (timeDiff <= 15 * 60 * 1000 && timeDiff > 0) {
        void refreshLiveKitToken();
      }
    };
    const interval = setInterval(maybeRefresh, 30000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      maybeRefresh();
      // A backgrounded tab is exactly when the browser stops camera
      // tracks: re-check liveness on return instead of trusting the
      // tile, and resume any video element the browser paused.
      if (isVideoOnRef.current) {
        const t = localVideoTrackRef.current;
        if (!t || t.readyState === 'ended') {
          setLocalCameraLive(false);
          void reacquireLocalCamera('visibility-return');
        }
      }
      resumeVideoElements();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, engineType]);

  // Fix Round 5: media health watchdog. Runs every 5s while in the room:
  // (1) a local camera that died without firing onended gets reacquired
  // (backed off inside reacquireLocalCamera); (2) remote LiveKit streams
  // whose tracks all ended are pruned so their tiles fall back to avatars
  // instead of holding a dead stream; (3) camera publications that are
  // published but unsubscribed are re-subscribed; (4) paused <video>
  // elements are resumed. No secrets are logged.
  useEffect(() => {
    if (!isMediaInitialized) return;
    const id = setInterval(() => {
      if (isVideoOnRef.current) {
        const t = localVideoTrackRef.current;
        if (!t || t.readyState === 'ended') {
          setLocalCameraLive(false);
          void reacquireLocalCamera('watchdog');
        }
      }
      setLivekitRemoteStreams(prev => {
        let changed = false;
        const next: { [peerKey: string]: MediaStream } = {};
        Object.entries(prev).forEach(([k, s]) => {
          if (s.getTracks().some(tr => tr.readyState === 'live')) next[k] = s;
          else changed = true;
        });
        return changed ? next : prev;
      });
      Object.values(livekitPublicationsRef.current).forEach((pub: any) => {
        try {
          if (pub && pub.kind === 'video' && pub.source === Track.Source.Camera && pub.isSubscribed === false && typeof pub.setSubscribed === 'function') {
            pub.setSubscribed(true);
          }
        } catch (e) { /* re-subscribe is best-effort; next tick retries */ }
      });
      resumeVideoElements();
    }, 5000);
    return () => clearInterval(id);
  }, [isMediaInitialized]);

  // Attendance: who joined, when, and how long they stayed. Recorded
  // locally in this browser (localStorage, per meeting) from the
  // participant list: a key that appears gets a joinedAt, a key that
  // disappears gets a leftAt. The host can view it from the dashboard
  // after the meeting (same browser). It is a record of this browser's
  // view of the room, not a server log — the labels say so.
  useEffect(() => {
    try {
      const key = `giin_attendance_${meetingId}`;
      const raw = localStorage.getItem(key);
      const map: Record<string, { name: string; joinedAt: number; leftAt: number | null }> = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const present = new Set<string>();
      participants.forEach((p) => {
        const k = p.userId || p.id;
        present.add(k);
        if (!map[k]) map[k] = { name: p.name, joinedAt: now, leftAt: null };
        else map[k].name = p.name;
      });
      // Round 9 (9D): the host's own attendance — the participants list
      // excludes self, so without this the host never appears in their
      // own attendance report.
      present.add(myKey);
      if (!map[myKey]) map[myKey] = { name: currentUser?.name || 'You', joinedAt: meetingJoinedAt, leftAt: null };
      else map[myKey].name = currentUser?.name || 'You';
      Object.keys(map).forEach((k) => {
        if (!present.has(k) && !map[k].leftAt) map[k].leftAt = now;
      });
      localStorage.setItem(key, JSON.stringify(map));
    } catch (e) { /* attendance is best-effort */ }
  }, [participants, meetingId]);

  // Meeting timer: elapsed time since this client joined the room.
  useEffect(() => {
    const timer = setInterval(() => {
      const secs = Math.floor((Date.now() - meetingJoinedAt) / 1000);
      elapsedSecondsRef.current = secs;
      setElapsedSeconds(secs);
    }, 1000);
    return () => clearInterval(timer);
  }, [meetingJoinedAt]);

  const formatElapsedTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Keep the activePanel ref in step (realtime handlers close over the
  // first render, so they read the panel state through this ref).
  useEffect(() => {
    activePanelRef.current = activePanel;
  });

  // On unmount (leaving the room for good), remove our participant row so
  // we do not linger as 'Admitted' forever, AND mark our LiveKit
  // allocation row LEFT so the room's capacity slot is freed. Without the
  // LEFT mark, every drop/rejoin left a JOINED row behind and the room
  // filled with ghosts (the capacity leak). Best-effort: the tab may be
  // closing, so the request may not complete — the host can still kick a
  // stale row, and the token route now counts live LiveKit participants
  // instead of stale rows. This effect has EMPTY deps on purpose: it runs
  // its cleanup only on unmount. The LiveKit connect effect's cleanup also
  // runs on engine switches and token refreshes, so the row must NOT be
  // removed there — a token refresh is not a leave.
  useEffect(() => {
    const markLeft = () => {
      try {
        const rowId = localStorage.getItem(`giin_participant_row_${meetingId}`);
        // Round 9 (9A/9B): leave server-side — the row becomes 'Left'
        // (it persists for rejoin) and the meeting completes when the
        // last person leaves. The old removeParticipant deleted the row.
        void giinApi.leaveMeeting(meetingId, rowId || undefined);
        // Round 9 (9D): close our own attendance record in this browser.
        try {
          const attKey = `giin_attendance_${meetingId}`;
          const attRaw = localStorage.getItem(attKey);
          if (attRaw) {
            const attMap = JSON.parse(attRaw);
            if (attMap[myKey] && !attMap[myKey].leftAt) {
              attMap[myKey].leftAt = Date.now();
              localStorage.setItem(attKey, JSON.stringify(attMap));
            }
          }
        } catch (e) { /* attendance is best-effort */ }
        const roomId = livekitRoomIdRef.current;
        // Fix Round 7 (#2): mark LEFT with the token identity - the
        // participant row id for guests - not the random per-visit key,
        // which matches no row and left a ghost JOINED row behind.
        if (roomId) void giinApi.markParticipantLeft(roomId, rowId || myParticipantRowId || myKey);
      } catch (e) { /* best effort */ }
    };
    // Tab close / refresh: unmount cleanup may not run, so mark LEFT here too.
    window.addEventListener('pagehide', markLeft);
    return () => {
      window.removeEventListener('pagehide', markLeft);
      markLeft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts. Deliberately no dependency array: the listener is
  // re-registered every render so the handlers always see fresh state
  // (toggleMute/toggleVideo read state directly). 'L' is NOT bound — a
  // stray keypress must never end the meeting; leaving is click-only.
  // Ignored while typing in an input, textarea, select or editable area.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'm') toggleMute();
      else if (k === 'v') toggleVideo();
      else if (k === 's') handleToggleScreenShare();
      else if (k === 'h') toggleHandRaise();
      else if (k === 'c') {
        if (activePanelRef.current === 'chat') {
          setActivePanel('none');
        } else {
          setActivePanel('chat');
          setUnreadChatCount(0);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (meetingAdminId) {
      setTimeout(() => {
        setLocalAdminId(meetingAdminId);
      }, 0);
    }
  }, [meetingAdminId]);

  // Relocated fullscreen state to top block

  const toggleFullscreen = () => {
    if (!meetingRoomRef.current) return;
    if (!document.fullscreenElement) {
      meetingRoomRef.current.requestFullscreen().catch(err => {
        console.error(`Error entering fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Exit Picture-in-Picture and release media hardware on unmount
  useEffect(() => {
    return () => {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(err => console.warn('Failed to exit PiP on unmount:', err));
      }
      // Release camera and microphone hardware
      if (localVideoTrackRef.current) {
        const dyingTrack = localVideoTrackRef.current;
        localVideoTrackRef.current = null;
        dyingTrack.stop();
      }
      // Fix Round 6: when Studio Voice is on, localAudioTrackRef is the
      // filtered destination track — stopping it alone leaves the raw
      // capture feeding the chain with the mic light on. Tear the
      // chain down (stops the destination track) and stop the raw
      // capture too. Also end every speaking-indicator loop.
      teardownEnhancer();
      if (localMicRawTrackRef.current) {
        localMicRawTrackRef.current.stop();
        localMicRawTrackRef.current = null;
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current = null;
      }
      Object.keys(speakingAnalysersRef.current).forEach(stopSpeakingDetection);
    };
  }, []);

  // Relocated states/constants to consolidated top block

  const toggleHandRaise = (reason?: string) => {
    if (localHandRaised) {
      // Lower hand
      setLocalHandRaised(false);
      setHandRaiseReason(null);
      setHandRaises(prev => prev.filter(hr => hr.userId !== myKey));
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'lower-hand',
          payload: { userId: myKey }
        });
      }
    } else {
      // Raise hand
      setLocalHandRaised(true);
      setHandRaiseReason(reason || null);
      const newRaise = {
        userId: myKey,
        name: currentUser?.name || 'You',
        timestamp: Date.now(),
        reason
      };
      setHandRaises(prev => [...prev.filter(hr => hr.userId !== myKey), newRaise]);
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'hand-raise',
          payload: newRaise
        });
      }
      // A broadcast is never echoed back to its sender, so the raiser
      // plays their own reason sound locally; every other participant
      // plays it when the 'hand-raise' event arrives.
      playSynthesizedSound(handRaiseSoundKey(reason));
    }
    setShowHandRaiseMenu(false);
  };

  const lowerHand = (userId: string) => {
    if (userId === myKey) {
      setLocalHandRaised(false);
      setHandRaiseReason(null);
    }
    setHandRaises(prev => prev.filter(hr => hr.userId !== userId));
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'lower-hand',
        payload: { userId }
      });
    }
  };

  const clearAllHands = () => {
    setLocalHandRaised(false);
    setHandRaiseReason(null);
    setHandRaises([]);
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'clear-all-hands',
        payload: {}
      });
    }
  };

  // Active peer connection keys state to avoid ref access during render
  const [activePeerKeys, setActivePeerKeys] = useState<string[]>([]);

  // Collaborative Whiteboard States
  const [isWhiteboardActive, setIsWhiteboardActive] = useState(false);
  const [whiteboardColor, setWhiteboardColor] = useState('#10B981');
  const [whiteboardWidth, setWhiteboardWidth] = useState(3);
  const whiteboardCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const whiteboardCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const whiteboardStrokesRef = useRef<{x0: number, y0: number, x1: number, y1: number, color: string, width: number}[]>([]);

  // Breakout Rooms States
  // Relocated states to top block

  const getSpatialAudioCtx = () => {
    if (!spatialAudioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      spatialAudioCtxRef.current = new AudioCtx();
    }
    if (spatialAudioCtxRef.current.state === 'suspended') {
      spatialAudioCtxRef.current.resume();
    }
    return spatialAudioCtxRef.current;
  };
  // Relocated states/helpers to consolidated top block

  // Apply chosen speaker device to remote audio elements
  useEffect(() => {
    if (selectedSpeaker) {
      const mediaEls = document.querySelectorAll('audio, video.remote-video-feed');
      mediaEls.forEach((el: any) => {
        if (typeof el.setSinkId === 'function') {
          el.setSinkId(selectedSpeaker).catch((err: any) => 
            console.warn('[Speakers] Failed to set sink ID:', err)
          );
        }
      });
    }
    // Fix Round 6: livekitRemoteStreams was missing here, so an audio
    // element mounted for a LiveKit peer never got the chosen speaker
    // (it played on the default device instead).
  }, [selectedSpeaker, remoteStreams, livekitRemoteStreams, activePeerKeys]);

  const changeCamera = async (deviceId: string) => {
    setSelectedCamera(deviceId);
    localStorage.setItem('giin_selected_camera', deviceId);

    if (isVideoOn) {
      try {
        // Acquire the new camera FIRST. Stopping the old track before the
        // new one is acquired leaves the camera dead if getUserMedia fails.
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        const oldTrack = localVideoTrackRef.current;
        videoTrack.enabled = true;
        // attachLocalCameraTrack sets the ref, the liveness state and
        // the onended handler (a switched-to camera that later dies
        // must reacquire, not go black).
        attachLocalCameraTrack(videoTrack);
        localCameraRecoverRef.current.attempts = 0;
        if (oldTrack && oldTrack !== videoTrack) {
          oldTrack.stop();
        }

        setStream(prev => {
          const newStream = prev || new MediaStream();
          newStream.getVideoTracks().forEach(t => newStream.removeTrack(t));
          newStream.addTrack(videoTrack);
          return newStream;
        });

        Object.values(pcsRef.current).forEach(pc => {
          const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(videoTrack);
          }
        });

        // Publish the new camera to LiveKit as well — otherwise LiveKit
        // viewers keep receiving the old (now stopped) track.
        await publishLiveKitTrack(videoTrack, Track.Source.Camera);
      } catch (err) {
        console.error('Failed to change camera:', err);
        triggerToast('Could not switch camera — keeping the current one.');
      }
    }
  };

  const changeMicrophone = async (deviceId: string) => {
    setSelectedMic(deviceId);
    localStorage.setItem('giin_selected_mic', deviceId);

    try {
      // Acquire the new microphone FIRST (see changeCamera).
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: micAudioConstraints(deviceId)
      });
      const audioTrack = audioStream.getAudioTracks()[0];
      const oldRaw = localMicRawTrackRef.current;
      const oldPublished = localAudioTrackRef.current;
      // Tear the enhancer down FIRST: its destination track is the
      // published one and its source is the raw capture. Stopping the
      // raw track while the chain is live would silence the new chain,
      // and leaving the old chain up leaks a second live mic.
      teardownEnhancer();
      if (oldPublished && oldPublished !== audioTrack) {
        try { oldPublished.stop(); } catch (e) {}
      }
      if (oldRaw && oldRaw !== audioTrack && oldRaw !== oldPublished) {
        try { oldRaw.stop(); } catch (e) {}
      }
      localMicRawTrackRef.current = audioTrack;
      verifyMicProcessing(audioTrack);
      // Studio Voice stays as the user set it: a mic switch must not
      // silently drop the enhancement (the old code published the raw
      // track while the toggle still showed ON).
      const trackToUse = isAudioEnhancedRef.current ? buildEnhancedTrack(audioTrack) : audioTrack;
      await publishMicTrack(trackToUse);
    } catch (err) {
      console.error('Failed to change microphone:', err);
      triggerToast('Could not switch microphone — keeping the current one.');
    }
  };

  const changeSpeaker = (deviceId: string) => {
    setSelectedSpeaker(deviceId);
    localStorage.setItem('giin_selected_speaker', deviceId);
  };

  const screenSendersRef = useRef<{ [peerKey: string]: RTCRtpSender }>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<{ [peerKey: string]: MediaStream }>({});

  // Fix Round 8 (#4): speaker mute + live connection quality.
  // Speakers muted breaks a feedback loop in one tap (laptop and
  // phone in the same room, both mics live, both speakers on). The
  // effect re-applies whenever the toggle or the remote streams
  // change, so a newcomer starts muted too.
  const [isSpeakersMuted, setIsSpeakersMuted] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<string>('unknown');
  useEffect(() => {
    const streams: any[] = [...Object.values(livekitRemoteStreams), ...Object.values(remoteStreams), ...Object.values(remoteScreenStreams)];
    streams.forEach((s) => {
      try {
        s?.getAudioTracks?.().forEach((t: MediaStreamTrack) => { t.enabled = !isSpeakersMuted; });
      } catch (e) { /* a stream without audio tracks is fine */ }
    });
  }, [isSpeakersMuted, livekitRemoteStreams, remoteStreams, remoteScreenStreams]);

  // Ref mirror of the remote screen-share map (defined above).
  const remoteScreenStreamsRef = useRef(remoteScreenStreams);
  // Per-peer provenance for received video tracks, and the
  // audio-confirmed camera track id. A screen is captured with
  // audio:false, so a screen track always arrives in a video-only stream;
  // a camera track normally arrives with its mic track (mute only
  // disables it, never removes it) -- except for a peer whose mic
  // acquisition failed, whose camera is video-only too. The sender's
  // screen track id (carried on the media-state / presence broadcasts)
  // is what disambiguates that case.
  const remoteCameraTrackIdsRef = useRef<{ [peerKey: string]: string }>({});
  const remoteVideoMetaRef = useRef<{ [peerKey: string]: { [trackId: string]: { streamHadAudio: boolean } } }>({});
  useEffect(() => { remoteScreenStreamsRef.current = remoteScreenStreams; }, [remoteScreenStreams]);

  // Last time a (re)negotiation offer was actually sent to a peer, per
  // peer. Lets start/stopScreenShare notice when the onnegotiationneeded
  // event never fired (or its handler bailed early while signalling was
  // unstable) and retry explicitly instead of leaving the remote side
  // without the screen track.
  const lastOfferAtRef = useRef<{ [peerKey: string]: number }>({});

  // Send a fresh offer to one peer (explicit renegotiation). Used by the
  // onnegotiationneeded handler and as a safety net after addTrack /
  // removeTrack. No-ops unless the connection is stable and no offer is
  // already in flight, so a double call can never produce a duplicate offer.
  const renegotiatePeer = async (peerKey: string) => {
    const pc = pcsRef.current[peerKey];
    if (!pc || pc.signalingState === 'closed') return;
    if (pc.signalingState !== 'stable' || makingOfferRef.current[peerKey]) return;
    try {
      makingOfferRef.current[peerKey] = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      lastOfferAtRef.current[peerKey] = Date.now();
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'signal',
          payload: { type: 'offer', targetKey: peerKey, senderKey: myKey, sdp: pc.localDescription, engine: engineTypeRef.current }
        });
      }
    } catch (err) {
      console.error('[WebRTC] Renegotiation offer error:', err);
    } finally {
      makingOfferRef.current[peerKey] = false;
    }
  };

  // Safety net: a track was just added/removed on this peer. If no offer
  // went out within ~2.5s (missed onnegotiationneeded), renegotiate
  // explicitly. `changedAt` is the time the track change happened.
  const ensureRenegotiation = (peerKey: string, changedAt: number) => {
    setTimeout(() => {
      const pc = pcsRef.current[peerKey];
      if (!pc || pc.signalingState === 'closed') return;
      if (pc.signalingState !== 'stable') return;
      if ((lastOfferAtRef.current[peerKey] || 0) >= changedAt) return;
      void renegotiatePeer(peerKey);
    }, 2500);
  };

  // Broadcast our current media state (mute / video / screen share) to the
  // room, including the screen track id so receivers can recognise the
  // screen track even if it arrives before the announcement. Reads live
  // values from refs -- the signalling effect's closures are stale --
  // with per-call overrides for the value that just changed (the ref
  // only syncs after the next render). Returns false when there is no
  // signalling channel yet; the 6s presence broadcast (also ref-driven)
  // then delivers the true state once the channel exists.
  const broadcastMediaState = (overrides?: { isVideoOn?: boolean; isMuted?: boolean; isScreenSharing?: boolean }) => {
    if (!sigChannelRef.current) return false;
    const sharing = overrides?.isScreenSharing ?? isScreenSharingRef.current;
    sigChannelRef.current.send({
      type: 'broadcast',
      event: 'media-state',
      payload: {
        senderKey: myKey,
        participantRowId: myParticipantRowId || undefined,
        isVideoOn: overrides?.isVideoOn ?? isVideoOnRef.current,
        isMuted: overrides?.isMuted ?? isMutedRef.current,
        isScreenSharing: sharing,
        screenTrackId: sharing ? (screenStreamRef.current?.getVideoTracks()[0]?.id ?? null) : null
      }
    });
    return true;
  };

  // Re-route a peer's video tracks between the camera map and the screen
  // map using the CURRENT sharing flag and screen track id. Fixes tracks
  // that were misclassified because the announcement arrived after the
  // track (or the flag flipped). `sharing` / `screenTrackId` are passed
  // in because the peerStates ref only syncs after the next render.
  const reclassifyScreenTracks = (peerKey: string, sharing: boolean, screenTrackId: string | null) => {
    const camStream = remoteStreamsRef.current[peerKey];
    const screenStreamObj = remoteScreenStreamsRef.current[peerKey];
    const knownCameraId = remoteCameraTrackIdsRef.current[peerKey] || null;
    // 1. Anything in the screen map that is not the known screen track is
    //    a misclassified camera (or an ended track): move live ones back
    //    to the camera map, drop ended ones.
    if (screenStreamObj) {
      const wronglyPlaced = screenStreamObj.getVideoTracks().filter(t => !sharing || (screenTrackId !== null && t.id !== screenTrackId));
      if (wronglyPlaced.length > 0) {
        const target = camStream || new MediaStream();
        wronglyPlaced.forEach(t => {
          screenStreamObj.removeTrack(t);
          if (t.readyState === 'live' && !target.getTracks().some(x => x.id === t.id)) target.addTrack(t);
        });
        const nextCam = { ...remoteStreamsRef.current, [peerKey]: target };
        remoteStreamsRef.current = nextCam;
        setRemoteStreams(nextCam);
        const nextScreen = { ...remoteScreenStreamsRef.current };
        remoteScreenStreamsRef.current = nextScreen;
        setRemoteScreenStreams(nextScreen);
      }
    }
    // 2. Anything in the camera map that is the known screen track -- or
    //    arrived video-only while the peer is sharing and is not the
    //    audio-confirmed camera -- is a misclassified screen: move it over.
    if (sharing) {
      const currentCam = remoteStreamsRef.current[peerKey];
      if (currentCam) {
        const meta = remoteVideoMetaRef.current[peerKey] || {};
        const misplaced = currentCam.getVideoTracks().filter(t =>
          t.readyState === 'live' && (
            (screenTrackId !== null && t.id === screenTrackId) ||
            (screenTrackId === null && meta[t.id]?.streamHadAudio === false && t.id !== knownCameraId)
          )
        );
        if (misplaced.length > 0) {
          const target = remoteScreenStreamsRef.current[peerKey] || new MediaStream();
          misplaced.forEach(t => {
            currentCam.removeTrack(t);
            if (!target.getTracks().some(x => x.id === t.id)) target.addTrack(t);
          });
          const nextCam = { ...remoteStreamsRef.current };
          remoteStreamsRef.current = nextCam;
          setRemoteStreams(nextCam);
          const nextScreen = { ...remoteScreenStreamsRef.current, [peerKey]: target };
          remoteScreenStreamsRef.current = nextScreen;
          setRemoteScreenStreams(nextScreen);
        }
      }
    }
    // 3. Drop ended video tracks lingering in the camera map.
    const cam = remoteStreamsRef.current[peerKey];
    if (cam) {
      const ended = cam.getVideoTracks().filter(t => t.readyState === 'ended');
      if (ended.length > 0) {
        ended.forEach(t => cam.removeTrack(t));
        const nextCam = { ...remoteStreamsRef.current };
        remoteStreamsRef.current = nextCam;
        setRemoteStreams(nextCam);
      }
    }
  };

  // Clean up a single peer connection
  const cleanupPeer = (peerKey: string) => {
    if (pcsRef.current[peerKey]) {
      pcsRef.current[peerKey].close();
      delete pcsRef.current[peerKey];
    }
    stopSpeakingDetection(peerKey);
    if (screenSendersRef.current[peerKey]) {
      delete screenSendersRef.current[peerKey];
    }
    if (remoteCameraTrackIdsRef.current[peerKey]) {
      delete remoteCameraTrackIdsRef.current[peerKey];
    }
    if (remoteVideoMetaRef.current[peerKey]) {
      delete remoteVideoMetaRef.current[peerKey];
    }
    if (pcCandidatesRef.current[peerKey]) {
      delete pcCandidatesRef.current[peerKey];
    }
    setActivePeerKeys(prev => prev.filter(k => k !== peerKey));
    setRemoteStreams(prev => {
      const copy = { ...prev };
      delete copy[peerKey];
      return copy;
    });
    setRemoteScreenStreams(prev => {
      const copy = { ...prev };
      delete copy[peerKey];
      return copy;
    });
    setPeerStates(prev => {
      const copy = { ...prev };
      delete copy[peerKey];
      return copy;
    });
    setParticipants(prev => prev.filter(p => p.id !== peerKey && p.userId !== peerKey));
  };

  // Fix Round 6: close ONE P2P link without touching the tile. Unlike
  // cleanupPeer (the peer left), the participant is still in the room —
  // only the redundant transport goes away (their voice stays on
  // LiveKit). A P2P screen track is dropped too, unless it is also a
  // LiveKit screen track: the two must never share one MediaStream, or
  // the tile shows one at random. LiveKit re-delivers its screens on
  // subscribe, so dropping the P2P copy cannot strand a share.
  const closeP2PLink = (peerKey: string) => {
    if (pcsRef.current[peerKey]) {
      try { pcsRef.current[peerKey].close(); } catch (e) {}
      delete pcsRef.current[peerKey];
    }
    if (screenSendersRef.current[peerKey]) delete screenSendersRef.current[peerKey];
    if (remoteCameraTrackIdsRef.current[peerKey]) delete remoteCameraTrackIdsRef.current[peerKey];
    if (remoteVideoMetaRef.current[peerKey]) delete remoteVideoMetaRef.current[peerKey];
    if (pcCandidatesRef.current[peerKey]) delete pcCandidatesRef.current[peerKey];
    stopSpeakingDetection(peerKey);
    setActivePeerKeys(prev => prev.filter(k => k !== peerKey));
    const nextRemoteRef = { ...remoteStreamsRef.current };
    delete nextRemoteRef[peerKey];
    remoteStreamsRef.current = nextRemoteRef;
    setRemoteStreams(prev => {
      if (!prev[peerKey]) return prev;
      const copy = { ...prev };
      delete copy[peerKey];
      return copy;
    });
    setRemoteScreenStreams(prev => {
      const entry = prev[peerKey];
      if (!entry) return prev;
      const livekitScreenTrackIds = new Set<string>();
      Object.entries(livekitPublicationsRef.current).forEach(([k, pub]: [string, any]) => {
        if (!k.startsWith(`${peerKey}:`)) return;
        if (pub?.source !== Track.Source.ScreenShare) return;
        const id = pub?.track?.mediaStreamTrack?.id;
        if (id) livekitScreenTrackIds.add(id);
      });
      const kept = entry.getTracks().filter(t => livekitScreenTrackIds.has(t.id));
      if (kept.length === entry.getTracks().length) return prev;
      if (kept.length === 0) {
        const copy = { ...prev };
        delete copy[peerKey];
        return copy;
      }
      const next = new MediaStream(kept);
      return { ...prev, [peerKey]: next };
    });
  };

  // Fix Round 6: one engine carries each voice. While LiveKit is the
  // engine, a P2P link to the same peer sends that peer's microphone
  // (and camera) a second time — doubling uplink load and jitter on
  // constrained connections, for a stream nobody plays (tiles prefer
  // LiveKit). Close the redundant links. Links to peers whose own
  // engine is P2P are KEPT: they cannot reach the SFU, so the mesh is
  // their only path to us. Peers whose engine is not known yet are
  // treated as LiveKit — their presence broadcast (every 6 s) corrects
  // the record if they are really P2P, and the mesh rebuilds.
  const teardownP2PMesh = () => {
    Object.keys(pcsRef.current).forEach(peerKey => {
      if (peerEnginesRef.current[peerKey] === 'P2P') return;
      closeP2PLink(peerKey);
    });
  };

  // Collaborative Whiteboard Drawing Functions
  const redrawWhiteboard = () => {
    const canvas = whiteboardCanvasRef.current;
    const ctx = whiteboardCtxRef.current;
    if (!canvas || !ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    whiteboardStrokesRef.current.forEach(stroke => {
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Calculate responsive coordinates scaled by current canvas dimensions
      const x0 = stroke.x0 * canvas.width;
      const y0 = stroke.y0 * canvas.height;
      const x1 = stroke.x1 * canvas.width;
      const y1 = stroke.y1 * canvas.height;
      
      const type = (stroke as any).type || 'pen';
      if (type === 'pen' || type === 'line') {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      } else if (type === 'rect') {
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      } else if (type === 'circle') {
        const radius = Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2));
        ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    if (whiteboardTool === 'sticky') {
      const pctX = ((clientX - rect.left) / rect.width) * 100;
      const pctY = ((clientY - rect.top) / rect.height) * 100;
      const newNote = {
        id: generateRandomId(),
        x: pctX,
        y: pctY,
        text: 'Type here...',
        color: whiteboardColor
      };
      setStickyNotes(prev => [...prev, newNote]);
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'sticky-add',
          payload: newNote
        });
      }
      return;
    }

    isDrawingRef.current = true;
    lastPosRef.current = { x, y };
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = whiteboardCanvasRef.current;
    const ctx = whiteboardCtxRef.current;
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    if (whiteboardTool === 'pen') {
      ctx.beginPath();
      ctx.strokeStyle = whiteboardColor;
      ctx.lineWidth = whiteboardWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();

      const stroke = {
        type: 'pen',
        x0: lastPosRef.current.x / canvas.width,
        y0: lastPosRef.current.y / canvas.height,
        x1: x / canvas.width,
        y1: y / canvas.height,
        color: whiteboardColor,
        width: whiteboardWidth
      };
      whiteboardStrokesRef.current.push(stroke);

      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'draw-whiteboard',
          payload: stroke
        });
      }

      lastPosRef.current = { x, y };
    } else {
      redrawWhiteboard();
      ctx.beginPath();
      ctx.strokeStyle = whiteboardColor;
      ctx.lineWidth = whiteboardWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (whiteboardTool === 'line') {
        ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else if (whiteboardTool === 'rect') {
        ctx.strokeRect(lastPosRef.current.x, lastPosRef.current.y, x - lastPosRef.current.x, y - lastPosRef.current.y);
      } else if (whiteboardTool === 'circle') {
        const radius = Math.sqrt(Math.pow(x - lastPosRef.current.x, 2) + Math.pow(y - lastPosRef.current.y, 2));
        ctx.arc(lastPosRef.current.x, lastPosRef.current.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
  };

  const stopDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (whiteboardTool !== 'pen') {
      const canvas = whiteboardCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      let clientX = 0;
      let clientY = 0;
      if ('touches' in e) {
        if (e.changedTouches.length > 0) {
          clientX = e.changedTouches[0].clientX;
          clientY = e.changedTouches[0].clientY;
        } else {
          return;
        }
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;

      const stroke = {
        type: whiteboardTool,
        x0: lastPosRef.current.x / canvas.width,
        y0: lastPosRef.current.y / canvas.height,
        x1: x / canvas.width,
        y1: y / canvas.height,
        color: whiteboardColor,
        width: whiteboardWidth
      };

      whiteboardStrokesRef.current.push(stroke);
      redrawWhiteboard();

      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'draw-whiteboard',
          payload: stroke
        });
      }
    }
  };

  const clearWhiteboard = (broadcast = true) => {
    whiteboardStrokesRef.current = [];
    setStickyNotes([]);
    const canvas = whiteboardCanvasRef.current;
    const ctx = whiteboardCtxRef.current;
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (broadcast && sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'clear-whiteboard',
        payload: {}
      });
    }
  };

  const downloadWhiteboard = () => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `whiteboard-${meetingId}.png`;
    link.href = url;
    link.click();
  };

  // AI summary is not available: no transcription or summarisation service is
  // wired up yet. The panel says so instead of showing a pre-written summary
  // that was never about this meeting. Set immediately — there is nothing
  // to "analyze", so no fake spinner or delay.
  const generateAiSummary = () => {
    setAiSummary('AI summaries are not available yet — no transcription service is connected. This panel will show a real summary once speech-to-text is wired up.');
    setIsGeneratingSummary(false);
  };

  // Q&A Hub Functions
  const submitQuestion = (text: string) => {
    if (!text.trim()) return;
    const questionId = generateRandomId();
    const authorName = currentUser?.name || 'Guest';
    const newQ = {
      id: questionId,
      text: text,
      author: authorName,
      upvotes: 0,
      upvotedBy: []
    };
    
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'new-question',
        payload: newQ
      });
    }
    
    setQaQuestions(prev => [...prev, newQ]);
    setNewQuestionText('');
  };

  const upvoteQuestion = (questionId: string) => {
    const userId = currentUser?.id || myKey;
    setQaQuestions(prev => {
      return prev.map(q => {
        if (q.id === questionId) {
          const alreadyUpvoted = q.upvotedBy.includes(userId);
          const upvotedBy = alreadyUpvoted 
            ? q.upvotedBy.filter(id => id !== userId) 
            : [...q.upvotedBy, userId];
          const upvotes = alreadyUpvoted ? q.upvotes - 1 : q.upvotes + 1;
          
          const updatedQ = { ...q, upvotes, upvotedBy };
          
          if (sigChannelRef.current) {
            sigChannelRef.current.send({
              type: 'broadcast',
              event: 'upvote-question',
              payload: { questionId, upvotes, upvotedBy }
            });
          }
          
          return updatedQ;
        }
        return q;
      });
    });
  };

  // Emoji Reactions Functions
  const sendReaction = (emoji: string) => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'reaction',
        payload: {
          senderKey: myKey,
          emoji: emoji
        }
      });
    }
    triggerReaction(myKey, emoji);
    // 👏 is the toolbar twin of the soundboard Applause: the 'reaction'
    // broadcast carries it to everyone, who play it on receipt (above).
    // Other emoji reactions stay visual-only.
    if (emoji === '👏') playSynthesizedSound('applause');
    setShowEmojiReactions(false);
  };

  const triggerReaction = (senderKey: string, emoji: string) => {
    const id = generateRandomId();
    const offset = generateRandomOffset();
    setActiveReactions(prev => [...prev, { id, senderKey, emoji, offset }]);
    setTimeout(() => {
      setActiveReactions(prev => prev.filter(r => r.id !== id));
    }, 3000);
  };

  // Breakout Rooms Functions
  // Move into / out of a breakout room. The peer-to-peer mesh splits by
  // signalling channel, but the LiveKit room does not split on its own —
  // so entering a breakout disconnects LiveKit (otherwise voices and video
  // from the other breakout rooms would keep leaking in), and returning to
  // the main room reconnects it.
  const enterBreakoutRoom = (roomNumber: number | null) => {
    setBreakoutRoom(roomNumber);
    if (roomNumber !== null) {
      setEngineType('P2P');
    } else {
      setEngineType('LIVEKIT');
    }
  };

  const handleStartBreakouts = (roomsCount: number, durationMinutes: number) => {
    const assignments: { [peerKey: string]: number } = {};
    let roomIdx = 0;
    participants.forEach(p => {
      const peerKey = p.userId || p.id;
      if (peerKey !== myKey && p.role !== 'Admin') {
        assignments[peerKey] = (roomIdx % roomsCount) + 1;
        roomIdx++;
      }
    });

    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'start-breakout',
        payload: {
          assignments,
          durationSeconds: durationMinutes * 60
        }
      });
    }

    setBreakoutTimeRemaining(durationMinutes * 60);
    alert(`Started ${roomsCount} breakout rooms for ${durationMinutes} minutes. Breakout rooms run peer-to-peer, not on the video server, so video quality may drop — this is a labelled fallback, not the LiveKit engine.`);
  };

  const handleEndBreakouts = () => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'end-breakout',
        payload: {}
      });
    }
    enterBreakoutRoom(null);
    setBreakoutTimeRemaining(null);
  };

  // Whiteboard Canvas Context Initializer
  useEffect(() => {
    if (isWhiteboardActive && whiteboardCanvasRef.current) {
      const canvas = whiteboardCanvasRef.current;
      canvas.width = 800;
      canvas.height = 500;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        whiteboardCtxRef.current = ctx;
        redrawWhiteboard();
      }
    }
  }, [isWhiteboardActive]);

  // Web Audio speaking volume analyzer (registry version — Fix Round 6).
  // One analyser per peer, deduped by stream: a re-subscribe or a
  // re-negotiation used to pile up a new analyser + rAF loop each time,
  // none of them ever stopped. stopSpeakingDetection ends the loop and
  // disconnects the nodes (peer leave / engine teardown / mic swap).
  // Remote analysers route through a zero-gain node to the destination:
  // that keeps iOS Safari / Chrome from silencing the stream, at gain 0,
  // so it can never double-play the voice.
  const stopSpeakingDetection = (targetKey: string) => {
    const entry = speakingAnalysersRef.current[targetKey];
    if (!entry) return;
    delete speakingAnalysersRef.current[targetKey];
    entry.stopped = true;
    if (entry.raf) cancelAnimationFrame(entry.raf);
    try { entry.source.disconnect(); } catch (e) {}
    try { entry.analyser.disconnect(); } catch (e) {}
    entry.extraNodes.forEach(n => { try { n.disconnect(); } catch (e) {} });
  };

  const setupSpeakingDetection = (mediaStream: MediaStream, targetKey: string, isLocal: boolean) => {
    try {
      if (!mediaStream.getAudioTracks().some(t => t.readyState === 'live')) return;
      const existing = speakingAnalysersRef.current[targetKey];
      if (existing && existing.streamId === mediaStream.id && !existing.stopped) return; // already analysing this stream
      if (existing) stopSpeakingDetection(targetKey);
      const ctx = getAudioCtx();
      const source = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      const extraNodes: AudioNode[] = [];
      if (!isLocal) {
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        analyser.connect(silentGain);
        silentGain.connect(ctx.destination);
        extraNodes.push(silentGain);
      }

      const entry = { streamId: mediaStream.id, stopped: false, raf: 0, source, analyser, extraNodes };
      speakingAnalysersRef.current[targetKey] = entry;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let wasSpeaking = false;
      const checkVolume = () => {
        if (entry.stopped) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const speaking = average > 10;

        if (speaking !== wasSpeaking) {
          wasSpeaking = speaking;
          if (isLocal) {
            setIsSpeaking(speaking);
          } else {
            setPeerStates(prev => {
              if (!prev[targetKey]) return prev;
              return {
                ...prev,
                [targetKey]: { ...prev[targetKey], isSpeaking: speaking }
              };
            });
          }
        }
        entry.raf = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn('Speaking volume detector creation failed:', e);
    }
  };

  // Load meeting details (admin_id and notes). The passcode is NOT read
  // from the meeting row any more — it is hidden from anon reads — so the
  // host fetches it through the host-only server route for the invite
  // panel, and everyone else gets an empty passcode (the panel then shows
  // '—' and the share link carries no code). The old code started with a
  // freshly generated random code as the passcode state, so guests could
  // briefly see a made-up code in the invite panel.
  useEffect(() => {
    const loadDetails = async () => {
      try {
        const { data } = await giinApi.getMeetingDetails(meetingId);
        if (data) {
          setMeetingAdminId(data.admin_id || '');
          // Fix Round 8 (bypass check): the waiting-room toggle used to
          // default to ON for every meeting, so a bypass meeting showed
          // "Waiting Room ON" in Host Controls even though guests
          // auto-join. Initialise it from the meeting row instead.
          setIsWaitingRoomEnabled(data.require_waiting_room ?? true);
          setInitialNotes(data.notes || '');
          // Fix Round 7 (#6): the meeting lock is persisted on the
          // meeting row now - sync the toggle from the server value on
          // entry, so a host who re-opens the room sees the real state.
          void giinApi.getMeetingLock(meetingId).then(locked => setIsMeetingLocked(locked)).catch(() => { /* best-effort: keep the last known value */ });
          const amHost = isHost || (currentUser?.id && (data.admin_id === currentUser.id || data.user_id === currentUser.id));
          if (amHost) {
            const hostPasscode = await giinApi.getMeetingPasscode(meetingId);
            if (hostPasscode) setPasscode(hostPasscode);
          } else {
            setPasscode('');
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadDetails();
  }, [meetingId]);

  // Fix Round 6 (Phase 6) — the end signal must NOT depend on the P2P
  // signalling channel. That channel was gated on `passcode`, and
  // loadDetails sets passcode='' for every non-host, so guests
  // unsubscribed from it and never heard 'end-meeting'. This dedicated
  // channel is subscribed by everyone in the room, on any engine.
  useEffect(() => {
    const ch = supabase.channel(`meeting-events-${meetingId}`, {
      config: { broadcast: { self: false } }
    });
    eventsChannelRef.current = ch;
    ch
      .on('broadcast', { event: 'end-meeting' }, () => { enterEndedState('host-ended'); })
      .on('broadcast', { event: 'designate-admin' }, (payload: any) => {
        const newAdminId = payload?.payload?.newAdminId;
        if (!newAdminId) return;
        setMeetingAdminId(newAdminId);
        setLocalAdminId(newAdminId);
        if (currentUser && newAdminId === currentUser.id) {
          triggerToast('You are now the host of this meeting.');
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
      if (eventsChannelRef.current === ch) eventsChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // Fix Round 6 (Phase 6) — server-truth meeting watcher. A missed
  // broadcast must never strand anyone: the meeting row itself says
  // when the meeting ended (status Completed) or who the host is now
  // (admin_id). Realtime first, 5s polling as the backstop.
  useEffect(() => {
    let active = true;
    let lastAdminSeen = '';
    const applyMeetingRow = (row: any) => {
      if (!active || !row || endedRef.current) return;
      if (row.status === 'Completed') { enterEndedState('host-ended'); return; }
      const newAdmin = row.admin_id || '';
      if (newAdmin) {
        const wasAdmin = lastAdminSeen;
        lastAdminSeen = newAdmin;
        setMeetingAdminId(newAdmin);
        setLocalAdminId(newAdmin);
        if (currentUser && newAdmin === currentUser.id && wasAdmin && wasAdmin !== currentUser.id) {
          triggerToast('You are now the host of this meeting.');
        }
      }
    };
    const poll = async () => {
      try {
        const { data } = await giinApi.getMeetingDetails(meetingId);
        if (data) applyMeetingRow(data);
      } catch (e) { /* transient: keep polling */ }
      // Fix Round 7 (#6): the persisted lock is the truth for everyone
      // in the room, even if a settings broadcast was missed. Skipped
      // while the host's own lock write is in flight, so the poll
      // cannot undo the toggle a moment after it was flipped.
      if (!lockWriteInFlightRef.current) {
        try {
          const locked = await giinApi.getMeetingLock(meetingId);
          setIsMeetingLocked(locked);
        } catch (e) { /* best-effort: keep the last known value */ }
      }
    };
    const channel = supabase
      .channel(`meeting-state-${meetingId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meetings', filter: `id=eq.${meetingId}` }, (payload: any) => {
        applyMeetingRow(payload.new);
      })
      .subscribe();
    void poll();
    const interval = setInterval(poll, 5000);
    return () => {
      active = false;
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // Poll and subscribe to realtime call chat messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const list = await giinApi.getMessages(meetingId);
        if (list) {
          const mapped = list.map((msg: any) => {
            const isSelf = currentUser ? (msg.user_id === currentUser.id) : false;
            return {
              id: msg.id,
              sender: msg.sender_name,
              text: msg.text,
              time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              self: isSelf
            };
          });
          // Keep any just-sent message that the database list has not
          // caught up with yet (see mergeChatWithPending).
          setMessages(prev => mergeChatWithPending(mapped, prev));
        }
      } catch (err) {
        console.error('Failed to load call messages:', err);
      }
    };

    loadMessages();

    // Subscribe to realtime inserts
    const channel = supabase
      .channel(`meeting-chat-${meetingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: any) => {
          const msg = payload.new;
          if (msg && msg.thread_id === meetingId) {
            const isSelf = currentUser ? (msg.user_id === currentUser.id) : false;
            const mappedMsg = {
              id: msg.id,
              sender: msg.sender_name,
              text: msg.text,
              time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              self: isSelf
            };
            setMessages(prev => {
              // Dedup by database row id. The old text+sender key dropped
              // legitimately repeated messages ("ok" twice is two messages).
              if (mappedMsg.id && prev.some(m => (m as any).id === mappedMsg.id)) return prev;
              // A realtime echo of our own just-sent message replaces the
              // optimistic copy instead of duplicating it.
              const pendingIdx = prev.findIndex(m => (m as any).pending && m.self && m.sender === mappedMsg.sender && m.text === mappedMsg.text);
              if (pendingIdx >= 0) {
                const next = [...prev];
                next[pendingIdx] = mappedMsg;
                return next;
              }
              return [...prev, mappedMsg];
            });
            // Unread badge: a message from someone else while the chat
            // panel is closed counts as unread. (Your own messages can't
            // reach here with the panel closed — you send from the panel.)
            if (!isSelf && activePanelRef.current !== 'chat') {
              setUnreadChatCount(c => c + 1);
            }
          }
        }
      )
      .subscribe();

    const interval = setInterval(loadMessages, 4000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [meetingId, currentUser]);

  // Load admitted participants from database periodically and in realtime
  useEffect(() => {
    const loadParticipants = async () => {
      try {
        const list = await giinApi.getAdmittedParticipants(meetingId);
        if (list) {
          // Fix Round 7 (#1): a kicked guest leaves even if the
          // remove-participant broadcast was missed - their row is
          // gone from this list. Only trust the check once our own row
          // has been seen at least once, so a slow first load never
          // ejects someone who just joined. Hosts never self-eject.
          const ownRowSeen = list.some((p: any) => (myParticipantRowId && p.id === myParticipantRowId) || p.user_id === myKey || p.id === myKey);
          if (ownRowSeen) {
            seenOwnRowRef.current = true;
          } else if (seenOwnRowRef.current && !isAdmin && !endedRef.current) {
            // Round 9 (9A): our row left the admitted list — the host
            // removed us (status 'Removed'). No alert: the removed
            // screen IS the message.
            enterEndedState('removed');
            return;
          }
          const mapped: Participant[] = list
            .filter((p: any) => p.user_id !== currentUser?.id && p.id !== currentUser?.id)
            .map((p: any) => {
              const initials = getParticipantInitials(p.name);
              let hash = 0;
              for (let i = 0; i < (p.name || '').length; i++) {
                hash = (p.name || '').charCodeAt(i) + ((hash << 5) - hash);
              }
              const hue = Math.abs(hash % 360);
              const avatarBg = `hsl(${hue}, 60%, 40%)`;

              return {
                id: p.id,
                userId: p.user_id,
                name: p.name || 'Participant',
                avatar: initials,
                role: p.role || 'Participant',
                isMuted: false,
                isSpeaking: false,
                // Unknown until the peer announces (presence) or a live
                // track arrives: assuming video-on made trackless guests
                // look "Connecting..." forever. The tile trusts a live
                // track over this flag anyway.
                isVideoOn: false,
                avatarBg: avatarBg
              };
            });
          setParticipants(prev => {
            // Carry over the live media state we already know for each
            // person. The database rows carry no mute/video state, so a
            // fresh map would otherwise reset everyone to "unmuted, video
            // on" on every poll.
            const merged = mapped.map(m => {
              const existing = prev.find(p => p.id === m.id || (m.userId ? p.userId === m.userId : false));
              if (!existing) return m;
              return { ...m, isMuted: existing.isMuted, isVideoOn: existing.isVideoOn, isSpeaking: existing.isSpeaking };
            });
            prev.forEach(p => {
              // If it's a peer discovered over the signalling channel (not in the database list), preserve it so it is not wiped out by the database sync
              const isDynamic = p.id.startsWith('user-signals-') || !mapped.some(m => m.id === p.id || m.userId === p.userId);
              const isStillActive = !!(pcsRef.current[p.id] || pcsRef.current[p.userId || ''] || peerStates[p.id] || peerStates[p.userId || ''] || p.id.startsWith('user-signals-'));
              if (isDynamic && isStillActive) {
                if (!merged.some(m => m.id === p.id || m.userId === p.userId)) {
                  merged.push(p);
                }
              }
            });
            return merged;
          });
        }
      } catch (err) {
        console.error('Failed to load call participants:', err);
      }
    };

    loadParticipants();

    // Subscribe to participant additions/status changes
    const channel = supabase
      .channel(`meeting-participants-${meetingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_participants' },
        (payload: any) => {
          const row = payload.new || payload.old;
          if (row && row.meeting_id === meetingId) {
            loadParticipants();
          }
        }
      )
      .subscribe();

    const interval = setInterval(loadParticipants, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [meetingId, currentUser]);

  // Keep the participants list honest: sync live media state (mute / video /
  // speaking) from the signalling channel into the list. The database rows
  // carry no media state, so without this the list always shows everyone
  // unmuted with video on, and the host mute button always renders.
  useEffect(() => {
    setParticipants(prev => {
      let changed = false;
      const next = prev.map(p => {
        const ps = peerStates[p.userId || ''] || peerStates[p.id || ''];
        if (!ps) return p;
        if (p.isMuted === ps.isMuted && p.isVideoOn === ps.isVideoOn && p.isSpeaking === ps.isSpeaking) return p;
        changed = true;
        return { ...p, isMuted: ps.isMuted, isVideoOn: ps.isVideoOn, isSpeaking: ps.isSpeaking };
      });
      return changed ? next : prev;
    });
  }, [peerStates]);

  // WebRTC mesh signaling engine
  useEffect(() => {
    // Fix Round 7 (#1): the channel is NOT gated on the meeting
    // passcode any more. loadDetails sets passcode='' for every
    // non-host, so guests unsubscribed from this channel and never
    // heard mute/kick/settings/hand-raises - and P2P signalling could
    // not reach them at all. The channel name is not a secret; control
    // events are authenticated server-side instead (see
    // /api/meetings/control and the `server` marker checks below).
    if (!isMediaInitialized) return; // wait until media loads

    const channelSuffix = breakoutRoom ? `-breakout-${breakoutRoom}` : '';
    const sigChannel = supabase.channel(`sig-webrtc-${meetingId}${channelSuffix}`, {
      config: {
        broadcast: { self: false }
      }
    });

    sigChannelRef.current = sigChannel;

    const initPeerConnection = (peerKey: string, forceAudioOnly = false) => {
      if (pcsRef.current[peerKey]) {
        pcsRef.current[peerKey].close();
      }

      const config: any = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        encodedInsertableStreams: false
      };

      let pc: RTCPeerConnection;
      try {
        pc = new RTCPeerConnection(config);
      } catch (e) {
        pc = new RTCPeerConnection(config);
      }

      pcsRef.current[peerKey] = pc;
      makingOfferRef.current[peerKey] = false;
      setActivePeerKeys(prev => [...new Set([...prev, peerKey])]);

      // Add local media tracks
      if (stream) {
        stream.getTracks().forEach(track => {
          if (forceAudioOnly && track.kind === 'video') {
            return; // Skip adding video tracks under capacity rules
          }
          const sender = pc.addTrack(track, stream);
        });
      }
      // If we are currently screensharing, we must also add the screen track!
      // NOTE: read the ref, not the isScreenSharing/screenStream state --
      // this function closes over the signalling effect's render, so the
      // state here is stale (sharing usually started after the effect last
      // ran) and a peer joining mid-share would otherwise never receive it.
      const liveScreenStream = screenStreamRef.current;
      if (liveScreenStream) {
        const screenTrack = liveScreenStream.getVideoTracks()[0];
        if (screenTrack && screenTrack.readyState === 'live') {
          const sender = pc.addTrack(screenTrack, liveScreenStream);
          screenSendersRef.current[peerKey] = sender;
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && sigChannelRef.current) {
          sigChannelRef.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'candidate',
              targetKey: peerKey,
              senderKey: myKey,
              candidate: event.candidate
            }
          });
        }
      };

      pc.ontrack = (event) => {
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        const track = event.track;
        // Record provenance: whether this track arrived in a stream that
        // also carried audio. A screen is captured with audio:false, so a
        // screen track always arrives in a video-only stream; a camera
        // track normally arrives with its mic track (mute only disables
        // it, never removes it) -- except for a peer whose mic acquisition
        // failed, whose camera is video-only too. Provenance plus the
        // sender's screen track id (below) disambiguate that case.
        if (track.kind === 'video') {
          const meta = remoteVideoMetaRef.current[peerKey] || {};
          meta[track.id] = { streamHadAudio: remoteStream.getAudioTracks().length > 0 };
          remoteVideoMetaRef.current[peerKey] = meta;
        }
        if (track.kind === 'video') {
          // Classification. Read peer state through refs: this handler
          // closes over the signalling effect's first render, so the
          // `peerStates` / `remoteStreams` state variables here are stale
          // (sharing flags from before the call) and the old checks could
          // never see a peer start sharing.
          const peerState = peerStatesRef.current[peerKey];
          const peerSharing = !!peerState?.isScreenSharing;
          const screenTrackId = peerState?.screenTrackId || null;
          // An audio-confirmed camera track for this peer (only set when
          // a video track arrived in a stream that also carried audio --
          // a screen never does, so this can never point at one).
          const knownCameraId = remoteCameraTrackIdsRef.current[peerKey] || null;
          const streamHasAudio = remoteStream.getAudioTracks().length > 0;
          // Primary signal: the sender's screen track id, which arrives
          // on the media-state / presence broadcasts (before the offer in
          // the normal case). Fallbacks: a video-only stream from a peer
          // who is sharing, or any further video track once their camera
          // is known. A no-mic peer's video-only CAMERA is only misread
          // while the id is still unknown -- reclassifyScreenTracks sorts
          // it out as soon as the id lands.
          const isScreen =
            (screenTrackId !== null && peerSharing && track.id === screenTrackId) ||
            (peerSharing && !streamHasAudio) ||
            (peerSharing && !!knownCameraId) ||
            (!peerSharing && !streamHasAudio && !!knownCameraId);
          if (isScreen) {
            const storedScreen = remoteScreenStreamsRef.current[peerKey] || new MediaStream();
            if (!storedScreen.getTracks().some(t => t.id === track.id)) storedScreen.addTrack(track);
            const nextScreen = { ...remoteScreenStreamsRef.current, [peerKey]: storedScreen };
            remoteScreenStreamsRef.current = nextScreen;
            setRemoteScreenStreams(nextScreen);
            return;
          }
          if (streamHasAudio) remoteCameraTrackIdsRef.current[peerKey] = track.id;
        }
        // Camera-side tracks (audio, or a video track classified as
        // camera): merge into the stored camera stream, replacing tracks
        // of the same kind(s) the incoming stream carries -- except a
        // video-only track that is not the audio-confirmed camera, which
        // is a screen track that arrived early and was tentatively filed
        // here. Dropping it would lose it for good; reclassify moves it
        // once the announcement lands.
        const incomingKinds = new Set(remoteStream.getTracks().map(t => t.kind));
        const metaForPeer = remoteVideoMetaRef.current[peerKey] || {};
        const knownCameraIdNow = remoteCameraTrackIdsRef.current[peerKey] || null;
        const stored = remoteStreamsRef.current[peerKey] || new MediaStream();
        stored.getTracks().forEach(t => {
          if (!incomingKinds.has(t.kind)) return;
          if (t.kind === 'video' && metaForPeer[t.id]?.streamHadAudio === false && t.id !== knownCameraIdNow) return;
          stored.removeTrack(t);
        });
        remoteStream.getTracks().forEach(t => {
          if (!stored.getTracks().some(x => x.id === t.id)) stored.addTrack(t);
        });
        const nextStreams = { ...remoteStreamsRef.current, [peerKey]: stored };
        remoteStreamsRef.current = nextStreams;
        setRemoteStreams(nextStreams);
        setupSpeakingDetection(stored, peerKey, false);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          if (reconnectTimersRef.current[peerKey]) {
            clearTimeout(reconnectTimersRef.current[peerKey]);
            delete reconnectTimersRef.current[peerKey];
          }
          stopRingSound();
          playHandshakeConfirmSound();
          setPeerStates(prev => ({
            ...prev,
            [peerKey]: {
              ...prev[peerKey],
              isReconnecting: false
            }
          }));
        } else if (pc.connectionState === 'disconnected') {
          setPeerStates(prev => ({
            ...prev,
            [peerKey]: {
              ...prev[peerKey],
              isReconnecting: true
            }
          }));
          
          try {
            pc.restartIce();
          } catch (e) {
            console.warn('ICE restart failed:', e);
          }
          
          const timerId = setTimeout(() => {
            if (pcsRef.current[peerKey] && pcsRef.current[peerKey].connectionState === 'disconnected') {
              cleanupPeer(peerKey);
            }
          }, 10000);
          reconnectTimersRef.current[peerKey] = timerId;
        } else if (pc.connectionState === 'failed') {
          cleanupPeer(peerKey);
        }
      };

      // Renegotiation (e.g. after addTrack/removeTrack for screen share)
      // goes through the shared helper, which records when an offer
      // actually went out so a missed onnegotiationneeded event can be
      // retried explicitly.
      pc.onnegotiationneeded = () => {
        void renegotiatePeer(peerKey);
      };

      return pc;
    };
    initPeerConnectionRef.current = initPeerConnection;

    const handleSignal = async (data: any) => {
      const { type, senderKey, sdp, candidate } = data;

      // Fix Round 6: the mesh is dormant while the SFU carries media —
      // except for a peer whose own engine is P2P (their LiveKit
      // failed), who can only reach us peer-to-peer. The offer carries
      // the sender's engine so the answerer can tell. Answers and
      // candidates need no gate: they only arrive for a PC this side
      // already created.
      if (data.engine) peerEnginesRef.current[senderKey] = data.engine;
      if (type === 'offer' && engineTypeRef.current === 'LIVEKIT' && data.engine !== 'P2P') return;

      if (type === 'offer') {
        let pc = pcsRef.current[senderKey];
        if (!pc || pc.signalingState === 'closed') {
          pc = initPeerConnection(senderKey);
        }

        const polite = myKey < senderKey;
        const offerCollision = makingOfferRef.current[senderKey] || pc.signalingState !== 'stable';
        const ignoreOffer = !polite && offerCollision;

        if (ignoreOffer) {
          console.warn('[WebRTC] Collision detected: ignoring polite offer from', senderKey);
          return;
        }

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (sigChannelRef.current) {
            sigChannelRef.current.send({
              type: 'broadcast',
              event: 'signal',
              payload: {
                type: 'answer',
                targetKey: senderKey,
                senderKey: myKey,
                sdp: pc.localDescription
              }
            });
          }
        } catch (err) {
          console.error('[WebRTC] Error handling offer:', err);
        }

        // Process buffered ICE candidates
        const candidates = pcCandidatesRef.current[senderKey] || [];
        for (const cand of candidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.warn('[WebRTC] Error adding buffered ICE candidate:', e);
          }
        }
        pcCandidatesRef.current[senderKey] = [];

      } else if (type === 'answer') {
        const pc = pcsRef.current[senderKey];
        if (pc && pc.signalingState !== 'closed') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          } catch (err) {
            console.error('[WebRTC] Error handling answer:', err);
          }

          // Process buffered ICE candidates
          const candidates = pcCandidatesRef.current[senderKey] || [];
          for (const cand of candidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('[WebRTC] Error adding buffered ICE candidate:', e);
            }
          }
          pcCandidatesRef.current[senderKey] = [];
        }
      } else if (type === 'candidate') {
        const pc = pcsRef.current[senderKey];
        if (pc && pc.remoteDescription && pc.remoteDescription.type && pc.signalingState !== 'closed') {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTC] Error adding ICE candidate:', e);
          }
        } else {
          if (!pcCandidatesRef.current[senderKey]) {
            pcCandidatesRef.current[senderKey] = [];
          }
          pcCandidatesRef.current[senderKey].push(candidate);
        }
      }
    };

    sigChannel
      .on('broadcast', { event: 'presence' }, (payload: any) => {
        const data = payload.payload;
        const senderKey = data.senderKey;
        
        if (senderKey !== myKey) {
          playUserJoinSound();
          // Fix Round 6: remember the peer's engine. A peer on the SFU
          // needs no P2P link — and if we built one while their engine
          // was unknown, close it now that we know.
          if (data.engine) peerEnginesRef.current[senderKey] = data.engine;
          if (data.engine === 'LIVEKIT' && engineTypeRef.current === 'LIVEKIT') closeP2PLink(senderKey);
          // A guest's signalling key is a random per-visit UUID, but
          // tiles are keyed by the meeting_participants row id (which
          // is also the guest's LiveKit identity). The guest sends its
          // row id with presence, so store the state under BOTH keys:
          // the sender key for the P2P mesh, the row id for the tiles.
          // Without this, a guest's "camera off" never reached their
          // tile and it waited forever for video that was never coming.
          const canonicalKey = data.participantRowId || senderKey;
          const peerStateFor = (prev: any) => ({
            name: data.name,
            isVideoOn: data.isVideoOn,
            isMuted: data.isMuted,
            isScreenSharing: data.isScreenSharing,
            screenTrackId: data.screenTrackId !== undefined ? data.screenTrackId : prev[senderKey]?.screenTrackId ?? prev[canonicalKey]?.screenTrackId ?? null,
            isSpeaking: false
          });
          setPeerStates(prev => {
            const next: { [peerKey: string]: any } = { ...prev, [senderKey]: peerStateFor(prev) };
            if (canonicalKey !== senderKey) next[canonicalKey] = peerStateFor(prev);
            return next;
          });

          // A peer discovered over the signalling channel: add them to the participant list if not present yet.
          // A late screen-share announcement can arrive after the track:
          // move any misclassified track into (or out of) the screen map.
          reclassifyScreenTracks(senderKey, !!data.isScreenSharing, data.screenTrackId ?? null);

          setParticipants(prev => {
            const exists = prev.some(p => p.id === senderKey || p.userId === senderKey || p.id === canonicalKey || p.userId === canonicalKey);
            if (exists) return prev;
            
            const initials = getParticipantInitials(data.name);
            let hash = 0;
            for (let i = 0; i < (data.name || '').length; i++) {
              hash = (data.name || '').charCodeAt(i) + ((hash << 5) - hash);
            }
            const hue = Math.abs(hash % 360);
            const avatarBg = `hsl(${hue}, 60%, 40%)`;

            const newDiscoveredParticipant: Participant = {
              id: canonicalKey,
              userId: canonicalKey,
              name: data.name || 'Participant',
              avatar: initials,
              role: 'Participant',
              isMuted: data.isMuted,
              isSpeaking: false,
              isVideoOn: data.isVideoOn,
              avatarBg: avatarBg
            };
            return [...prev, newDiscoveredParticipant];
          });

          // Lexicographical ordering resolves glare (only smaller key initiates)
          const isInitiator = myKey < senderKey;
          const existingPc = pcsRef.current[senderKey];
          const needsConnection = !existingPc || 
            existingPc.connectionState === 'failed' || 
            existingPc.connectionState === 'closed';

          // Fix Round 6: build the mesh only when it is actually the
          // transport — our engine is P2P (fallback / breakout), or the
          // peer's is (their LiveKit failed, so the SFU cannot carry
          // them). Two LiveKit peers never mesh: their voices already
          // meet on the server, and a parallel mesh only doubles the
          // uplink and the jitter.
          if (isInitiator && needsConnection && (engineTypeRef.current === 'P2P' || data.engine === 'P2P')) {
            initPeerConnection(senderKey);
          }
        }
      })
      .on('broadcast', { event: 'leave' }, (payload: any) => {
        const data = payload.payload;
        cleanupPeer(data.senderKey);
      })
      .on('broadcast', { event: 'waitroom-request' }, (payload: any) => {
        if (isAdmin) {
          const data = payload.payload;
          // Admit by the DATABASE participant row id when the guest has
          // one — the signalling key alone matches no database row, so the
          // old admit updated zero rows and the guest stayed 'Waiting'
          // forever in the database (the 4s poll could never see Admitted).
          const admitKey = data.participantRowId || data.senderKey;

          if (isMeetingLocked) {
            handleAdmitParticipant(admitKey, 'Declined');
            return;
          }

          const isPreviouslyAdmitted = admittedKeys.has(data.senderKey) ||
            admittedKeys.has(admitKey) ||
            JSON.parse(localStorage.getItem(`admitted_keys_${meetingId}`) || '[]').includes(data.senderKey);

          if (!isWaitingRoomEnabled || isPreviouslyAdmitted) {
            handleAdmitParticipant(admitKey, 'Admitted');
            return;
          }

          setWaitingList(prev => {
            // One entry per guest: a guest first announces with their
            // signalling key, then with their database row id — keep the
            // row id on the same entry so Admit updates the real row.
            const existing = prev.find(p => p.id === data.senderKey || (data.participantRowId && p.participantRowId === data.participantRowId));
            if (existing) {
              if (data.participantRowId && existing.participantRowId !== data.participantRowId) {
                return prev.map(p => p.id === existing.id ? { ...p, participantRowId: data.participantRowId } : p);
              }
              return prev;
            }
            return [...prev, { id: data.senderKey, name: data.name, participantRowId: data.participantRowId || undefined }];
          });
        }
      })
      .on('broadcast', { event: 'end-meeting' }, () => {
        // Legacy path — the dedicated meeting-events channel is the
        // primary signal now (Phase 6). Kept so a client on the older
        // build still ends this one.
        if (!isAdmin) {
          enterEndedState('host-ended');
        }
      })
      .on('broadcast', { event: 'designate-admin' }, (payload: any) => {
        const data = payload.payload;
        setMeetingAdminId(data.newAdminId);
        setLocalAdminId(data.newAdminId);
        if (currentUser && data.newAdminId === currentUser.id) {
          alert('You have been designated as the meeting host.');
        }
      })
      .on('broadcast', { event: 'settings-update' }, (payload: any) => {
        const data = payload.payload;
        // Fix Round 7 (#3): settings only arrive from the server now
        // (POST /api/meetings/control, host-verified). A broadcast
        // without the server marker is a forgery attempt - ignore it.
        if (data.server !== true) return;
        if (data.isWaitingRoomEnabled !== undefined) {
          setIsWaitingRoomEnabled(data.isWaitingRoomEnabled);
        }
        if (data.isChatLocked !== undefined) {
          setIsChatLocked(data.isChatLocked);
        }
        if (data.isMeetingLocked !== undefined) {
          setIsMeetingLocked(data.isMeetingLocked);
        }
        if (data.isScreenShareBlockedForGuests !== undefined) {
          setIsScreenShareBlockedForGuests(data.isScreenShareBlockedForGuests);
        }
        if (data.isMuteOnEntryEnabled !== undefined) {
          setIsMuteOnEntryEnabled(data.isMuteOnEntryEnabled);
          if (data.isMuteOnEntryEnabled && !isAdmin) {
            setIsMuted(true);
            if (localAudioTrackRef.current) {
              localAudioTrackRef.current.enabled = false;
            }
          }
        }
      })
      .on('broadcast', { event: 'mute-all' }, (payload: any) => {
        // Fix Round 7 (#3): only the server may mute everyone.
        if (payload?.payload?.server !== true) return;
        if (!isAdmin) {
          setIsMuted(true);
          if (localAudioTrackRef.current) {
            localAudioTrackRef.current.enabled = false;
          }
          alert('The host has muted everyone.');
        }
      })
      .on('broadcast', { event: 'mute-participant' }, (payload: any) => {
        const data = payload.payload;
        // Fix Round 7 (#3): only the server may mute a participant.
        if (data.server !== true) return;
        // Match by signalling key OR our own participant row id
        // (guests have user_id NULL, so a row-id target is the only
        // form that reaches them).
        if ((data.targetUserId === myKey || (data.targetRowId && myParticipantRowId && data.targetRowId === myParticipantRowId)) && !isAdmin) {
          setIsMuted(true);
          if (localAudioTrackRef.current) {
            localAudioTrackRef.current.enabled = false;
          }
          alert('You have been muted by the host.');
        }
      })
      .on('broadcast', { event: 'remove-participant' }, async (payload: any) => {
        const data = payload.payload;
        // Fix Round 7 (#3): only the server may remove a participant.
        if (data.server !== true) return;
        // Match by signalling key OR by our own meeting_participants row id
        // (guests have user_id NULL, so their myKey never matches a user id).
        if (data.targetUserId === myKey || (data.targetRowId && myParticipantRowId && data.targetRowId === myParticipantRowId)) {
          // Round 9 (9A): the server kept our row as 'Removed' (the
          // rejoin block) — do NOT delete it, and do not alert: the
          // removed screen IS the message.
          enterEndedState('removed');
        }
      })
      .on('broadcast', { event: 'disable-video-all' }, (payload: any) => {
        // Fix Round 7 (#3): only the server may disable everyone's video.
        if (payload?.payload?.server !== true) return;
        if (!isAdmin) {
          setIsVideoOn(false);
          if (localVideoTrackRef.current) {
            localVideoTrackRef.current.enabled = false;
          }
          alert("The host has disabled everyone's video.");
        }
      })
      .on('broadcast', { event: 'play-sound' }, (payload: any) => {
        const data = payload.payload;
        playSynthesizedSound(data.soundType);
      })
      .on('broadcast', { event: 'launch-poll' }, (payload: any) => {
        const data = payload.payload;
        setPolls(prev => {
          if (prev.some(p => p.id === data.poll.id)) return prev;
          return [...prev, data.poll];
        });
      })
      .on('broadcast', { event: 'vote-poll' }, (payload: any) => {
        // Every client counts votes itself (with per-voter dedup), so polls
        // work even when no admin is present. A voter changing their mind
        // moves their vote instead of inflating the count.
        const data = payload.payload;
        applyPollVote(data.pollId, data.optionIndex, data.voterId);
      })
      .on('broadcast', { event: 'update-poll-results' }, (payload: any) => {
        const data = payload.payload;
        setPolls(prev => prev.map(p => p.id === data.pollId ? { ...p, votes: data.votes } : p));
      })
      .on('broadcast', { event: 'media-filter' }, (payload: any) => {
        const data = payload.payload;
        setPeerStates(prev => {
          if (!prev[data.senderKey]) return prev;
          return {
            ...prev,
            [data.senderKey]: { 
              ...prev[data.senderKey], 
              videoFilter: data.filter,
              isStudioLightEnabled: data.isStudioLightEnabled
            }
          };
        });
      })
      .on('broadcast', { event: 'live-caption' }, (payload: any) => {
        const data = payload.payload;
        setActiveCaption({ name: data.senderName, text: data.text });
        
        if (data.isFinal) {
          const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setTranscripts(prev => [...prev, { name: data.senderName, text: data.text, time }]);
          setTimeout(() => {
            setActiveCaption(null);
          }, 4000);
        }
      })
      .on('broadcast', { event: 'hand-raise' }, (payload: any) => {
        const data = payload.payload;
        setHandRaises(prev => [...prev.filter(hr => hr.userId !== data.userId), data]);
        // The raise itself is the sound trigger: one sound per reason,
        // played for everyone in the room. The raiser is not echoed by
        // the broadcast, so they play their own sound locally in
        // toggleHandRaise; everyone else plays it here.
        if (data.userId !== myKey) playSynthesizedSound(handRaiseSoundKey(data.reason));
      })
      .on('broadcast', { event: 'lower-hand' }, (payload: any) => {
        const data = payload.payload;
        if (data.userId === myKey) {
          setLocalHandRaised(false);
          setHandRaiseReason(null);
        }
        setHandRaises(prev => prev.filter(hr => hr.userId !== data.userId));
      })
      .on('broadcast', { event: 'clear-all-hands' }, () => {
        setLocalHandRaised(false);
        setHandRaiseReason(null);
        setHandRaises([]);
      })
      .on('broadcast', { event: 'signal' }, (payload: any) => {
        const data = payload.payload;
        if (data.targetKey === myKey) {
          handleSignal(data);
        }
      })
      .on('broadcast', { event: 'reaction' }, (payload: any) => {
        const data = payload.payload;
        triggerReaction(data.senderKey, data.emoji);
        // 👏 is the toolbar twin of the soundboard Applause — it plays the
        // same sound for everyone. Other emoji reactions stay visual-only.
        if (data.emoji === '👏') playSynthesizedSound('applause');
      })
      .on('broadcast', { event: 'new-question' }, (payload: any) => {
        const data = payload.payload;
        setQaQuestions(prev => {
          if (prev.some(q => q.id === data.id)) return prev;
          return [...prev, data];
        });
      })
      .on('broadcast', { event: 'upvote-question' }, (payload: any) => {
        const data = payload.payload;
        setQaQuestions(prev => prev.map(q => q.id === data.questionId ? { ...q, upvotes: data.upvotes, upvotedBy: data.upvotedBy } : q));
      })
      .on('broadcast', { event: 'draw-whiteboard' }, (payload: any) => {
        const data = payload.payload;
        whiteboardStrokesRef.current.push(data);
        redrawWhiteboard();
      })
      .on('broadcast', { event: 'clear-whiteboard' }, () => {
        clearWhiteboard(false);
      })
      .on('broadcast', { event: 'sticky-add' }, (payload: any) => {
        const data = payload.payload;
        setStickyNotes(prev => [...prev.filter(n => n.id !== data.id), data]);
      })
      .on('broadcast', { event: 'sticky-update' }, (payload: any) => {
        const data = payload.payload;
        setStickyNotes(prev => prev.map(n => n.id === data.id ? { ...n, text: data.text } : n));
      })
      .on('broadcast', { event: 'sticky-delete' }, (payload: any) => {
        const data = payload.payload;
        setStickyNotes(prev => prev.filter(n => n.id !== data.id));
      })
      .on('broadcast', { event: 'start-breakout' }, (payload: any) => {
        const data = payload.payload;
        const myAssignment = data.assignments[myKey];
        if (myAssignment) {
          enterBreakoutRoom(myAssignment);
          setBreakoutTimeRemaining(data.durationSeconds);
          alert(`You are being moved to Breakout Room ${myAssignment}.`);
        }
      })
      .on('broadcast', { event: 'end-breakout' }, () => {
        enterBreakoutRoom(null);
        setBreakoutTimeRemaining(null);
        alert('Breakout rooms have ended. Returning to main room.');
      })
      .on('broadcast', { event: 'media-state' }, (payload: any) => {
        const data = payload.payload;
        if (data.senderKey !== myKey) {
          const mediaCanonicalKey = data.participantRowId || data.senderKey;
          setPeerStates(prev => {
            const current = prev[data.senderKey] || prev[mediaCanonicalKey] || {
              name: 'Participant',
              isSpeaking: false
            };
            const updated = {
              ...current,
              isVideoOn: data.isVideoOn,
              isMuted: data.isMuted,
              isScreenSharing: data.isScreenSharing,
              screenTrackId: data.screenTrackId !== undefined ? data.screenTrackId : (current as any).screenTrackId ?? null
            };
            const next: { [peerKey: string]: any } = { ...prev, [data.senderKey]: updated };
            if (mediaCanonicalKey !== data.senderKey) next[mediaCanonicalKey] = updated;
            return next;
          });
          // The track may have arrived before this announcement: re-route
          // any video track it misclassified, in either direction.
          reclassifyScreenTracks(data.senderKey, !!data.isScreenSharing, data.screenTrackId ?? null);
        }
      })
      .on('broadcast', { event: 'ping' }, (payload: any) => {
        const data = payload.payload;
        if (data.senderKey !== myKey) {
          sigChannel.send({
            type: 'broadcast',
            event: 'pong',
            payload: {
              targetKey: data.senderKey,
              senderKey: myKey,
              timestamp: data.timestamp
            }
          });
        }
      })
      .on('broadcast', { event: 'pong' }, (payload: any) => {
        const data = payload.payload;
        if (data.targetKey === myKey) {
          const rtt = Date.now() - data.timestamp;
          const latency = Math.round(rtt / 2);
          setPeerStates(prev => {
            if (!prev[data.senderKey]) return prev;
            return {
              ...prev,
              [data.senderKey]: { ...prev[data.senderKey], latency }
            };
          });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Announce local user presence
          sigChannel.send({
            type: 'broadcast',
            event: 'presence',
            payload: {
              senderKey: myKey,
              participantRowId: myParticipantRowId || undefined,
              name: currentUser?.name || 'Guest',
              // Fix Round 6: peers need to know our engine — a P2P-only
              // peer can only reach us over the mesh, a LiveKit peer
              // must not build one to us.
              engine: engineTypeRef.current,
              // Read live values from refs: this closure is frozen at the
              // signalling effect's last run and would otherwise re-broadcast
              // a stale isScreenSharing=false every 6s.
              isVideoOn: isVideoOnRef.current,
              isMuted: isMutedRef.current,
              isScreenSharing: isScreenSharingRef.current,
              screenTrackId: isScreenSharingRef.current ? (screenStreamRef.current?.getVideoTracks()[0]?.id ?? null) : null
            }
          });

          // Start calling tone loop until a peer joins (only for P2P calls)
          if (isP2PCall) {
            startRingSound();
          }
        }
      });

    // Check ringing loop: if someone connects, stop ring chimes
    const ringingCheck = setInterval(() => {
      if (Object.keys(pcsRef.current).length > 0) {
        stopRingSound();
      }
    }, 1500);

    // Keep broadcasting presence and latency ping requests
    const intervalPresence = setInterval(() => {
      sigChannel.send({
        type: 'broadcast',
        event: 'presence',
        payload: {
          senderKey: myKey,
          participantRowId: myParticipantRowId || undefined,
          name: currentUser?.name || 'Guest',
          engine: engineTypeRef.current,
          // Live values from refs -- see the SUBSCRIBED announce above.
          isVideoOn: isVideoOnRef.current,
          isMuted: isMutedRef.current,
          isScreenSharing: isScreenSharingRef.current,
          screenTrackId: isScreenSharingRef.current ? (screenStreamRef.current?.getVideoTracks()[0]?.id ?? null) : null
        }
      });
    }, 6000);

    const intervalPing = setInterval(() => {
      sigChannel.send({
        type: 'broadcast',
        event: 'ping',
        payload: {
          senderKey: myKey,
          timestamp: Date.now()
        }
      });
    }, 8000);

    return () => {
      // Broadcast instant leave message
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'leave',
          payload: {
            senderKey: myKey
          }
        });
      }

      sigChannel.unsubscribe();
      stopRingSound();
      clearInterval(ringingCheck);
      clearInterval(intervalPresence);
      clearInterval(intervalPing);
      // Close all connections
      Object.keys(pcsRef.current).forEach(cleanupPeer);
    };
  }, [stream, isMediaInitialized, breakoutRoom]);

  // Breakout Countdown Timer Effect
  useEffect(() => {
    if (breakoutTimeRemaining === null) return;
    if (breakoutTimeRemaining <= 0) {
      if (isAdmin) {
        handleEndBreakouts();
      }
      return;
    }
    const timer = setTimeout(() => {
      setBreakoutTimeRemaining(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [breakoutTimeRemaining, isAdmin]);

  // Screen sharing track feed replacement injector (User gesture compliant)
  const startScreenShare = async (): Promise<boolean> => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      triggerToast('Screen sharing is not supported in this browser -- try Chrome or Edge on a laptop.');
      return false;
    }
    setScreenShareError(null);
    setScreenShareStarting(true);
    try {
      const constraints = getWebRTCScreenshareConstraints();
      // audio: true asks the browser for system audio with the share
      // (Chrome/Edge: pick a tab or window — "Share audio" — to include
      // the sound of a video you play). Not every choice provides audio:
      // sharing a whole screen often has no audio track, and Firefox does
      // not support it at all — when no audio track arrives we say so
      // plainly instead of pretending the share has sound.
      // Fix Round 8 (#3): getDisplayMedia can hang forever without
      // opening a picker (notably in automated/headless browsers, and
      // when the browser's picker is blocked) — the old code awaited it
      // with no timeout, so the click looked dead with no error at all.
      // Race it against a 25 s timeout and say so honestly.
      const displayStream = await Promise.race([
        navigator.mediaDevices.getDisplayMedia({
          video: constraints.video,
          audio: true
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(Object.assign(new Error('Screen picker timed out'), { name: 'PickerTimeoutError' })), 25000)),
      ]);
      setScreenShareStarting(false);

      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) {
        displayStream.getTracks().forEach(t => t.stop());
        setScreenShareStarting(false);
        triggerToast('Screen sharing started but no video track was captured -- please try again.');
        return false;
      }
      const screenAudioTrack = displayStream.getAudioTracks()[0] || null;

      setScreenStream(displayStream);
      screenStreamRef.current = displayStream;

      const video = document.createElement('video');
      video.srcObject = displayStream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;

      video.onloadedmetadata = () => {
        video.play();
        screenVideoRef.current = video;
      };

      // Swap webcam video tracks with screen share tracks in all active peer connections
      livekitScreenTrackRef.current = screenTrack;

      screenSendersRef.current = {};
      const addedAt = Date.now();
      Object.keys(pcsRef.current).forEach(peerKey => {
        const pc = pcsRef.current[peerKey];
        const sender = pc.addTrack(screenTrack, displayStream);
        screenSendersRef.current[peerKey] = sender;
        // addTrack must renegotiate the connection or remotes never receive
        // the track. onnegotiationneeded normally does this; the safety net
        // retries explicitly if it never fires.
        ensureRenegotiation(peerKey, addedAt);
      });

      // Publish the screen to LiveKit too, so participants connected over
      // the LiveKit engine see it -- not just the peer-to-peer ones.
      await publishLiveKitTrack(screenTrack, Track.Source.ScreenShare);
      // System audio, when the browser provided it: published as the
      // screen-share audio source on LiveKit and added to every P2P peer
      // connection, so remotes hear the shared video's sound.
      if (screenAudioTrack) {
        await publishLiveKitTrack(screenAudioTrack, Track.Source.ScreenShareAudio);
        Object.keys(pcsRef.current).forEach(peerKey => {
          const pc = pcsRef.current[peerKey];
          try { pc.addTrack(screenAudioTrack, displayStream); } catch (e) {}
        });
      }

      // Broadcast screenshare media state changes (with the screen track
      // id so receivers can recognise the track even if it arrives first).
      broadcastMediaState({ isScreenSharing: true });

      // A fresh capture: any later `ended` event is unexpected until the
      // user stops the share from our own button.
      screenShareStoppedByUserRef.current = false;

      screenTrack.onended = () => {
        if (screenShareStoppedByUserRef.current) {
          // Deliberate stop (our Stop button, or the room unmounting).
          stopScreenShare();
          setIsScreenSharing(false);
          return;
        }
        // Unexpected end: iOS / the browser ended the capture (app switch,
        // call, screen lock, Control Centre). The track is dead and cannot
        // be restarted, and re-acquiring needs a real user tap
        // (getDisplayMedia without one is rejected) — so tear the dead
        // track down but do NOT silently drop the share: show a notice
        // with a one-tap restart instead.
        screenShareStoppedByUserRef.current = true; // silence the re-entrant onended from stopScreenShare()
        stopScreenShare();
        setIsScreenSharing(false);
        const msg = 'Your screen share ended by itself — your phone stopped the capture (switching apps, a call, or the screen locking can do this). Tap Try again to share again.';
        setScreenShareError(msg);
        triggerToast(msg);
      };

      setIsScreenSharing(true);
      triggerToast(screenAudioTrack
        ? 'Screen sharing started with system audio — others can hear the sound of what you share.'
        : 'Screen sharing started without system audio — this browser or screen choice did not provide audio. To share sound, pick a browser tab and tick "Share audio" in the picker.');
      return true;
    } catch (err: any) {
      console.warn('[Screen Share] Permission denied or failed.', err);
      if (screenStreamRef.current) {
        screenShareStoppedByUserRef.current = true;
        stopScreenShare();
      }
      screenVideoRef.current = null;
      setScreenShareStarting(false);
      setIsScreenSharing(false);
      // Every failure path tells the user why -- a silent no-op here is
      // what made sharing look broken when the picker was cancelled or
      // permission was denied.
      const reason = err?.name === 'NotAllowedError'
        ? 'Screen sharing was blocked -- allow screen sharing in your browser and try again.'
        : err?.name === 'NotFoundError'
        ? 'No screen or window was available to share -- try again and pick a screen or window.'
        : err?.name === 'NotReadableError'
        ? 'Your screen could not be captured right now -- another app may be using it. Try again.'
        : err?.name === 'AbortError'
        ? 'Screen sharing was cancelled before it started.'
        : err?.name === 'OverconstrainedError'
        ? 'Your browser refused the screen capture settings -- try again.'
        : err?.name === 'PickerTimeoutError'
        ? 'The screen picker did not open — check that screen sharing is allowed for this browser, then try again.'
        : `Screen sharing could not start (${err?.message || 'unknown error'}).`;
      triggerToast(reason);
      setScreenShareError(reason);
      return false;
    }
  };

  const handleToggleScreenShare = async () => {
    if (isScreenShareBlockedForGuests && !isAdmin) {
      alert('Screen sharing is blocked by the host.');
      return;
    }
    const nextVal = !isScreenSharing;
    if (nextVal) {
      const success = await startScreenShare();
      if (success) {
        setIsScreenSharing(true);
        setIsColleagueSharing(false);
      }
    } else {
      screenShareStoppedByUserRef.current = true;
      stopScreenShare();
      setIsScreenSharing(false);
    }
  };

  useEffect(() => {
    return () => {
      screenShareStoppedByUserRef.current = true;
      stopScreenShare();
    };
  }, []);

  const stopScreenShare = () => {
    // Stop via the ref mirror: this is also called from the track's
    // onended handler and the unmount cleanup, both of which close over
    // stale state where `screenStream` is still null -- using the ref is
    // what actually stops the capture.
    const liveScreenStream = screenStreamRef.current || screenStream;
    if (liveScreenStream) {
      liveScreenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      screenStreamRef.current = null;
    }
    screenVideoRef.current = null;
    // Unpublish from LiveKit so remote tiles stop showing the screen.
    livekitScreenTrackRef.current = null;
    unpublishLiveKitTrack(Track.Source.ScreenShare);
    unpublishLiveKitTrack(Track.Source.ScreenShareAudio);

    // Remove screenshare track senders from all peer connections
    const removedAt = Date.now();
    Object.keys(screenSendersRef.current).forEach(peerKey => {
      const sender = screenSendersRef.current[peerKey];
      const pc = pcsRef.current[peerKey];
      if (pc && sender) {
        try {
          pc.removeTrack(sender);
          // Removing a track also needs renegotiation or remotes keep a
          // dead track.
          ensureRenegotiation(peerKey, removedAt);
        } catch (e) {
          console.warn(e);
        }
      }
    });
    screenSendersRef.current = {};

    // Broadcast screenshare media state changes
    broadcastMediaState({ isScreenSharing: false });
  };

  // Hosts and co-hosts check for waiting participants via realtime and fallback polling
  useEffect(() => {
    if (!canModerate) return;
    const checkWaitroom = async () => {
      try {
        const list = await giinApi.getWaitingParticipants(meetingId);
        setWaitingList(list);
      } catch (err) {
        console.error(err);
      }
    };
    checkWaitroom();

    // Subscribe to host waitroom additions
    const channel = supabase
      .channel(`host-waitroom-${meetingId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_participants' },
        (payload: any) => {
          const row = payload.new || payload.old;
          if (row && row.meeting_id === meetingId) {
            checkWaitroom();
          }
        }
      )
      .subscribe();

    const interval = setInterval(checkWaitroom, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [meetingId, canModerate]);

  // Handle host admission action - host-verified, server-side.
  // Fix Round 7 (#4): the route flips the row and broadcasts the
  // decision with a server marker. The old direct client-side row
  // update (under a public UPDATE policy) let anyone admit themselves,
  // and the decision broadcast had no sender check.
  const handleAdmitParticipant = async (participantId: string, status: 'Admitted' | 'Declined') => {
    try {
      const result = await giinApi.admitParticipant(meetingId, participantId, status, {
        isWaitingRoomEnabled,
        isChatLocked,
        isMeetingLocked,
        isScreenShareBlockedForGuests,
        isMuteOnEntryEnabled
      });
      if (!result.rowUpdated) {
        triggerToast('That guest is no longer in the waiting room - they may have left already.');
      }
    } catch (err: any) {
      triggerToast(err?.message || 'Could not admit the participant - please try again.');
      return;
    }
    try {
      
      if (status === 'Admitted') {
        setAdmittedKeys(prev => {
          const next = new Set(prev);
          next.add(participantId);
          try {
            localStorage.setItem(`admitted_keys_${meetingId}`, JSON.stringify([...next]));
          } catch (e) {}
          return next;
        });
      }

      setWaitingList(prev => prev.filter(p => p.id !== participantId));
    } catch (err) {
      console.error(err);
    }
  };

  // Delegate admin host rights to another user (server-verified, Phase 6).
  const handleDesignateAdmin = async (targetUserId: string) => {
    if (!confirm('Are you sure you want to designate this user as the meeting admin? You will transfer host settings.')) return;
    try {
      await giinApi.transferHost(meetingId, targetUserId);
      setMeetingAdminId(targetUserId);
      setLocalAdminId(targetUserId);
      alert('Meeting administrator transferred successfully!');
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Could not transfer the host role. Please try again.');
    }
  };


  
  
  // Camera video ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Set srcObject for local video element when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
    }
  }, [stream]);

  // Spatial Audio change listener
  useEffect(() => {
    const handleSpatialChange = () => {
      setIsSpatialAudioEnabled(localStorage.getItem('giin_spatial_audio') === 'true');
    };
    window.addEventListener('giin_spatial_audio_changed', handleSpatialChange);
    return () => {
      window.removeEventListener('giin_spatial_audio_changed', handleSpatialChange);
    };
  }, []);

  // Spatial Audio Panning effect
  useEffect(() => {
    if (!isSpatialAudioEnabled) {
      Object.keys(spatialAudioNodesRef.current).forEach(peerKey => {
        const nodes = spatialAudioNodesRef.current[peerKey];
        if (nodes) {
          try {
            nodes.source.disconnect();
            nodes.panner.disconnect();
          } catch (e) {}
        }
      });
      spatialAudioNodesRef.current = {};
      return;
    }

    // Build active streams map based on current active engines (LiveKit or P2P fallback)
    const activeStreams: { [peerKey: string]: MediaStream } = {};
    participantsRef.current.forEach(p => {
      const peerKey = p.userId || p.id;
      if (peerKey === myKey) return;
      const livekitStream = livekitRemoteStreams[peerKey];
      const p2pStream = remoteStreams[peerKey];
      const activeStream = livekitStream || p2pStream;
      if (activeStream) {
        activeStreams[peerKey] = activeStream;
      }
    });

    const remoteKeys = Object.keys(activeStreams);
    const N = remoteKeys.length;
    
    remoteKeys.forEach((peerKey, idx) => {
      const streamObj = activeStreams[peerKey];
      if (!streamObj || streamObj.getAudioTracks().length === 0) return;

      try {
        const ctx = getSpatialAudioCtx();
        let nodes = spatialAudioNodesRef.current[peerKey];
        
        if (nodes) {
          // If the stream reference changed, disconnect the old source node first
          if ((nodes as any).streamId !== streamObj.id) {
            try {
              nodes.source.disconnect();
            } catch (e) {}
            const source = ctx.createMediaStreamSource(streamObj);
            source.connect(nodes.panner);
            nodes.source = source;
            (nodes as any).streamId = streamObj.id;
          }
        } else {
          const source = ctx.createMediaStreamSource(streamObj);
          const panner = ctx.createStereoPanner();
          source.connect(panner);
          panner.connect(ctx.destination);
          nodes = { source, panner };
          (nodes as any).streamId = streamObj.id;
          spatialAudioNodesRef.current[peerKey] = nodes;
        }

        // Calculate horizontal panning value based on grid position (-0.7 to 0.7)
        const panValue = N <= 1 ? 0 : -0.7 + (1.4 * (idx / (N - 1)));
        nodes.panner.pan.setValueAtTime(panValue, ctx.currentTime);
      } catch (err) {
        console.warn('Error setting up spatial audio panning for', peerKey, err);
      }
    });

    // Cleanup nodes of peers that left
    Object.keys(spatialAudioNodesRef.current).forEach(peerKey => {
      if (!activeStreams[peerKey]) {
        const nodes = spatialAudioNodesRef.current[peerKey];
        if (nodes) {
          try {
            nodes.source.disconnect();
            nodes.panner.disconnect();
          } catch (e) {}
          delete spatialAudioNodesRef.current[peerKey];
        }
      }
    });
  }, [remoteStreams, livekitRemoteStreams, isSpatialAudioEnabled]);

  // Fix Round 6: speaking detection for LiveKit peers. It used to come
  // only from the P2P mesh's ontrack — so with the mesh gated off in
  // LiveKit mode, remote speaking rings would go dead. Analyse the
  // LiveKit stream directly (deduped by the registry, so a peer with
  // both engines never gets two analysers), and stop analysers for
  // peers with no live audio on either engine.
  useEffect(() => {
    if (engineType !== 'LIVEKIT') return;
    Object.keys(livekitRemoteStreams).forEach(peerKey => {
      const s = livekitRemoteStreams[peerKey];
      if (s && s.getAudioTracks().some(t => t.readyState === 'live')) {
        setupSpeakingDetection(s, peerKey, false);
      }
    });
    Object.keys(speakingAnalysersRef.current).forEach(peerKey => {
      if (peerKey === myKey) return;
      const lk = livekitRemoteStreams[peerKey];
      const p2p = remoteStreams[peerKey];
      const hasLive =
        (lk && lk.getAudioTracks().some(t => t.readyState === 'live')) ||
        (p2p && p2p.getAudioTracks().some(t => t.readyState === 'live'));
      if (!hasLive) stopSpeakingDetection(peerKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livekitRemoteStreams, remoteStreams, engineType]);

  // Initialize audio track (kept alive throughout the meeting)
  useEffect(() => {
    async function initAudio() {
      try {
        const savedMic = localStorage.getItem('giin_selected_mic');
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(savedMic || undefined)
        });
        const audioTrack = audioStream.getAudioTracks()[0];
        localMicRawTrackRef.current = audioTrack;
        verifyMicProcessing(audioTrack);
        // One funnel (see publishMicTrack): local stream, P2P senders,
        // LiveKit publication and speaking detector all get this track.
        await publishMicTrack(audioTrack);
      } catch (err: any) {
        // A dead mic used to fail silently (console.error only) and the
        // user joined the meeting unable to speak, never knowing why.
        console.error('Error acquiring audio:', err);
        const reason = err?.name === 'NotAllowedError'
          ? 'Microphone blocked — allow the microphone in the browser address bar, then turn your mic on again. Others cannot hear you until then.'
          : err?.name === 'NotFoundError'
          ? 'No microphone was found on this device — plug one in, then turn your mic on again.'
          : err?.name === 'NotReadableError'
          ? 'Your microphone is in use by another app — close that app, then turn your mic on again.'
          : `Your microphone could not be started (${err?.message || 'unknown error'}). Others cannot hear you.`;
        triggerToast(reason);
      }
    }
    initAudio();
    return () => {
      // Fix Round 6: stop the raw capture too, not just the published
      // track (when Studio Voice is on they are different objects).
      teardownEnhancer();
      if (localMicRawTrackRef.current) {
        localMicRawTrackRef.current.stop();
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
      }
    };
  }, []);

  // Initialize/toggle video track (dynamic camera access)
  useEffect(() => {
    let active = true;
    async function syncVideo() {
      if (isVideoOn) {
        const current = localVideoTrackRef.current;
        if (!current || current.readyState === 'ended') {
          // No usable track — acquire a fresh one. (The old code only
          // re-enabled an existing track, so an ended track stayed
          // "on" with a black tile; enabling an ended track is a no-op.)
          if (current && current.readyState === 'ended') localVideoTrackRef.current = null;
          try {
            const savedCam = localStorage.getItem('giin_selected_camera');
            const videoStream = await navigator.mediaDevices.getUserMedia({
              video: savedCam ? {
                deviceId: { exact: savedCam },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              } : {
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            });
            if (!active) {
              videoStream.getTracks().forEach(t => t.stop());
              return;
            }
            const videoTrack = videoStream.getVideoTracks()[0];
            videoTrack.enabled = true;
            attachLocalCameraTrack(videoTrack);
            localCameraRecoverRef.current.attempts = 0;
            
            setStream(prev => {
              const newStream = prev || new MediaStream();
              newStream.getVideoTracks().forEach(t => newStream.removeTrack(t));
              newStream.addTrack(videoTrack);
              return newStream;
            });

            // Replace track in all active peer connections
            Object.values(pcsRef.current).forEach(pc => {
              const senders = pc.getSenders();
              const videoSender = senders.find(s => s.track && s.track.kind === 'video');
              if (videoSender) {
                videoSender.replaceTrack(videoTrack);
              } else {
                const sender = pc.addTrack(videoTrack, stream || new MediaStream([videoTrack]));
              }
            });

            // And publish it to LiveKit (the connect effect does not re-run
            // when the camera is switched on mid-call).
            publishLiveKitTrack(videoTrack, Track.Source.Camera);
          } catch (err: any) {
            console.warn('Error acquiring video:', err);
            const reason = err?.name === 'NotAllowedError'
              ? 'Camera blocked — allow the camera in the browser address bar, then turn your camera on again. Others see your avatar until then.'
              : err?.name === 'NotFoundError'
              ? 'No camera was found on this device — you are joining with the camera off.'
              : err?.name === 'NotReadableError'
              ? 'Your camera is in use by another app — close that app, then turn your camera on again.'
              : `Your camera could not be started (${err?.message || 'unknown error'}). You are joining with the camera off.`;
            triggerToast(reason);
            setLocalCameraLive(false);
            setIsVideoOn(false);
          }
        } else {
          // Track is live: re-enable it AND make sure LiveKit is still
          // serving it — a publication lost during a reconnect is
          // otherwise never repaired, and remotes keep a black tile.
          current.enabled = true;
          setLocalCameraLive(true);
          publishLiveKitTrack(current, Track.Source.Camera);
        }
      } else {
        // Instead of stopping the track and destroying it (which causes long hardware boot delays),
        // we keep the track alive but set enabled = false, so turning the
        // camera back on is instant. We ALSO unpublish it from LiveKit:
        // a live-but-disabled track streams black frames to remotes,
        // so without this they see a black tile instead of "Camera Off".
        if (localVideoTrackRef.current) {
          localVideoTrackRef.current.enabled = false;
        }
        setLocalCameraLive(false);
        unpublishLiveKitTrack(Track.Source.Camera);
      }
      setIsMediaInitialized(true);
    }
    syncVideo();
    return () => {
      active = false;
    };
  }, [isVideoOn]);

  // Speech Recognition Live Captions Effect
  useEffect(() => {
    let rec: any = null;
    if (isCaptionsEnabled) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          const currentText = finalTranscript || interimTranscript;
          if (currentText.trim()) {
            setActiveCaption({ name: 'You', text: currentText });
            
            if (sigChannelRef.current) {
              sigChannelRef.current.send({
                type: 'broadcast',
                event: 'live-caption',
                payload: {
                  senderName: currentUser?.name || 'You',
                  text: currentText,
                  isFinal: !!finalTranscript
                }
              });
            }

            if (finalTranscript) {
              const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              setTranscripts(prev => [...prev, { name: currentUser?.name || 'You', text: finalTranscript, time }]);
              setTimeout(() => {
                setActiveCaption(null);
              }, 4000);
            }
          }
        };

        rec.onerror = (e: any) => {
          console.warn('Speech recognition error:', e);
        };

        rec.onend = () => {
          if (isCaptionsEnabled && rec) {
            try { rec.start(); } catch (err) {}
          }
        };

        try {
          rec.start();
        } catch (err) {
          console.error(err);
        }
      } else {
        alert('Speech recognition is not supported in this browser. Try Chrome or Safari.');
        setTimeout(() => {
          setIsCaptionsEnabled(false);
        }, 0);
      }
    }

    return () => {
      if (rec) {
        rec.stop();
      }
    };
  }, [isCaptionsEnabled]);

  // Toggle buttons
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (localAudioTrackRef.current) {
      localAudioTrackRef.current.enabled = !nextMuted;
    }

    // Broadcast audio state change (through the helper: it reads the live
    // screen-share flag from a ref, so toggling mute mid-share cannot
    // overwrite receivers with a stale isScreenSharing=false).
    broadcastMediaState({ isMuted: nextMuted });
  };

  const toggleVideo = () => {
    const nextVideoOn = !isVideoOn;
    setIsVideoOn(nextVideoOn);

    // Broadcast video state change (through the helper -- see toggleMute).
    broadcastMediaState({ isVideoOn: nextVideoOn });
  };

  const handleLeaveOrEnd = () => {
    // Fix Round 6 (Phase 6): the host is ALWAYS asked to choose —
    // transfer host or end for everyone. The old code skipped the
    // choice (and the broadcast) whenever the participant list looked
    // empty, and that list is database-derived and can lag behind the
    // people actually connected. A minimised room un-minimises first
    // so the choice is visible.
    if (isAdmin) {
      setEndError('');
      if (isMinimized) onMinimizeToggle?.(false);
      setShowLeaveModal(true);
    } else {
      onEndMeeting();
    }
  };

  // Fix Round 6 (Phase 6) — end for everyone, for real. Order matters:
  // (1) the SERVER ends it first (meeting Completed + LiveKit room
  // deleted) so the link is dead even if every broadcast is missed;
  // (2) the end is broadcast on both channels, awaited with a timeout,
  // so the signal is not lost to the unmount that follows; (3) only
  // then does this client show its own ended screen. The old code did
  // it backwards — fire-and-forget broadcast, then immediate unmount —
  // and the LiveKit room was never torn down at all, so everyone else
  // kept talking. If the server end fails, NOBODY is ended and the
  // host gets the honest error instead of a silent partial end.
  const sendEndBroadcast = async (ch: any) => {
    if (!ch) return;
    try {
      await Promise.race([
        ch.send({ type: 'broadcast', event: 'end-meeting', payload: { meetingId, endedAt: new Date().toISOString() } }),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
    } catch (e) { /* broadcast is best-effort: server state + polling cover it */ }
  };

  const handleEndForAll = async () => {
    if (endingInProgress || endedRef.current) return;
    setEndingInProgress(true);
    setEndError('');
    try {
      const result = await giinApi.endMeeting(meetingId);
      await sendEndBroadcast(eventsChannelRef.current);
      await sendEndBroadcast(sigChannelRef.current);
      setShowLeaveModal(false);
      setLeaveOption(null);
      setSelectedNewAdminId('');
      enterEndedState('you-ended', (result as any)?.livekitWarning);
    } catch (err: any) {
      console.error('[GiinMeet] End for everyone failed:', err);
      setEndError(err?.message || 'Could not end the meeting. Nobody was removed — please try again.');
    } finally {
      setEndingInProgress(false);
    }
  };

  // Fix Round 6 (Phase 6) — transfer host, for real. The transfer is
  // a server-verified act now (POST /api/meetings/transfer-host): the
  // caller must be the current host, and the new host must be a
  // signed-in participant actually in the meeting — a guest (no auth
  // account) can never hold the host role, so guests are not offered
  // in the picker. The old code broadcast the designation BEFORE the
  // database write and ignored the write's error entirely, so a failed
  // transfer still left the host gone and everyone confused. Now the
  // database move happens first; only then is it broadcast, and only
  // then does the old host leave. A failure leaves the host in the
  // meeting with an honest error.
  const handleTransferAndLeave = async () => {
    if (!selectedNewAdminId || endingInProgress) return;
    setEndingInProgress(true);
    setEndError('');
    try {
      await giinApi.transferHost(meetingId, selectedNewAdminId);
      const payload = { newAdminId: selectedNewAdminId };
      const sendDesignate = async (ch: any) => {
        if (!ch) return;
        try {
          await Promise.race([
            ch.send({ type: 'broadcast', event: 'designate-admin', payload }),
            new Promise(resolve => setTimeout(resolve, 2000)),
          ]);
        } catch (e) { /* best-effort: the meeting watcher is the truth */ }
      };
      await sendDesignate(eventsChannelRef.current);
      await sendDesignate(sigChannelRef.current);
      setMeetingAdminId(selectedNewAdminId);
      setShowLeaveModal(false);
      setLeaveOption(null);
      setSelectedNewAdminId('');
      onEndMeeting();
    } catch (err: any) {
      console.error('[GiinMeet] Failed to transfer host role:', err);
      setEndError(err?.message || 'Could not transfer the host role. You are still the host — please try again.');
    } finally {
      setEndingInProgress(false);
    }
  };

  const handleToggleWaitingRoom = (enabled: boolean) => {
    setIsWaitingRoomEnabled(enabled);
    broadcastSettingsUpdate({
      isWaitingRoomEnabled: enabled,
      isChatLocked,
      isMeetingLocked,
      isScreenShareBlockedForGuests,
      isMuteOnEntryEnabled
    });
  };

  const handleToggleChatLock = (locked: boolean) => {
    setIsChatLocked(locked);
    broadcastSettingsUpdate({
      isWaitingRoomEnabled,
      isChatLocked: locked,
      isMeetingLocked,
      isScreenShareBlockedForGuests,
      isMuteOnEntryEnabled
    });
  };

  const handleToggleMeetingLock = async (locked: boolean) => {
    setIsMeetingLocked(locked);
    // Fix Round 7 (#6): the lock is persisted on the meeting row now
    // (POST /api/meetings/lock, host-verified). If the persist fails -
    // e.g. the one-time giinmeet_meeting_lock.sql has not been run yet
    // - the toggle must not pretend the meeting is locked.
    lockWriteInFlightRef.current = true;
    try {
      await giinApi.setMeetingLock(meetingId, locked);
    } catch (err: any) {
      setIsMeetingLocked(!locked);
      triggerToast(err?.message || 'Could not change the meeting lock - please try again.');
      return;
    } finally {
      lockWriteInFlightRef.current = false;
    }
    broadcastSettingsUpdate({
      isWaitingRoomEnabled,
      isChatLocked,
      isMeetingLocked: locked,
      isScreenShareBlockedForGuests,
      isMuteOnEntryEnabled
    });
  };

  const handleToggleScreenShareBlock = (blocked: boolean) => {
    setIsScreenShareBlockedForGuests(blocked);
    broadcastSettingsUpdate({
      isWaitingRoomEnabled,
      isChatLocked,
      isMeetingLocked,
      isScreenShareBlockedForGuests: blocked,
      isMuteOnEntryEnabled
    });
  };

  const handleToggleMuteOnEntry = (enabled: boolean) => {
    setIsMuteOnEntryEnabled(enabled);
    broadcastSettingsUpdate({
      isWaitingRoomEnabled,
      isChatLocked,
      isMeetingLocked,
      isScreenShareBlockedForGuests,
      isMuteOnEntryEnabled: enabled
    });
  };

  // Fix Round 7 (#3): settings go through the host-verified server
  // route, which broadcasts them with a server marker - receivers
  // ignore settings-update broadcasts that did not come from the
  // server, so a participant can no longer push fake settings to the
  // room. Never throws: a failed sync is toasted honestly instead.
  const broadcastSettingsUpdate = async (settings: {
    isWaitingRoomEnabled: boolean;
    isChatLocked: boolean;
    isMeetingLocked: boolean;
    isScreenShareBlockedForGuests: boolean;
    isMuteOnEntryEnabled: boolean;
  }) => {
    try {
      await giinApi.controlMeeting(meetingId, 'settings-update', { settings });
    } catch (err: any) {
      triggerToast(err?.message || 'Could not sync the new settings to the room - guests may not see this change. Please try again.');
    }
  };

  const handleMuteAll = async () => {
    // Fix Round 7 (#3): mute-all goes through the host-verified server
    // route - the server broadcasts it with a server marker.
    try {
      await giinApi.controlMeeting(meetingId, 'mute-all');
      alert('Mute all request sent.');
    } catch (err: any) {
      triggerToast(err?.message || 'Could not mute everyone - please try again.');
    }
  };


  const handleDisableVideoAll = async () => {
    // Fix Round 7 (#3): disable-video-all goes through the host-verified
    // server route - the server broadcasts it with a server marker.
    try {
      await giinApi.controlMeeting(meetingId, 'disable-video-all');
      alert('Disable video request sent.');
    } catch (err: any) {
      triggerToast(err?.message || "Could not disable everyone's video - please try again.");
    }
  };

  // Fix Round 6: Studio Voice, rebuilt. The old toggle re-acquired the
  // microphone on every flip (without the selected device — so it
  // silently switched mics), never stopped the previous track, never
  // published anything to LiveKit (only the P2P senders changed, so on
  // the LiveKit engine the toggle changed nothing anyone heard), and
  // never tore the old filter chain down. The chain is now built from
  // the CURRENT capture and tracked in enhancerChainRef, so it can be
  // torn down exactly once — and the raw track stays alive as the
  // chain's input until the chain is gone.
  const buildEnhancedTrack = (rawTrack: MediaStreamTrack): MediaStreamTrack => {
    try {
      const ctx = getAudioCtx();
      const rawStream = new MediaStream([rawTrack]);
      const source = ctx.createMediaStreamSource(rawStream);

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 1650;
      bandpass.Q.value = 0.5;

      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 150;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const dest = ctx.createMediaStreamDestination();

      source.connect(highpass);
      highpass.connect(bandpass);
      bandpass.connect(compressor);
      compressor.connect(dest);

      const destTrack = dest.stream.getAudioTracks()[0];
      enhancerChainRef.current = { rawTrack, destTrack, nodes: { source, highpass, bandpass, compressor, dest } };
      return destTrack;
    } catch (e) {
      console.warn('Failed to initialize Audio Enhancer:', e);
      return rawTrack;
    }
  };

  const teardownEnhancer = () => {
    const chain = enhancerChainRef.current;
    if (!chain) return;
    enhancerChainRef.current = null;
    try { chain.nodes.source.disconnect(); } catch (e) {}
    try { chain.nodes.highpass.disconnect(); } catch (e) {}
    try { chain.nodes.bandpass.disconnect(); } catch (e) {}
    try { chain.nodes.compressor.disconnect(); } catch (e) {}
    try { chain.nodes.dest.disconnect(); } catch (e) {}
    try { chain.destTrack.stop(); } catch (e) {}
  };

  const toggleAudioEnhancement = async () => {
    const nextVal = !isAudioEnhanced;
    setIsAudioEnhanced(nextVal);
    isAudioEnhancedRef.current = nextVal;
    const rawTrack = localMicRawTrackRef.current;
    if (!rawTrack || rawTrack.readyState !== 'live') {
      setIsAudioEnhanced(false);
      isAudioEnhancedRef.current = false;
      triggerToast('Microphone is not ready yet — try again once your mic is on.');
      return;
    }
    // No re-acquisition: the toggle re-routes the CURRENT capture, so it
    // can never silently switch microphones. Echo cancellation, noise
    // suppression and gain control are already on for the capture (see
    // micAudioConstraints); the toggle only adds or removes the Studio
    // Voice filter chain — and the result is published to LiveKit AND
    // the P2P mesh alike through the one funnel (publishMicTrack).
    try {
      if (nextVal) {
        const enhanced = buildEnhancedTrack(rawTrack);
        await publishMicTrack(enhanced);
      } else {
        teardownEnhancer();
        await publishMicTrack(rawTrack);
      }
    } catch (err) {
      console.error('Failed to toggle audio enhancement:', err);
      triggerToast('Could not change Studio Voice — keeping the current microphone.');
    }
  };

  const toggleStudioLight = () => {
    const nextVal = !isStudioLightEnabled;
    setIsStudioLightEnabled(nextVal);
    broadcastVideoFilter(videoFilter, nextVal);
  };

  const changeVideoFilter = (filter: string) => {
    setVideoFilter(filter);
    broadcastVideoFilter(filter, isStudioLightEnabled);
  };

  const broadcastVideoFilter = (filter: string, studioLight: boolean) => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'media-filter',
        payload: {
          senderKey: myKey,
          filter,
          isStudioLightEnabled: studioLight
        }
      });
    }
  };

  // ONE shared sound engine for hand-raise chimes AND the soundboard.
  // Every sound is built from shaped WebAudio tones / filtered noise with
  // a real attack/decay envelope (never a bare oscillator switched on at
  // full gain — that clicks). Peaks stay low (<= 0.12) and sawtooth
  // voices run through a lowpass, so nothing blasts or screeches.
  // Delivery reuses the single Supabase Realtime signalling channel
  // (sigChannelRef): hand-raises ride their existing 'hand-raise' event
  // (the reason is already in the payload) and soundboard sounds ride
  // 'play-sound'. No second channel. The sender plays locally because a
  // broadcast is never echoed back to its sender.
  const playSynthesizedSound = (type: string) => {
    try {
      // The sound-effects mute (soundboard panel toggle). This never
      // touches the microphone or anyone else's audio.
      if (!soundEffectsEnabledRef.current) return;
      const ctx = getAudioCtx();
      const now = ctx.currentTime;

      // Click-free tone: ramp up from silence over `attack`, then decay
      // exponentially to silence. `freqEnd` slides the pitch (omit it
      // for a fixed pitch); `lowpass` tames buzzy waves.
      const tone = (opts: { wave: OscillatorType; freq: number; freqEnd?: number; at: number; dur: number; peak: number; attack?: number; lowpass?: number }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = now + opts.at;
        const attack = opts.attack ?? 0.008;
        osc.type = opts.wave;
        osc.frequency.setValueAtTime(opts.freq, t0);
        if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(opts.peak, t0 + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
        osc.connect(gain);
        if (opts.lowpass) {
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = opts.lowpass;
          gain.connect(lp);
          lp.connect(ctx.destination);
        } else {
          gain.connect(ctx.destination);
        }
        osc.start(t0);
        osc.stop(t0 + opts.dur + 0.05);
      };

      // Shaped filtered-noise burst (claps, breath, shimmer).
      const noiseBurst = (opts: { at: number; dur: number; peak: number; filterType: BiquadFilterType; freq: number; q?: number }) => {
        const len = Math.max(1, Math.floor(ctx.sampleRate * opts.dur));
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = opts.filterType;
        filter.frequency.value = opts.freq;
        filter.Q.value = opts.q ?? 1;
        const gain = ctx.createGain();
        const t0 = now + opts.at;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(opts.peak, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start(t0);
        src.stop(t0 + opts.dur + 0.05);
      };

      if (type === 'bell') {
        // Struck bell: inharmonic partials, long natural decay.
        tone({ wave: 'sine', freq: 1046.5, at: 0, dur: 1.6, peak: 0.12 });
        tone({ wave: 'sine', freq: 1568, at: 0, dur: 1.1, peak: 0.06 });
        tone({ wave: 'sine', freq: 2093, at: 0, dur: 0.6, peak: 0.03 });
        tone({ wave: 'triangle', freq: 523.25, at: 0, dur: 0.9, peak: 0.03 });
      } else if (type === 'applause') {
        // A small crowd: a swell of band-passed noise plus a run of
        // individual claps (short high-passed bursts) over ~1.4 s.
        noiseBurst({ at: 0, dur: 1.4, peak: 0.10, filterType: 'bandpass', freq: 1200, q: 0.8 });
        noiseBurst({ at: 0.05, dur: 1.2, peak: 0.05, filterType: 'highpass', freq: 2500 });
        [0, 0.09, 0.17, 0.28, 0.36, 0.47, 0.55, 0.68, 0.79, 0.9, 1.02, 1.15].forEach((at, i) => {
          noiseBurst({ at, dur: 0.06, peak: 0.05 + (i % 3) * 0.015, filterType: 'highpass', freq: 1800 });
        });
      } else if (type === 'horn') {
        // Party horn: a bright two-note "toot" (rising slide) with a
        // breathy blow underneath — lowpassed, no raw sawtooth blast.
        tone({ wave: 'sawtooth', freq: 392, freqEnd: 523.25, at: 0, dur: 0.32, peak: 0.05, attack: 0.02, lowpass: 1600 });
        tone({ wave: 'sawtooth', freq: 392, freqEnd: 659.25, at: 0.32, dur: 0.5, peak: 0.06, attack: 0.02, lowpass: 1600 });
        tone({ wave: 'triangle', freq: 784, freqEnd: 1046.5, at: 0.32, dur: 0.5, peak: 0.05, attack: 0.02 });
        noiseBurst({ at: 0, dur: 0.8, peak: 0.02, filterType: 'bandpass', freq: 900, q: 1.5 });
      } else if (type === 'alert') {
        // Warning: two soft alternating tones (triangle, not square),
        // smooth steps so it alerts without screeching.
        tone({ wave: 'triangle', freq: 659.25, at: 0, dur: 0.22, peak: 0.09 });
        tone({ wave: 'triangle', freq: 523.25, at: 0.24, dur: 0.22, peak: 0.09 });
        tone({ wave: 'triangle', freq: 659.25, at: 0.48, dur: 0.22, peak: 0.09 });
        tone({ wave: 'sine', freq: 1318.5, at: 0, dur: 0.15, peak: 0.02 });
      } else if (type === 'hand-question') {
        // Question: warm two-note chime, rising (E5 -> A5).
        tone({ wave: 'sine', freq: 659.25, at: 0, dur: 0.55, peak: 0.11 });
        tone({ wave: 'sine', freq: 880, at: 0.14, dur: 0.7, peak: 0.11 });
        tone({ wave: 'triangle', freq: 1760, at: 0.14, dur: 0.4, peak: 0.02 });
      } else if (type === 'hand-comment') {
        // Comment: one soft low "plip" — calm, unobtrusive.
        tone({ wave: 'sine', freq: 523.25, at: 0, dur: 0.45, peak: 0.10 });
        tone({ wave: 'triangle', freq: 1046.5, at: 0, dur: 0.25, peak: 0.02 });
      } else if (type === 'hand-idea') {
        // Idea: bright ascending arpeggio (C5 -> E5 -> G5), a little sparkle.
        tone({ wave: 'sine', freq: 523.25, at: 0, dur: 0.35, peak: 0.10 });
        tone({ wave: 'sine', freq: 659.25, at: 0.11, dur: 0.35, peak: 0.10 });
        tone({ wave: 'sine', freq: 783.99, at: 0.22, dur: 0.55, peak: 0.11 });
        tone({ wave: 'triangle', freq: 1567.98, at: 0.22, dur: 0.3, peak: 0.02 });
      } else if (type === 'hand-urgent') {
        // Urgent: two crisp attention pings over a soft low pulse —
        // distinct from every other chime, still not a siren.
        tone({ wave: 'triangle', freq: 1174.66, at: 0, dur: 0.28, peak: 0.12 });
        tone({ wave: 'triangle', freq: 1174.66, at: 0.3, dur: 0.35, peak: 0.12 });
        tone({ wave: 'sine', freq: 196, at: 0, dur: 0.65, peak: 0.06 });
      } else {
        // Neutral default ("Just Raise Hand" and anything unknown):
        // a single soft chime.
        tone({ wave: 'sine', freq: 783.99, at: 0, dur: 0.5, peak: 0.10 });
        tone({ wave: 'sine', freq: 1046.5, at: 0.08, dur: 0.45, peak: 0.05 });
      }
    } catch (e) {
      console.warn(e);
    }
  };

  const triggerSoundboard = (soundType: string) => {
    playSynthesizedSound(soundType);
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'play-sound',
        payload: { soundType }
      });
    }
  };

  const handleCreatePoll = () => {
    if (!newPollQuestion.trim()) return;
    const cleanOptions = newPollOptions.filter(o => o.trim() !== '');
    if (cleanOptions.length < 2) return;

    const newPoll = {
      id: 'poll-' + Math.random().toString(36).substring(2, 9),
      question: newPollQuestion,
      options: cleanOptions,
      votes: cleanOptions.map(() => 0),
      creatorId: currentUser?.id || myKey
    };

    setPolls(prev => [...prev, newPoll]);
    setNewPollQuestion('');
    setNewPollOptions(['', '']);

    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'launch-poll',
        payload: { poll: newPoll }
      });
    }
  };

  // Apply one vote to a poll, with per-voter dedup. Used both for our own
  // vote (applied locally, since a broadcast is never echoed back to its
  // sender) and for votes received from other participants. Every client
  // runs the same logic, so all clients converge on the same totals
  // without needing an admin to count.
  const applyPollVote = (pollId: string, optionIndex: number, voterId: string) => {
    if (!voterId) return;
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId) return p;
      const votedBy: { [voterId: string]: number } = { ...(p.votedBy || {}) };
      const previousVote = votedBy[voterId];
      if (previousVote === optionIndex) return p; // already counted
      const votes = [...p.votes];
      if (previousVote !== undefined && previousVote !== null) {
        votes[previousVote] = Math.max(0, (votes[previousVote] || 0) - 1);
      }
      votes[optionIndex] = (votes[optionIndex] || 0) + 1;
      votedBy[voterId] = optionIndex;
      return { ...p, votes, votedBy };
    }));
  };

  const handleVotePoll = (pollId: string, optionIndex: number) => {
    setUserVotes(prev => ({ ...prev, [pollId]: optionIndex }));
    applyPollVote(pollId, optionIndex, myKey);
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'vote-poll',
        payload: { pollId, optionIndex, voterId: myKey }
      });
    }
  };

  // Screen Share Canvas Animation Simulation (unused, but kept for safe ref compatibility)
  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (isScreenSharing && canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const draw = () => {
          if (screenVideoRef.current && screenVideoRef.current.readyState >= 2) {
            ctx.drawImage(screenVideoRef.current, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.fillStyle = '#0B0F19';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          animationId = requestAnimationFrame(draw);
        };
        draw();
      }
    }
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isScreenSharing]);



  // Chat file sharing: upload to the 'chat-files' bucket, then post the
  // file as a chat message (text is `📎 name — url`, rendered as a
  // clickable link by renderChatText). Guests cannot send files — same
  // as text chat, sending needs a signed-in session — and the file is
  // only uploaded after that check, so a guest never uploads a file
  // that can never be posted.
  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      triggerToast('That file is larger than 25 MB — chat files are limited to 25 MB.');
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      triggerToast('Sign in to share files. Guests can read chat but cannot send messages or files.');
      return;
    }
    triggerToast(`Uploading ${file.name}…`);
    try {
      const { url, name } = await giinApi.uploadChatFile(meetingId, file);
      const senderName = currentUser?.name || currentUser?.email?.split('@')[0] || 'Guest';
      await giinApi.sendMessage({
        thread_id: meetingId,
        sender_name: senderName,
        text: `📎 ${name} — ${url}`,
        user_id: currentUser?.id
      });
      const list = await giinApi.getMessages(meetingId);
      if (list) {
        setMessages(prev => mergeChatWithPending(list.map((msg: { id?: string; user_id: string; sender_name: string; text: string; created_at: string }) => ({
          id: msg.id,
          sender: msg.sender_name,
          text: msg.text,
          time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          self: currentUser ? (msg.user_id === currentUser.id) : false
        })), prev));
      }
    } catch (err: any) {
      console.error('Failed to share the file:', err);
      triggerToast(err?.message || 'Could not share the file. Please try again.');
    }
  };

  // A file message (`📎 name — url`) renders as a real download link;
  // anything else renders as plain text.
  const renderChatText = (text: string) => {
    const m = text.match(/^📎 (.+) — (https?:\/\/\S+)$/);
    if (m) {
      return (
        <span>
          📎 <a href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{m[1]}</a>
        </span>
      );
    }
    return text;
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    // The host can lock chat for everyone except the host. Enforce it here
    // as well as in the UI — a disabled input alone is not a lock.
    if (isChatLocked && !isAdmin) return;
    if (!chatInput.trim()) return;

    const senderName = currentUser?.name || currentUser?.email?.split('@')[0] || 'Guest';
    const text = chatInput;
    // Show the message immediately (optimistic render) so the sender sees
    // it in their own history right away. The temporary copy is swapped
    // for the real database row when the reload / realtime echo arrives
    // (mergeChatWithPending + the INSERT handler), so it never doubles.
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: senderName,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      self: true,
      pending: true
    };
    setMessages(prev => [...prev, optimistic]);
    setChatInput('');

    try {
      await giinApi.sendMessage({
        thread_id: meetingId,
        sender_name: senderName,
        text: text,
        user_id: currentUser?.id
      });

      const list = await giinApi.getMessages(meetingId);
      if (list) {
        const mapped = list.map((msg: { id?: string; user_id: string; sender_name: string; text: string; created_at: string }) => {
          const isSelf = currentUser ? (msg.user_id === currentUser.id) : false;
          return {
            id: msg.id,
            sender: msg.sender_name,
            text: msg.text,
            time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            self: isSelf
          };
        });
        setMessages(prev => mergeChatWithPending(mapped, prev));
      }
    } catch (err) {
      // Never silently drop a failed send: take the optimistic message
      // back, put the text back in the box, and say why. (Guests hit this
      // by design — sending needs a signed-in session, see giinApi
      // .sendMessage — so the failure is honest, not a phantom send.)
      console.error('Failed to send chat message:', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setChatInput(text);
      triggerToast(err instanceof Error ? err.message : 'Could not send the message — please try again.');
    }
  };

  const isDirectCall = isP2PCall && participants.length <= 1 && !isScreenSharing && !Object.keys(peerStates).some(k => peerStates[k].isScreenSharing);

  // Fix Round 6 (Phase 6) — the ended screen. Rendered BEFORE the
  // minimised branch so a minimised participant sees it too. The media
  // is already disconnected by enterEndedState; this screen only
  // explains what happened and sends the user back to the dashboard.
  // onEndMeeting(true) skips the server end — it already happened.
  if (endedState) {
    return (
      <div style={{
        width: '100%',
        height: '100dvh',
        backgroundColor: '#07090E',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PhoneOff size={28} color="#EF4444" />
        </div>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>{endedState.reason === 'removed' ? 'You were removed from this meeting' : 'This meeting has ended'}</h2>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-muted)', maxWidth: '420px', lineHeight: 1.5 }}>
          {endedState.reason === 'removed'
            ? 'The host removed you from this meeting. You can\'t rejoin with this link unless the host invites you back.'
            : endedState.reason === 'you-ended'
            ? 'You ended the meeting for everyone. All participants have been disconnected and the invite link no longer works.'
            : 'The host has ended this meeting. You have been disconnected and the invite link no longer works.'}
        </p>
        {endedState.reason !== 'removed' && endedState.durationSeconds !== undefined && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '420px' }}>
            Meeting lasted {formatElapsedTime(endedState.durationSeconds)}{endedState.attendeeCount !== undefined ? ` · ${endedState.attendeeCount} ${endedState.attendeeCount === 1 ? 'person' : 'people'} attended` : ''}
          </p>
        )}
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '420px' }}>{meetingTitle}</p>
        {endedState.detail && (
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#FCA5A5', maxWidth: '420px', lineHeight: 1.5 }}>{endedState.detail}</p>
        )}
        {currentUser?.email === 'guest@phone.giinmeet.com' ? (
          <>
            {endedState.reason !== 'removed' && (
              <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-muted)', maxWidth: '420px' }}>Thanks for joining.</p>
            )}
            <button
              onClick={() => { try { window.close(); } catch (e) { /* tab was not opened by script */ } }}
              className="premium-btn premium-btn-primary"
              style={{ marginTop: '0.5rem', height: '44px', padding: '0 1.5rem', fontSize: '0.9rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
            >
              Close this tab
            </button>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '420px' }}>If the tab stays open, you can close it yourself.</p>
          </>
        ) : (
          <button
            onClick={() => onEndMeeting(true)}
            className="premium-btn premium-btn-primary"
            style={{ marginTop: '0.5rem', height: '44px', padding: '0 1.5rem', fontSize: '0.9rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
          >
            Back to dashboard
          </button>
        )}
      </div>
    );
  }

  if (isMinimized) {
    // Determine which stream to display in the mini window
    const screenPeerKey = Object.keys(peerStates).find(k => peerStates[k].isScreenSharing);
    const activeRemoteKey = Object.keys(peerStates).find(k => peerStates[k].isSpeaking) || Object.keys(remoteStreams)[0] || Object.keys(livekitRemoteStreams)[0];

    // Fix Round 6: the mini window used to read the P2P stream map
    // only — with the mesh gated off in LiveKit mode that map is
    // empty, so minimising showed yourself instead of the speaker.
    // Resolve through the active (LiveKit-first) stream, like the
    // tiles do.
    const activeStreamFor = (peerKey: string) => getRemoteTileState(peerKey).activeStreamObj;
    const showStream = screenPeerKey ? (activeStreamFor(screenPeerKey) || remoteScreenStreams[screenPeerKey]) : (activeRemoteKey ? activeStreamFor(activeRemoteKey) : stream);
    const isLocalStream = !screenPeerKey && !activeRemoteKey;
    
    let label = 'You';
    let isVideoActive = isVideoOn;
    let avatarName = currentUser?.name || 'You';
    
    if (screenPeerKey) {
      label = `${peerStates[screenPeerKey]?.name || 'Someone'}'s Screen`;
      isVideoActive = true;
    } else if (activeRemoteKey) {
      label = peerStates[activeRemoteKey]?.name || 'Participant';
      isVideoActive = peerStates[activeRemoteKey]?.isVideoOn;
      avatarName = label;
    }

    const initials = getParticipantInitials(avatarName);

    return (
      <div 
        onMouseDown={handleMouseDown}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '320px',
          height: '180px',
          zIndex: 9999,
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: '#0F172A',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          animation: 'pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
        }}
      >
        <div style={{ flex: 1, position: 'relative', backgroundColor: '#020617' }}>
          {showStream && isVideoActive && (
            <video
              className="remote-video-feed"
              ref={el => {
                if (el && showStream && el.srcObject !== showStream) {
                  el.srcObject = showStream;
                }
              }}
              autoPlay
              playsInline
              // Fix Round 6: when minimised this is the only player for
              // the remote voice — except with Spatial Audio on, when
              // the WebAudio panner also plays it. Mute the element
              // then, like the grid tiles do.
              muted={isLocalStream || isSpatialAudioEnabled}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
          )}

          {(!showStream || !isVideoActive) && (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#0B0F19'
            }}>
              <div style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-primary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '1.1rem',
                border: '2px solid rgba(255, 255, 255, 0.1)',
                marginBottom: '0.25rem'
              }}>
                {initials}
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {isLocalStream ? 'Camera Off' : `${label} (Camera Off)`}
              </span>
            </div>
          )}

          {/* Mini Header overlay */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '8px 12px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pointerEvents: 'none',
            zIndex: 10
          }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
              {label}
            </span>
            <div style={{ display: 'flex', gap: '4px', pointerEvents: 'auto' }}>
              <button 
                onClick={() => onMinimizeToggle?.(false)}
                title="Restore to full screen"
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  padding: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Maximize2 size={12} />
              </button>
            </div>
          </div>

          {/* Mini Controls overlay */}
          <div style={{
            position: 'absolute',
            bottom: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(4px)',
            padding: '6px 12px',
            borderRadius: '20px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
            zIndex: 10,
            alignItems: 'center'
          }}>
            <button 
              onClick={() => {
                setIsMuted(!isMuted);
                if (localAudioTrackRef.current) {
                  localAudioTrackRef.current.enabled = isMuted;
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: isMuted ? '#EF4444' : '#10B981',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex'
              }}
            >
              {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            
            <button 
              onClick={() => {
                setIsVideoOn(!isVideoOn);
                if (localVideoTrackRef.current) {
                  localVideoTrackRef.current.enabled = !isVideoOn;
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: !isVideoOn ? '#EF4444' : '#10B981',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex'
              }}
            >
              {!isVideoOn ? <VideoOff size={14} /> : <VideoIcon size={14} />}
            </button>

            <button 
              onClick={handleTogglePictureInPicture}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex'
              }}
              title="Pop out Picture-in-Picture"
            >
              <Monitor size={14} />
            </button>

            <div style={{ width: '1px', height: '12px', backgroundColor: 'rgba(255,255,255,0.2)' }} />

            <button 
              onClick={handleLeaveOrEnd}
              style={{
                background: 'none',
                border: 'none',
                color: '#EF4444',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex'
              }}
              title="Leave Call"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={meetingRoomRef} style={{
      display: 'flex',
      flexDirection: 'column',
      height: isFullscreen ? '100dvh' : '100%',
      backgroundColor: '#07090E', // Dark screen for immersive meeting
      color: 'white',
      borderRadius: isFullscreen ? '0' : 'var(--radius-lg)',
      overflow: 'hidden',
      position: 'relative',
      border: isFullscreen ? 'none' : '1px solid #1E293B',
      animation: 'pop-in var(--transition-normal)'
    }}>
      {/* Breakout Room Status Banner */}
      {breakoutRoom !== null && (
        <div style={{
          position: 'absolute',
          top: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(239, 68, 68, 0.9)',
          color: 'white',
          padding: '6px 16px',
          borderRadius: '20px',
          fontSize: '0.8rem',
          fontWeight: 600,
          zIndex: 99,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
        }}>
          <span>Breakout Room {breakoutRoom}</span>
          {breakoutTimeRemaining !== null && (
            <span style={{ fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>
              {Math.floor(breakoutTimeRemaining / 60)}:{(breakoutTimeRemaining % 60).toString().padStart(2, '0')}
            </span>
          )}
        </div>
      )}
      {/* Upper Status Bar */}
      <div className="meeting-topbar" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid #1E293B',
        backgroundColor: 'rgba(11, 15, 25, 0.9)',
        zIndex: 10
      }}>
        <div className="meeting-topbar-title-wrap" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
          <span className="badge badge-premium" style={{ color: '#000', backgroundColor: 'var(--color-accent)', border: 'none' }}>
            LIVE
          </span>
          <h3 className="meeting-topbar-title" style={{ fontSize: '1.1rem', color: 'white', fontFamily: 'var(--font-heading)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {meetingTitle}
          </h3>
        </div>
        <div className="meeting-topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
          {/* Participant count */}
          <span
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'white', fontWeight: 600 }}
            title={`${participants.length + 1} people in this meeting (including you)`}
          >
            <Users size={14} color="var(--color-accent)" />
            {participants.length + 1}
          </span>
          {/* Video engine badge: LiveKit (server) or P2P (direct fallback) */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.2rem 0.55rem',
              borderRadius: '10px',
              backgroundColor: engineType === 'LIVEKIT' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(250, 189, 2, 0.12)',
              border: `1px solid ${engineType === 'LIVEKIT' ? '#10B981' : 'var(--color-accent)'}`,
              color: engineType === 'LIVEKIT' ? '#10B981' : 'var(--color-accent)',
              fontSize: '0.7rem',
              fontWeight: 700
            }}
            title={engineType === 'LIVEKIT' ? 'Video is running through the LiveKit server' : 'LiveKit is unavailable — video is running direct peer-to-peer'}
          >
            {engineType === 'LIVEKIT' ? 'LiveKit' : 'P2P'}
          </span>
          <button 
            onClick={() => onMinimizeToggle?.(true)}
            className="premium-btn premium-btn-secondary"
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px'
            }}
            title="Minimize to Floating Window"
          >
            <Minimize2 size={14} />
            <span className="hide-mobile-text">Minimize</span>
          </button>

          {!isP2PCall && (
            <button 
              onClick={() => setShowMeetingInfo(!showMeetingInfo)}
              className="premium-btn premium-btn-secondary"
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                border: '1px solid var(--border-color)',
                borderRadius: '4px'
              }}
            >
              <Users size={14} />
              <span className="hide-mobile-text">Invite & Info</span>
            </button>
          )}
          {/* Security details hidden to run silently in the background */}
        </div>
      </div>

      {/* Floating Invite Info Card Overlay */}
      {showMeetingInfo && (
        <div style={{
          position: 'absolute',
          top: '80px',
          right: '24px',
          zIndex: 100,
          width: '320px',
          animation: 'slide-in var(--transition-normal)'
        }}>
          <div className="glass-panel" style={{
            padding: '1.5rem',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            boxShadow: 'var(--shadow-premium)'
          }}>
            <div className="flex-between">
              <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'white' }}>Boardroom Invite Info</h4>
              <button 
                onClick={() => setShowMeetingInfo(false)}
                className="panel-close-btn" aria-label="Close invite info"
              >
                &times;
              </button>
            </div>
            
            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: 0 }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>Meeting Join Link</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input 
                  type="text" 
                  value={buildJoinLink(meetingId, passcode)}
                  readOnly 
                  className="premium-input"
                  style={{ fontSize: '0.7rem', padding: '0.35rem 0.5rem', backgroundColor: 'rgba(0,0,0,0.15)', flex: 1 }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildJoinLink(meetingId, passcode));
                    setCopiedInfo('link');
                    setTimeout(() => setCopiedInfo(null), 2000);
                  }}
                  className={`premium-btn ${copiedInfo === 'link' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                  style={{ padding: '0.35rem 0.5rem', height: '28px', fontSize: '0.7rem', flexShrink: 0 }}
                >
                  {copiedInfo === 'link' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>Meeting ID</span>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 700, color: 'white' }}>
                  {meetingId}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>Passcode</span>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 700, color: 'white' }}>
                  {passcode || '—'}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                const link = buildJoinLink(meetingId, passcode);
                const invitation = `Please join my GIIN Meet video conference:
Topic: ${meetingTitle}
Join Link: ${link}
Meeting ID: ${meetingId}
Passcode: ${passcode || '—'}

Media encrypted in transit (DTLS-SRTP).`;
                navigator.clipboard.writeText(invitation);
                setCopiedInfo('details');
                setTimeout(() => setCopiedInfo(null), 2000);
              }}
              className={`premium-btn ${copiedInfo === 'details' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'center', gap: '6px', padding: '0.5rem', fontSize: '0.75rem' }}
            >
              {copiedInfo === 'details' ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedInfo === 'details' ? 'Invitation Details Copied' : 'Copy Invitation Email'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main workspace (Grid & Panels) */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
        
        {/* Floating Subtitles Overlay */}
        {activeCaption && (
          <div style={{
            position: 'absolute',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(7, 9, 14, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '0.6rem 1.25rem',
            zIndex: 100,
            maxWidth: '80%',
            textAlign: 'center',
            boxShadow: 'var(--shadow-premium)',
            pointerEvents: 'none',
            animation: 'pop-in 0.2s ease'
          }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)', display: 'block', marginBottom: '0.15rem' }}>
              {activeCaption.name}
            </span>
            <span style={{ fontSize: '0.9rem', color: 'white', fontWeight: 500 }}>
              {activeCaption.text}
            </span>
          </div>
        )}

        {/* Waiting Room Alert Overlay for Hosts — the full queue, not just
            the first person waiting. */}
        {canModerate && waitingList.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#00205B',
            border: '1px solid var(--color-accent)',
            color: 'white',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            zIndex: 100,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            animation: 'pop-in 0.3s ease',
            maxHeight: '40vh',
            overflowY: 'auto',
            minWidth: '320px'
          }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
              {waitingList.length} {waitingList.length === 1 ? 'person' : 'people'} waiting to join
            </span>
            {waitingList.map((w: any) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{w.name}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleAdmitParticipant(w.participantRowId || w.id, 'Admitted')}
                    className="premium-btn premium-btn-accent"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: '28px' }}
                  >
                    Admit
                  </button>
                  <button
                    onClick={() => handleAdmitParticipant(w.participantRowId || w.id, 'Declined')}
                    className="premium-btn premium-btn-danger"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: '28px', backgroundColor: '#EF4444' }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {isDirectCall ? (
          <div style={{
            flex: 1,
            position: 'relative',
            backgroundColor: '#07090E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
          }}>
            {/* Full-bleed Remote Participant Video/Avatar */}
            {participants.length === 1 ? (
              (() => {
                const p = participants[0];
                const peerKey = p.userId || p.id;
                const tile = getRemoteTileState(peerKey);
                const hasConnection = tile.isPresent;
                const peerStreamObj = tile.activeStreamObj;
                const pState = peerStates[peerKey] || {
                  name: p.name,
                  isVideoOn: p.isVideoOn,
                  isMuted: p.isMuted,
                  isSpeaking: p.isSpeaking,
                  latency: undefined,
                };

                return (
                  <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                    {hasConnection && peerStreamObj && (
                      <audio
                        ref={el => {
                          if (el && peerStreamObj && el.srcObject !== peerStreamObj) {
                            el.srcObject = peerStreamObj;
                          }
                        }}
                        autoPlay
                        // Fix Round 6: the grid tile already mutes its
                        // audio element when Spatial Audio is on (the
                        // WebAudio panner plays the voice instead). This
                        // 1:1 view did not — so with Spatial on, a voice
                        // played twice, centre + panned, slightly out of
                        // sync: the echo / interference in a two-person
                        // call.
                        muted={isSpatialAudioEnabled}
                      />
                    )}
                    {tile.showVideo && peerStreamObj && (
                      <video
                        className="remote-video-feed"
                        ref={el => {
                          if (el && peerStreamObj && el.srcObject !== peerStreamObj) {
                            el.srcObject = peerStreamObj;
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          zIndex: 1
                        }}
                      />
                    )}
                    {!tile.showVideo && (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'linear-gradient(to bottom, #0A0F1D, #04060B)',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 2
                      }}>
                        <div className="pulsing-avatar-container" style={{
                          width: '120px',
                          height: '120px',
                          borderRadius: '50%',
                          backgroundColor: p.avatarBg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '3rem',
                          fontWeight: 700,
                          color: 'white',
                          boxShadow: '0 0 40px rgba(112, 130, 190, 0.25)',
                          border: '4px solid rgba(255, 255, 255, 0.1)',
                          animation: 'pulse-ring 2.5s infinite'
                        }}>
                          {p.avatar}
                        </div>
                        <h4 style={{ marginTop: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>{p.name}</h4>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                          {tile.connecting ? 'Connecting secure tunnel...' : 'Camera Off'}
                        </span>
                      </div>
                    )}

                    {/* Remote Info Banner on top of remote view */}
                    <div style={{
                      position: 'absolute',
                      bottom: '24px',
                      left: '24px',
                      backgroundColor: 'rgba(7, 9, 14, 0.75)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      padding: '0.5rem 1rem',
                      borderRadius: '30px',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      backdropFilter: 'blur(8px)',
                      zIndex: 10
                    }}>
                      <span style={{ fontWeight: 600 }}>{p.name} ({displayRoleLabel(p.role)})</span>
                      {pState.isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />}
                      {/* Latency badge removed to run in the background */}
                    </div>
                    {activeReactions.filter(r => r.senderKey === peerKey).map(r => (
                      <div 
                        key={r.id} 
                        className="floating-emoji-bubble"
                        style={{
                          position: 'absolute',
                          bottom: '40px',
                          left: `${50 + (r.offset || 0)}%`,
                          transform: 'translateX(-50%)',
                          fontSize: '3rem',
                          pointerEvents: 'none',
                          zIndex: 100
                        }}
                      >
                        {r.emoji}
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : (
              /* Calling Screen (participants.length === 0) */
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(to bottom, #0A0F1D, #04060B)'
              }}>
                <div style={{
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '3rem',
                  fontWeight: 700,
                  color: 'white',
                  border: '4px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 0 50px rgba(59, 130, 246, 0.3)',
                  animation: 'pulse-ring 2.5s infinite'
                }}>
                  {meetingTitle ? meetingTitle.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) : 'C'}
                </div>
                <h4 style={{ marginTop: '1.5rem', fontSize: '1.4rem', fontWeight: 700, color: 'white' }}>
                  {meetingTitle || 'Calling...'}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  <span>Calling</span>
                  <span className="calling-dot">.</span>
                  <span className="calling-dot">.</span>
                  <span className="calling-dot">.</span>
                </div>
              </div>
            )}

            {/* Floating PiP Local Preview Card */}
            <div style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              width: '130px',
              height: '195px',
              borderRadius: '16px',
              overflow: 'hidden',
              backgroundColor: '#111827',
              border: isSpeaking && !isMuted ? '3px solid var(--color-accent)' : '2px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
              zIndex: 50,
              transition: 'all 0.3s ease'
            }}>
              {isVideoOn && stream && localCameraLive ? (
                <video 
                  ref={el => {
                    if (el && stream && el.srcObject !== stream) {
                      el.srcObject = stream;
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: 'scaleX(-1)',
                    display: isVideoOn ? 'block' : 'none',
                    filter: videoFilter === 'blur' ? 'blur(6px)' : videoFilter === 'sepia' ? 'sepia(0.8)' : videoFilter === 'grayscale' ? 'grayscale(1)' : videoFilter === 'warm' ? 'sepia(0.3) hue-rotate(-10deg) saturate(1.4)' : videoFilter === 'cyberpunk' ? 'hue-rotate(90deg) saturate(1.5)' : 'none'
                  }}
                />
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  backgroundColor: '#090D14'
                }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1rem',
                    fontWeight: 700,
                    color: 'white',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                  }}>
                    {getParticipantInitials(currentUser?.name)}
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Camera Off</span>
                </div>
              )}
              <div style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                backgroundColor: 'rgba(7, 9, 14, 0.75)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                color: 'white'
              }}>
                You
              </div>
            </div>
          </div>
        ) : participants.length === 0 && !isScreenSharing ? (
          /* Professional Fintech boardroom details dashboard when alone in a meeting (and not sharing your screen -- sharing uses the main screen-share layout below) */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(250, 189, 2, 0.06), transparent 60%), radial-gradient(ellipse 70% 55% at 50% 110%, rgba(37, 99, 235, 0.10), transparent 65%), #07090E',
            overflowY: 'auto'
          }}>
            {/* Centered: Your webcam tile */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '800px' }}>
              <div style={{
                position: 'relative',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                backgroundColor: '#111827',
                aspectRatio: '16/9',
                border: isSpeaking && !isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                boxShadow: 'var(--shadow-premium)',
                transition: 'all 0.25s ease'
              }}>
                {isVideoOn && stream && localCameraLive ? (
                  <>
                    <video 
                      ref={el => {
                        if (el && stream && el.srcObject !== stream) {
                          el.srcObject = stream;
                        }
                      }}
                      autoPlay 
                      playsInline 
                      muted 
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'cover', 
                        transform: 'scaleX(-1)',
                        filter: `${videoFilter === 'blur' ? 'blur(6px)' : videoFilter === 'sepia' ? 'sepia(0.8)' : videoFilter === 'grayscale' ? 'grayscale(1)' : videoFilter === 'warm' ? 'sepia(0.3) hue-rotate(-10deg) saturate(1.4)' : videoFilter === 'cyberpunk' ? 'hue-rotate(90deg) saturate(1.5)' : 'none'} ${isStudioLightEnabled ? 'brightness(1.15) contrast(1.05) saturate(1.1)' : ''}`
                      }} 
                    />
                    {isStudioLightEnabled && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.1) 80%)',
                        pointerEvents: 'none',
                        zIndex: 2
                      }} />
                    )}
                  </>
                ) : (
                  <div style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem',
                    backgroundColor: '#090D14'
                  }}>
                    <div style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.8rem',
                      fontWeight: 700,
                      color: 'white',
                      border: '2px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      {getParticipantInitials(currentUser?.name)}
                    </div>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 500 }}>Webcam Off</span>
                  </div>
                )}

                {/* E2EE secure emblem removed to run silently in the background */}

                <div style={{
                  position: 'absolute',
                  bottom: '12px',
                  left: '12px',
                  backgroundColor: 'rgba(7, 9, 14, 0.85)',
                  border: '1px solid #1E293B',
                  padding: '0.35rem 0.7rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  backdropFilter: 'blur(4px)'
                }}>
                </div>
                {activeReactions.filter(r => r.senderKey === myKey).map(r => (
                  <div 
                    key={r.id} 
                    className="floating-emoji-bubble"
                    style={{
                      position: 'absolute',
                      bottom: '40px',
                      left: `${50 + (r.offset || 0)}%`,
                      transform: 'translateX(-50%)',
                      fontSize: '3rem',
                      pointerEvents: 'none',
                      zIndex: 100
                    }}
                  >
                    {r.emoji}
                  </div>
                ))}
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.5rem' }}>
                You are currently the only participant in this boardroom conference.
              </span>
            </div>
          </div>
        ) : (
          (() => {
            const hasScreenShare = isScreenSharing || Object.keys(peerStates).some(k => peerStates[k].isScreenSharing);

            // Speaker-layout spotlight: the pinned person if set (and still
            // in the room), else whoever is speaking, else the first remote
            // participant, else yourself. Only used in speaker mode.
            const remotePeerKeys = participants
              .filter(p => (p.userId || p.id) !== myKey)
              .map(p => p.userId || p.id);
            const speakingPeerKey = remotePeerKeys.find(k => peerStates[k]?.isSpeaking && !peerStates[k]?.isMuted);
            const spotlightKey = layoutMode === 'speaker'
              ? (pinnedKey && (pinnedKey === 'local' || remotePeerKeys.includes(pinnedKey)) ? pinnedKey : (speakingPeerKey || remotePeerKeys[0] || 'local'))
              : null;

            // Render local video card
            const localVideoCard = (
              <div className={`meeting-card ${isSpeaking && !isMuted ? 'speaking' : ''}${spotlightKey === 'local' ? ' spotlight' : ''}`} style={{
                position: 'relative',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: '#111827',
                aspectRatio: '16/9',
                border: isSpeaking && !isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                transition: 'all 0.25s ease'
              }}>
                {/* Pin to spotlight (speaker view) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pinnedKey === 'local') {
                      setPinnedKey(null);
                    } else {
                      setPinnedKey('local');
                      setLayoutMode('speaker');
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: pinnedKey === 'local' ? 'var(--color-accent)' : 'rgba(0,0,0,0.55)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: pinnedKey === 'local' ? 'black' : 'white',
                    cursor: 'pointer',
                    zIndex: 10
                  }}
                  title={pinnedKey === 'local' ? 'Unpin (stop spotlighting yourself)' : 'Pin yourself as the spotlight (speaker view)'}
                >
                  <Pin size={13} />
                </button>
                {isVideoOn && stream && localCameraLive ? (
                  <>
                    <video 
                      ref={el => {
                        if (el && stream && el.srcObject !== stream) {
                          el.srcObject = stream;
                        }
                      }}
                      autoPlay 
                      playsInline 
                      muted 
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'cover', 
                        transform: 'scaleX(-1)',
                        filter: `${videoFilter === 'blur' ? 'blur(6px)' : videoFilter === 'sepia' ? 'sepia(0.8)' : videoFilter === 'grayscale' ? 'grayscale(1)' : videoFilter === 'warm' ? 'sepia(0.3) hue-rotate(-10deg) saturate(1.4)' : videoFilter === 'cyberpunk' ? 'hue-rotate(90deg) saturate(1.5)' : 'none'} ${isStudioLightEnabled ? 'brightness(1.15) contrast(1.05) saturate(1.1)' : ''}`
                      }} 
                    />
                  </>
                ) : (
                  <div style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem',
                    backgroundColor: '#090D14'
                  }}>
                    <div style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      color: 'white',
                      border: '2px solid rgba(255,255,255,0.1)'
                    }}>
                      {getParticipantInitials(currentUser?.name)}
                    </div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{localCameraRecovering ? 'Camera reconnecting…' : 'Camera Off'}</span>
                  </div>
                )}
                
                {localHandRaised && (
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    backgroundColor: 'var(--color-accent)',
                    color: 'black',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    zIndex: 10,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                  }}>
                    <Hand size={11} />
                    <span>{handRaiseReason ? handRaiseReason.split(' ')[1] || handRaiseReason : 'Hand Raised'}</span>
                  </div>
                )}

                {isSpeaking && !isMuted && (
                  <div style={{
                    position: 'absolute',
                    bottom: '12px',
                    right: '12px',
                    display: 'flex',
                    gap: '3px',
                    alignItems: 'center',
                    backgroundColor: 'rgba(0,0,0,0.65)',
                    padding: '6px',
                    borderRadius: '6px',
                    zIndex: 10
                  }}>
                    <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.7s ease infinite', transformOrigin: 'bottom' }} />
                    <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.4s ease infinite', transformOrigin: 'bottom' }} />
                    <span style={{ width: '3px', height: '8px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.8s ease infinite', transformOrigin: 'bottom' }} />
                  </div>
                )}

                <div style={{
                  position: 'absolute',
                  bottom: '12px',
                  left: '12px',
                  backgroundColor: 'rgba(7, 9, 14, 0.65)',
                  border: '1px solid #1E293B',
                  padding: '0.35rem 0.7rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  backdropFilter: 'blur(4px)',
                  zIndex: 10
                }}>
                  {/* The label is the real role, never a hardcoded one:
                      a guest's own tile says Guest, the host's says Host. */}
                  <span style={{ fontWeight: 600 }}>You ({isAdmin ? 'Host' : isCoHost ? 'Co-host' : 'Guest'})</span>
                  {isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
                  <span
                    style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: engineType === 'LIVEKIT' ? '#10B981' : 'var(--color-accent)' }}
                    title={engineType === 'LIVEKIT' ? 'Connected through the LiveKit server' : 'Connected direct peer-to-peer (LiveKit unavailable)'}
                  />
                </div>
                {activeReactions.filter(r => r.senderKey === myKey).map(r => (
                  <div 
                    key={r.id} 
                    className="floating-emoji-bubble"
                    style={{
                      position: 'absolute',
                      bottom: '40px',
                      left: `${50 + (r.offset || 0)}%`,
                      transform: 'translateX(-50%)',
                      fontSize: '2.5rem',
                      pointerEvents: 'none',
                      zIndex: 100
                    }}
                  >
                    {r.emoji}
                  </div>
                ))}
              </div>
            );

            // Render remote video cards
            const remoteVideoCards = participants
              .filter(p => (p.userId || p.id) !== myKey)
              .map(p => {
                const peerKey = p.userId || p.id;
                // LiveKit is the engine; the P2P stream is only the
                // fallback when LiveKit could not connect at all.
                // One honest tile state: live video only on a live track,
                // "Connecting..." only while a camera is actually on its
                // way — never for a participant with no tracks at all.
                const tile = getRemoteTileState(peerKey);
                const activeStreamObj = tile.activeStreamObj;
                const hasConnection = tile.isPresent;
                
                const pState = peerStates[peerKey] || {
                  name: p.name,
                  isVideoOn: p.isVideoOn,
                  isMuted: p.isMuted,
                  isSpeaking: p.isSpeaking,
                  latency: undefined,
                  videoFilter: undefined,
                  isStudioLightEnabled: false,
                  // Fix Round 8 (#7): was hardcoded false, so the tile
                  // never showed its own "Reconnecting..." overlay.
                  isReconnecting: isLivekitReconnecting
                };

                return (
                  <div key={p.id} className={`meeting-card participant-tile ${pState.isSpeaking && !pState.isMuted ? 'speaking' : ''}${spotlightKey === peerKey ? ' spotlight' : ''}`} style={{
                    position: 'relative',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    backgroundColor: '#111827',
                    aspectRatio: '16/9',
                    border: pState.isSpeaking && !pState.isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                    transition: 'all 0.25s ease'
                  }}>
                    {/* Pin to spotlight (speaker view) */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (pinnedKey === peerKey) {
                          setPinnedKey(null);
                        } else {
                          setPinnedKey(peerKey);
                          setLayoutMode('speaker');
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: pinnedKey === peerKey ? 'var(--color-accent)' : 'rgba(0,0,0,0.55)',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: pinnedKey === peerKey ? 'black' : 'white',
                        cursor: 'pointer',
                        zIndex: 10
                      }}
                      title={pinnedKey === peerKey ? `Unpin ${p.name}` : `Pin ${p.name} as the spotlight (speaker view)`}
                    >
                      <Pin size={13} />
                    </button>
                    {/* Fix Round 8: host mute on the video card — the same
                        server-verified mute as the participants list, with
                        its own unmistakable button (red pill, MicOff icon
                        + "Mute" label) so it is never confused with the
                        toolbar mute. Hidden once the participant is
                        already muted; the name bar already shows that. */}
                    {canModerate && !pState.isMuted && (
                      <button
                        className="tile-mute-btn"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await giinApi.controlMeeting(meetingId, 'mute-participant', { targetUserId: p.userId || undefined, targetRowId: p.id });
                          } catch (err: any) {
                            triggerToast(err?.message || `Could not mute ${p.name} - please try again.`);
                          }
                        }}
                        style={{
                          position: 'absolute',
                          top: '48px',
                          right: '10px',
                          height: '28px',
                          minWidth: '28px',
                          padding: '0 6px',
                          borderRadius: '14px',
                          backgroundColor: 'rgba(239, 68, 68, 0.92)',
                          border: '1px solid rgba(255,255,255,0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          color: 'white',
                          cursor: 'pointer',
                          zIndex: 10,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
                        }}
                        title={`Mute ${p.name}`}
                      >
                        <MicOff size={13} />
                        <span style={{ fontSize: '0.65rem', fontWeight: 700 }}>Mute</span>
                      </button>
                    )}
                    {hasConnection && activeStreamObj && (
                      <audio
                        ref={el => {
                          if (el && activeStreamObj && el.srcObject !== activeStreamObj) {
                            el.srcObject = activeStreamObj;
                          }
                        }}
                        autoPlay
                        muted={isSpatialAudioEnabled}
                      />
                    )}
                  {tile.showVideo && activeStreamObj ? (
                    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                      {/* Active Video Feed (LiveKit or Swapped P2P) */}
                      <video
                        className="remote-video-feed"
                        ref={el => {
                          if (el && activeStreamObj && el.srcObject !== activeStreamObj) {
                            el.srcObject = activeStreamObj;
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        style={{ 
                          width: '100%', 
                          height: '100%', 
                          objectFit: 'cover',
                          filter: `${pState.videoFilter === 'blur' ? 'blur(6px)' : pState.videoFilter === 'sepia' ? 'sepia(0.8)' : pState.videoFilter === 'grayscale' ? 'grayscale(1)' : pState.videoFilter === 'warm' ? 'sepia(0.3) hue-rotate(-10deg) saturate(1.4)' : pState.videoFilter === 'cyberpunk' ? 'hue-rotate(90deg) saturate(1.5)' : 'none'} ${pState.isStudioLightEnabled ? 'brightness(1.15) contrast(1.05) saturate(1.1)' : ''}`
                        }}
                      />

                    </div>
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '1rem',
                      backgroundColor: '#090D14'
                    }}>
                      <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        backgroundColor: p.avatarBg || 'var(--color-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        color: 'white',
                        border: '2px solid rgba(255,255,255,0.1)'
                      }}>
                        {p.avatar || getParticipantInitials(p.name)}
                      </div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {tile.connecting ? 'Connecting...' : 'Camera Off'}
                      </span>
                    </div>
                  )}

                  {(() => {
                    const isUserHandRaised = handRaises.some(hr => hr.userId === peerKey);
                    const userHandRaise = handRaises.find(hr => hr.userId === peerKey);
                    const handRaiseIndex = handRaises.findIndex(hr => hr.userId === peerKey);
                    
                    return isUserHandRaised && userHandRaise && (
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        left: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        backgroundColor: 'var(--color-accent)',
                        color: 'black',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        zIndex: 10,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                      }}>
                        <Hand size={11} />
                        <span>#{handRaiseIndex + 1} {userHandRaise.reason ? (userHandRaise.reason.split(' ')[1] || userHandRaise.reason) : 'Raised'}</span>
                      </div>
                    );
                  })()}

                  {/* Reconnecting overlay status */}
                  {pState.isReconnecting && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 15
                    }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-accent)', fontWeight: 600 }}>Reconnecting...</span>
                    </div>
                  )}

                  {pState.isSpeaking && !pState.isMuted && (
                    <div style={{
                      position: 'absolute',
                      bottom: '12px',
                      right: '12px',
                      display: 'flex',
                      gap: '3px',
                      alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.65)',
                      padding: '6px',
                      borderRadius: '6px',
                      zIndex: 10
                    }}>
                      <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.7s ease infinite', transformOrigin: 'bottom' }} />
                      <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.4s ease infinite', transformOrigin: 'bottom' }} />
                      <span style={{ width: '3px', height: '8px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.8s ease infinite', transformOrigin: 'bottom' }} />
                    </div>
                  )}

                  <div style={{
                    position: 'absolute',
                    bottom: '12px',
                    left: '12px',
                    backgroundColor: 'rgba(7, 9, 14, 0.8)',
                    border: '1px solid #1E293B',
                    padding: '0.35rem 0.7rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    backdropFilter: 'blur(4px)',
                    zIndex: 10
                  }}>
                    <span style={{ fontWeight: 600 }}>{p.name} ({displayRoleLabel(p.role)})</span>
                    {pState.isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
                    <span
                      style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: pState.isReconnecting ? 'var(--color-accent)' : hasConnection ? (typeof pState.latency === 'number' ? (pState.latency < 150 ? '#10B981' : pState.latency < 400 ? 'var(--color-accent)' : '#EF4444') : '#10B981') : '#64748B' }}
                      title={pState.isReconnecting ? 'Reconnecting...' : hasConnection ? (typeof pState.latency === 'number' ? `Connection latency ${pState.latency} ms` : 'Connected') : tile.connecting ? 'Connecting...' : 'In the meeting — camera off' }
                    />
                    {typeof pState.latency === 'number' && (
                      <span
                        style={{
                          color: pState.latency < 150 ? '#10B981' : pState.latency < 400 ? 'var(--color-accent)' : '#EF4444',
                          fontFamily: 'monospace',
                          fontSize: '0.7rem'
                        }}
                        title="Connection latency to this participant"
                      >
                        {pState.latency} ms
                      </span>
                    )}
                  </div>

                  {activeReactions.filter(r => r.senderKey === peerKey).map(r => (
                    <div 
                      key={r.id} 
                      className="floating-emoji-bubble"
                      style={{
                        position: 'absolute',
                        bottom: '30px',
                        left: `${50 + (r.offset || 0)}%`,
                        transform: 'translateX(-50%)',
                        fontSize: '2.5rem',
                        pointerEvents: 'none',
                        zIndex: 100
                      }}
                    >
                      {r.emoji}
                    </div>
                  ))}
                </div>
              );
            });

            if (hasScreenShare) {
              return (
                <div className="screenshare-layout" style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: window.innerWidth < 768 ? 'column' : 'row',
                  overflow: 'hidden',
                  background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(250, 189, 2, 0.06), transparent 60%), radial-gradient(ellipse 70% 55% at 50% 110%, rgba(37, 99, 235, 0.10), transparent 65%), #07090E'
                }}>
                  {/* Main Screen Share Frame */}
                  <div style={{
                    flex: 1,
                    position: 'relative',
                    borderRadius: window.innerWidth < 768 ? '8px' : 'var(--radius-lg)',
                    overflow: 'hidden',
                    border: '2px solid var(--color-accent)',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: '#0A0D14',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.4), 0 0 32px rgba(250, 189, 2, 0.18)',
                    aspectRatio: window.innerWidth < 768 ? 'auto' : '16/9',
                    margin: window.innerWidth < 768 ? '0.5rem' : '1.5rem'
                  }}>
                    {isScreenSharing ? (
                      <video
                        key={screenStream?.id || 'local-screen'}
                        ref={el => {
                          if (el && screenStream && el.srcObject !== screenStream) {
                            el.srcObject = screenStream;
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      (() => {
                        const screenPeerKey = Object.keys(peerStates).find(k => peerStates[k].isScreenSharing);
                        const screenStreamObj = screenPeerKey ? remoteScreenStreams[screenPeerKey] : null;
                        const screenPeerName = screenPeerKey ? peerStates[screenPeerKey].name : 'Remote Peer';
                        return screenStreamObj ? (
                          <video
                            key={screenStreamObj?.id || 'remote-screen'}
                            ref={el => {
                              if (el && screenStreamObj && el.srcObject !== screenStreamObj) {
                                el.srcObject = screenStreamObj;
                              }
                            }}
                            autoPlay
                            playsInline
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          />
                        ) : (
                          <div className="flex-center" style={{ flex: 1, flexDirection: 'column', gap: '1rem' }}>
                            <AlertTriangle color="var(--color-accent)" size={32} />
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Waiting for screen stream from {screenPeerName}...</span>
                          </div>
                        );
                      })()
                    )}

                    {/* Secure Fintech Watermark Overlay */}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      pointerEvents: 'none',
                      zIndex: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      opacity: 0.08,
                      userSelect: 'none'
                    }}>
                      <div style={{
                        transform: 'rotate(-25deg)',
                        fontSize: '1.8rem',
                        fontWeight: 800,
                        color: 'white',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        fontFamily: 'monospace',
                        letterSpacing: '3px'
                      }}>
                        {`CONFIDENTIAL • GIIN SECURE SYSTEM • ${currentUser?.email || 'GUEST'} • ${new Date().toLocaleDateString()}`}
                      </div>
                    </div>
                    
                    {isAnnotating && isScreenSharing && (
                      <ScreenAnnotation 
                        isPresenter={true} 
                        onClose={() => setIsAnnotating(false)} 
                        sigChannelRef={sigChannelRef}
                        myKey={myKey}
                        userName={currentUser?.name || 'Presenter'}
                      />
                    )}
                    
                    {/* Screen Annotation Overlay for Receivers */}
                    {!isScreenSharing && (
                      <ScreenAnnotation 
                        isPresenter={false} 
                        onClose={() => {}} 
                        sigChannelRef={sigChannelRef}
                        myKey={myKey}
                        userName={currentUser?.name || 'Participant'}
                      />
                    )}
                    
                    <div style={{
                      position: 'absolute',
                      bottom: '16px',
                      left: '16px',
                      backgroundColor: 'rgba(7, 9, 14, 0.85)',
                      padding: '0.45rem 0.9rem',
                      borderRadius: '6px',
                      border: '1px solid #1E293B',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      zIndex: 25,
                      backdropFilter: 'blur(4px)'
                    }}>
                      {isScreenSharing && (
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444', animation: 'pulse-red 1.5s infinite', flexShrink: 0 }} />
                      )}
                      <Monitor size={14} color="var(--color-accent)" />
                      <span>
                        {isScreenSharing 
                          ? 'You are sharing your screen' 
                          : `${Object.keys(peerStates).find(k => peerStates[k].isScreenSharing) ? peerStates[Object.keys(peerStates).find(k => peerStates[k].isScreenSharing)!].name : 'Participant'} is sharing screen`}
                      </span>
                        {isScreenSharing && (
                          <button
                            onClick={handleToggleScreenShare}
                            style={{
                              marginLeft: '0.4rem',
                              backgroundColor: 'var(--color-accent)',
                              color: 'black',
                              border: 'none',
                              borderRadius: '4px',
                              padding: '0.2rem 0.6rem',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Stop sharing
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Participant Sidebar */}
                  <div className="screenshare-sidebar" style={{
                    width: window.innerWidth < 768 ? '100%' : '260px',
                    display: 'flex',
                    flexDirection: window.innerWidth < 768 ? 'row' : 'column',
                    gap: '0.5rem',
                    padding: window.innerWidth < 768 ? '0.5rem' : '1.5rem 1.5rem 1.5rem 0',
                    overflowY: window.innerWidth < 768 ? 'hidden' : 'auto',
                    overflowX: window.innerWidth < 768 ? 'auto' : 'hidden'
                  }}>
                    {localVideoCard}
                    {remoteVideoCards}
                  </div>
                </div>
              );
            }

            // No Screen Share: Normal grid tiling
            return (
              <div className={`meeting-grid${layoutMode === 'speaker' ? ' speaker-mode' : ''}`} style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                padding: window.innerWidth < 768 ? '0.75rem' : '1.5rem',
                overflowY: 'auto',
                background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(250, 189, 2, 0.06), transparent 60%), radial-gradient(ellipse 70% 55% at 50% 110%, rgba(37, 99, 235, 0.10), transparent 65%), #07090E'
              }}>
                {/* Portrait-phone tile auto-size: this inner wrapper carries
                    the wrap layout and margin:auto centres the tiles when
                    they fit, but collapses to the top (never clips the
                    first tiles) when 3+ tiles overflow the viewport height
                    — plain align/justify centering on a scrollable flex
                    container hides the top rows above the scroll origin. */}
                <div style={{
                  margin: 'auto',
                  flexShrink: 0,
                  width: '100%',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: window.innerWidth < 768 ? '0.75rem' : '1.25rem',
                  justifyContent: 'center',
                  alignContent: 'center'
                }}>
                  {localVideoCard}
                  {remoteVideoCards}
                </div>
              </div>
            );
          })()
        )}

        {/* Mobile backdrop: tap outside an open side panel to close it,
            so the small close X is not the only way back. */}
        {activePanel !== 'none' && window.innerWidth < 768 && (
          <div
            aria-hidden="true"
            onClick={() => setActivePanel('none')}
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.5)', zIndex: 55 }}
          />
        )}

        {/* Collapsible Panels */}
        {activePanel === 'chat' && (
          <div className="meeting-side-panel" style={{
            width: '320px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>Meeting Chat</h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>
            
            {/* Messages Feed */}
            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {messages.map((m, idx) => (
                <div key={idx} style={{
                  alignSelf: m.self ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.self ? 'flex-end' : 'flex-start'
                }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>
                    {m.sender} &bull; {m.time}{m.pending ? ' • Sending…' : ''}
                  </span>
                  <div style={{
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    backgroundColor: m.self ? 'var(--color-primary)' : '#1E293B',
                    color: 'white',
                    fontSize: '0.85rem',
                    lineHeight: 1.3,
                    opacity: m.pending ? 0.65 : 1
                  }}>
                    {renderChatText(m.text)}
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={sendChatMessage} className="meeting-chat-form" style={{ padding: '0.75rem', borderTop: '1px solid #1E293B', display: 'flex', gap: '0.5rem' }}>
              <label
                title="Share a file (up to 25 MB; signed-in users only)"
                style={{
                  background: '#1E293B',
                  border: 'none',
                  borderRadius: '4px',
                  width: '34px',
                  height: '34px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <Paperclip size={16} />
                <input type="file" onChange={handleAttachFile} style={{ display: 'none' }} />
              </label>
              <input 
                type="text" 
                placeholder={isChatLocked && !isAdmin ? "Chat is disabled by the host." : !currentUser ? "Sign in to send messages — guests can read chat" : "Send message to everyone..."} 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={(!currentUser || (isChatLocked && !isAdmin))}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '4px',
                  backgroundColor: (!currentUser || (isChatLocked && !isAdmin)) ? '#1E293B' : '#090D16',
                  border: '1px solid #1E293B',
                  color: 'white',
                  fontSize: '0.85rem',
                  cursor: (!currentUser || (isChatLocked && !isAdmin)) ? 'not-allowed' : 'text'
                }}
              />
              <button 
                type="submit" 
                disabled={(!currentUser || (isChatLocked && !isAdmin))}
                style={{
                  background: (!currentUser || (isChatLocked && !isAdmin)) ? '#475569' : 'var(--color-primary)',
                  border: 'none',
                  borderRadius: '4px',
                  width: '34px',
                  height: '34px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  cursor: (!currentUser || (isChatLocked && !isAdmin)) ? 'not-allowed' : 'pointer',
                  opacity: (!currentUser || (isChatLocked && !isAdmin)) ? 0.6 : 1
                }}
              >
                <SendHorizontal size={16} />
              </button>
            </form>
          </div>
        )}

        {activePanel === 'participants' && (
          <div className="meeting-side-panel" style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>Participants ({participants.length + 1})</h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Speaker Queue (Handraises) */}
              {handRaises.length > 0 && (
                <div style={{
                  padding: '0.75rem',
                  border: '1px solid var(--color-accent)',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(250, 189, 2, 0.05)',
                  marginBottom: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem'
                }}>
                  <div className="flex-between">
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      🙋 Speaker Queue ({handRaises.length})
                    </span>
                    {isAdmin && (
                      <button 
                        onClick={clearAllHands}
                        style={{ border: 'none', background: 'none', color: '#EF4444', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Lower All
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {handRaises.map((hr, index) => {
                      const waitingSecs = Math.floor((Date.now() - hr.timestamp) / 1000);
                      const waitingText = waitingSecs < 60 ? `${waitingSecs}s` : `${Math.floor(waitingSecs / 60)}m`;
                      
                      return (
                        <div key={hr.userId} className="flex-between" style={{
                          padding: '0.45rem 0.6rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255, 255, 255, 0.04)',
                          borderLeft: '3px solid var(--color-accent)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)', minWidth: '16px' }}>
                              #{index + 1}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {hr.name}
                              </div>
                              {hr.reason && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-secondary)', fontStyle: 'italic' }}>
                                  {hr.reason}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {waitingText}
                            </span>
                            {isAdmin && (
                              <button 
                                onClick={() => lowerHand(hr.userId)}
                                style={{
                                  border: 'none',
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#EF4444',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '0.65rem',
                                  cursor: 'pointer',
                                  fontWeight: 600
                                }}
                              >
                                Lower
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Host */}
              <div className="flex-between">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.85rem' }}>
                    Y
                  </div>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>You</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{isAdmin ? 'Host' : isCoHost ? 'Co-host' : 'Guest'}</div>
                  </div>
                </div>
                <div>
                  {isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />}
                </div>
              </div>

              {/* Other participants */}
              {participants.map(p => (
                <div key={p.id} className="flex-between" style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.02)', flexWrap: 'wrap', rowGap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: '1 1 140px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: p.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.85rem', color: 'white', flexShrink: 0 }}>
                      {p.avatar}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{displayRoleLabel(p.role)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' }}>
                    {p.isSpeaking && !p.isMuted && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', animation: 'pulse-ring 2s infinite' }} />}
                    
                    {/* Fix Round 7 (#5): moderation is offered for guest
                        rows too - guests have user_id NULL, so gating on
                        p.userId hid every control from them. Actions that
                        need a signed-in user (Make Admin) still check
                        p.userId individually below. */}
                    {canModerate && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {isAdmin && p.userId && (
                          <button
                            onClick={() => handleDesignateAdmin(p.userId!)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--color-accent)', fontWeight: 600, padding: '2px 4px' }}
                            title="Designate Admin"
                          >
                            Make Admin
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={async () => {
                              const { error } = await giinApi.setParticipantRole(p.id, 'CoHost');
                              if (error) {
                                triggerToast(`Could not make ${p.name} a co-host — please try again.`);
                              } else {
                                setCoHostKeys(prev => {
                                  const next = new Set(prev);
                                  next.add(p.id);
                                  if (p.userId) next.add(p.userId);
                                  return next;
                                });
                                triggerToast(`${p.name} is now a co-host and can admit people and mute participants.`);
                              }
                            }}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--color-accent)', fontWeight: 600, padding: '2px 4px' }}
                            title="Make Co-Host (can admit people and mute participants)"
                          >
                            Make Co-Host
                          </button>
                        )}
                        
                        {!p.isMuted && (
                          <button 
                            onClick={async () => {
                              // Fix Round 7 (#3): mute goes through the
                              // host-verified server route. Guests are
                              // targeted by row id - their user_id is NULL.
                              try {
                                await giinApi.controlMeeting(meetingId, 'mute-participant', { targetUserId: p.userId || undefined, targetRowId: p.id });
                              } catch (err: any) {
                                triggerToast(err?.message || `Could not mute ${p.name} - please try again.`);
                              }
                            }}
                            style={{
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              color: '#EF4444',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '4px',
                              borderRadius: '4px'
                            }}
                            title="Mute Participant"
                          >
                            <MicOff size={13} />
                          </button>
                        )}

                        {isAdmin && (
                        <button
                          disabled={busyControlKey === p.id}
                          onClick={async () => {
                            if (busyControlKey) return;
                            if (confirm(`Are you sure you want to remove ${p.name} from the meeting?`)) {
                              // Fix Round 7 (#1 + #3): the kick goes
                              // through the host-verified server route -
                              // the server deletes the row AND broadcasts
                              // the removal with a server marker. The
                              // guest leaves even if the broadcast is
                              // missed (participants poll self-row-gone
                              // check).
                              setBusyControlKey(p.id);
                              try {
                                await giinApi.controlMeeting(meetingId, 'remove-participant', { targetUserId: p.userId || undefined, targetRowId: p.id });
                                // Immediately clean up locally for instant UI feedback
                                cleanupPeer(p.userId || p.id);
                                // Round 9 (9A): the person now shows in
                                // the Removed section below, with Re-invite.
                                loadRemovedParticipants();
                              } catch (err: any) {
                                triggerToast(err?.message || `Could not remove ${p.name} from the meeting - please try again.`);
                              } finally {
                                setBusyControlKey(null);
                              }
                            }
                          }}
                          style={{
                            border: 'none',
                            background: 'rgba(239, 68, 68, 0.1)',
                            cursor: busyControlKey === p.id ? 'wait' : 'pointer',
                            opacity: busyControlKey === p.id ? 0.5 : 1,
                            color: '#EF4444',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '3px 6px',
                            borderRadius: '4px'
                          }}
                          title="Remove Participant"
                        >
                          Remove
                        </button>
                        )}
                      </div>
                    )}
                    
                    {!isAdmin && (p.isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />)}
                    {isAdmin && p.isMuted && <MicOff size={14} color="#EF4444" style={{ marginLeft: '4px' }} />}
                  </div>
                </div>
              ))}

              {/* Round 9 (9A): removed participants, with a host re-invite. */}
              {isAdmin && removedParticipants.length > 0 && (
                <div style={{ borderTop: '1px solid #1E293B', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#FCA5A5' }}>Removed ({removedParticipants.length})</span>
                  {removedParticipants.map((rp: any) => (
                    <div key={rp.id} className="flex-between" style={{ flexWrap: 'wrap', rowGap: '0.35rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'white', fontWeight: 600 }}>{rp.name}</span>
                      <button
                        onClick={async () => {
                          try {
                            await giinApi.admitParticipant(meetingId, rp.id, 'Admitted');
                            triggerToast(`${rp.name} was invited back — they can rejoin with the same link.`);
                            loadRemovedParticipants();
                          } catch (err: any) {
                            triggerToast(err?.message || `Could not invite ${rp.name} back — please try again.`);
                          }
                        }}
                        style={{ border: 'none', background: 'rgba(16, 185, 129, 0.12)', cursor: 'pointer', color: '#10B981', fontSize: '0.7rem', fontWeight: 600, padding: '3px 8px', borderRadius: '4px' }}
                        title="Invite this person back into the meeting"
                      >
                        Re-invite
                      </button>
                    </div>
                  ))}
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Removed people cannot rejoin with the link until you invite them back.</span>
                </div>
              )}
            </div>
          </div>
        )}
        {activePanel === 'host-settings' && isAdmin && (
          <div className="meeting-side-panel" style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>Host Controls</h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Lock Meeting Toggle */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Lock Meeting</span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isMeetingLocked} 
                      onChange={(e) => handleToggleMeetingLock(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isMeetingLocked ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isMeetingLocked ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isMeetingLocked ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Prevent any new participants from joining the meeting room.
                </span>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Toggle Waiting Room */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Waiting Room</span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isWaitingRoomEnabled} 
                      onChange={(e) => handleToggleWaitingRoom(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isWaitingRoomEnabled ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isWaitingRoomEnabled ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isWaitingRoomEnabled ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  New participants must be approved by you before entering the meeting.
                </span>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Toggle In-Call Chat */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Lock In-Call Chat</span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isChatLocked} 
                      onChange={(e) => handleToggleChatLock(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isChatLocked ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isChatLocked ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isChatLocked ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  When locked, only you can send messages. Other participants can only view.
                </span>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Block Screen Sharing for Guests */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Block Guest Screen Share</span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isScreenShareBlockedForGuests} 
                      onChange={(e) => handleToggleScreenShareBlock(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isScreenShareBlockedForGuests ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isScreenShareBlockedForGuests ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isScreenShareBlockedForGuests ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Block guests from sharing their screen.
                </span>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Mute on Entry */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Mute on Entry</span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isMuteOnEntryEnabled} 
                      onChange={(e) => handleToggleMuteOnEntry(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isMuteOnEntryEnabled ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isMuteOnEntryEnabled ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isMuteOnEntryEnabled ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Mute new participants automatically when they join the meeting.
                </span>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Global Audio/Video Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Global Actions</span>
                
                <button 
                  onClick={handleMuteAll}
                  className="premium-btn premium-btn-secondary"
                  style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', padding: '0.5rem' }}
                >
                  <MicOff size={14} style={{ marginRight: '4px' }} />
                  Mute All Participants
                </button>
 
                <button 
                  onClick={handleDisableVideoAll}
                  className="premium-btn premium-btn-secondary"
                  style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', padding: '0.5rem' }}
                >
                  <VideoOff size={14} style={{ marginRight: '4px' }} />
                  Turn Off All Videos
                </button>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Breakout Rooms Management */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>Breakout Rooms</span>
                <span style={{ fontSize: '0.75rem', color: '#FCA5A5', lineHeight: 1.45 }}>
                  Breakout rooms run peer-to-peer, not on the video server — video quality may drop with several people. LiveKit-native breakouts need breakout-scoped presence (a bigger redesign) and are not in this release.
                </span>
                {breakoutTimeRemaining === null ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Rooms:</span>
                      <input 
                        type="number" 
                        min="2" 
                        max="5" 
                        value={breakoutRoomsCount}
                        onChange={(e) => setBreakoutRoomsCount(parseInt(e.target.value) || 2)}
                        className="premium-input"
                        style={{ width: '60px', height: '28px', fontSize: '0.8rem', textAlign: 'center' }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Duration:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input 
                          type="number" 
                          min="1" 
                          max="60" 
                          value={breakoutDurationMinutes}
                          onChange={(e) => setBreakoutDurationMinutes(parseInt(e.target.value) || 5)}
                          className="premium-input"
                          style={{ width: '60px', height: '28px', fontSize: '0.8rem', textAlign: 'center' }}
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>min</span>
                      </div>
                    </div>

                    <button 
                      onClick={() => handleStartBreakouts(breakoutRoomsCount, breakoutDurationMinutes)}
                      className="premium-btn premium-btn-primary"
                      style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', padding: '0.5rem', marginTop: '0.25rem' }}
                    >
                      Start Breakout Rooms
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-accent)', fontWeight: 600 }}>
                      Breakout Rooms Active
                    </span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', fontFamily: 'monospace' }}>
                      {Math.floor(breakoutTimeRemaining / 60)}:{(breakoutTimeRemaining % 60).toString().padStart(2, '0')}
                    </span>
                    
                    {/* Host Join Room Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Jump to Room:</span>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button 
                          onClick={() => enterBreakoutRoom(null)}
                          style={{
                            padding: '2px 6px',
                            fontSize: '0.7rem',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: breakoutRoom === null ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)',
                            color: breakoutRoom === null ? 'black' : 'white',
                            cursor: 'pointer'
                          }}
                        >
                          Main
                        </button>
                        {Array.from({ length: breakoutRoomsCount }).map((_, idx) => {
                          const rNum = idx + 1;
                          return (
                            <button 
                              key={rNum}
                              onClick={() => enterBreakoutRoom(rNum)}
                              style={{
                                padding: '2px 6px',
                                fontSize: '0.7rem',
                                borderRadius: '4px',
                                border: 'none',
                                backgroundColor: breakoutRoom === rNum ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)',
                                color: breakoutRoom === rNum ? 'black' : 'white',
                                cursor: 'pointer'
                              }}
                            >
                              Room {rNum}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button 
                      onClick={handleEndBreakouts}
                      className="premium-btn"
                      style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', padding: '0.5rem', backgroundColor: '#EF4444', border: 'none', color: 'white', marginTop: '0.5rem' }}
                    >
                      End Breakout Rooms
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {activePanel === 'polls' && (
          <div className="meeting-side-panel" style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            {/* Tab Selector */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1E293B' }}>
              <button 
                onClick={() => setIsQAActive(false)}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: !isQAActive ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  color: !isQAActive ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                📊 Polls
              </button>
              <button 
                onClick={() => setIsQAActive(true)}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: isQAActive ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  color: isQAActive ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                ❓ Q&A Hub
              </button>
            </div>

            {/* Content */}
            {!isQAActive ? (
              <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Host Poll Creator */}
                {isAdmin && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white' }}>CREATE A POLL</span>
                    <input 
                      type="text" 
                      placeholder="Ask a question..."
                      value={newPollQuestion}
                      onChange={(e) => setNewPollQuestion(e.target.value)}
                      className="premium-input"
                      style={{ fontSize: '0.8rem', height: '36px' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {newPollOptions.map((opt, idx) => (
                        <input 
                          key={idx}
                          type="text" 
                          placeholder={`Option ${idx + 1}`}
                          value={opt}
                          onChange={(e) => {
                            const copy = [...newPollOptions];
                            copy[idx] = e.target.value;
                            setNewPollOptions(copy);
                          }}
                          className="premium-input"
                          style={{ fontSize: '0.8rem', height: '32px' }}
                        />
                      ))}
                      <button 
                        onClick={() => setNewPollOptions([...newPollOptions, ''])}
                        style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.75rem', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                      >
                        + Add Option
                      </button>
                    </div>
                    <button 
                      onClick={handleCreatePoll}
                      className="premium-btn premium-btn-primary"
                      style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', height: '36px' }}
                    >
                      Launch Poll
                    </button>
                  </div>
                )}

                {/* Active Polls List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>ACTIVE POLLS</span>
                  {polls.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', display: 'block', padding: '1rem 0' }}>No active polls yet.</span>
                  ) : (
                    polls.map(p => {
                      const totalVotes = p.votes.reduce((a: number, b: number) => a + b, 0);
                      const hasVoted = userVotes[p.id] !== undefined;

                      return (
                        <div key={p.id} style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>{p.question}</span>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {p.options.map((opt: string, idx: number) => {
                              const voteCount = p.votes[idx] || 0;
                              const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
                              const isMyVote = userVotes[p.id] === idx;

                              if (hasVoted) {
                                return (
                                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <div className="flex-between" style={{ fontSize: '0.8rem' }}>
                                      <span style={{ color: isMyVote ? 'var(--color-accent)' : 'white' }}>
                                        {opt} {isMyVote && '✓'}
                                      </span>
                                      <span style={{ color: 'var(--text-muted)' }}>{voteCount} ({percent}%)</span>
                                    </div>
                                    <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                      <div style={{ width: `${percent}%`, height: '100%', backgroundColor: isMyVote ? 'var(--color-accent)' : 'var(--color-primary)', borderRadius: '3px', transition: 'width 0.3s ease' }} />
                                    </div>
                                  </div>
                                );
                              } else {
                                return (
                                  <button 
                                    key={idx}
                                    onClick={() => handleVotePoll(p.id, idx)}
                                    className="premium-btn premium-btn-secondary"
                                    style={{ width: '100%', justifyContent: 'flex-start', fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
                                  >
                                    {opt}
                                  </button>
                                );
                              }
                            })}
                          </div>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total votes: {totalVotes}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>SUBMIT A QUESTION</span>
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitQuestion(newQuestionText);
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
                >
                  <input 
                    type="text" 
                    placeholder="Type your question..."
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    className="premium-input"
                    style={{ fontSize: '0.8rem', height: '36px' }}
                  />
                  <button 
                    type="submit"
                    className="premium-btn premium-btn-primary"
                    style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', height: '36px' }}
                  >
                    Post Question
                  </button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>QUESTIONS ({qaQuestions.length})</span>
                  {qaQuestions.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', display: 'block', padding: '1rem 0' }}>
                      No questions asked yet. Be the first!
                    </span>
                  ) : (
                    [...qaQuestions]
                      .sort((a, b) => b.upvotes - a.upvotes)
                      .map(q => {
                        const userId = currentUser?.id || myKey;
                        const hasUpvoted = q.upvotedBy.includes(userId);
                        return (
                          <div 
                            key={q.id} 
                            style={{ 
                              padding: '0.75rem 1rem', 
                              borderRadius: '8px', 
                              border: '1px solid var(--border-color)', 
                              backgroundColor: 'rgba(255,255,255,0.02)',
                              display: 'flex', 
                              alignItems: 'flex-start',
                              gap: '0.75rem' 
                            }}
                          >
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span style={{ fontSize: '0.8rem', color: 'white', fontWeight: 500 }}>{q.text}</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Asked by {q.author}</span>
                            </div>
                            <button 
                              onClick={() => upvoteQuestion(q.id)}
                              style={{ 
                                display: 'flex', 
                                flexDirection: 'column', 
                                alignItems: 'center', 
                                gap: '2px', 
                                background: 'none', 
                                border: 'none', 
                                color: hasUpvoted ? 'var(--color-accent)' : 'var(--text-muted)',
                                cursor: 'pointer',
                                padding: 0 
                              }}
                            >
                              <span style={{ fontSize: '1rem' }}>▲</span>
                              <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{q.upvotes}</span>
                            </button>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activePanel === 'filters' && (
          <div className="meeting-side-panel" style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sliders size={16} color="var(--color-accent)" />
                <span>AV Enhancements</span>
              </h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* AI Studio Voice Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Mic size={14} color={isAudioEnhanced ? 'var(--color-accent)' : '#64748B'} />
                    STUDIO VOICE
                  </span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isAudioEnhanced}
                      onChange={toggleAudioEnhancement}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isAudioEnhanced ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isAudioEnhanced ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isAudioEnhanced ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                  Studio Voice focuses your voice with a gentle high-pass filter, presence band and soft compression. Echo cancellation, noise suppression and gain control are already on for every microphone.
                </p>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* AI Studio Light Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="flex-between">
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Sparkles size={14} color={isStudioLightEnabled ? 'var(--color-accent)' : '#64748B'} />
                    STUDIO LIGHT
                  </span>
                  <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                    <input 
                      type="checkbox" 
                      checked={isStudioLightEnabled}
                      onChange={toggleStudioLight}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isStudioLightEnabled ? 'var(--color-accent)' : '#1E293B',
                      transition: '0.3s', borderRadius: '20px'
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                        backgroundColor: isStudioLightEnabled ? '#07090E' : 'white',
                        transition: '0.3s', borderRadius: '50%',
                        transform: isStudioLightEnabled ? 'translateX(14px)' : 'none'
                      }} />
                    </span>
                  </label>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                  Brightens your face and adds a warm, professional spotlight glow to counter poor room lighting.
                </p>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

              {/* Camera Filters Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>CAMERA FILTER</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {[
                    { id: 'none', label: 'Normal' },
                    { id: 'blur', label: 'Soft Blur' },
                    { id: 'sepia', label: 'Sepia' },
                    { id: 'grayscale', label: 'B&W' },
                    { id: 'warm', label: 'Warm' },
                    { id: 'cyberpunk', label: 'Cyberpunk' }
                  ].map(f => (
                    <button 
                      key={f.id}
                      onClick={() => changeVideoFilter(f.id)}
                      className="premium-btn"
                      style={{
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        height: '40px',
                        border: videoFilter === f.id ? '1px solid var(--color-accent)' : '1px solid var(--border-color)',
                        backgroundColor: videoFilter === f.id ? 'rgba(250,189,2,0.1)' : 'rgba(255,255,255,0.02)',
                        color: videoFilter === f.id ? 'var(--color-accent)' : 'white'
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                  Soft Blur blurs your whole video — it is not a background blur. A true background blur (you sharp, background blurred) needs a segmentation engine and is planned for Phase 2.
                </p>
              </div>

            </div>
          </div>
        )}

        {activePanel === 'transcript' && (
          <div className="meeting-side-panel" style={{
            width: '320px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Languages size={16} color="var(--color-accent)" />
                <span>Transcript & AI Summary</span>
              </h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            {/* Tab Selector */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1E293B' }}>
              <button 
                onClick={() => setIsSummaryTabActive(false)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: !isSummaryTabActive ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  color: !isSummaryTabActive ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem'
                }}
              >
                🎙️ Captions
              </button>
              <button 
                onClick={() => setIsSummaryTabActive(true)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: isSummaryTabActive ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  color: isSummaryTabActive ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8rem'
                }}
              >
                ✨ AI Copilot
              </button>
            </div>

            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {!isSummaryTabActive ? (
                <>
                  <div className="flex-between" style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'white' }}>Enable Speech Captions</span>
                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
                      <input 
                        type="checkbox" 
                        checked={isCaptionsEnabled}
                        onChange={(e) => setIsCaptionsEnabled(e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: isCaptionsEnabled ? 'var(--color-accent)' : '#1E293B',
                        transition: '0.3s', borderRadius: '20px'
                      }}>
                        <span style={{
                          position: 'absolute', content: '""', height: '14px', width: '14px', left: '3px', bottom: '3px',
                          backgroundColor: isCaptionsEnabled ? '#07090E' : 'white',
                          transition: '0.3s', borderRadius: '50%',
                          transform: isCaptionsEnabled ? 'translateX(14px)' : 'none'
                        }} />
                      </span>
                    </label>
                  </div>

                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>TRANSCRIPT HISTORY</span>
                    
                    {transcripts.length === 0 ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', height: '150px', textAlign: 'center' }}>
                        {isCaptionsEnabled ? 'Listening for speech...' : 'Turn on captions to view live transcription history.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {transcripts.map((t, idx) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div className="flex-between">
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-accent)' }}>{t.name}</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{t.time}</span>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'white', margin: 0, lineHeight: 1.4 }}>{t.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>AI MEETING SUMMARY</span>

                  {isGeneratingSummary ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', height: '200px' }}>
                      <div className="pulse" style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Sparkles size={20} color="black" />
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Analyzing transcript audio...</span>
                    </div>
                  ) : aiSummary ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                      <div style={{
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        padding: '1rem',
                        fontSize: '0.8rem',
                        color: 'white',
                        lineHeight: 1.5,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ color: 'var(--color-accent)', fontWeight: 700, fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                          🌟 GIIN Meet AI Copilot Summary
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <div>📅 <strong>Date:</strong> {new Date().toLocaleDateString()}</div>
                          <div>📊 <strong>ID:</strong> {meetingId}</div>
                        </div>

                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontWeight: 700, color: 'white', marginBottom: '0.35rem' }}>📋 Meeting facts</div>
                          <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <li>Participants in this call: {participants.length + 1}</li>
                            <li>Chat messages sent: {messages.length}</li>
                            <li>Caption lines captured: {transcripts.length}</li>
                            <li>Reactions and polls are shown live in the call, not in this summary.</li>
                          </ul>
                        </div>

                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontWeight: 700, color: 'white', marginBottom: '0.35rem' }}>📝 Notes</div>
                          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {aiSummary}
                          </p>
                        </div>
                      </div>

                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(aiSummary);
                          alert('Summary copied to clipboard!');
                        }}
                        className="premium-btn premium-btn-secondary"
                        style={{ width: '100%', justifyContent: 'center', fontSize: '0.75rem', height: '36px' }}
                      >
                        Copy Summary Text
                      </button>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', height: '200px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>AI summaries are not available yet — no transcription service is connected.</span>
                      <button 
                        onClick={generateAiSummary}
                        className="premium-btn premium-btn-primary"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', height: '36px', gap: '0.4rem', justifyContent: 'center', width: '100%' }}
                      >
                        <Sparkles size={14} />
                        <span>Generate AI Summary</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === 'soundboard' && (
          <div className="meeting-side-panel" style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>React Soundboard</h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>TRIGGER SOUND EFFECTS</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Sounds play for everyone in the room, in real time. Muting only silences them for you.</span>
              <button
                onClick={toggleSoundEffects}
                title={soundEffectsEnabled ? 'Mute hand-raise and soundboard sounds for yourself' : 'Unmute hand-raise and soundboard sounds'}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #1E293B',
                  backgroundColor: soundEffectsEnabled ? 'rgba(255,255,255,0.04)' : 'rgba(239, 68, 68, 0.12)',
                  color: 'white',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                {soundEffectsEnabled ? '🔔 Sounds on — tap to mute' : '🔕 Sounds muted — tap to unmute'}
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[
                  { id: 'applause', label: '👏 Applause' },
                  { id: 'bell', label: '🔔 Bell Chime' },
                  { id: 'horn', label: '🎉 Party Horn' },
                  { id: 'alert', label: '⚠️ Warning' }
                ].map(s => (
                  <button 
                    key={s.id}
                    onClick={() => triggerSoundboard(s.id)}
                    className="premium-btn premium-btn-secondary"
                    style={{
                      justifyContent: 'center',
                      fontSize: '0.8rem',
                      height: '60px',
                      backgroundColor: 'rgba(255,255,255,0.02)'
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activePanel === 'info' && (
          <div className="meeting-side-panel" style={{
            width: '300px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            <div className="flex-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #1E293B' }}>
              <h4 style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>Meeting Credentials</h4>
              <button 
                onClick={() => setActivePanel('none')}
                className="panel-close-btn" aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>MEETING TITLE</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'white' }}>{meetingTitle}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>MEETING ID</span>
                <div className="flex-between" style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                  <code style={{ fontSize: '0.8rem', color: 'var(--color-accent)' }}>{meetingId}</code>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(meetingId);
                      setCopiedInfo('details');
                      setTimeout(() => setCopiedInfo(null), 2000);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer' }}
                  >
                    {copiedInfo === 'details' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>PASSCODE</span>
                <div className="flex-between" style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                  <code style={{ fontSize: '0.8rem', color: 'white', letterSpacing: '0.1em' }}>{passcode}</code>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>INVITATION LINK</span>
                <button
                  onClick={() => {
                    const inviteUrl = buildJoinLink(meetingId, passcode);
                    navigator.clipboard.writeText(inviteUrl);
                    setCopiedInfo('link');
                    setTimeout(() => setCopiedInfo(null), 2000);
                  }}
                  className="premium-btn premium-btn-accent"
                  style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem' }}
                >
                  {copiedInfo === 'link' ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedInfo === 'link' ? 'Copied Link!' : 'Copy Share Link'}</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>INVITE BY EMAIL</span>
                <input
                  type="email"
                  className="premium-input"
                  placeholder="person@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
                />
                <button
                  onClick={() => {
                    if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
                      setInviteNote('Enter a valid email address first.');
                      return;
                    }
                    const link = buildJoinLink(meetingId, passcode);
                    const subject = encodeURIComponent(`Invitation: ${meetingTitle} — GIIN Meet`);
                    const body = encodeURIComponent(`Please join my GIIN Meet video meeting:\nTopic: ${meetingTitle}\nJoin link: ${link}\nMeeting ID: ${meetingId}\nPasscode: ${passcode || 'none - open link'}\n\nMedia encrypted in transit (DTLS-SRTP).`);
                    window.location.href = `mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`;
                    setInviteNote('Your mail app opened with the invitation ready to send. No email is sent automatically — GIIN Meet has no mail provider configured yet.');
                  }}
                  className="premium-btn premium-btn-secondary"
                  style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem' }}
                >
                  <span>Email Invite</span>
                </button>
                {inviteNote && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{inviteNote}</span>}
              </div>
            </div>
          </div>
        )}
        {activePanel === 'workspace' && (
          <div className="meeting-side-panel" style={{
            width: '350px',
            borderLeft: '1px solid #1E293B',
            backgroundColor: 'rgba(11, 15, 25, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slide-in 0.2s ease',
            zIndex: 5
          }}>
            {/* Tab Selector */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1E293B' }}>
              <button 
                onClick={() => setIsWhiteboardActive(false)}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: !isWhiteboardActive ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  color: !isWhiteboardActive ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                📝 Notes
              </button>
              <button 
                onClick={() => setIsWhiteboardActive(true)}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: isWhiteboardActive ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  color: isWhiteboardActive ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem'
                }}
              >
                🎨 Whiteboard
              </button>
            </div>

            {/* Content */}
            {!isWhiteboardActive ? (
              <WorkspacePanel 
                meetingId={meetingId}
                workspaceUsers={participants.map(p => ({ name: p.name, role: p.role }))}
                initialNotes={initialNotes}
                meetingTitle={meetingTitle}
                onSaveWorkspaceData={(notes, itemsCount) => {
                  if (onSaveWorkspaceData) {
                    onSaveWorkspaceData(notes, itemsCount);
                  }
                  setInitialNotes(notes);
                  setActivePanel('none');
                }}
                onClose={() => setActivePanel('none')}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'white' }}>COLLABORATIVE CANVAS</span>
                  <button 
                    onClick={() => clearWhiteboard(true)}
                    className="premium-btn premium-btn-secondary"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', height: '26px' }}
                  >
                    Clear
                  </button>
                </div>

                {/* Whiteboard Tool Picker */}
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', borderBottom: '1px dashed var(--border-color)', paddingBottom: '0.5rem' }}>
                  {[
                    { id: 'pen', label: '✏️ Pen' },
                    { id: 'line', label: '📏 Line' },
                    { id: 'rect', label: '⬛ Rect' },
                    { id: 'circle', label: '⭕ Circle' },
                    { id: 'sticky', label: '📌 Note' }
                  ].map(tool => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => setWhiteboardTool(tool.id as any)}
                      style={{
                        padding: '0.25rem 0.45rem',
                        fontSize: '0.7rem',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: whiteboardTool === tool.id ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)',
                        color: 'white',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>

                <div style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  backgroundColor: '#0F172A',
                  position: 'relative',
                  aspectRatio: '8/5'
                }}>
                  <canvas 
                    ref={whiteboardCanvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      cursor: 'crosshair'
                    }}
                  />

                  {/* Render sticky notes */}
                  {stickyNotes.map(note => (
                    <div
                      key={note.id}
                      style={{
                        position: 'absolute',
                        left: `${note.x}%`,
                        top: `${note.y}%`,
                        backgroundColor: note.color,
                        padding: '0.35rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(0,0,0,0.2)',
                        boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                        width: '85px',
                        minHeight: '45px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}
                    >
                      <textarea
                        value={note.text}
                        onChange={(e) => {
                          const text = e.target.value;
                          setStickyNotes(prev => prev.map(n => n.id === note.id ? { ...n, text } : n));
                          if (sigChannelRef.current) {
                            sigChannelRef.current.send({
                              type: 'broadcast',
                              event: 'sticky-update',
                              payload: { id: note.id, text }
                            });
                          }
                        }}
                        style={{
                          width: '100%',
                          height: '25px',
                          background: 'none',
                          border: 'none',
                          resize: 'none',
                          outline: 'none',
                          fontSize: '0.65rem',
                          color: '#000000',
                          fontWeight: 600,
                          lineHeight: 1.1,
                          padding: 0
                        }}
                      />
                      <button
                        onClick={() => {
                          setStickyNotes(prev => prev.filter(n => n.id !== note.id));
                          if (sigChannelRef.current) {
                            sigChannelRef.current.send({
                              type: 'broadcast',
                              event: 'sticky-delete',
                              payload: { id: note.id }
                            });
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#EF4444',
                          fontSize: '0.55rem',
                          cursor: 'pointer',
                          marginLeft: 'auto',
                          padding: 0,
                          fontWeight: 'bold'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>

                {/* Drawing Controls */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Color:</span>
                  <input 
                    type="color" 
                    value={whiteboardColor}
                    onChange={(e) => setWhiteboardColor(e.target.value)}
                    style={{ border: 'none', width: '28px', height: '28px', borderRadius: '4px', cursor: 'pointer', background: 'none' }}
                  />
                  
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Size:</span>
                  <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    value={whiteboardWidth}
                    onChange={(e) => setWhiteboardWidth(parseInt(e.target.value))}
                    style={{ width: '80px', cursor: 'pointer' }}
                  />
                </div>

                <button 
                  onClick={downloadWhiteboard}
                  className="premium-btn premium-btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 'auto', fontSize: '0.8rem', height: '36px' }}
                >
                  Download Sketch (PNG)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fix Round 8 (#3): a failed screen share stays visible, not a
          4-second toast that can be missed — with a one-tap retry. */}
      {screenShareError && (
        <div role="alert" style={{ margin: '0 1rem', padding: '0.6rem 0.9rem', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.45)', borderRadius: '8px', color: '#FCA5A5', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: '200px' }}>{screenShareError}</span>
          <button type="button" onClick={() => { setScreenShareError(null); void handleToggleScreenShare(); }} style={{ padding: '0.4rem 0.9rem', minHeight: '44px', borderRadius: '6px', border: 'none', backgroundColor: '#EF4444', color: 'white', fontWeight: 700, cursor: 'pointer' }}>Try again</button>
          <button type="button" onClick={() => setScreenShareError(null)} className="panel-close-btn" aria-label="Dismiss">&times;</button>
        </div>
      )}

      {/* Toolbar / Controls */}
      {isDirectCall ? (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          maxWidth: 'calc(100vw - 32px)',
          justifyContent: 'center',
          gap: '1rem',
          padding: '0.75rem 1.5rem',
          borderRadius: '40px',
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          zIndex: 100,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
          transition: 'all 0.3s ease'
        }}>
          {/* Mute Audio */}
          <button 
            onClick={toggleMute}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: isMuted ? '#EF4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(4px)'
            }}
            title={isMuted ? "Unmute Mic (M)" : "Mute Mic (M)"}
          >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Toggle Video */}
          <button 
            onClick={toggleVideo}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: !isVideoOn ? '#EF4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(4px)'
            }}
            title={isVideoOn ? "Turn Camera Off (V)" : "Turn Camera On (V)"}
          >
            {isVideoOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>{isVideoOn ? 'Cam Off' : 'Cam On'}</span>
          </button>

          {/* Toggle Screen Share */}
          <button 
            onClick={handleToggleScreenShare}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: isScreenSharing ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: isScreenSharing ? 'black' : 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Share Screen (S)"
          >
            <Monitor size={18} />
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>{screenShareStarting ? 'Starting…' : isScreenSharing ? 'Stop Share' : 'Share'}</span>
          </button>

          {/* Speakers — one-tap feedback breaker (Fix Round 8 #4) */}
          <button
            onClick={() => setIsSpeakersMuted(!isSpeakersMuted)}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: isSpeakersMuted ? '#EF4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title={isSpeakersMuted ? 'Unmute speakers' : 'Mute speakers (stops echo / feedback)'}
          >
            {isSpeakersMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>{isSpeakersMuted ? 'Unmute' : 'Speakers'}</span>
          </button>

          {/* Record (local, on this device) */}
          <button
            onClick={() => { if (isRecording) stopRecording(); else startRecording(); }}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: isRecording ? '#EF4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(4px)'
            }}
            title={isRecording ? 'Stop recording (saves to this device)' : 'Record your camera and mic on this device'}
          >
            <span style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: isRecording ? 'white' : '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: isRecording ? '2px' : '50%', backgroundColor: isRecording ? '#EF4444' : 'white' }} />
            </span>
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>{isRecording ? formatElapsedTime(recordingSeconds) : 'Record'}</span>
          </button>

          {/* Picture-in-Picture Popout Button */}
          <button 
            onClick={handleTogglePictureInPicture}
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Pop out Floating Video (Picture-in-Picture)"
          >
            <Maximize2 size={20} />
          </button>

          {/* Toggle Chat Panel */}
          <button 
            onClick={() => {
              if (activePanel === 'chat') {
                setActivePanel('none');
              } else {
                setActivePanel('chat');
                setUnreadChatCount(0);
              }
            }}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: activePanel === 'chat' ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}
            title="Chat (C)"
          >
            <MessageSquare size={18} />
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>Chat</span>
            {unreadChatCount > 0 && activePanel !== 'chat' && (
              <span style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                minWidth: '20px',
                height: '20px',
                padding: '0 5px',
                borderRadius: '10px',
                backgroundColor: '#EF4444',
                color: 'white',
                fontSize: '0.7rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid #0B0F19',
                animation: 'pulse-red 1.5s ease-out infinite'
              }}>
                {unreadChatCount > 9 ? '9+' : unreadChatCount}
              </span>
            )}
          </button>

          {/* Toggle Workspace notes Panel */}
          <button 
            onClick={() => setActivePanel(activePanel === 'workspace' ? 'none' : 'workspace')}
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: activePanel === 'workspace' ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Workspace Notes"
          >
            <Edit2 size={20} />
          </button>

          {/* Layout: Grid / Speaker (spotlight follows the pinned person, else the speaker) */}
          <button 
            onClick={() => setLayoutMode(layoutMode === 'grid' ? 'speaker' : 'grid')}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              backgroundColor: layoutMode === 'speaker' ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title={layoutMode === 'grid' ? 'Switch to Speaker view (spotlight on the speaker)' : 'Switch to Grid view'}
          >
            {layoutMode === 'grid' ? <LayoutGrid size={18} /> : <LayoutList size={18} />}
            <span style={{ fontSize: '0.55rem', fontWeight: 600 }}>{layoutMode === 'grid' ? 'Speaker' : 'Grid'}</span>
          </button>

          {/* End Call / Hang Up */}
          <button 
            onClick={handleLeaveOrEnd}
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: '#EF4444',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 8px 20px rgba(239, 68, 68, 0.4)'
            }}
            title="End Call"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      ) : (
        <div className="meeting-toolbar" style={{ position: 'relative' }}>
          {/* Left Side details */}
          <div className="meeting-toolbar-left" style={{ gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: </span>
            <span style={{ color: 'white', fontWeight: 600, fontSize: '0.85rem' }}>{meetingId.slice(0, 8)}</span>
            {connectionQuality !== 'unknown' && (
              <span title={`Connection quality: ${connectionQuality}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: connectionQuality === 'excellent' ? '#10B981' : connectionQuality === 'good' ? '#84CC16' : connectionQuality === 'poor' ? '#F59E0B' : '#EF4444' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: connectionQuality === 'excellent' ? '#10B981' : connectionQuality === 'good' ? '#84CC16' : connectionQuality === 'poor' ? '#F59E0B' : '#EF4444' }} />
                {connectionQuality === 'excellent' ? 'Excellent' : connectionQuality === 'good' ? 'Good' : connectionQuality === 'poor' ? 'Poor' : 'Lost'}
              </span>
            )}
            {/* Fix Round 8 (Evidence 1): the room retries the video
                server on its own while on a direct connection, but the
                host can also force one retry from here. */}
            {engineType === 'P2P' && isAdmin && (
              <button
                onClick={handleRetryLiveKit}
                className="premium-btn premium-btn-secondary"
                style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem', borderRadius: '6px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="The room is on a direct connection because the video server could not be reached. Try the video server again."
              >
                Retry video
              </button>
            )}
            <button 
              onClick={() => setShowMeetingInfo(!showMeetingInfo)}
              className="premium-btn premium-btn-secondary" 
              style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem', borderRadius: '6px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="View meeting info and share"
            >
              Share
            </button>
            {/* Meeting timer */}
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginLeft: '0.5rem',
                color: 'white',
                fontSize: '0.85rem',
                fontWeight: 600,
                fontFamily: 'monospace'
              }}
              title="Time in this meeting"
            >
              <Clock size={14} color="var(--color-accent)" />
              {formatElapsedTime(elapsedSeconds)}
            </span>
            {isRecording && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '999px', backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#FCA5A5', fontSize: '0.8rem', fontWeight: 700 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
                REC {formatElapsedTime(recordingSeconds)} - on this device
              </span>
            )}
            {/* Connection quality (round-trip latency, measured every 8s) */}
            {(() => {
              const latencies = Object.values(peerStates)
                .map(p => p.latency)
                .filter((l): l is number => typeof l === 'number');
              if (latencies.length === 0) return null;
              const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
              const color = avg < 150 ? '#10B981' : avg < 400 ? 'var(--color-accent)' : '#EF4444';
              return (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    marginLeft: '0.5rem',
                    color,
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    fontFamily: 'monospace'
                  }}
                  title="Average connection latency to other participants"
                >
                  {avg} ms
                </span>
              );
            })()}
          </div>

          {/* Center Controls */}
          <div className="meeting-toolbar-center" style={{ gap: '0.75rem', position: 'relative' }}>
            {/* Mute Audio */}
            <button 
              className="toolbar-control-btn"
              onClick={toggleMute}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isMuted ? '#EF4444' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title={isMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {/* Stop Video */}
            <button 
              className="toolbar-control-btn"
              onClick={toggleVideo}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: !isVideoOn ? '#EF4444' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title={isVideoOn ? "Turn Camera Off" : "Turn Camera On"}
            >
              {isVideoOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
            </button>

            {/* Screen Share */}
            <button 
              className="toolbar-control-btn"
              onClick={handleToggleScreenShare}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isScreenSharing ? 'var(--color-accent)' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isScreenSharing ? 'black' : 'white',
                cursor: (isScreenShareBlockedForGuests && !isAdmin) ? 'not-allowed' : 'pointer',
                transition: 'all var(--transition-fast)',
                opacity: (isScreenShareBlockedForGuests && !isAdmin) ? 0.5 : 1
              }}
              title={isScreenShareBlockedForGuests && !isAdmin ? "Screen Sharing Blocked by Host" : "Toggle Screenshare"}
            >
              <Monitor size={18} />
            </button>

            {/* Speakers — one-tap feedback breaker (Fix Round 8 #4) */}
            <button
              className="toolbar-control-btn"
              onClick={() => setIsSpeakersMuted(!isSpeakersMuted)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isSpeakersMuted ? '#EF4444' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title={isSpeakersMuted ? 'Unmute speakers' : 'Mute speakers (stops echo / feedback)'}
            >
              {isSpeakersMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>

            {/* Device Settings Toggle */}
            <button 
              className="toolbar-control-btn"
              onClick={() => setIsDeviceModalOpen(true)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isDeviceModalOpen ? 'var(--color-primary)' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title="Device Settings"
            >
              <Settings size={18} />
            </button>

            {/* Full Screen Toggle */}
            <button 
              className="toolbar-control-btn"
              onClick={toggleFullscreen}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: isFullscreen ? 'var(--color-primary)' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>

            {/* Hand Raise / Lower */}
            <div style={{ position: 'relative' }}>
              <button 
                className="toolbar-control-btn"
                onClick={() => {
                  if (localHandRaised) {
                    toggleHandRaise();
                  } else {
                    setShowHandRaiseMenu(!showHandRaiseMenu);
                  }
                }}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: localHandRaised ? 'var(--color-accent)' : '#1E293B',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: localHandRaised ? 'black' : 'white',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
                title={localHandRaised ? `Lower Hand (Reason: ${handRaiseReason || 'None'})` : "Raise Hand"}
              >
                <Hand size={18} />
              </button>
              
              {/* Tap outside the sheet to close it (mobile) */}
            {showHandRaiseMenu && window.innerWidth < 768 && (
              <div
                aria-hidden="true"
                onClick={() => setShowHandRaiseMenu(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
              />
            )}
            {showHandRaiseMenu && (
                <div 
                  className="hand-raise-menu-container"
                  style={{
                    position: window.innerWidth < 768 ? 'fixed' : 'absolute',
                    bottom: window.innerWidth < 768 ? 'calc(65px + env(safe-area-inset-bottom))' : '55px',
                    left: window.innerWidth < 768 ? '0' : '50%',
                    right: window.innerWidth < 768 ? '0' : 'auto',
                    transform: window.innerWidth < 768 ? 'none' : 'translateX(-50%)',
                    width: window.innerWidth < 768 ? '100%' : '320px',
                    backgroundColor: 'rgba(15, 23, 42, 0.98)',
                    border: window.innerWidth < 768 ? 'none' : '1px solid #1E293B',
                    borderTop: window.innerWidth < 768 ? '1px solid #1E293B' : '1px solid #1E293B',
                    borderRadius: window.innerWidth < 768 ? '20px 20px 0 0' : '12px',
                    padding: window.innerWidth < 768 ? '1rem 1rem calc(1.25rem + env(safe-area-inset-bottom))' : '1.5rem',
                    maxHeight: window.innerWidth < 768 ? 'calc(100dvh - 170px)' : 'calc(100dvh - 80px)',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    zIndex: 10000,
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                    backdropFilter: 'blur(20px)',
                    animation: window.innerWidth < 768 ? 'slide-up 0.3s ease-out' : 'pop-in 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                  }}
                >
                  {window.innerWidth < 768 && (
                    <div style={{ width: '40px', height: '4px', backgroundColor: '#475569', borderRadius: '2px', margin: '0 auto', flexShrink: 0 }} />
                  )}
                  
                  <div className="flex-between" style={{ marginBottom: '0.25rem', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-heading)' }}>
                      Raise Hand
                    </span>
                    <button 
                      onClick={() => setShowHandRaiseMenu(false)}
                      className="panel-close-btn" aria-label="Close raise hand menu"
                    >
                      &times;
                    </button>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gridAutoRows: '1fr',
                    alignItems: 'stretch',
                    flexShrink: 0,
                    gap: '0.75rem',
                    width: '100%'
                  }}>
                    {[
                      { label: '🙋 Question', value: 'Question', desc: 'Ask a question', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
                      { label: '💬 Comment', value: 'Comment', desc: 'Share a thought', color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
                      { label: '💡 Idea', value: 'Idea', desc: 'Suggest an idea', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
                      { label: '🚨 Urgent', value: 'Urgent', desc: 'Interrupt host', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' }
                    ].map(r => (
                      <button
                        key={r.value}
                        onClick={() => toggleHandRaise(r.label)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 0,
                          height: '100%',
                          minHeight: '104px',
                          flexShrink: 0,
                          alignItems: 'flex-start',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: `1px solid rgba(255, 255, 255, 0.05)`,
                          backgroundColor: r.bg,
                          cursor: 'pointer',
                          textAlign: 'left',
                          overflowWrap: 'break-word',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.03)';
                          e.currentTarget.style.borderColor = r.color;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                        }}
                      >
                        <span style={{ fontSize: '1.25rem', lineHeight: 1, height: '28px', display: 'flex', alignItems: 'center', marginBottom: '0.25rem', flexShrink: 0 }}>{r.label.split(' ')[0]}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', lineHeight: 1.25, overflowWrap: 'break-word' }}>{r.label.split(' ')[1]}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.35, overflowWrap: 'break-word' }}>{r.desc}</span>
                      </button>
                    ))}
                  </div>

                  <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: '0.25rem 0', flexShrink: 0 }} />

                  <button
                    onClick={() => toggleHandRaise()}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: '1px dashed var(--color-accent)',
                      background: 'rgba(250, 189, 2, 0.05)',
                      color: 'var(--color-accent)',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                  >
                    ✋ Just Raise Hand
                  </button>
                </div>
              )}
            </div>

            {/* Annotate Screen */}
            {isScreenSharing && (
              <button 
                className="toolbar-control-btn"
                onClick={() => setIsAnnotating(!isAnnotating)}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: isAnnotating ? 'var(--color-primary)' : '#1E293B',
                  border: isAnnotating ? '1px solid var(--color-accent)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isAnnotating ? 'var(--color-accent)' : 'white',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
                title="Draw Annotations"
              >
                <Edit2 size={18} />
              </button>
            )}

            {/* More Options Dropdown Toggle */}
            <button 
              className="toolbar-control-btn"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: showMoreMenu ? 'rgba(255, 255, 255, 0.15)' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title="More Options"
            >
              <MoreHorizontal size={18} />
            </button>

            {/* Emoji Reactions Trigger */}
            <div style={{ position: 'relative' }}>
              <button 
                className="toolbar-control-btn"
                onClick={() => setShowEmojiReactions(!showEmojiReactions)}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: showEmojiReactions ? 'rgba(255, 255, 255, 0.15)' : '#1E293B',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
                title="Send Reaction"
              >
                <Smile size={18} />
              </button>

              {showEmojiReactions && (
                <div style={{
                  position: 'fixed',
                  bottom: '85px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  gap: '12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.98)',
                  padding: '10px 16px',
                  borderRadius: '30px',
                  border: '1px solid #1E293B',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                  zIndex: 9999,
                  backdropFilter: 'blur(10px)'
                }}>
                  {['👏', '👍', '❤️', '😂', '😮'].map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => sendReaction(emoji)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease',
                        padding: 0,
                        width: '44px',
                        height: '44px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.25)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Floating More Options Menu */}
            {showMoreMenu && (
              <>
                <div 
                  onClick={() => setShowMoreMenu(false)} 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 14000 }}
                />
                <div style={{
                  position: window.innerWidth < 768 ? 'fixed' : 'absolute',
                  bottom: window.innerWidth < 768 ? 'calc(77px + env(safe-area-inset-bottom))' : '55px',
                  left: window.innerWidth < 768 ? '16px' : '50%',
                  right: window.innerWidth < 768 ? '16px' : 'auto',
                  transform: window.innerWidth < 768 ? 'none' : 'translateX(-50%)',
                  width: window.innerWidth < 768 ? 'calc(100% - 32px)' : '240px',
                  backgroundColor: 'rgba(15, 23, 42, 0.98)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                  zIndex: 15000,
                  maxHeight: window.innerWidth < 768 ? 'calc(100dvh - 170px)' : 'none',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                  animation: 'pop-in 0.2s ease'
                }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '0.35rem 0.85rem 0.1rem' }}>MEETING</div>
                  {/* Meeting Info */}
                  <button 
                    onClick={() => {
                      setActivePanel(activePanel === 'info' ? 'none' : 'info');
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: activePanel === 'info' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Info size={16} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>Meeting Info</span>
                  </button>

                  {/* Workspace / Notes */}
                  <button 
                    onClick={() => {
                      setActivePanel(activePanel === 'workspace' ? 'none' : 'workspace');
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: activePanel === 'workspace' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Edit2 size={16} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>Workspace Notes</span>
                  </button>

                  <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '0.35rem 0.85rem 0.1rem', borderTop: '1px solid #1E293B', marginTop: '0.35rem', paddingTop: '0.6rem' }}>ENGAGE</div>
                  {/* Interactive Polls */}
                  <button 
                    onClick={() => {
                      setActivePanel(activePanel === 'polls' ? 'none' : 'polls');
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: activePanel === 'polls' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <BarChart3 size={16} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>Interactive Polls</span>
                  </button>

                  {/* Live Captions */}
                  <button 
                    onClick={() => {
                      setActivePanel(activePanel === 'transcript' ? 'none' : 'transcript');
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: activePanel === 'transcript' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Languages size={16} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>Live Captions</span>
                  </button>

                  <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '0.35rem 0.85rem 0.1rem', borderTop: '1px solid #1E293B', marginTop: '0.35rem', paddingTop: '0.6rem' }}>MEDIA</div>
                  {/* Camera Filters */}
                  <button 
                    onClick={() => {
                      setActivePanel(activePanel === 'filters' ? 'none' : 'filters');
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: activePanel === 'filters' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Sliders size={16} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>AV Enhancements</span>
                  </button>

                  {/* React Soundboard */}
                  <button 
                    onClick={() => {
                      setActivePanel(activePanel === 'soundboard' ? 'none' : 'soundboard');
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: activePanel === 'soundboard' ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Volume2 size={16} style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>Soundboard Reacts</span>
                  </button>

                  {/* Host Controls (if Admin) */}
                  {isAdmin && (
                    <button 
                      onClick={() => {
                        setActivePanel(activePanel === 'host-settings' ? 'none' : 'host-settings');
                        setShowMoreMenu(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        backgroundColor: activePanel === 'host-settings' ? 'rgba(255,255,255,0.1)' : 'transparent',
                        border: 'none',
                        borderTop: '1px solid #1E293B',
                        marginTop: '0.35rem',
                        padding: '0.6rem 0.85rem',
                      width: '100%',
                      minHeight: '44px',
                      flexShrink: 0,
                        borderRadius: '6px',
                        color: 'white',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <Settings size={16} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>Host Controls</span>
                    </button>
                  )}

                  {/* Keyboard Shortcuts */}
                  <div style={{ borderTop: '1px solid #1E293B', marginTop: '0.25rem', paddingTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', padding: '0 0.85rem' }}>KEYBOARD SHORTCUTS</span>
                    {[
                      { key: 'M', action: 'Mute / unmute mic' },
                      { key: 'V', action: 'Camera on / off' },
                      { key: 'S', action: 'Share / stop sharing screen' },
                      { key: 'H', action: 'Raise / lower hand' },
                      { key: 'C', action: 'Open / close chat' }
                    ].map(s => (
                      <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.15rem 0.85rem', fontSize: '0.8rem', color: 'white' }}>
                        <kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid #1E293B', borderRadius: '4px', padding: '1px 6px', fontSize: '0.7rem', fontFamily: 'monospace', minWidth: '22px', textAlign: 'center' }}>{s.key}</kbd>
                        <span>{s.action}</span>
                      </div>
                    ))}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '0.15rem 0.85rem' }}>Shortcuts are ignored while typing. Leaving the meeting is click-only, by design.</span>
                  </div>

                </div>
              </>
            )}
          </div>

          {/* Right Side Options & Leave */}
          <div className="meeting-toolbar-right" style={{ gap: '0.5rem' }}>
            <button 
              onClick={() => setActivePanel(activePanel === 'participants' ? 'none' : 'participants')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: activePanel === 'participants' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
                border: '1px solid #1E293B',
                padding: '0.45rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                color: activePanel === 'participants' ? 'var(--color-accent)' : 'white',
                fontSize: '0.8rem',
                cursor: 'pointer',
                height: '36px'
              }}
            >
              <Users size={16} />
              <span className="hide-mobile-text">Participants</span>
            </button>

            <button 
              onClick={() => setActivePanel(activePanel === 'chat' ? 'none' : 'chat')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: activePanel === 'chat' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
                border: '1px solid #1E293B',
                padding: '0.45rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                color: activePanel === 'chat' ? 'var(--color-accent)' : 'white',
                fontSize: '0.8rem',
                cursor: 'pointer',
                height: '36px'
              }}
            >
              <MessageSquare size={16} />
              <span className="hide-mobile-text">Chat</span>
            </button>

            <button 
              onClick={handleLeaveOrEnd}
              className="premium-btn premium-btn-danger"
              style={{
                padding: '0.45rem 1rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontWeight: 600,
                gap: '0.35rem',
                backgroundColor: '#EF4444',
                height: '36px'
              }}
            >
              <PhoneOff size={16} />
              <span className="hide-mobile-text">{isAdmin ? 'End for All' : 'Leave Call'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Leave Meeting Modal for Admin */}
      {showLeaveModal && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(5, 7, 12, 0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(16px)',
          transition: 'all 0.3s ease'
        }}>
          <div className="glass-panel" style={{
            width: '460px',
            padding: '2.25rem',
            backgroundColor: '#090D16',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.75rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            animation: 'pop-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            position: 'relative'
          }}>
            {/* Close Icon Button */}
            <button
              onClick={() => {
                setShowLeaveModal(false);
                setLeaveOption(null);
                setSelectedNewAdminId('');
              }}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                width: '44px',
                height: '44px',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                backgroundColor: 'rgba(255, 255, 255, 0.02)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
              }}
            >
              <X size={18} />
            </button>

            <div>
              <h3 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em' }}>
                Exit Boardroom
              </h3>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                As the meeting host, you must choose how to exit. You cannot leave the meeting orphaned while other participants are present.
              </p>
            </div>

            {/* Options List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* Option 1: Transfer Host & Leave */}
              <div 
                onClick={() => setLeaveOption('transfer')}
                style={{
                  cursor: 'pointer',
                  padding: '1.25rem',
                  borderRadius: '12px',
                  border: leaveOption === 'transfer' ? '2px solid var(--color-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: leaveOption === 'transfer' ? 'rgba(99, 102, 241, 0.06)' : 'rgba(255, 255, 255, 0.01)',
                  boxShadow: leaveOption === 'transfer' ? '0 0 20px rgba(99, 102, 241, 0.15)' : 'none',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem'
                }}
                onMouseEnter={(e) => {
                  if (leaveOption !== 'transfer') {
                    e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (leaveOption !== 'transfer') {
                    e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.01)';
                  }
                }}
              >
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <div style={{
                    padding: '0.65rem',
                    borderRadius: '8px',
                    backgroundColor: leaveOption === 'transfer' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    color: leaveOption === 'transfer' ? 'var(--color-accent)' : 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.25s ease'
                  }}>
                    <UserCheck size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'white', marginBottom: '0.2rem' }}>
                      Transfer Host & Leave
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                      Designate an active participant to take over as the host. The meeting will continue without you.
                    </div>
                  </div>
                </div>

                {/* Participant Dropdown (rendered inline if selected) */}
                {leaveOption === 'transfer' && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    style={{ 
                      marginTop: '0.5rem', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '0.5rem',
                      animation: 'slide-down 0.2s ease'
                    }}
                  >
                    <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Select New Host
                    </label>
                    <select
                      value={selectedNewAdminId}
                      onChange={(e) => setSelectedNewAdminId(e.target.value)}
                      className="premium-input"
                      style={{
                        width: '100%',
                        height: '40px',
                        backgroundColor: '#07090E',
                        color: 'white',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '8px',
                        padding: '0 0.75rem',
                        fontSize: '0.85rem',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">-- Choose from active participants --</option>
                      {participants.filter(p => !!p.userId).map(p => (
                        <option key={p.id} value={p.userId}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {participants.length > 0 && participants.filter(p => !!p.userId).length === 0 && (
                      <div style={{ fontSize: '0.8rem', color: '#FCA5A5', lineHeight: 1.4 }}>
                        Nobody signed in to take over yet — guests who joined without signing in cannot become host.
                      </div>
                    )}
                    {participants.some(p => !p.userId) && participants.filter(p => !!p.userId).length > 0 && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        Guests who joined without signing in cannot become host — only signed-in participants are listed.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Option 2: End Meeting for All */}
              <div 
                onClick={() => {
                  setLeaveOption('end');
                  setSelectedNewAdminId('');
                }}
                style={{
                  cursor: 'pointer',
                  padding: '1.25rem',
                  borderRadius: '12px',
                  border: leaveOption === 'end' ? '2px solid #EF4444' : '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: leaveOption === 'end' ? 'rgba(239, 68, 68, 0.06)' : 'rgba(255, 255, 255, 0.01)',
                  boxShadow: leaveOption === 'end' ? '0 0 20px rgba(239, 68, 68, 0.15)' : 'none',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'flex-start'
                }}
                onMouseEnter={(e) => {
                  if (leaveOption !== 'end') {
                    e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (leaveOption !== 'end') {
                    e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.01)';
                  }
                }}
              >
                <div style={{
                  padding: '0.65rem',
                  borderRadius: '8px',
                  backgroundColor: leaveOption === 'end' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                  color: leaveOption === 'end' ? '#EF4444' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.25s ease'
                }}>
                  <LogOut size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'white', marginBottom: '0.2rem' }}>
                    End Meeting for All
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                    Terminate the boardroom call immediately. All participants will be disconnected.
                  </div>
                </div>
              </div>

            </div>

            {/* Actions Footer */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
              {endError && (
                <div style={{ fontSize: '0.85rem', color: '#FCA5A5', backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: '8px', padding: '0.6rem 0.75rem', lineHeight: 1.4 }}>
                  {endError}
                </div>
              )}
              {leaveOption === 'transfer' && (
                <button
                  onClick={handleTransferAndLeave}
                  disabled={!selectedNewAdminId || endingInProgress}
                  className="premium-btn premium-btn-primary"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    height: '44px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                    opacity: selectedNewAdminId ? 1 : 0.5,
                    cursor: selectedNewAdminId ? 'pointer' : 'not-allowed',
                    boxShadow: selectedNewAdminId ? '0 4px 12px rgba(99, 102, 241, 0.2)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {endingInProgress ? 'Transferring...' : 'Confirm Transfer & Exit'}
                </button>
              )}

              {leaveOption === 'end' && (
                <button
                  onClick={handleEndForAll}
                  disabled={endingInProgress}
                  className="premium-btn premium-btn-danger"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    height: '44px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                    backgroundColor: '#EF4444',
                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {endingInProgress ? 'Ending meeting...' : 'End Meeting for All'}
                </button>
              )}

              {leaveOption === null && (
                <button
                  disabled
                  className="premium-btn premium-btn-secondary"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    height: '44px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                    opacity: 0.5,
                    cursor: 'not-allowed',
                    border: '1px solid rgba(255,255,255,0.05)',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                    color: 'rgba(255,255,255,0.4)'
                  }}
                >
                  Select an Option Above
                </button>
              )}

              <button
                onClick={() => {
                  setShowLeaveModal(false);
                  setLeaveOption(null);
                  setSelectedNewAdminId('');
                }}
                style={{
                  width: '100%',
                  height: '40px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                Go Back to Meeting
              </button>
            </div>

          </div>
        </div>
      )}

      <DeviceSettingsModal
        isOpen={isDeviceModalOpen}
        onClose={() => setIsDeviceModalOpen(false)}
        selectedCamera={selectedCamera}
        selectedMic={selectedMic}
        selectedSpeaker={selectedSpeaker}
        onCameraChange={changeCamera}
        onMicChange={changeMicrophone}
        onSpeakerChange={changeSpeaker}
      />

      {connectionNotice && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxWidth: '480px',
          width: 'calc(100% - 32px)',
          padding: '1.25rem 1.5rem',
          backgroundColor: '#0F172A',
          border: '1px solid #334155',
          borderRadius: 'var(--radius-md)',
          color: 'white',
          fontSize: '0.9rem',
          lineHeight: 1.5,
          zIndex: 9999,
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ flex: 1 }}>{connectionNotice}</span>
            <button
              onClick={() => setConnectionNotice(null)}
              style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
          {engineType === 'P2P' && (
            <button
              onClick={handleRetryLiveKit}
              style={{ marginTop: '1rem', backgroundColor: 'var(--color-accent)', color: 'black', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
              title="Try connecting to the video server again with a fresh token"
            >
              Retry video server
            </button>
          )}
        </div>
      )}

      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          maxWidth: '360px',
          pointerEvents: 'none',
          padding: '0.75rem 1.5rem',
          backgroundColor: '#1E293B',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          color: 'white',
          fontSize: '0.85rem',
          zIndex: 9999,
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          animation: 'fadeInUp 0.2s ease-out'
        }}>
          <Sparkles size={16} color="var(--color-primary)" />
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, marginLeft: 'auto', pointerEvents: 'auto', flexShrink: 0 }}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
};
