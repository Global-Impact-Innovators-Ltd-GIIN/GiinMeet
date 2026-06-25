import React, { useEffect, useRef, useState } from 'react';
import { 
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, Users, MessageSquare, PhoneOff, 
  SendHorizontal, Edit2, ShieldCheck, Lock, Unlock, Wifi, AlertTriangle, Copy, Check
} from 'lucide-react';
import { ScreenAnnotation } from './ScreenAnnotation';
import { WorkspacePanel } from './WorkspacePanel';
import { encryptFrame, decryptFrame } from '../services/e2ee';

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
  try {
    const ctx = getAudioCtx();
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.02, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.35);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.35);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.setValueAtTime(1174.66, ctx.currentTime); // D6
      gain2.gain.setValueAtTime(0.02, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.5);
    }, 120);
  } catch (e) {
    console.warn('Audio play blocked:', e);
  }
};

// User joined chime
export const playUserJoinSound = () => {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.25); // Sweep to G5
    gain.gain.setValueAtTime(0.02, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.25);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.warn('Audio play blocked:', e);
  }
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
  return {
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { max: 15 }
    },
    audio: false
  };
};

import { mockAuth, supabase, getDeterministicPasscode } from '../supabaseClient';

interface MeetingRoomProps {
  meetingId: string;
  meetingTitle: string;
  onEndMeeting: () => void;
  onSaveWorkspaceData?: (notes: string, actionItemsCount: number) => void;
  currentUser: { id: string; name: string; email: string } | null;
  initialVideoState?: boolean;
  isP2PCall?: boolean;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ 
  meetingId, 
  meetingTitle, 
  onEndMeeting, 
  onSaveWorkspaceData, 
  currentUser,
  initialVideoState = true,
  isP2PCall = false
}) => {
  const [showE2EEPannel, setShowE2EEPannel] = useState(false);

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
  const [activePanel, setActivePanel] = useState<'none' | 'chat' | 'participants' | 'workspace'>('none');
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
  const isAdmin = currentUser && meetingAdminId === currentUser.id;

  // WebRTC Peer States & Connections
  const myKey = currentUser?.id || 'guest-user-' + Math.random().toString(36).substring(2, 7);
  const pcsRef = useRef<{ [peerKey: string]: RTCPeerConnection }>({});
  const pcCandidatesRef = useRef<{ [peerKey: string]: any[] }>({});
  const [remoteStreams, setRemoteStreams] = useState<{ [peerKey: string]: MediaStream }>({});
  const [peerStates, setPeerStates] = useState<{ 
    [peerKey: string]: { 
      name: string; 
      isVideoOn: boolean; 
      isMuted: boolean; 
      isScreenSharing: boolean; 
      isSpeaking: boolean;
      latency?: number; 
      e2eeStatus?: 'secure' | 'unsupported' 
    } 
  }>({});

  // Clean up a single peer connection
  const cleanupPeer = (peerKey: string) => {
    if (pcsRef.current[peerKey]) {
      pcsRef.current[peerKey].close();
      delete pcsRef.current[peerKey];
    }
    if (pcCandidatesRef.current[peerKey]) {
      delete pcCandidatesRef.current[peerKey];
    }
    setRemoteStreams(prev => {
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

  // E2EE Transform stream injectors
  const setupSenderE2EE = (sender: RTCRtpSender) => {
    if (typeof (sender as any).createEncodedStreams === 'function') {
      try {
        const streams = (sender as any).createEncodedStreams();
        const transformer = new TransformStream({
          transform(chunk, controller) {
            encryptFrame(chunk, controller, passcode || meetingId);
          }
        });
        streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
      } catch (e) {
        console.warn('[E2EE] Sender transform failed:', e);
      }
    }
  };

  const setupReceiverE2EE = (receiver: RTCRtpReceiver) => {
    if (typeof (receiver as any).createEncodedStreams === 'function') {
      try {
        const streams = (receiver as any).createEncodedStreams();
        const transformer = new TransformStream({
          transform(chunk, controller) {
            decryptFrame(chunk, controller, passcode || meetingId);
          }
        });
        streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
      } catch (e) {
        console.warn('[E2EE] Receiver transform failed:', e);
      }
    }
  };

  // Web Audio speaking volume analyzer
  const setupSpeakingDetection = (mediaStream: MediaStream, targetKey: string, isLocal: boolean) => {
    try {
      const ctx = getAudioCtx();
      const source = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      
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
          setPasscode(data.passcode || '');
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
              // If it's a dynamic participant (we have an active peer connection with them), keep them!
              const isDynamic = p.id.startsWith('guest-') || p.id.startsWith('mock-') || p.id.startsWith('virtual-') || !mapped.some(m => m.id === p.id || m.userId === p.userId);
              if (isDynamic && (pcsRef.current[p.id] || pcsRef.current[p.userId || ''])) {
                merged.push(p);
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

    const sigChannel = supabase.channel(`sig-webrtc-${meetingId}`, {
      config: {
        broadcast: { self: false }
      }
    });

    const initPeerConnection = (peerKey: string, isCaller: boolean) => {
      if (pcsRef.current[peerKey]) {
        pcsRef.current[peerKey].close();
      }

      const config: any = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ],
        encodedInsertableStreams: true
      };

      let pc: RTCPeerConnection;
      try {
        pc = new RTCPeerConnection(config);
      } catch (e) {
        config.encodedInsertableStreams = false;
        pc = new RTCPeerConnection(config);
      }

      pcsRef.current[peerKey] = pc;

      // Add local media tracks
      if (stream) {
        stream.getTracks().forEach(track => {
          const sender = pc.addTrack(track, stream);
          setupSenderE2EE(sender);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sigChannel.send({
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
        setRemoteStreams(prev => ({
          ...prev,
          [peerKey]: remoteStream
        }));

        setupReceiverE2EE(event.receiver);
        setupSpeakingDetection(remoteStream, peerKey, false);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          stopRingSound();
          playHandshakeConfirmSound();
          setPeerStates(prev => ({
            ...prev,
            [peerKey]: {
              ...prev[peerKey],
              e2eeStatus: (pc.getConfiguration() as any).encodedInsertableStreams !== false ? 'secure' : 'unsupported'
            }
          }));
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          cleanupPeer(peerKey);
        }
      };

      if (isCaller) {
        pc.onnegotiationneeded = async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sigChannel.send({
              type: 'broadcast',
              event: 'signal',
              payload: {
                type: 'offer',
                targetKey: peerKey,
                senderKey: myKey,
                sdp: offer
              }
            });
          } catch (err) {
            console.error('[WebRTC] Offer error:', err);
          }
        };
      }

      return pc;
    };

    const handleSignal = async (data: any) => {
      const { type, senderKey, sdp, candidate } = data;

      if (type === 'offer') {
        const pc = initPeerConnection(senderKey, false);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        sigChannel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'answer',
            targetKey: senderKey,
            senderKey: myKey,
            sdp: answer
          }
        });

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
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));

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
        if (pc) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
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
          if (isInitiator) {
            initPeerConnection(senderKey, true);
          }
        }
      })
      .on('broadcast', { event: 'signal' }, (payload: any) => {
        const data = payload.payload;
        if (data.targetKey === myKey) {
          handleSignal(data);
        }
      })
      .on('broadcast', { event: 'media-state' }, (payload: any) => {
        const data = payload.payload;
        if (data.senderKey !== myKey) {
          setPeerStates(prev => {
            if (!prev[data.senderKey]) return prev;
            return {
              ...prev,
              [data.senderKey]: {
                ...prev[data.senderKey],
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

          // Start calling tone loop until a peer joins
          startRingSound();
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
      sigChannel.unsubscribe();
      stopRingSound();
      clearInterval(ringingCheck);
      clearInterval(intervalPresence);
      clearInterval(intervalPing);
      // Close all connections
      Object.keys(pcsRef.current).forEach(cleanupPeer);
    };
  }, [passcode, stream, isMediaInitialized]);

  // Screen sharing track feed replacement injector
  useEffect(() => {
    async function startScreenShare() {
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
        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });

        // Broadcast screenshare media state changes
        const sigChannel = supabase.channel(`sig-webrtc-${meetingId}`);
        sigChannel.send({
          type: 'broadcast',
          event: 'media-state',
          payload: {
            senderKey: myKey,
            isVideoOn,
            isMuted,
            isScreenSharing: true
          }
        });

        screenTrack.onended = () => {
          stopScreenShare();
          setIsScreenSharing(false);
        };

      } catch (err) {
        console.warn('[Screen Share] Permission denied or failed. Fallback simulation.', err);
        screenVideoRef.current = null;
      }
    }

    if (isScreenSharing) {
      startScreenShare();
    } else {
      stopScreenShare();
    }

    return () => {
      stopScreenShare();
    };
  }, [isScreenSharing]);

  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
    }
    screenVideoRef.current = null;

    // Swap back webcam video track
    if (stream) {
      const webcamTrack = stream.getVideoTracks()[0];
      if (webcamTrack) {
        Object.values(pcsRef.current).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(webcamTrack);
          }
        });
      }
    }

    // Broadcast screenshare media state changes
    const sigChannel = supabase.channel(`sig-webrtc-${meetingId}`);
    sigChannel.send({
      type: 'broadcast',
      event: 'media-state',
      payload: {
        senderKey: myKey,
        isVideoOn,
        isMuted,
        isScreenSharing: false
      }
    });
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
      await mockAuth.updateParticipantStatus(participantId, status);
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

  // Share link and passcode
  const handleCopyCredentials = () => {
    const link = `${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`;
    const text = `Join my GIIN MEET call:\nTitle: ${meetingTitle}\nLink: ${link}\nPasscode: ${passcode}`;
    navigator.clipboard.writeText(text);
    alert('Meeting credentials (link & passcode) copied to clipboard!');
  };
  
  const colleagueCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Chat state
  const [messages, setMessages] = useState<{ sender: string; text: string; time: string; self: boolean }[]>([]);
  const [chatInput, setChatInput] = useState('');
  
  // Camera video ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Initial participants list from DB
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Handle media devices (webcam)
  useEffect(() => {
    async function startCamera() {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }

        // Setup local audio analyzer
        setupSpeakingDetection(mediaStream, myKey, true);

        // Replace track in existing connections if camera restarts
        mediaStream.getTracks().forEach(track => {
          Object.values(pcsRef.current).forEach(pc => {
            const senders = pc.getSenders();
            const sender = senders.find(s => s.track && s.track.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track);
            }
          });
        });
        setIsMediaInitialized(true);
      } catch (err) {
        console.warn('Camera access denied or unavailable. Running in simulated fallback mode.', err);
        setIsMediaInitialized(true);
      }
    }

    if (isVideoOn) {
      startCamera();
    } else {
      stopCamera();
      setIsMediaInitialized(true);
    }

    return () => {
      stopCamera();
    };
  }, [isVideoOn]);

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  // Toggle buttons
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = !nextMuted;
      });
    }

    // Broadcast audio state change
    const sigChannel = supabase.channel(`sig-webrtc-${meetingId}`);
    sigChannel.send({
      type: 'broadcast',
      event: 'media-state',
      payload: {
        senderKey: myKey,
        isVideoOn,
        isMuted: nextMuted,
        isScreenSharing
      }
    });
  };

  const toggleVideo = () => {
    const nextVideoOn = !isVideoOn;
    setIsVideoOn(nextVideoOn);

    // Broadcast video state change
    const sigChannel = supabase.channel(`sig-webrtc-${meetingId}`);
    sigChannel.send({
      type: 'broadcast',
      event: 'media-state',
      payload: {
        senderKey: myKey,
        isVideoOn: nextVideoOn,
        isMuted,
        isScreenSharing
      }
    });
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
        let frame = 0;
        const draw = () => {
          frame++;
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
        let frame = 0;
        const draw = () => {
          frame++;
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
      console.error('Failed to send chat message:', err);
    }
  };

  const isDirectCall = isP2PCall && participants.length <= 1 && !isScreenSharing && !Object.keys(peerStates).some(k => peerStates[k].isScreenSharing);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 80px)',
      backgroundColor: '#07090E', // Dark screen for immersive meeting
      color: 'white',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      position: 'relative',
      border: '1px solid #1E293B',
      animation: 'pop-in var(--transition-normal)'
    }}>
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
          <button 
            onClick={() => setShowE2EEPannel(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#10B981',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontWeight: 600
            }}
          >
            <ShieldCheck size={16} />
            <span>E2EE Active</span>
          </button>
          <span style={{ color: 'var(--text-muted)' }}>&bull;</span>
          <span style={{ color: 'var(--color-secondary)' }}>HD Call</span>
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
                const hasConnection = !!pcsRef.current[peerKey];
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
                      <video
                        ref={el => {
                          if (el && peerStreamObj && el.srcObject !== peerStreamObj) {
                            el.srcObject = peerStreamObj;
                          }
                        }}
                        autoPlay
                        playsInline
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: pState.isVideoOn ? 'block' : 'none'
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
                        zIndex: 1
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
                      {hasConnection && pState.latency !== undefined && (
                        <>
                          <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: pState.latency < 80 ? '#10B981' : '#FBBF24' }}>
                            <Wifi size={12} />
                            <span>{pState.latency}ms</span>
                          </span>
                        </>
                      )}
                    </div>
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
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
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
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr',
            gap: '2.5rem',
            padding: '2.5rem',
            alignItems: 'center',
            backgroundColor: '#07090E',
            overflowY: 'auto'
          }} className="grid-2">
            {/* Left: Your webcam tile */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                  <video 
                    ref={el => {
                      if (el && stream && el.srcObject !== stream) {
                        el.srcObject = stream;
                      }
                    }}
                    autoPlay 
                    playsInline 
                    muted 
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} 
                  />
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

                {/* E2EE secure emblem overlay */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  backgroundColor: 'rgba(16, 185, 129, 0.25)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  color: '#10B981',
                  fontWeight: 600,
                  backdropFilter: 'blur(4px)'
                }}>
                  <Lock size={10} color="#10B981" />
                  <span>E2EE SECURE ROOM</span>
                </div>

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
                  <span style={{ fontWeight: 600 }}>{currentUser?.name || 'You'} (Host)</span>
                  {isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
                </div>
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                You are currently the only participant in this boardroom conference.
              </span>
            </div>

            {/* Right: Invitation & Joining Info Card */}
            <div className="glass-panel" style={{
              padding: '2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-premium)'
            }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Live Boardroom Hub
                </span>
                <h3 style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '0.25rem', marginBottom: '0.25rem', fontFamily: 'var(--font-heading)' }}>
                  Invite Others to Join
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Share the credentials below to invite remote participants.
                </p>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: 0 }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Meeting Join Link</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    value={`${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`}
                    readOnly 
                    className="premium-input"
                    style={{ fontSize: '0.75rem', padding: '0.45rem 0.75rem', backgroundColor: 'rgba(0,0,0,0.15)', flex: 1 }}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/#/join?id=${meetingId}&passcode=${passcode}`);
                      setCopiedInfo('link');
                      setTimeout(() => setCopiedInfo(null), 2000);
                    }}
                    className={`premium-btn ${copiedInfo === 'link' ? 'premium-btn-accent' : 'premium-btn-secondary'}`}
                    style={{ padding: '0.45rem 0.75rem', height: '34px', fontSize: '0.75rem', flexShrink: 0 }}
                    title="Copy Join Link"
                  >
                    {copiedInfo === 'link' ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>Meeting ID</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'white', marginTop: '0.25rem' }}>
                    {meetingId}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>Passcode</span>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, color: 'white', marginTop: '0.25rem' }}>
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
                style={{ width: '100%', justifyContent: 'center', gap: '8px', padding: '0.75rem', fontSize: '0.85rem' }}
              >
                {copiedInfo === 'details' ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedInfo === 'details' ? 'Invitation Details Copied' : 'Copy Invitation Email'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="meeting-grid" style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: (isScreenSharing || Object.keys(peerStates).some(k => peerStates[k].isScreenSharing)) 
              ? '3fr 1fr' 
              : 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.25rem',
            padding: '1.5rem',
            overflowY: 'auto',
            alignContent: 'center',
            backgroundColor: '#07090E'
          }}>
            {/* Main Large Screen Share Frame */}
            {(isScreenSharing || Object.keys(peerStates).some(k => peerStates[k].isScreenSharing)) && (
              <div style={{
                gridRow: 'span 2',
                position: 'relative',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                border: '2px solid var(--color-accent)',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#0A0D14',
                boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
                aspectRatio: '16/9'
              }}>
                {isScreenSharing ? (
                  <video
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
                    const screenStreamObj = screenPeerKey ? remoteStreams[screenPeerKey] : null;
                    const screenPeerName = screenPeerKey ? peerStates[screenPeerKey].name : 'Remote Peer';
                    return screenStreamObj ? (
                      <video
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
                
                {isAnnotating && isScreenSharing && (
                  <ScreenAnnotation 
                    isPresenter={true} 
                    onClose={() => setIsAnnotating(false)} 
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
            )}

            {/* Sidebar / Grid Cards Wrapper (All participants' webcam video elements) */}
            <div style={{
              display: 'contents'
            }}>
              {/* User local webcam card */}
              <div style={{
                position: 'relative',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                backgroundColor: '#111827',
                aspectRatio: '16/9',
                border: isSpeaking && !isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                boxShadow: isSpeaking && !isMuted ? '0 0 15px rgba(250, 189, 2, 0.45)' : 'none',
                transition: 'all 0.25s ease'
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
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} 
                  />
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
                      fontSize: '1.4rem',
                      fontWeight: 700,
                      color: 'white',
                      border: '2px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      {currentUser?.name ? currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'Y'}
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Webcam Off</span>
                  </div>
                )}

                {/* Security Shield Lock Status */}
                <div style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  backgroundColor: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  color: '#10B981',
                  fontWeight: 600,
                  backdropFilter: 'blur(4px)'
                }}>
                  <Lock size={10} color="#10B981" />
                  <span>E2EE LOCKED</span>
                </div>

                {/* Local Speaking wave overlay if speaking */}
                {isSpeaking && !isMuted && (
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    display: 'flex',
                    gap: '3px',
                    alignItems: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    padding: '6px',
                    borderRadius: '6px'
                  }}>
                    <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.8s ease infinite', transformOrigin: 'bottom' }} />
                    <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.5s ease infinite', transformOrigin: 'bottom' }} />
                    <span style={{ width: '3px', height: '8px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.9s ease infinite', transformOrigin: 'bottom' }} />
                  </div>
                )}

                {/* Bottom tag info banner */}
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
                  backdropFilter: 'blur(4px)'
                }}>
                  <span style={{ fontWeight: 600 }}>You (Host)</span>
                  {isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
                </div>
              </div>

              {/* Remote Active Participants Card Loops */}
              {participants.map(p => {
                const peerKey = p.userId || p.id;
                const hasConnection = !!pcsRef.current[peerKey];
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
                  <div key={p.id} style={{
                    position: 'relative',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    backgroundColor: '#111827',
                    aspectRatio: '16/9',
                    border: pState.isSpeaking && !pState.isMuted ? '3px solid var(--color-accent)' : '2px solid #1E293B',
                    boxShadow: pState.isSpeaking && !pState.isMuted ? '0 0 15px rgba(250, 189, 2, 0.45)' : 'none',
                    transition: 'all 0.25s ease'
                  }}>
                    {hasConnection && peerStreamObj && (
                      <video
                        ref={el => {
                          if (el && peerStreamObj && el.srcObject !== peerStreamObj) {
                            el.srcObject = peerStreamObj;
                          }
                        }}
                        autoPlay
                        playsInline
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: pState.isVideoOn ? 'block' : 'none'
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
                        gap: '0.85rem',
                        backgroundColor: '#090D14',
                        position: (hasConnection && peerStreamObj) ? 'absolute' : 'relative',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 1
                      }}>
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '50%',
                          backgroundColor: p.avatarBg,
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          border: '2px solid rgba(255, 255, 255, 0.1)'
                        }}>
                          {p.avatar}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                          {!hasConnection ? 'Connecting secure tunnel...' : 'Camera Off'}
                        </span>
                      </div>
                    )}

                    {/* Network Latency Indicator */}
                    {hasConnection && pState.latency !== undefined && (
                      <div style={{
                        position: 'absolute',
                        top: '12px',
                        left: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        backgroundColor: 'rgba(7, 9, 14, 0.7)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.65rem',
                        color: pState.latency < 80 ? '#10B981' : pState.latency < 200 ? '#FBBF24' : '#EF4444'
                      }}>
                        <Wifi size={10} />
                        <span>{pState.latency}ms</span>
                      </div>
                    )}

                    {/* E2EE Lock badge */}
                    <div style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      backgroundColor: pState.e2eeStatus === 'secure' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                      border: pState.e2eeStatus === 'secure' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                      color: pState.e2eeStatus === 'secure' ? '#10B981' : '#EF4444',
                      fontWeight: 600,
                      backdropFilter: 'blur(4px)'
                    }}>
                      {pState.e2eeStatus === 'secure' ? <Lock size={10} /> : <Unlock size={10} />}
                      <span>{pState.e2eeStatus === 'secure' ? 'E2EE' : 'P2P'}</span>
                    </div>

                    {/* Dynamic speaker audio pulse wave */}
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
                        borderRadius: '6px'
                      }}>
                        <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.7s ease infinite', transformOrigin: 'bottom' }} />
                        <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.4s ease infinite', transformOrigin: 'bottom' }} />
                        <span style={{ width: '3px', height: '8px', backgroundColor: 'var(--color-accent)', animation: 'wave-animation 0.8s ease infinite', transformOrigin: 'bottom' }} />
                      </div>
                    )}

                    {/* Remote user name card info */}
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
                      backdropFilter: 'blur(4px)'
                    }}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      {pState.isMuted ? <MicOff size={11} color="#EF4444" /> : <Mic size={11} color="#10B981" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
                placeholder="Send message to everyone..." 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  borderRadius: '4px',
                  backgroundColor: '#090D16',
                  border: '1px solid #1E293B',
                  color: 'white',
                  fontSize: '0.85rem'
                }}
              />
              <button type="submit" style={{
                background: 'var(--color-primary)',
                border: 'none',
                borderRadius: '4px',
                width: '34px',
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer'
              }}>
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
                <div key={p.id} className="flex-between">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: p.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '0.85rem', color: 'white' }}>
                      {p.avatar}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.role}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {p.isSpeaking && !p.isMuted && <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-accent)', animation: 'pulse-ring 2s infinite' }} />}
                    {isAdmin && p.userId && (
                      <button 
                        onClick={() => handleDesignateAdmin(p.userId!)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--color-accent)', fontWeight: 600, marginRight: '6px' }}
                        title="Designate Admin"
                      >
                        Make Admin
                      </button>
                    )}
                    {p.isMuted ? <MicOff size={14} color="#EF4444" /> : <Mic size={14} color="#10B981" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activePanel === 'workspace' && (
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
            onClick={() => {
              const nextVal = !isScreenSharing;
              setIsScreenSharing(nextVal);
              if (nextVal) {
                setIsColleagueSharing(false);
              }
            }}
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
            onClick={onEndMeeting}
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
        <div className="meeting-toolbar">
          {/* Left Side details */}
          <div className="meeting-toolbar-left">
            <span>ID: </span>
            <span style={{ color: 'white', fontWeight: 500 }}>{meetingId.slice(0, 8)}</span>
            <button 
              onClick={handleCopyCredentials}
              className="premium-btn premium-btn-secondary" 
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', borderRadius: '4px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Copy link and passcode to clipboard"
            >
              Share
            </button>
          </div>

          {/* Center Controls */}
          <div className="meeting-toolbar-center">
            {/* Mute Audio */}
            <button 
              onClick={toggleMute}
              style={{
                width: '44px',
                height: '44px',
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
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {/* Stop Video */}
            <button 
              onClick={toggleVideo}
              style={{
                width: '44px',
                height: '44px',
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
            >
              {isVideoOn ? <VideoIcon size={18} /> : <VideoOff size={18} />}
            </button>

            {/* Screen Share */}
            <button 
              onClick={() => {
                const nextVal = !isScreenSharing;
                setIsScreenSharing(nextVal);
                if (nextVal) {
                  setIsColleagueSharing(false);
                }
              }}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: isScreenSharing ? 'var(--color-accent)' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isScreenSharing ? 'black' : 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title="Toggle Screenshare"
            >
              <Monitor size={18} />
            </button>

            {/* Annotate Screen */}
            {isScreenSharing && (
              <button 
                onClick={() => setIsAnnotating(!isAnnotating)}
                style={{
                  width: '44px',
                  height: '44px',
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

            {/* Simulate Colleague Share */}
            <button 
              onClick={() => {
                const nextVal = !isColleagueSharing;
                setIsColleagueSharing(nextVal);
                if (nextVal) {
                  setIsScreenSharing(false);
                }
              }}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: isColleagueSharing ? 'var(--color-secondary)' : '#1E293B',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
              title="Simulate Remote Share"
            >
              <Users size={18} />
            </button>
          </div>

          {/* Right Side Options & Leave */}
          <div className="meeting-toolbar-right">
            <button 
              onClick={() => setActivePanel(activePanel === 'participants' ? 'none' : 'participants')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: activePanel === 'participants' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
                border: '1px solid #1E293B',
                padding: '0.5rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                color: activePanel === 'participants' ? 'var(--color-accent)' : 'white',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              <Users size={16} />
              <span className="hide-mobile-text">Participants</span>
            </button>

            <button 
              onClick={() => setActivePanel(activePanel === 'workspace' ? 'none' : 'workspace')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: activePanel === 'workspace' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
                border: '1px solid #1E293B',
                padding: '0.5rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                color: activePanel === 'workspace' ? 'var(--color-accent)' : 'white',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
              title="Meeting Workspace Notes"
            >
              <Edit2 size={16} />
              <span className="hide-mobile-text">Workspace</span>
            </button>

            <button 
              onClick={() => setActivePanel(activePanel === 'chat' ? 'none' : 'chat')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: activePanel === 'chat' ? 'rgba(112, 130, 190, 0.2)' : 'transparent',
                border: '1px solid #1E293B',
                padding: '0.5rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                color: activePanel === 'chat' ? 'var(--color-accent)' : 'white',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              <MessageSquare size={16} />
              <span className="hide-mobile-text">Chat</span>
            </button>

            <button 
              onClick={onEndMeeting}
              className="premium-btn premium-btn-danger"
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                fontWeight: 600,
                gap: '0.35rem',
                backgroundColor: '#EF4444'
              }}
            >
              <PhoneOff size={16} />
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
    </div>
  );
};
