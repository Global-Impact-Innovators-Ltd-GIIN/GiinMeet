# Audio Engineering - 3D Spatial Audio & Voice Filters

GIIN Meet provides an immersive conferencing experience using the Web Audio API to route and process microphone audio tracks.

---

## 1. Web Audio Panning Node Graph
When remote audio streams are added:
1. They bypass the standard HTML DOM `<audio>` tag (`muted={isSpatialAudioEnabled}`).
2. A `MediaStreamAudioSourceNode` is generated to capture the audio buffer.
3. The source feeds into a `StereoPannerNode` which pans the track from Left to Right:
   - Values scale from `-0.7` (far left) to `0.7` (far right).
   - Horizontal indices match the participant's layout coordinate index in the meeting grid.
4. The panner outputs to the `AudioContext.destination`.

---

## 2. Decibel Noise Gate
Eliminates breathing, clicks, and background hum:
- A threshold state `noiseGateThreshold` (values `-100 dB` to `0 dB`) is registered.
- Signals below this decibel value are gain-scaled to `0` (muted).

---

## 3. Equalizer Pitch Profiles
Custom filter frequencies shift vocal pitches:
- **Baritone**: Boosts low-mid frequencies (100 Hz - 250 Hz) for a deep broadcast tone.
- **High**: Amplifies upper gains (2 kHz - 5 kHz) for crisp vocals.
- **Robotic / Alien**: Connects delay and feedback loop nodes to distort pitch frequencies.
