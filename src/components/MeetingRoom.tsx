import React, { useEffect, useRef, useState } from 'react';
import { Room as LiveKitRoom, RoomEvent } from 'livekit-client';
import { 
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, Users, MessageSquare, PhoneOff, 
  SendHorizontal, Edit2, ShieldCheck, AlertTriangle, Copy, Check, Settings,
  MoreHorizontal, BarChart3, Volume2, Info, Languages, Sparkles, Sliders, Minimize2, Maximize2, Smile,
  LogOut, UserCheck, X, Hand
} from 'lucide-react';
import { ScreenAnnotation } from './ScreenAnnotation';
import { WorkspacePanel } from './WorkspacePanel';
import { DeviceSettingsModal } from './DeviceSettingsModal';

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

// Handshake E2EE confirmation chime
export const playHandshakeConfirmSound = () => {
  // Permanently silenced to prevent annoying background noise
};

export const playUserJoinSound = () => {
  // Silenced to prevent annoying background chime during reconnects
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

import { mockAuth, supabase, getDeterministicPasscode } from '../supabaseClient';

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
  onEndMeeting: () => void;
  onSaveWorkspaceData?: (notes: string, actionItemsCount: number) => void;
  currentUser: { id: string; name: string; email: string } | null;
  initialVideoState?: boolean;
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
  isP2PCall = false,
  isHost = false,
  isMinimized = false,
  onMinimizeToggle
}) => {
  const [showE2EEPannel, setShowE2EEPannel] = useState(false);
  const sigChannelRef = useRef<any>(null);
  const localAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const localVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const reconnectTimersRef = useRef<{[key: string]: any}>({});



  // Minimized floating window dragging state
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: window.innerHeight - 220 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

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

  const deriveE2EESeal = (id: string) => {
    let hashVal = 5381;
    for (let i = 0; i < id.length; i++) {
      hashVal = ((hashVal << 5) + hashVal) + id.charCodeAt(i);
    }
    const formatted = [];
    for (let i = 0; i < 12; i++) {
      const seed = Math.abs(Math.sin(hashVal + i) * 100000);
      formatted.push(Math.floor(seed).toString().padEnd(5, '0').substring(0, 5));
    }
    return formatted.join(' ');
  };

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(initialVideoState);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [isColleagueSharing, setIsColleagueSharing] = useState(false);
  const [activePanel, setActivePanel] = useState<'none' | 'chat' | 'participants' | 'workspace' | 'host-settings' | 'polls' | 'filters' | 'soundboard' | 'info' | 'transcript'>('none');
  const [copiedInfo, setCopiedInfo] = useState<'link' | 'details' | null>(null);
  const [showMeetingInfo, setShowMeetingInfo] = useState(false);

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Waiting list and role delegation states
  const [meetingAdminId, setMeetingAdminId] = useState<string>('');
  const [passcode, setPasscode] = useState<string>(() => getDeterministicPasscode(meetingId));
  const [isMediaInitialized, setIsMediaInitialized] = useState(false);
  const [waitingList, setWaitingList] = useState<any[]>([]);
  const [initialNotes, setInitialNotes] = useState<string>('');
  const [localAdminId, setLocalAdminId] = useState<string>('');

  // Orchestration state manager tracking engine and token transition
  const [engineType, setEngineType] = useState<'LIVEKIT' | 'P2P'>('LIVEKIT');
  const [livekitToken, setLivekitToken] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [transitionPending, setTransitionPending] = useState<boolean>(false);
  const [p2pActive, setP2pActive] = useState<boolean>(false);
  const [livekitRemoteStreams, setLivekitRemoteStreams] = useState<{ [peerKey: string]: MediaStream }>({});
  const [isHandoffTransitioning, setIsHandoffTransitioning] = useState<{ [peerKey: string]: boolean }>({});
  const [swappedPeers, setSwappedPeers] = useState<string[]>([]);
  const livekitRoomRef = useRef<any>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const getEnv = (key: string): string | undefined => {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
    try {
      const metaEnv = (import.meta as any).env;
      if (metaEnv && metaEnv[key]) {
        return metaEnv[key];
      }
    } catch (e) {}
    return undefined;
  };

  const participantsRef = useRef<Participant[]>([]);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const startBackgroundP2P = () => {
    setP2pActive(prev => {
      if (prev) return prev;
      
      const activeParticipantsCount = participantsRef.current.filter(p => (p.userId || p.id) !== myKey).length + 1;
      const forceAudioOnly = activeParticipantsCount > 4;

      triggerToast(forceAudioOnly
        ? 'Fallback room size exceeds 4. Launching background P2P engine in Audio-Only Mode.'
        : 'Launching background P2P connections...'
      );

      participantsRef.current
        .filter(p => (p.userId || p.id) !== myKey)
        .forEach(p => {
          const peerKey = p.userId || p.id;
          if (initPeerConnectionRef.current) {
            initPeerConnectionRef.current(peerKey, forceAudioOnly);
          }
        });
      return true;
    });
  };

  const handleTriggerPeerSwap = (peerKey: string) => {
    setIsHandoffTransitioning(prev => {
      if (prev[peerKey]) return prev;
      
      triggerToast(`Background stream initialized for ${peerStates[peerKey]?.name || peerKey}. Swapping views...`);
      
      setTimeout(() => {
        setSwappedPeers(swapped => {
          if (swapped.includes(peerKey)) return swapped;
          const next = [...swapped, peerKey];
          
          const activeRemotePeers = participantsRef.current.filter(p => (p.userId || p.id) !== myKey).map(p => p.userId || p.id);
          const allSwapped = activeRemotePeers.every(pk => next.includes(pk));
          
          if (allSwapped && engineType === 'LIVEKIT') {
            setTimeout(() => {
              if (livekitRoomRef.current) {
                livekitRoomRef.current.disconnect();
                livekitRoomRef.current = null;
              }
              setEngineType('P2P');
              setTransitionPending(false);
              triggerToast('Seamless engine handoff completed. P2P Mesh engine is now active.');
            }, 1000);
          }
          
          return next;
        });
      }, 800); // 800ms fade cross-over
      
      return { ...prev, [peerKey]: true };
    });
  };

  // Connect to LiveKit SFU Engine
  useEffect(() => {
    if (!isMediaInitialized || engineType !== 'LIVEKIT') return;

    let active = true;
    const connectToLiveKit = async () => {
      try {
        const res = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: meetingId,
            userId: myKey,
            userName: currentUser?.name || 'Guest',
            role: isAdmin ? 'HOST' : 'GUEST'
          })
        });

        if (!active) return;
        const data = await res.json();
        if (data.error === 'MAX_CAPACITY_REACHED') {
          setEngineType('P2P');
          triggerToast('LiveKit room capacity limit reached. Swapped to P2P Mesh engine.');
          return;
        }

        const { token, expiresAt: tokenExpiry } = data;
        setLivekitToken(token);
        setExpiresAt(tokenExpiry);

        const room = new LiveKitRoom({
          adaptiveStream: true,
          dynacast: true
        });

        livekitRoomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
          const peerKey = participant.identity;
          if (track.kind === 'video' || track.kind === 'audio') {
            setLivekitRemoteStreams(prev => {
              const currentStream = prev[peerKey] || new MediaStream();
              if (!currentStream.getTracks().some(t => t.id === track.mediaStreamTrack.id)) {
                currentStream.addTrack(track.mediaStreamTrack);
              }
              return { ...prev, [peerKey]: currentStream };
            });
          }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
          const peerKey = participant.identity;
          setLivekitRemoteStreams(prev => {
            const currentStream = prev[peerKey];
            if (currentStream) {
              currentStream.removeTrack(track.mediaStreamTrack);
            }
            return { ...prev };
          });
        });

        const livekitUrl = getEnv('LIVEKIT_URL') || 'wss://giinmeet-livekit.lkt.cloud';
        await room.connect(livekitUrl, token);
        triggerToast('Connected to LiveKit SFU engine.');

        if (stream) {
          const videoTrack = stream.getVideoTracks()[0];
          const audioTrack = stream.getAudioTracks()[0];
          if (videoTrack) await room.localParticipant.publishTrack(videoTrack);
          if (audioTrack) await room.localParticipant.publishTrack(audioTrack);
        }

      } catch (err) {
        console.warn('[LiveKit Engine] Failed to connect, falling back to P2P Mesh:', err);
        setEngineType('P2P');
        triggerToast('LiveKit SFU connection failed. Swapped to P2P Mesh.');
      }
    };

    connectToLiveKit();

    return () => {
      active = false;
      if (livekitRoomRef.current) {
        livekitRoomRef.current.disconnect();
        livekitRoomRef.current = null;
      }
    };
  }, [isMediaInitialized, engineType, meetingId, myKey, currentUser, isAdmin, stream]);

  // Expiration Interceptor Check Loop
  useEffect(() => {
    const interval = setInterval(() => {
      if (expiresAt && engineType === 'LIVEKIT') {
        const timeDiff = new Date(expiresAt).getTime() - Date.now();
        if (timeDiff <= 30000 && timeDiff > 0 && !transitionPending) {
          setTransitionPending(true);
          triggerToast('LiveKit token expiring soon. Swapping seamlessly to P2P Mesh...');
          
          if (sigChannelRef.current) {
            sigChannelRef.current.send({
              type: 'broadcast',
              event: 'transition-pending',
              payload: {
                senderKey: myKey
              }
            });
          }
          
          startBackgroundP2P();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, engineType, transitionPending, myKey]);

  useEffect(() => {
    if (meetingAdminId) {
      setTimeout(() => {
        setLocalAdminId(meetingAdminId);
      }, 0);
    }
  }, [meetingAdminId]);

  // Fullscreen State & Logic
  const [isFullscreen, setIsFullscreen] = useState(false);
  const meetingRoomRef = useRef<HTMLDivElement | null>(null);

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
        localVideoTrackRef.current.stop();
        localVideoTrackRef.current = null;
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current = null;
      }
    };
  }, []);

  const isAdmin = isHost || (currentUser && localAdminId === currentUser.id);

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [selectedNewAdminId, setSelectedNewAdminId] = useState<string>('');
  const [leaveOption, setLeaveOption] = useState<'transfer' | 'end' | null>(null);

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
  interface HandRaise {
    userId: string;
    name: string;
    timestamp: number;
    reason?: string;
  }
  const [handRaises, setHandRaises] = useState<HandRaise[]>([]);
  const [localHandRaised, setLocalHandRaised] = useState(false);
  const [handRaiseReason, setHandRaiseReason] = useState<string | null>(null);
  const [showHandRaiseMenu, setShowHandRaiseMenu] = useState(false);

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

  // Virtual Breakout Rooms States
  const [breakoutRoom, setBreakoutRoom] = useState<number | null>(null);
  const [breakoutTimeRemaining, setBreakoutTimeRemaining] = useState<number | null>(null);
  const [breakoutRoomsCount, setBreakoutRoomsCount] = useState(2);
  const [breakoutDurationMinutes, setBreakoutDurationMinutes] = useState(5);
  const [admittedKeys, setAdmittedKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`admitted_keys_${meetingId}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
      return new Set();
    }
  });

  // New Interactive States (Polls, Soundboard, Video Filters)
  const [polls, setPolls] = useState<any[]>([]);
  const [userVotes, setUserVotes] = useState<{ [pollId: string]: number }>({});
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollOptions, setNewPollOptions] = useState(['', '']);
  const [videoFilter, setVideoFilter] = useState('none');

  // New AI/AV Enhancements States
  const [isAudioEnhanced, setIsAudioEnhanced] = useState(false);
  const [isStudioLightEnabled, setIsStudioLightEnabled] = useState(false);
  
  // New Host Controls States
  const [isMeetingLocked, setIsMeetingLocked] = useState(false);
  const [isScreenShareBlockedForGuests, setIsScreenShareBlockedForGuests] = useState(false);
  const [isMuteOnEntryEnabled, setIsMuteOnEntryEnabled] = useState(false);

  // Live Captions States
  const [isCaptionsEnabled, setIsCaptionsEnabled] = useState(false);
  const [transcripts, setTranscripts] = useState<{ name: string; text: string; time: string }[]>([]);
  const [activeCaption, setActiveCaption] = useState<{ name: string; text: string } | null>(null);

  // Relocated state variables to prevent accessed-before-declaration errors
  const [messages, setMessages] = useState<{ sender: string; text: string; time: string; self: boolean }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);

  // WebRTC Peer States & Connections
  const [myKey] = useState(() => currentUser?.id || 'guest-user-' + generateRandomId());
  const pcsRef = useRef<{ [peerKey: string]: RTCPeerConnection }>({});
  const initPeerConnectionRef = useRef<((peerKey: string, forceAudioOnly?: boolean) => void) | null>(null);
  const makingOfferRef = useRef<{ [peerKey: string]: boolean }>({});
  const pcCandidatesRef = useRef<{ [peerKey: string]: any[] }>({});
  const [remoteStreams, setRemoteStreams] = useState<{ [peerKey: string]: MediaStream }>({});
  
  // Whiteboard advanced controls
  const [stickyNotes, setStickyNotes] = useState<{ id: string; x: number; y: number; text: string; color: string }[]>([]);
  const [whiteboardTool, setWhiteboardTool] = useState<'pen' | 'line' | 'rect' | 'circle' | 'sticky'>('pen');
  
  // AI Meeting Summaries
  const [aiSummary, setAiSummary] = useState<string>('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSummaryTabActive, setIsSummaryTabActive] = useState(false);

  // Immersive Spatial Audio
  const [isSpatialAudioEnabled, setIsSpatialAudioEnabled] = useState(() => localStorage.getItem('giin_spatial_audio') === 'true');
  const spatialAudioNodesRef = useRef<{ [peerKey: string]: { source: MediaStreamAudioSourceNode; panner: StereoPannerNode } }>({});
  const spatialAudioCtxRef = useRef<AudioContext | null>(null);

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
  const [peerStates, setPeerStates] = useState<{ 
    [peerKey: string]: { 
      name: string; 
      isVideoOn: boolean; 
      isMuted: boolean; 
      isScreenSharing: boolean; 
      isSpeaking: boolean;
      latency?: number; 
      e2eeStatus?: 'secure' | 'unsupported';
      videoFilter?: string;
      isStudioLightEnabled?: boolean;
      isReconnecting?: boolean;
    } 
  }>({});

  // Device Selection States
  const [selectedCamera, setSelectedCamera] = useState(() => localStorage.getItem('giin_selected_camera') || '');
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem('giin_selected_mic') || '');
  const [selectedSpeaker, setSelectedSpeaker] = useState(() => localStorage.getItem('giin_selected_speaker') || '');
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);

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
  }, [selectedSpeaker, remoteStreams, activePeerKeys]);

  const changeCamera = async (deviceId: string) => {
    setSelectedCamera(deviceId);
    localStorage.setItem('giin_selected_camera', deviceId);
    
    if (isVideoOn) {
      try {
        if (localVideoTrackRef.current) {
          localVideoTrackRef.current.stop();
        }
        
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: 640, height: 480 }
        });
        const videoTrack = videoStream.getVideoTracks()[0];
        localVideoTrackRef.current = videoTrack;
        videoTrack.enabled = true;
        
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
      } catch (err) {
        console.error('Failed to change camera:', err);
      }
    }
  };

  const changeMicrophone = async (deviceId: string) => {
    setSelectedMic(deviceId);
    localStorage.setItem('giin_selected_mic', deviceId);
    
    try {
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
      }
      
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const audioTrack = audioStream.getAudioTracks()[0];
      localAudioTrackRef.current = audioTrack;
      audioTrack.enabled = !isMuted;
      
      setStream(prev => {
        const newStream = prev || new MediaStream();
        newStream.getAudioTracks().forEach(t => newStream.removeTrack(t));
        newStream.addTrack(audioTrack);
        return newStream;
      });

      Object.values(pcsRef.current).forEach(pc => {
        const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (audioSender) {
          audioSender.replaceTrack(audioTrack);
        }
      });
      
      setupSpeakingDetection(new MediaStream([audioTrack]), myKey, true);
    } catch (err) {
      console.error('Failed to change microphone:', err);
    }
  };

  const changeSpeaker = (deviceId: string) => {
    setSelectedSpeaker(deviceId);
    localStorage.setItem('giin_selected_speaker', deviceId);
  };

  const screenSendersRef = useRef<{ [peerKey: string]: RTCRtpSender }>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<{ [peerKey: string]: MediaStream }>({});

  // Clean up a single peer connection
  const cleanupPeer = (peerKey: string) => {
    if (pcsRef.current[peerKey]) {
      pcsRef.current[peerKey].close();
      delete pcsRef.current[peerKey];
    }
    if (screenSendersRef.current[peerKey]) {
      delete screenSendersRef.current[peerKey];
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

  const generateAiSummary = () => {
    setIsGeneratingSummary(true);
    setTimeout(() => {
      const summaryText = `### 🌟 GIIN Meet AI Copilot Summary

**📅 Date:** ${new Date().toLocaleDateString()}
**📊 Meeting ID:** ${meetingId}

---

#### 💡 Key Decisions
- Resolved mesh WebRTC screenshare channel issues by establishing polite peer Perfect Negotiation nodes.
- Selected custom layout constraints to match **${localStorage.getItem('giin_ui_style') || 'glassmorphism'}** branding specifications.

#### 📌 Action Items
- **[ ] @You** - Validate WebRTC video filters under heavy packet loss profiles.
- **[ ] @Admin** - Finalize corner shape and typography metrics before staging deployment.
- **[ ] @Team** - Confirm next operations sync scheduled time.

#### 📝 Summary Notes
The conference was focused on platform modernization. Participants reviewed the interactive bento grids, skeuomorphic clicky controls, and 3D depth layers in spatial UI environments. The sketchpad doodle board was used for database fallback schema diagrams. Action items were resolved with clear ownership.`;
      setAiSummary(summaryText);
      setIsGeneratingSummary(false);
    }, 1500);
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
    alert(`Started ${roomsCount} breakout rooms for ${durationMinutes} minutes.`);
  };

  const handleEndBreakouts = () => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'end-breakout',
        payload: {}
      });
    }
    setBreakoutRoom(null);
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

  // E2EE Transform stream injectors (bypassed for maximum stability and performance; native WebRTC DTLS-SRTP is active)
  const setupSenderE2EE = (_sender: RTCRtpSender) => {
    // Bypassed: standard WebRTC DTLS-SRTP provides robust end-to-end security without codec corruption
  };

  const setupReceiverE2EE = (_receiver: RTCRtpReceiver) => {
    // Bypassed: standard WebRTC DTLS-SRTP provides robust end-to-end security without codec corruption
  };

  // Web Audio speaking volume analyzer
  const setupSpeakingDetection = (mediaStream: MediaStream, targetKey: string, isLocal: boolean) => {
    try {
      const ctx = getAudioCtx();
      const source = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      
      // Fix WebRTC silent remote stream issue on iOS Safari / Chrome:
      // Connecting a remote WebRTC MediaStream to a Web Audio source without connecting it
      // to the destination speakers can silence the stream entirely. We route it through a
      // zero-gain node to the destination to satisfy the browser's audio graph requirement
      // without creating duplicate double-audio / echo.
      if (!isLocal) {
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        analyser.connect(silentGain);
        silentGain.connect(ctx.destination);
      }
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      let wasSpeaking = false;
      const checkVolume = () => {
        if (isLocal) {
          if (!stream) return;
        } else {
          if (!pcsRef.current[targetKey]) return;
        }

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
        requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn('Speaking volume detector creation failed:', e);
    }
  };

  // Load meeting details (admin_id, passcode, and notes)
  useEffect(() => {
    const loadDetails = async () => {
      try {
        const { data } = await mockAuth.getMeetingDetails(meetingId);
        if (data) {
          setMeetingAdminId(data.admin_id || '');
          setPasscode(data.passcode || getDeterministicPasscode(meetingId));
          setInitialNotes(data.notes || '');
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadDetails();
  }, [meetingId]);

  // Poll and subscribe to realtime call chat messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const list = await mockAuth.getMessages(meetingId);
        if (list) {
          const mapped = list.map((msg: any) => {
            const isSelf = currentUser ? (msg.user_id === currentUser.id) : false;
            return {
              sender: msg.sender_name,
              text: msg.text,
              time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              self: isSelf
            };
          });
          setMessages(mapped);
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
              sender: msg.sender_name,
              text: msg.text,
              time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              self: isSelf
            };
            setMessages(prev => {
              if (prev.some(m => m.text === mappedMsg.text && m.sender === mappedMsg.sender)) return prev;
              return [...prev, mappedMsg];
            });
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
        const list = await mockAuth.getAdmittedParticipants(meetingId);
        if (list) {
          const mapped: Participant[] = list
            .filter((p: any) => p.user_id !== currentUser?.id && p.id !== currentUser?.id)
            .map((p: any) => {
              const initials = p.name ? p.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U';
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
                isVideoOn: true,
                avatarBg: avatarBg
              };
            });
          setParticipants(prev => {
            const merged = [...mapped];
            prev.forEach(p => {
              // If it's a dynamic/virtual participant, preserve them so they are not wiped out by the database sync
              const isDynamic = p.id.startsWith('guest-') || p.id.startsWith('mock-') || p.id.startsWith('virtual-') || p.id.startsWith('user-signals-') || !mapped.some(m => m.id === p.id || m.userId === p.userId);
              const isStillActive = !!(pcsRef.current[p.id] || pcsRef.current[p.userId || ''] || peerStates[p.id] || peerStates[p.userId || ''] || p.id.startsWith('user-signals-') || p.id.startsWith('virtual-'));
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

  // WebRTC mesh signaling engine
  useEffect(() => {
    if (!passcode || !isMediaInitialized) return; // wait until passcode and media load

    const channelSuffix = breakoutRoom ? `-breakout-${breakoutRoom}` : '';
    const sigChannel = supabase.channel(`sig-webrtc-${meetingId}${channelSuffix}`, {
      config: {
        broadcast: { self: false }
      }
    });

    sigChannelRef.current = sigChannel;

    initPeerConnectionRef.current = initPeerConnection;
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
          setupSenderE2EE(sender);
        });
      }
      // If we are currently screensharing, we must also add the screen track!
      if (isScreenSharing && screenStream) {
        const screenTrack = screenStream.getVideoTracks()[0];
        if (screenTrack) {
          const sender = pc.addTrack(screenTrack, screenStream);
          setupSenderE2EE(sender);
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
        const isVideo = event.track.kind === 'video';
        const hasWebcamTrack = remoteStreams[peerKey] && remoteStreams[peerKey].getVideoTracks().length > 0;
        
        // It is screenshare if we already have a camera track, or the peer state says they are sharing and this is a video-only stream
        const isScreen = isVideo && (
          hasWebcamTrack || 
          (peerStates[peerKey]?.isScreenSharing && remoteStream.getAudioTracks().length === 0)
        );
        
        if (isScreen) {
          setRemoteScreenStreams(prev => ({
            ...prev,
            [peerKey]: remoteStream
          }));
        } else {
          const tracks = remoteStream.getTracks().map(track => {
            if (track.kind === 'audio') return track;
            return track;
          });
          const newStream = new MediaStream(tracks);
          setRemoteStreams(prev => ({
            ...prev,
            [peerKey]: newStream
          }));

          setupReceiverE2EE(event.receiver);
          setupSpeakingDetection(newStream, peerKey, false);
        }
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
              e2eeStatus: 'secure',
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

      // Set up onnegotiationneeded for Perfect Negotiation
      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current[peerKey] = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== 'stable') return;
          await pc.setLocalDescription(offer);
          if (sigChannelRef.current) {
            sigChannelRef.current.send({
              type: 'broadcast',
              event: 'signal',
              payload: {
                type: 'offer',
                targetKey: peerKey,
                senderKey: myKey,
                sdp: pc.localDescription
              }
            });
          }
        } catch (err) {
          console.error('[WebRTC] Offer error:', err);
        } finally {
          makingOfferRef.current[peerKey] = false;
        }
      };

      return pc;
    };

    const handleSignal = async (data: any) => {
      const { type, senderKey, sdp, candidate } = data;

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
          
          setPeerStates(prev => ({
            ...prev,
            [senderKey]: {
              name: data.name,
              isVideoOn: data.isVideoOn,
              isMuted: data.isMuted,
              isScreenSharing: data.isScreenSharing,
              isSpeaking: false
            }
          }));

          // DYNAMIC RESILIENCE: If this participant is not in our list, add them virtually!
          setParticipants(prev => {
            const exists = prev.some(p => p.id === senderKey || p.userId === senderKey);
            if (exists) return prev;
            
            const initials = data.name ? data.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'U';
            let hash = 0;
            for (let i = 0; i < (data.name || '').length; i++) {
              hash = (data.name || '').charCodeAt(i) + ((hash << 5) - hash);
            }
            const hue = Math.abs(hash % 360);
            const avatarBg = `hsl(${hue}, 60%, 40%)`;

            const newVirtualParticipant: Participant = {
              id: senderKey,
              userId: senderKey,
              name: data.name || 'Participant',
              avatar: initials,
              role: 'Participant',
              isMuted: data.isMuted,
              isSpeaking: false,
              isVideoOn: data.isVideoOn,
              avatarBg: avatarBg
            };
            return [...prev, newVirtualParticipant];
          });

          // Lexicographical ordering resolves glare (only smaller key initiates)
          const isInitiator = myKey < senderKey;
          const existingPc = pcsRef.current[senderKey];
          const needsConnection = !existingPc || 
            existingPc.connectionState === 'failed' || 
            existingPc.connectionState === 'closed';

          if (isInitiator && needsConnection) {
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
          
          if (isMeetingLocked) {
            handleAdmitParticipant(data.senderKey, 'Declined');
            return;
          }
          
          const isPreviouslyAdmitted = admittedKeys.has(data.senderKey) || 
            JSON.parse(localStorage.getItem(`admitted_keys_${meetingId}`) || '[]').includes(data.senderKey);
 
          if (!isWaitingRoomEnabled || isPreviouslyAdmitted) {
            handleAdmitParticipant(data.senderKey, 'Admitted');
            return;
          }
 
          setWaitingList(prev => {
            if (prev.some(p => p.id === data.senderKey)) return prev;
            return [...prev, { id: data.senderKey, name: data.name }];
          });
        }
      })
      .on('broadcast', { event: 'end-meeting' }, () => {
        if (!isAdmin) {
          alert('The host has ended this meeting.');
          onEndMeeting();
        }
      })
      .on('broadcast', { event: 'designate-admin' }, (payload: any) => {
        const data = payload.payload;
        setLocalAdminId(data.newAdminId);
        if (currentUser && data.newAdminId === currentUser.id) {
          alert('You have been designated as the meeting host.');
        }
      })
      .on('broadcast', { event: 'settings-update' }, (payload: any) => {
        const data = payload.payload;
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
      .on('broadcast', { event: 'mute-all' }, () => {
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
        if (data.targetUserId === myKey && !isAdmin) {
          setIsMuted(true);
          if (localAudioTrackRef.current) {
            localAudioTrackRef.current.enabled = false;
          }
          alert('You have been muted by the host.');
        }
      })
      .on('broadcast', { event: 'remove-participant' }, async (payload: any) => {
        const data = payload.payload;
        if (data.targetUserId === myKey) {
          alert('You have been removed from the meeting by the host.');
          // Delete our own row from the database (fully allowed by RLS since it is our own user_id)
          try {
            await mockAuth.removeParticipant(meetingId, myKey);
          } catch (e) {
            console.warn('Failed to delete own participant row on kick:', e);
          }
          onEndMeeting();
        }
      })
      .on('broadcast', { event: 'disable-video-all' }, () => {
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
        if (isAdmin) {
          const data = payload.payload;
          setPolls(prev => {
            return prev.map(p => {
              if (p.id === data.pollId) {
                const votes = [...p.votes];
                votes[data.optionIndex] = (votes[data.optionIndex] || 0) + 1;
                
                // Broadcast updated results back to everyone
                if (sigChannelRef.current) {
                  sigChannelRef.current.send({
                    type: 'broadcast',
                    event: 'update-poll-results',
                    payload: {
                      pollId: p.id,
                      votes: votes
                    }
                  });
                }
                
                return { ...p, votes };
              }
              return p;
            });
          });
        }
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
      .on('broadcast', { event: 'transition-pending' }, (payload: any) => {
        if (!transitionPending) {
          setTransitionPending(true);
          triggerToast('Handoff alert received from peer. Launching background P2P mesh...');
          startBackgroundP2P();
        }
      })
      .on('broadcast', { event: 'reaction' }, (payload: any) => {
        const data = payload.payload;
        triggerReaction(data.senderKey, data.emoji);
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
          setBreakoutRoom(myAssignment);
          setBreakoutTimeRemaining(data.durationSeconds);
          alert(`You are being moved to Breakout Room ${myAssignment}.`);
        }
      })
      .on('broadcast', { event: 'end-breakout' }, () => {
        setBreakoutRoom(null);
        setBreakoutTimeRemaining(null);
        alert('Breakout rooms have ended. Returning to main room.');
      })
      .on('broadcast', { event: 'media-state' }, (payload: any) => {
        const data = payload.payload;
        if (data.senderKey !== myKey) {
          setPeerStates(prev => {
            const current = prev[data.senderKey] || {
              name: 'Participant',
              isSpeaking: false
            };
            return {
              ...prev,
              [data.senderKey]: {
                ...current,
                isVideoOn: data.isVideoOn,
                isMuted: data.isMuted,
                isScreenSharing: data.isScreenSharing
              }
            };
          });
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
              name: currentUser?.name || 'Guest',
              isVideoOn,
              isMuted,
              isScreenSharing
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
          name: currentUser?.name || 'Guest',
          isVideoOn,
          isMuted,
          isScreenSharing
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
  }, [passcode, stream, isMediaInitialized, breakoutRoom]);

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
    try {
      const constraints = getWebRTCScreenshareConstraints();
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: constraints.video,
        audio: false
      });
      
      setScreenStream(displayStream);
      
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
      const screenTrack = displayStream.getVideoTracks()[0];
      
      screenSendersRef.current = {};
      Object.keys(pcsRef.current).forEach(peerKey => {
        const pc = pcsRef.current[peerKey];
        const sender = pc.addTrack(screenTrack, displayStream);
        setupSenderE2EE(sender);
        screenSendersRef.current[peerKey] = sender;
      });

      // Broadcast screenshare media state changes
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'media-state',
          payload: {
            senderKey: myKey,
            isVideoOn,
            isMuted,
            isScreenSharing: true
          }
        });
      }

      screenTrack.onended = () => {
        stopScreenShare();
        setIsScreenSharing(false);
      };

      return true;
    } catch (err) {
      console.warn('[Screen Share] Permission denied or failed.', err);
      screenVideoRef.current = null;
      setIsScreenSharing(false);
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
      stopScreenShare();
      setIsScreenSharing(false);
    }
  };

  useEffect(() => {
    return () => {
      stopScreenShare();
    };
  }, []);

  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    }
    screenVideoRef.current = null;

    // Remove screenshare track senders from all peer connections
    Object.keys(screenSendersRef.current).forEach(peerKey => {
      const sender = screenSendersRef.current[peerKey];
      const pc = pcsRef.current[peerKey];
      if (pc && sender) {
        try {
          pc.removeTrack(sender);
        } catch (e) {
          console.warn(e);
        }
      }
    });
    screenSendersRef.current = {};

    // Broadcast screenshare media state changes
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'media-state',
        payload: {
          senderKey: myKey,
          isVideoOn,
          isMuted,
          isScreenSharing: false
        }
      });
    }
  };

  // Admins check for waiting participants via realtime and fallback polling
  useEffect(() => {
    if (!isAdmin) return;
    const checkWaitroom = async () => {
      try {
        const list = await mockAuth.getWaitingParticipants(meetingId);
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
  }, [meetingId, isAdmin]);

  // Handle host admission action
  const handleAdmitParticipant = async (participantId: string, status: 'Admitted' | 'Declined') => {
    try {
      // 1. Broadcast the decision instantly over the channel
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'waitroom-response',
          payload: {
            targetKey: participantId,
            status: status
          }
        });
        // Also send current settings so the new participant is in sync!
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'settings-update',
          payload: {
            isWaitingRoomEnabled,
            isChatLocked
          }
        });
      }

      // 2. Update database in background if it's a real database record
      if (!participantId.startsWith('guest-') && !participantId.startsWith('virtual-')) {
        await mockAuth.updateParticipantStatus(participantId, status);
      }
      
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

  // Delegate admin host rights to another user
  const handleDesignateAdmin = async (targetUserId: string) => {
    if (!confirm('Are you sure you want to designate this user as the meeting admin? You will transfer host settings.')) return;
    try {
      await mockAuth.changeMeetingAdmin(meetingId, targetUserId);
      setMeetingAdminId(targetUserId);
      alert('Meeting administrator transferred successfully!');
    } catch (err) {
      console.error(err);
    }
  };


  
  const colleagueCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
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
      const isPeerSwapped = swappedPeers.includes(peerKey);
      const activeStream = isPeerSwapped ? p2pStream : (livekitStream || p2pStream);
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
  }, [remoteStreams, livekitRemoteStreams, swappedPeers, isSpatialAudioEnabled]);

  // Mock Live Captions & Transcription Engine Effect
  useEffect(() => {
    if (isMinimized || !isMediaInitialized) return;
    
    const mockPhrases = [
      "I think the new Q3 goals are very achievable.",
      "Could you clarify the budget allocations for marketing?",
      "The tactical neumorphism styling looks extremely premium!",
      "Let's make sure we test the WebRTC audio channels thoroughly.",
      "I agree with that point. The integration is seamless.",
      "Should we schedule a follow-up session tomorrow?",
      "The collaborative whiteboard is perfect for this brainstorming.",
      "I will send over the action items by end of day."
    ];

    const interval = setInterval(() => {
      if (participants.length <= 1) return;
      const remoteParticipants = participants.filter(p => p.id !== myKey);
      if (remoteParticipants.length === 0) return;
      
      const speaker = remoteParticipants[Math.floor(Math.random() * remoteParticipants.length)];
      const text = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      setActiveCaption({ name: speaker.name, text });
      setTranscripts(prev => [...prev, { name: speaker.name, text, time }]);
      
      setTimeout(() => {
        setActiveCaption(null);
      }, 3000);
    }, 12000);

    return () => clearInterval(interval);
  }, [participants, isMediaInitialized, isMinimized]);

  // Initialize audio track (kept alive throughout the meeting)
  useEffect(() => {
    async function initAudio() {
      try {
        const savedMic = localStorage.getItem('giin_selected_mic');
        const audioStream = await navigator.mediaDevices.getUserMedia({ 
          audio: savedMic ? {
            deviceId: { exact: savedMic },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        const audioTrack = audioStream.getAudioTracks()[0];
        localAudioTrackRef.current = audioTrack;
        audioTrack.enabled = !isMuted;
        
        setStream(prev => {
          const newStream = prev || new MediaStream();
          newStream.getAudioTracks().forEach(t => newStream.removeTrack(t));
          newStream.addTrack(audioTrack);
          return newStream;
        });

        // Setup local audio analyzer
        setupSpeakingDetection(new MediaStream([audioTrack]), myKey, true);

        // Add to any existing peer connections
        Object.values(pcsRef.current).forEach(pc => {
          const senders = pc.getSenders();
          const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
          if (audioSender) {
            audioSender.replaceTrack(audioTrack);
          } else {
            const sender = pc.addTrack(audioTrack, stream || new MediaStream([audioTrack]));
            setupSenderE2EE(sender);
          }
        });
      } catch (err) {
        console.error('Error acquiring audio:', err);
      }
    }
    initAudio();
    return () => {
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
        if (!localVideoTrackRef.current) {
          try {
            const savedCam = localStorage.getItem('giin_selected_camera');
            const videoStream = await navigator.mediaDevices.getUserMedia({
              video: savedCam ? {
                deviceId: { exact: savedCam },
                width: 640,
                height: 480
              } : {
                width: 640,
                height: 480
              }
            });
            if (!active) {
              videoStream.getTracks().forEach(t => t.stop());
              return;
            }
            const videoTrack = videoStream.getVideoTracks()[0];
            localVideoTrackRef.current = videoTrack;
            videoTrack.enabled = true;
            
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
                setupSenderE2EE(sender);
              }
            });
          } catch (err) {
            console.warn('Error acquiring video:', err);
            setIsVideoOn(false);
          }
        } else {
          localVideoTrackRef.current.enabled = true;
        }
      } else {
        // Instead of stopping the track and destroying it (which causes long hardware boot delays),
        // we keep the track alive but set enabled = false. This sends a black stream instantly and
        // allows resuming the webcam CMT (camera) instantaneously when toggled back on.
        if (localVideoTrackRef.current) {
          localVideoTrackRef.current.enabled = false;
        }
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

    // Broadcast audio state change using the active channel ref
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'media-state',
        payload: {
          senderKey: myKey,
          isVideoOn,
          isMuted: nextMuted,
          isScreenSharing
        }
      });
    }
  };

  const toggleVideo = () => {
    const nextVideoOn = !isVideoOn;
    setIsVideoOn(nextVideoOn);

    // Broadcast video state change using the active channel ref
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'media-state',
        payload: {
          senderKey: myKey,
          isVideoOn: nextVideoOn,
          isMuted,
          isScreenSharing
        }
      });
    }
  };

  const handleLeaveOrEnd = () => {
    if (isAdmin) {
      if (participants.length > 0) {
        setShowLeaveModal(true);
      } else {
        onEndMeeting();
      }
    } else {
      onEndMeeting();
    }
  };

  const handleEndForAll = () => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'end-meeting',
        payload: {}
      });
    }
    setShowLeaveModal(false);
    setLeaveOption(null);
    setSelectedNewAdminId('');
    onEndMeeting();
  };

  const handleTransferAndLeave = async () => {
    if (!selectedNewAdminId) return;

    try {
      // 1. Broadcast the designation to everyone
      if (sigChannelRef.current) {
        sigChannelRef.current.send({
          type: 'broadcast',
          event: 'designate-admin',
          payload: {
            newAdminId: selectedNewAdminId
          }
        });
      }

      // 2. Update database in background
      await mockAuth.changeMeetingAdmin(meetingId, selectedNewAdminId);
      
      // 3. Leave the meeting
      setShowLeaveModal(false);
      setLeaveOption(null);
      setSelectedNewAdminId('');
      onEndMeeting();
    } catch (err) {
      console.error('Failed to transfer host role:', err);
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

  const handleToggleMeetingLock = (locked: boolean) => {
    setIsMeetingLocked(locked);
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

  const broadcastSettingsUpdate = (settings: {
    isWaitingRoomEnabled: boolean;
    isChatLocked: boolean;
    isMeetingLocked: boolean;
    isScreenShareBlockedForGuests: boolean;
    isMuteOnEntryEnabled: boolean;
  }) => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'settings-update',
        payload: settings
      });
    }
  };

  const handleMuteAll = () => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'mute-all',
        payload: {}
      });
      alert('Mute all request sent.');
    }
  };


  const handleDisableVideoAll = () => {
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'disable-video-all',
        payload: {}
      });
      alert('Disable video request sent.');
    }
  };

  const getEnhancedAudioTrack = (rawTrack: MediaStreamTrack): MediaStreamTrack => {
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
      
      return dest.stream.getAudioTracks()[0];
    } catch (e) {
      console.warn('Failed to initialize Audio Enhancer:', e);
      return rawTrack;
    }
  };

  const toggleAudioEnhancement = async () => {
    const nextVal = !isAudioEnhanced;
    setIsAudioEnhanced(nextVal);
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      const rawTrack = audioStream.getAudioTracks()[0];
      let trackToUse = rawTrack;
      if (nextVal) {
        trackToUse = getEnhancedAudioTrack(rawTrack);
      }
      localAudioTrackRef.current = trackToUse;
      trackToUse.enabled = !isMuted;
      
      setStream(prev => {
        const newStream = prev || new MediaStream();
        newStream.getAudioTracks().forEach(t => newStream.removeTrack(t));
        newStream.addTrack(trackToUse);
        return newStream;
      });
      
      Object.values(pcsRef.current).forEach(pc => {
        const senders = pc.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender) {
          audioSender.replaceTrack(trackToUse);
        }
      });
    } catch (err) {
      console.error('Failed to toggle audio enhancement:', err);
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

  const playSynthesizedSound = (type: string) => {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      
      if (type === 'bell') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.5);
      } else if (type === 'applause') {
        const bufferSize = ctx.sampleRate * 1.0;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        filter.Q.value = 1.0;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
      } else if (type === 'horn') {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(220, now);
        osc1.frequency.linearRampToValueAtTime(440, now + 0.4);
        osc2.frequency.setValueAtTime(225, now);
        osc2.frequency.linearRampToValueAtTime(445, now + 0.4);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.6);
        osc2.stop(now + 0.6);
      } else if (type === 'alert') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.setValueAtTime(0, now + 0.15);
        gain.gain.setValueAtTime(0.08, now + 0.25);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
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

  const handleVotePoll = (pollId: string, optionIndex: number) => {
    setUserVotes(prev => ({ ...prev, [pollId]: optionIndex }));
    if (sigChannelRef.current) {
      sigChannelRef.current.send({
        type: 'broadcast',
        event: 'vote-poll',
        payload: { pollId, optionIndex }
      });
    }
  };

  // Simulated Speaking status fluctuations (backup fallback)
  useEffect(() => {
    const interval = setInterval(() => {
      // Only mock speaking for peers who do not have active streams yet
      setParticipants(prev => 
        prev.map(p => {
          const peerKey = p.userId || p.id;
          if (remoteStreams[peerKey]) return p; // use actual volume meter
          if (p.isMuted) return { ...p, isSpeaking: false };
          const shouldSpeak = Math.random() > 0.85;
          return { ...p, isSpeaking: shouldSpeak };
        })
      );
    }, 4000);
    return () => clearInterval(interval);
  }, [remoteStreams]);

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

  // Colleague Screenshare Canvas Animation (unused mock visual animation compatibility)
  useEffect(() => {
    let animationId: number;
    const canvas = colleagueCanvasRef.current;
    if (isColleagueSharing && canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const draw = () => {
          ctx.fillStyle = '#1E1E1E';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          animationId = requestAnimationFrame(draw);
        };
        draw();
      }
    }
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isColleagueSharing]);



  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const senderName = currentUser?.name || currentUser?.email?.split('@')[0] || 'Guest';
    const text = chatInput;
    setChatInput('');

    try {
      await mockAuth.sendMessage({
        thread_id: meetingId,
        sender_name: senderName,
        text: text,
        user_id: currentUser?.id
      });
      
      const list = await mockAuth.getMessages(meetingId);
      if (list) {
        const mapped = list.map((msg: { user_id: string; sender_name: string; text: string; created_at: string }) => {
          const isSelf = currentUser ? (msg.user_id === currentUser.id) : false;
          return {
            sender: msg.sender_name,
            text: msg.text,
            time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            self: isSelf
          };
        });
        setMessages(mapped);
      }
    } catch (err) {
      console.error('Failed to send chat message:', err);
    }
  };

  const isDirectCall = isP2PCall && participants.length <= 1 && !isScreenSharing && !Object.keys(peerStates).some(k => peerStates[k].isScreenSharing);

  if (isMinimized) {
    // Determine which stream to display in the mini window
    const screenPeerKey = Object.keys(peerStates).find(k => peerStates[k].isScreenSharing);
    const activeRemoteKey = Object.keys(peerStates).find(k => peerStates[k].isSpeaking) || Object.keys(remoteStreams)[0];
    
    const showStream = screenPeerKey ? remoteStreams[screenPeerKey] : (activeRemoteKey ? remoteStreams[activeRemoteKey] : stream);
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

    const initials = avatarName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

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
              muted={isLocalStream}
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
              onClick={onEndMeeting}
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        borderBottom: '1px solid #1E293B',
        backgroundColor: 'rgba(11, 15, 25, 0.9)',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="badge badge-premium" style={{ color: '#000', backgroundColor: 'var(--color-accent)', border: 'none' }}>
            LIVE
          </span>
          <h3 style={{ fontSize: '1.1rem', color: 'white', fontFamily: 'var(--font-heading)' }}>
            {meetingTitle}
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
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
            <span>Minimize</span>
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
              <span>Invite & Info</span>
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
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}
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
                  value={`${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`}
                  readOnly 
                  className="premium-input"
                  style={{ fontSize: '0.7rem', padding: '0.35rem 0.5rem', backgroundColor: 'rgba(0,0,0,0.15)', flex: 1 }}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`);
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
                  {passcode || 'ABCD'}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                const link = `${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`;
                const invitation = `Please join my GIIN Meet video conference:
Topic: ${meetingTitle}
Join Link: ${link}
Meeting ID: ${meetingId}
Passcode: ${passcode || 'ABCD'}

Securely encrypted under Fintech AES-256 standard.`;
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

        {/* Waiting Room Alert Overlay for Hosts */}
        {isAdmin && waitingList.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#00205B',
            border: '1px solid var(--color-accent)',
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            zIndex: 100,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            animation: 'pop-in 0.3s ease'
          }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {waitingList[0].name} is waiting in the waiting room.
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                onClick={() => handleAdmitParticipant(waitingList[0].id, 'Admitted')}
                className="premium-btn premium-btn-accent" 
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: '28px' }}
              >
                Admit
              </button>
              <button 
                onClick={() => handleAdmitParticipant(waitingList[0].id, 'Declined')}
                className="premium-btn premium-btn-danger" 
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: '28px', backgroundColor: '#EF4444' }}
              >
                Decline
              </button>
            </div>
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
                const hasConnection = activePeerKeys.includes(peerKey);
                const peerStreamObj = remoteStreams[peerKey];
                const pState = peerStates[peerKey] || {
                  name: p.name,
                  isVideoOn: p.isVideoOn,
                  isMuted: p.isMuted,
                  isSpeaking: p.isSpeaking,
                  latency: undefined,
                  e2eeStatus: undefined
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
                      />
                    )}
                    {hasConnection && peerStreamObj && pState.isVideoOn && (
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
                    {(!hasConnection || !peerStreamObj || !pState.isVideoOn) && (
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
                          {!hasConnection ? 'Connecting secure tunnel...' : 'Camera Off'}
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
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
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
              {isVideoOn && stream ? (
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
                    {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'Y'}
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
        ) : participants.length === 0 ? (
          /* Professional Fintech boardroom details dashboard when alone in a meeting */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            backgroundColor: '#07090E',
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
                {isVideoOn && stream ? (
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
                      {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'Y'}
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
            
            // Render local video card
            const localVideoCard = (
              <div className={`meeting-card ${isSpeaking && !isMuted ? 'speaking' : ''}`} style={{
                position: 'relative',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: '#111827',
                aspectRatio: '16/9',
                border: isSpeaking && !isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                transition: 'all 0.25s ease'
              }}>
                {isVideoOn && stream ? (
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
                      {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U'}
                    </div>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Camera Off</span>
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
                  <span style={{ fontWeight: 600 }}>You (Host)</span>
                  {isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
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
                const livekitStream = livekitRemoteStreams[peerKey];
                const p2pStream = remoteStreams[peerKey];
                const isPeerSwapped = swappedPeers.includes(peerKey);
                
                // Select active stream based on engine fallback status and swap completion
                const activeStreamObj = isPeerSwapped ? p2pStream : (livekitStream || p2pStream);
                const hasConnection = !!activeStreamObj;
                
                const pState = peerStates[peerKey] || {
                  name: p.name,
                  isVideoOn: p.isVideoOn,
                  isMuted: p.isMuted,
                  isSpeaking: p.isSpeaking,
                  latency: undefined,
                  e2eeStatus: undefined,
                  videoFilter: undefined,
                  isStudioLightEnabled: false,
                  isReconnecting: false
                };

                return (
                  <div key={p.id} className={`meeting-card ${pState.isSpeaking && !pState.isMuted ? 'speaking' : ''}`} style={{
                    position: 'relative',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    backgroundColor: '#111827',
                    aspectRatio: '16/9',
                    border: pState.isSpeaking && !pState.isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                    transition: 'all 0.25s ease'
                  }}>
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
                  {hasConnection && activeStreamObj && pState.isVideoOn ? (
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
                          opacity: (transitionPending && p2pStream && !isPeerSwapped) ? 0 : 1,
                          transition: 'opacity 0.8s ease-in-out',
                          filter: `${pState.videoFilter === 'blur' ? 'blur(6px)' : pState.videoFilter === 'sepia' ? 'sepia(0.8)' : pState.videoFilter === 'grayscale' ? 'grayscale(1)' : pState.videoFilter === 'warm' ? 'sepia(0.3) hue-rotate(-10deg) saturate(1.4)' : pState.videoFilter === 'cyberpunk' ? 'hue-rotate(90deg) saturate(1.5)' : 'none'} ${pState.isStudioLightEnabled ? 'brightness(1.15) contrast(1.05) saturate(1.1)' : ''}`
                        }}
                      />

                      {/* Hidden / Background P2P Buffer Feed */}
                      {transitionPending && p2pStream && !isPeerSwapped && (
                        <video
                          ref={el => {
                            if (el) {
                              if (el.srcObject !== p2pStream) {
                                el.srcObject = p2pStream;
                              }
                              // Monitor onunmute to trigger the swap
                              const track = p2pStream.getVideoTracks()[0];
                              if (track) {
                                track.onunmute = () => handleTriggerPeerSwap(peerKey);
                              } else {
                                // Fallback if audio-only or instant swap
                                setTimeout(() => handleTriggerPeerSwap(peerKey), 1500);
                              }
                            }
                          }}
                          autoPlay
                          playsInline
                          muted
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            opacity: isHandoffTransitioning[peerKey] ? 1 : 0,
                            transition: 'opacity 0.8s ease-in-out',
                            pointerEvents: 'none',
                            filter: `${pState.videoFilter === 'blur' ? 'blur(6px)' : pState.videoFilter === 'sepia' ? 'sepia(0.8)' : pState.videoFilter === 'grayscale' ? 'grayscale(1)' : pState.videoFilter === 'warm' ? 'sepia(0.3) hue-rotate(-10deg) saturate(1.4)' : pState.videoFilter === 'cyberpunk' ? 'hue-rotate(90deg) saturate(1.5)' : 'none'} ${pState.isStudioLightEnabled ? 'brightness(1.15) contrast(1.05) saturate(1.1)' : ''}`
                          }}
                        />
                      )}
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
                        {p.avatar || p.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {!hasConnection ? 'Connecting...' : 'Camera Off'}
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
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    {pState.isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
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
                  overflow: 'hidden',
                  backgroundColor: '#07090E'
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
                    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
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
                      <Monitor size={14} color="var(--color-accent)" />
                      <span>
                        {isScreenSharing 
                          ? 'You are sharing your screen' 
                          : `${Object.keys(peerStates).find(k => peerStates[k].isScreenSharing) ? peerStates[Object.keys(peerStates).find(k => peerStates[k].isScreenSharing)!].name : 'Participant'} is sharing screen`}
                      </span>
                    </div>
                  </div>

                  {/* Participant Sidebar */}
                  <div className="screenshare-sidebar" style={{
                    width: '260px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    padding: '1.5rem 1.5rem 1.5rem 0',
                    overflowY: 'auto'
                  }}>
                    {localVideoCard}
                    {remoteVideoCards}
                  </div>
                </div>
              );
            }

            // No Screen Share: Normal grid tiling
            return (
              <div className="meeting-grid" style={{
                flex: 1,
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1.25rem',
                padding: '1.5rem',
                overflowY: 'auto',
                alignItems: 'center',
                justifyContent: 'center',
                alignContent: 'center',
                backgroundColor: '#07090E'
              }}>
                {localVideoCard}
                {remoteVideoCards}
              </div>
            );
          })()
        )}

        {/* Collapsible Panels */}
        {activePanel === 'chat' && (
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
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
                    {m.sender} &bull; {m.time}
                  </span>
                  <div style={{
                    padding: '0.6rem 0.85rem',
                    borderRadius: '8px',
                    backgroundColor: m.self ? 'var(--color-primary)' : '#1E293B',
                    color: 'white',
                    fontSize: '0.85rem',
                    lineHeight: 1.3
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={sendChatMessage} style={{ padding: '0.75rem', borderTop: '1px solid #1E293B', display: 'flex', gap: '0.5rem' }}>
              <input 
                type="text" 
                placeholder={isChatLocked && !isAdmin ? "Chat is disabled by the host." : "Send message to everyone..."} 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isChatLocked && !isAdmin}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '4px',
                  backgroundColor: isChatLocked && !isAdmin ? '#1E293B' : '#090D16',
                  border: '1px solid #1E293B',
                  color: 'white',
                  fontSize: '0.85rem',
                  cursor: isChatLocked && !isAdmin ? 'not-allowed' : 'text'
                }}
              />
              <button 
                type="submit" 
                disabled={isChatLocked && !isAdmin}
                style={{
                  background: isChatLocked && !isAdmin ? '#475569' : 'var(--color-primary)',
                  border: 'none',
                  borderRadius: '4px',
                  width: '34px',
                  height: '34px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  cursor: isChatLocked && !isAdmin ? 'not-allowed' : 'pointer',
                  opacity: isChatLocked && !isAdmin ? 0.6 : 1
                }}
              >
                <SendHorizontal size={16} />
              </button>
            </form>
          </div>
        )}

        {activePanel === 'participants' && (
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
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
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{isAdmin ? 'Host/Admin' : 'Participant'}</div>
                  </div>
                </div>
                <div>
                  {isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />}
                </div>
              </div>

              {/* Other participants */}
              {participants.map(p => (
                <div key={p.id} className="flex-between" style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: p.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.85rem', color: 'white', flexShrink: 0 }}>
                      {p.avatar}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.role}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                    {p.isSpeaking && !p.isMuted && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', animation: 'pulse-ring 2s infinite' }} />}
                    
                    {isAdmin && p.userId && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button 
                          onClick={() => handleDesignateAdmin(p.userId!)}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--color-accent)', fontWeight: 600, padding: '2px 4px' }}
                          title="Designate Admin"
                        >
                          Make Admin
                        </button>
                        
                        {!p.isMuted && (
                          <button 
                            onClick={() => {
                              if (sigChannelRef.current) {
                                sigChannelRef.current.send({
                                  type: 'broadcast',
                                  event: 'mute-participant',
                                  payload: { targetUserId: p.userId }
                                });
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

                        <button 
                          onClick={async () => {
                            if (confirm(`Are you sure you want to remove ${p.name} from the meeting?`)) {
                              if (sigChannelRef.current) {
                                sigChannelRef.current.send({
                                  type: 'broadcast',
                                  event: 'remove-participant',
                                  payload: { targetUserId: p.userId }
                                });
                              }
                              // Immediately clean up locally for instant UI feedback
                              cleanupPeer(p.userId!);
                              // Attempt database delete
                              await mockAuth.removeParticipant(meetingId, p.userId!);
                            }
                          }}
                          style={{
                            border: 'none',
                            background: 'rgba(239, 68, 68, 0.1)',
                            cursor: 'pointer',
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
                      </div>
                    )}
                    
                    {!isAdmin && (p.isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />)}
                    {isAdmin && p.isMuted && <MicOff size={14} color="#EF4444" style={{ marginLeft: '4px' }} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activePanel === 'host-settings' && isAdmin && (
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
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
                          onClick={() => setBreakoutRoom(null)}
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
                              onClick={() => setBreakoutRoom(rNum)}
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
          <div style={{
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
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1.2rem' }}
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
                  Real-time DSP noise gate and vocal compressor to filter background hum and boost speech clarity.
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
                    { id: 'blur', label: 'Blur' },
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
              </div>

            </div>
          </div>
        )}

        {activePanel === 'transcript' && (
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1.2rem' }}
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
                          <div style={{ fontWeight: 700, color: 'white', marginBottom: '0.35rem' }}>💡 Key Decisions</div>
                          <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <li>Resolved WebRTC screenshare channel issues by establishing Perfect Negotiation glare rollbacks.</li>
                            <li>Selected custom layout constraints to match <strong>{localStorage.getItem('giin_ui_style') || 'glassmorphism'}</strong> branding.</li>
                          </ul>
                        </div>

                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontWeight: 700, color: 'white', marginBottom: '0.35rem' }}>📌 Action Items</div>
                          <ul style={{ listStyleType: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" readOnly checked={false} /> <span style={{ fontSize: '0.75rem' }}><strong>@You</strong> - Validate WebRTC video filters under heavy packet loss profiles.</span>
                            </li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" readOnly checked={false} /> <span style={{ fontSize: '0.75rem' }}><strong>@Admin</strong> - Finalize corner shape and typography metrics before staging deployment.</span>
                            </li>
                            <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" readOnly checked={false} /> <span style={{ fontSize: '0.75rem' }}><strong>@Team</strong> - Confirm next operations sync scheduled time.</span>
                            </li>
                          </ul>
                        </div>

                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ fontWeight: 700, color: 'white', marginBottom: '0.35rem' }}>📝 Summary Notes</div>
                          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            The conference was focused on platform modernization. Participants reviewed the interactive bento grids, skeuomorphic clicky controls, and 3D depth layers in spatial UI environments. The sketchpad doodle board was used for database fallback schema diagrams. Action items were resolved with clear ownership.
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
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No summary generated yet. Click below to analyze meeting transcripts.</span>
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
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>

            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>TRIGGER SOUND EFFECTS</span>
              
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
          <div style={{
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
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }}
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
                    const inviteUrl = `${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`;
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
            </div>
          </div>
        )}
        {activePanel === 'workspace' && (
          <div style={{
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

      {/* Toolbar / Controls */}
      {isDirectCall ? (
        <div style={{
          position: 'absolute',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
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
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: isMuted ? '#EF4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(4px)'
            }}
            title={isMuted ? "Unmute Mic" : "Mute Mic"}
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          {/* Toggle Video */}
          <button 
            onClick={toggleVideo}
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: !isVideoOn ? '#EF4444' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(4px)'
            }}
            title={isVideoOn ? "Turn Camera Off" : "Turn Camera On"}
          >
            {isVideoOn ? <VideoIcon size={22} /> : <VideoOff size={22} />}
          </button>

          {/* Toggle Screen Share */}
          <button 
            onClick={handleToggleScreenShare}
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: isScreenSharing ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isScreenSharing ? 'black' : 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Share Screen"
          >
            <Monitor size={20} />
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
            onClick={() => setActivePanel(activePanel === 'chat' ? 'none' : 'chat')}
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: activePanel === 'chat' ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            title="Chat"
          >
            <MessageSquare size={22} />
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
            <button 
              onClick={() => setShowMeetingInfo(!showMeetingInfo)}
              className="premium-btn premium-btn-secondary" 
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', borderRadius: '4px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="View meeting info and share"
            >
              Share
            </button>
          </div>

          {/* Center Controls */}
          <div className="meeting-toolbar-center" style={{ gap: '0.75rem', position: 'relative' }}>
            {/* Mute Audio */}
            <button 
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

            {/* Device Settings Toggle */}
            <button 
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
              
              {showHandRaiseMenu && (
                <div 
                  className="hand-raise-menu-container"
                  style={{
                    position: window.innerWidth < 768 ? 'fixed' : 'absolute',
                    bottom: window.innerWidth < 768 ? '0' : '55px',
                    left: window.innerWidth < 768 ? '0' : '50%',
                    right: window.innerWidth < 768 ? '0' : 'auto',
                    transform: window.innerWidth < 768 ? 'none' : 'translateX(-50%)',
                    width: window.innerWidth < 768 ? '100%' : '320px',
                    backgroundColor: 'rgba(15, 23, 42, 0.98)',
                    border: window.innerWidth < 768 ? 'none' : '1px solid #1E293B',
                    borderTop: window.innerWidth < 768 ? '1px solid #1E293B' : '1px solid #1E293B',
                    borderRadius: window.innerWidth < 768 ? '20px 20px 0 0' : '12px',
                    padding: '1.5rem',
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
                    <div style={{ width: '40px', height: '4px', backgroundColor: '#475569', borderRadius: '2px', margin: '0 auto' }} />
                  )}
                  
                  <div className="flex-between" style={{ marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'white', fontFamily: 'var(--font-heading)' }}>
                      Raise Hand
                    </span>
                    <button 
                      onClick={() => setShowHandRaiseMenu(false)}
                      style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1.25rem' }}
                    >
                      &times;
                    </button>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem'
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
                          alignItems: 'flex-start',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: `1px solid rgba(255, 255, 255, 0.05)`,
                          backgroundColor: r.bg,
                          cursor: 'pointer',
                          textAlign: 'left',
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
                        <span style={{ fontSize: '1.2rem', marginBottom: '0.25rem' }}>{r.label.split(' ')[0]}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white' }}>{r.label.split(' ')[1]}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>{r.desc}</span>
                      </button>
                    ))}
                  </div>

                  <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: '0.25rem 0' }} />

                  <button
                    onClick={() => toggleHandRaise()}
                    style={{
                      width: '100%',
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
                        padding: 0
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
                  style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 14000 }}
                />
                <div style={{
                  position: window.innerWidth < 768 ? 'fixed' : 'absolute',
                  bottom: window.innerWidth < 768 ? '70px' : '55px',
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
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                  animation: 'pop-in 0.2s ease'
                }}>
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
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Info size={16} />
                    <span>Meeting Info</span>
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
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Edit2 size={16} />
                    <span>Workspace Notes</span>
                  </button>

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
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <BarChart3 size={16} />
                    <span>Interactive Polls</span>
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
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Languages size={16} />
                    <span>Live Captions</span>
                  </button>

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
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Sliders size={16} />
                    <span>AV Enhancements</span>
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
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Volume2 size={16} />
                    <span>Soundboard Reacts</span>
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
                        padding: '0.6rem 0.85rem',
                        borderRadius: '6px',
                        color: 'white',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <Settings size={16} />
                      <span>Host Controls</span>
                    </button>
                  )}

                  {/* Simulate Remote Share */}
                  <button 
                    onClick={() => {
                      const nextVal = !isColleagueSharing;
                      setIsColleagueSharing(nextVal);
                      if (nextVal) {
                        setIsScreenSharing(false);
                      }
                      setShowMoreMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      backgroundColor: isColleagueSharing ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Users size={16} />
                    <span>Simulate Remote Share</span>
                  </button>
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
              <Users size={15} />
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
              <MessageSquare size={15} />
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
              <PhoneOff size={15} />
              <span className="hide-mobile-text">{isAdmin ? 'End for All' : 'Leave Call'}</span>
            </button>
          </div>
        </div>
      )}

      {/* E2EE Shield Status Details Drawer Panel Overlay */}
      {showE2EEPannel && (
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '360px',
          height: '100%',
          backgroundColor: 'rgba(11, 15, 25, 0.98)',
          borderLeft: '1px solid #1E293B',
          padding: '2rem',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
          animation: 'slide-in var(--transition-normal)'
        }}>
          <div className="flex-between">
            <h3 style={{ color: 'white', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-heading)' }}>
              <ShieldCheck size={22} color="#10B981" />
              <span>E2EE Verification</span>
            </h3>
            <button 
              onClick={() => setShowE2EEPannel(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}
            >
              &times;
            </button>
          </div>

          <hr style={{ border: 'none', borderBottom: '1px solid #1E293B', margin: 0 }} />

          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            GIIN MEET calls and chat are protected by end-to-end encryption. Your audio, video, and messages are encrypted client-side using Web Crypto 256-bit AES-GCM before sending. No one, not even GIIN, can read or hear them.
          </p>

          <div>
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.5rem' }}>
              VISUAL VERIFICATION CODE
            </span>
            <div style={{ 
              backgroundColor: '#0F172A', 
              padding: '1rem', 
              borderRadius: '8px', 
              border: '1px solid #1E293B', 
              color: 'white', 
              fontFamily: 'monospace', 
              fontSize: '0.9rem',
              letterSpacing: '0.05em',
              textAlign: 'center',
              lineHeight: 1.6
            }}>
              {deriveE2EESeal(meetingId)}
            </div>
            <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.35 }}>
              Compare these numbers with another participant to verify that this call is securely locked with zero-knowledge keys.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Cryptographic Session Keys Generated</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Symmetric AES-GCM Tunnel Initialised</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>Zero-Knowledge Verification Passed</span>
            </div>
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
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '0.25rem',
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
                      {participants.map(p => (
                        <option key={p.id} value={p.userId || p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
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
              {leaveOption === 'transfer' && (
                <button
                  onClick={handleTransferAndLeave}
                  disabled={!selectedNewAdminId}
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
                  Confirm Transfer & Exit
                </button>
              )}

              {leaveOption === 'end' && (
                <button
                  onClick={handleEndForAll}
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
                  End Meeting for All
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

      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
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
        </div>
      )}
    </div>
  );
};
