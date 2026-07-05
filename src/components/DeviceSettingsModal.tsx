import React, { useEffect, useState } from 'react';
import { Camera, Mic, Volume2, X } from 'lucide-react';

interface DeviceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCamera: string;
  selectedMic: string;
  selectedSpeaker: string;
  onCameraChange: (deviceId: string) => void;
  onMicChange: (deviceId: string) => void;
  onSpeakerChange: (deviceId: string) => void;
}

export const DeviceSettingsModal: React.FC<DeviceSettingsModalProps> = ({
  isOpen,
  onClose,
  selectedCamera,
  selectedMic,
  selectedSpeaker,
  onCameraChange,
  onMicChange,
  onSpeakerChange
}) => {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    // Enumerate available hardware devices
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const videoDevs = devices.filter(d => d.kind === 'videoinput');
        const audioInDevs = devices.filter(d => d.kind === 'audioinput');
        const audioOutDevs = devices.filter(d => d.kind === 'audiooutput');
        setCameras(videoDevs);
        setMics(audioInDevs);
        setSpeakers(audioOutDevs);
      })
      .catch(err => console.warn('[Devices] Failed to list media devices:', err));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(7, 9, 14, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 15000,
      backdropFilter: 'blur(8px)',
      animation: 'fade-in 0.2s ease-out'
    }}>
      <div style={{
        backgroundColor: '#0F172A',
        border: '1px solid #1E293B',
        borderRadius: '12px',
        padding: '2rem',
        width: '100%',
        maxWidth: '450px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        position: 'relative',
        animation: 'pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', margin: 0, fontFamily: 'var(--font-heading)' }}>
            Audio & Video Devices
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748B',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.25rem'
            }}
          >
            <X size={20} />
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0 }}>
          Select and test your input and output hardware devices for the call.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Camera Selection */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>
              <Camera size={16} color="var(--color-primary)" />
              <span>Camera (Video Input)</span>
            </label>
            <select
              value={selectedCamera}
              onChange={(e) => onCameraChange(e.target.value)}
              className="premium-input"
              style={{ width: '100%', backgroundColor: '#020617', border: '1px solid #1E293B', color: 'white' }}
            >
              {cameras.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera (${device.deviceId.substring(0, 5)})`}
                </option>
              ))}
              {cameras.length === 0 && <option value="">No cameras detected</option>}
            </select>
          </div>

          {/* Microphone Selection */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>
              <Mic size={16} color="var(--color-primary)" />
              <span>Microphone (Audio Input)</span>
            </label>
            <select
              value={selectedMic}
              onChange={(e) => onMicChange(e.target.value)}
              className="premium-input"
              style={{ width: '100%', backgroundColor: '#020617', border: '1px solid #1E293B', color: 'white' }}
            >
              {mics.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone (${device.deviceId.substring(0, 5)})`}
                </option>
              ))}
              {mics.length === 0 && <option value="">No microphones detected</option>}
            </select>
          </div>

          {/* Speaker Selection */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600, color: 'white', marginBottom: '0.5rem' }}>
              <Volume2 size={16} color="var(--color-primary)" />
              <span>Speaker (Audio Output)</span>
            </label>
            <select
              value={selectedSpeaker}
              onChange={(e) => onSpeakerChange(e.target.value)}
              className="premium-input"
              style={{ width: '100%', backgroundColor: '#020617', border: '1px solid #1E293B', color: 'white' }}
            >
              {speakers.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Speaker (${device.deviceId.substring(0, 5)})`}
                </option>
              ))}
              {speakers.length === 0 && <option value="">No speakers detected (Using default)</option>}
            </select>
            <span style={{ fontSize: '0.65rem', color: '#64748B', marginTop: '0.25rem', display: 'block' }}>
              Note: Speaker routing (setSinkId) is supported on Chrome, Edge, and Firefox.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button
            onClick={onClose}
            className="premium-btn premium-btn-primary"
            style={{ padding: '0.5rem 1.5rem', fontWeight: 600 }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
