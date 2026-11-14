import React, { useState, useEffect } from 'react';
import { ShieldAlert, ArrowLeft, Loader2, Sparkles, UserPlus, CheckCircle } from 'lucide-react';
import { giinApi, supabase, isMeetingHostForUser } from '../supabaseClient';

interface WaitroomProps {
  meetingId: string;
  initialPasscode?: string;
  // Display name already collected on the pre-join check screen. This is
  // the single source: the check screen writes it, the Waitroom uses it —
  // no second name store, no re-typing for guests who already gave it.
  initialDisplayName?: string;
  user: { id: string; name: string; email: string } | null;
  onAdmitted: (meetingTitle: string, participantId: string, displayName: string) => void;
  onDeclined: () => void;
  onBack: () => void;
}

export const Waitroom: React.FC<WaitroomProps> = ({
  meetingId,
  initialPasscode = '',
  initialDisplayName = '',
  user,
  onAdmitted,
  onDeclined,
  onBack
}) => {
  const [meetingDetails, setMeetingDetails] = useState<{ title: string; passcode: string; require_waiting_room?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Passcode entry states
  const [passcode, setPasscode] = useState(initialPasscode);
  const [passcodeValidated, setPasscodeValidated] = useState(false);
  const [passcodeError, setPasscodeError] = useState('');

  // Profile entry states — the name comes from the pre-join check screen
  // (initialDisplayName) or the signed-in account; guests who skipped the
  // check still get the form below.
  const [displayName, setDisplayName] = useState(initialDisplayName || user?.name || '');
  const [participantId, setParticipantId] = useState<string>('');
  const [waitingStatus, setWaitingStatus] = useState<'Waiting' | 'Admitted' | 'Declined' | 'None'>('None');
  const [guestKey] = useState(() => user?.id || crypto.randomUUID());

  // Round 9 (9A/9B/9C): a hard stop shown instead of the join form —
  // removed by the host, link expired, or meeting ended.
  const [blocked, setBlocked] = useState<null | 'removed' | 'expired' | 'ended'>(null);

  // Round 9 (9B/9C): an ended meeting or an expired link stops here,
  // with a plain message — before any join is attempted. Both reads
  // are best-effort; the token route is the final gate either way.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await giinApi.getMeetingDetails(meetingId);
        if (data && (data as any).status === 'Completed') { setBlocked('ended'); setLoading(false); return; }
      } catch (e) { /* fail closed below: the join still goes through the token route */ }
      try {
        const exp = await giinApi.getMeetingLinkExpiry(meetingId);
        if (exp && exp.expiresAt && exp.mode !== 'on-end' && new Date(exp.expiresAt).getTime() < Date.now()) {
          setBlocked('expired'); setLoading(false); return;
        }
      } catch (e) { /* no expiry on file: the link is live */ }
    })();
  }, [meetingId]);

  // If already admitted once, bypass waitroom completely — unless the
  // meeting has since ENDED, in which case the old link must not
  // re-enter (the flag is per-browser and was never cleared on the
  // guest's side). Check the meeting status first.
  useEffect(() => {
    if (localStorage.getItem(`admitted_meeting_${meetingId}`) !== 'true') return;
    (async () => {
      try {
        const { data } = await giinApi.getMeetingDetails(meetingId);
        if (data && (data as any).status === 'Completed') {
          setBlocked('ended');
          setLoading(false);
          return;
        }
        // Round 9 (9A): a removed guest must never slip through the
        // admitted-flag bypass — their row is 'Removed', not 'Admitted'.
        // A guest who left and came back gets the same row reactivated;
        // a Waiting/Declined row falls back to the normal form (the
        // token route refuses anyone who is not Admitted anyway).
        const rowId = localStorage.getItem(`giin_participant_row_${meetingId}`);
        if (rowId) {
          const rowStatus = await giinApi.checkParticipantStatus(rowId);
          if (rowStatus === 'Removed') { setBlocked('removed'); setLoading(false); return; }
          if (rowStatus === 'Left') {
            try {
              const rejoined: any = await giinApi.joinMeetingRoom(meetingId, user?.name || displayName || 'Guest', user?.id, 'Participant', 'Admitted');
              if (rejoined?.id) { try { localStorage.setItem(`giin_participant_row_${meetingId}`, rejoined.id); } catch (e) {} }
            } catch (e: any) {
              if (String(e?.message || '').startsWith('REMOVED')) { setBlocked('removed'); setLoading(false); return; }
              // Any other failure: fall through to the normal waitroom.
            }
          } else if (rowStatus === 'Waiting' || rowStatus === 'Declined') {
            return;
          }
        }
      } catch (e) {
        // Fix Round 7 (#13): a failed status check must NOT admit
        // anyone - fail CLOSED. The guest falls back to the normal
        // waiting-room flow (the details effect below shows the form);
        // if the host admits them there, they join as usual.
        return;
      }
      const savedTitle = localStorage.getItem(`admitted_meeting_title_${meetingId}`) || 'GIIN MEET Call';
      const savedName = localStorage.getItem(`admitted_meeting_name_${meetingId}`) || displayName || user?.name || 'Guest';
      onAdmitted(savedTitle, user?.id || guestKey, savedName);
    })();
  }, [meetingId, onAdmitted, user]);

  // Load meeting details on mount
  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const { data, error } = await giinApi.getMeetingDetails(meetingId);
        if (error || !data) {
          setErrorMsg('Meeting does not exist or has been deleted.');
        } else {
          setMeetingDetails(data);
          // An ended meeting stays ended: stop here with a plain message
          // instead of letting the guest wait forever for a host who
          // will never admit them (the token route rejects ended
          // meetings too, as a second line of defence).
          if ((data as any).status === 'Completed') {
            setBlocked('ended');
            setLoading(false);
            return;
          }
          // Host bypass (server truth): the meeting's creator never verifies
          // a passcode and never waits. Admit them straight into the room.
          if (user?.id && (await isMeetingHostForUser(data, user))) {
            try {
              const hostRow: any = await giinApi.joinMeetingRoom(meetingId, user.name || 'You', user.id, 'Admin', 'Admitted');
              if (hostRow?.id) {
                try { localStorage.setItem(`giin_participant_row_${meetingId}`, hostRow.id); } catch (e) {}
              }
            } catch (e) { /* host entry does not depend on the row write */ }
            try {
              localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
              localStorage.setItem(`admitted_meeting_title_${meetingId}`, data.title || 'GIIN MEET Call');
              localStorage.setItem(`admitted_meeting_name_${meetingId}`, user.name || 'You');
            } catch (e) {}
            onAdmitted(data.title || 'GIIN MEET Call', user.id, user.name || 'You');
            return;
          }
          // Passcode: verified SERVER-side (see giinApi.verifyPasscode).
          // The passcode is never compared in this component any more —
          // the meetings table is publicly readable, so a client-side
          // comparison was only ever a UI gate, not a secret. A code that
          // arrived in the invite link is verified the same way; a meeting
          // with no passcode at all skips the form.
          try {
            const verdict = await giinApi.verifyPasscode(meetingId, initialPasscode);
            if (verdict.valid) {
              setPasscodeValidated(true);
            } else if (!verdict.hasPasscode) {
              setPasscodeValidated(true);
            }
            // Otherwise the form stays up with the link's code prefilled
            // so the user can correct it.
          } catch (e: any) {
            setPasscodeError(e?.message || 'Could not verify the passcode. Please check your connection and try again.');
          }
        }
      } catch (err) {
        console.error('Failed to load meeting details:', err);
        setErrorMsg('Unable to reach authentication servers.');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [meetingId, initialPasscode, user]);

  // Fix Round 6 (Phase 6) — the host may end the meeting while someone
  // is still here (passcode screen or waiting room, before any
  // participant row exists). Poll the meeting itself, not just the
  // participant row: an ended meeting shows the ended message instead
  // of a wait that never ends.
  useEffect(() => {
    if (waitingStatus === 'Admitted') return;
    let active = true;
    const checkEnded = async () => {
      try {
        const { data } = await giinApi.getMeetingDetails(meetingId);
        if (active && data && (data as any).status === 'Completed') {
          setErrorMsg('This meeting has ended. The invite link no longer works.');
          setWaitingStatus('None');
          setLoading(false);
        }
      } catch (e) { /* transient: keep waiting */ }
    };
    const id = setInterval(checkEnded, 5000);
    return () => { active = false; clearInterval(id); };
  }, [meetingId, waitingStatus]);

  // Real-time waiting room status checking with fallback polling and instant broadcast channel
  useEffect(() => {
    if (waitingStatus !== 'Waiting') return;

    let active = true;

    // 1. Database fallback checking (if participantId is available)
    const checkStatus = async () => {
      if (!participantId || !active) return;
      try {
        const status = await giinApi.checkParticipantStatus(participantId);
        if (status === 'Admitted' && active) {
          setWaitingStatus('Admitted');
          localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
          localStorage.setItem(`admitted_meeting_title_${meetingId}`, meetingDetails?.title || 'GIIN MEET Call');
          localStorage.setItem(`admitted_meeting_name_${meetingId}`, displayName);
          onAdmitted(meetingDetails?.title || 'GIIN MEET Call', participantId, displayName);
        } else if (status === 'Declined' && active) {
          setWaitingStatus('Declined');
          onDeclined();
        }
      } catch (err) {
        console.error('Waiting status check failure:', err);
      }
    };

    if (participantId) {
      checkStatus();
    }

    // 2. Instant Broadcast Channel subscription
    const waitChannel = supabase.channel(`sig-webrtc-${meetingId}`, {
      config: {
        broadcast: { self: false }
      }
    });
    
    waitChannel
      .on('broadcast', { event: 'waitroom-response' }, (payload: any) => {
        const data = payload.payload;
        if (data.targetKey === guestKey || (participantId && data.targetKey === participantId)) {
          if (data.status === 'Admitted' && active) {
            setWaitingStatus('Admitted');
            localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
            localStorage.setItem(`admitted_meeting_title_${meetingId}`, meetingDetails?.title || 'GIIN MEET Call');
            localStorage.setItem(`admitted_meeting_name_${meetingId}`, displayName);
            onAdmitted(meetingDetails?.title || 'GIIN MEET Call', data.targetKey, displayName);
          } else if (data.status === 'Declined' && active) {
            setWaitingStatus('Declined');
            onDeclined();
          }
        }
      })
      .subscribe();

    // 3. Broadcast presence request to host every 2 seconds
    const broadcastInterval = setInterval(() => {
      waitChannel.send({
        type: 'broadcast',
        event: 'waitroom-request',
        payload: {
          senderKey: guestKey,
          name: displayName,
          // The database participant row id, once we have it. The host
          // admits by this id — the signalling key alone matches no
          // database row, so the host's admit used to leave the guest
          // stuck on 'Waiting' in the database forever.
          participantRowId: participantId || undefined
        }
      });
    }, 2000);

    // Standby database polling fallback every 4 seconds
    const pollInterval = setInterval(() => {
      if (participantId) {
        checkStatus();
      }
    }, 4000);

    return () => {
      active = false;
      supabase.removeChannel(waitChannel);
      clearInterval(broadcastInterval);
      clearInterval(pollInterval);
    };
  }, [participantId, waitingStatus, meetingDetails, displayName, onAdmitted, onDeclined, guestKey, meetingId]);

  // Handle Passcode Validation — server-side only. The typed code is sent
  // to /api/meetings/verify-passcode and only a true/false comes back;
  // the real passcode never reaches this component.
  const handleVerifyPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingDetails) return;
    setPasscodeError('');
    setLoading(true);
    try {
      const verdict = await giinApi.verifyPasscode(meetingId, passcode);
      if (verdict.valid) {
        // Joining itself happens in the auto-join effect below, which
        // uses the account name or the name from the pre-join check.
        setPasscodeValidated(true);
      } else {
        setPasscodeError('Invalid passcode. Please check and try again.');
      }
    } catch (err: any) {
      setPasscodeError(err?.message || 'Could not verify the passcode. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Join wait list in database
  const joinWaitingRoom = async (name: string, _pcode?: string) => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      // Fix Round 7 (#6): a locked meeting does NOT auto-admit.
      const isLockedForJoin = meetingDetails?.require_waiting_room === false ? await giinApi.getMeetingLock(meetingId) : false;
      if (meetingDetails?.require_waiting_room === false && !isLockedForJoin) {
        // Immediately admit — but still write the participant row, so the
        // host sees this guest in the room and host controls (kick) work.
        // The old code returned without a row, leaving the guest invisible
        // to the host's participant list. Best-effort: admission itself
        // does not depend on the write.
        try {
          const data = await giinApi.joinMeetingRoom(meetingId, name, user?.id, 'Participant', 'Admitted');
          if (data) {
            setParticipantId(data.id);
            try { localStorage.setItem(`giin_participant_row_${meetingId}`, data.id); } catch (e) {}
          }
        } catch (e: any) {
          console.warn('[Waitroom] Could not write participant row for immediate admit:', e?.message);
        }
        // Immediately admit!
        setWaitingStatus('Admitted');
        localStorage.setItem(`admitted_meeting_${meetingId}`, 'true');
        localStorage.setItem(`admitted_meeting_title_${meetingId}`, meetingDetails.title || 'GIIN MEET Call');
        localStorage.setItem(`admitted_meeting_name_${meetingId}`, name);
        onAdmitted(meetingDetails.title || 'GIIN MEET Call', user?.id || guestKey, name);
        return;
      }

      setWaitingStatus('Waiting');
      const data = await giinApi.joinMeetingRoom(meetingId, name, user?.id);
      if (data) {
        setParticipantId(data.id);
        // Remember our own participant row id. Guests have user_id NULL in
        // the database, so this row id is the only reliable way to identify
        // our own row later (e.g. when the host kicks us).
        try { localStorage.setItem(`giin_participant_row_${meetingId}`, data.id); } catch (e) {}
      }
    } catch (err: any) {
      console.error('Could not join the waiting room:', err);
      // Round 9 (9A): the rejoin route refused a removed participant.
      if (String(err?.message || '').startsWith('REMOVED')) { setBlocked('removed'); return; }
      setErrorMsg(`Could not join the waiting room: ${err?.message || 'please check your connection and try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  // Anyone who already has a display name — signed-in account name, or
  // the name collected on the pre-join check screen — joins straight away
  // once the passcode step is done (or there is none). Guests without a
  // name yet still get the name form below.
  useEffect(() => {
    if (!passcodeValidated || waitingStatus !== 'None' || !meetingDetails) return;
    const effectiveName = user?.name || displayName.trim();
    if (effectiveName) {
      joinWaitingRoom(effectiveName, undefined);
    }
  }, [passcodeValidated, waitingStatus, meetingDetails, user, displayName]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !meetingDetails) return;
    joinWaitingRoom(displayName, meetingDetails.passcode);
  };

  if (loading) {
    const loadingMessage = waitingStatus === 'Waiting' 
      ? 'Wait for Host to admit you...' 
      : 'Configuring secure tunnel...';
    return (
      <div className="flex-center" style={{ minHeight: '80vh', flexDirection: 'column', gap: '1rem' }}>
        <Loader2 size={40} className="mic-indicator" color="var(--color-primary)" style={{ animation: 'spin 1.5s linear infinite' }} />
        <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{loadingMessage}</span>
      </div>
    );
  }

  if (blocked) {
    const copy = blocked === 'removed'
      ? { title: 'You were removed from this meeting', text: 'The host removed you. You can\'t rejoin with this link unless the host invites you back.' }
      : blocked === 'expired'
      ? { title: 'This meeting link has expired', text: 'This link is no longer valid. Ask the host for a new link.' }
      : { title: 'This meeting has ended', text: 'The meeting has ended. The invite link no longer works.' };
    return (
      <div className="flex-center" style={{ minHeight: '80vh', padding: '2rem' }}>
        <div className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '2.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ alignSelf: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#EF4444' }}>
            <ShieldAlert size={28} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', marginBottom: '0.5rem' }}>{copy.title}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{copy.text}</p>
          </div>
          <button onClick={onBack} className="premium-btn premium-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex-center" style={{ minHeight: '80vh', padding: '2rem' }}>
        <div className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '2.5rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ alignSelf: 'center', width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center', color: '#EF4444' }}>
            <ShieldAlert size={28} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', marginBottom: '0.5rem' }}>Connection Denied</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{errorMsg}</p>
          </div>
          <button onClick={onBack} className="premium-btn premium-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
            <ArrowLeft size={16} />
            <span>Go Back</span>
          </button>
          <button
            onClick={() => {
              setErrorMsg('');
              joinWaitingRoom(displayName || user?.name || 'Guest', meetingDetails?.passcode);
            }}
            className="premium-btn premium-btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <span>Try Again</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-center" style={{ minHeight: '80vh', padding: '2rem' }}>
      <div className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* Header Title details */}
        <div style={{ textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            <Sparkles size={12} />
            <span>GIIN MEET Security waitroom</span>
          </span>
          <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)' }}>
            {meetingDetails?.title || 'Active Video Call'}
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {meetingId.slice(0, 8)}...</span>
        </div>

        <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: 0 }} />

        {/* Step 1: Passcode Verification */}
        {!passcodeValidated && (
          <form onSubmit={handleVerifyPasscode} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Enter Meeting Passcode
              </label>
              <input 
                type="text" 
                className="premium-input" 
                placeholder="e.g. AB12CD" 
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.toUpperCase())}
                required
                style={{ textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: '1.25rem', height: '50px' }}
              />
              {passcodeError && (
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#EF4444', marginTop: '0.5rem' }}>
                  {passcodeError}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={onBack} className="premium-btn premium-btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button type="submit" className="premium-btn premium-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                Verify Code
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Name Entry — only for guests who did not already give a
            name on the pre-join check screen; signed-in users auto-join
            with their account name. */}
        {passcodeValidated && waitingStatus === 'None' && !user?.name && !initialDisplayName && (
          <form onSubmit={handleNameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Enter Your Display Name
              </label>
              <input 
                type="text" 
                className="premium-input" 
                placeholder="Your Name (e.g. John Doe)" 
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                style={{ height: '46px' }}
              />
              <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                This is how other participants and the host will identify you in the room.
              </span>
            </div>

            <button type="submit" className="premium-btn premium-btn-accent" style={{ width: '100%', justifyContent: 'center', height: '46px' }}>
              <UserPlus size={18} />
              <span>Ask to Join Meeting</span>
            </button>
          </form>
        )}

        {/* Step 3: Waiting in waitroom */}
        {waitingStatus === 'Waiting' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                border: '3px solid var(--border-color)',
                borderTopColor: 'var(--color-secondary)',
                animation: 'spin 1s linear infinite'
              }} />
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'var(--color-secondary)'
              }}>
                <CheckCircle size={24} />
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-heading)', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                Waitroom Access Granted
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '300px', lineHeight: 1.45 }}>
                Wait for Host to admit you... Please don't close this window.
              </p>
            </div>

            <div style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Connected as <strong style={{ color: 'var(--text-main)' }}>{displayName}</strong>
            </div>

            <button onClick={onBack} className="premium-btn premium-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
              Leave Waitroom
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
