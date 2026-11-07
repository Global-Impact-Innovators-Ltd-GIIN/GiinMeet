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

## 2. Audio enhancement (no noise gate)
There is no noise gate in the app. Microphone audio uses the browser's built-in echo cancellation, noise suppression and automatic gain control.

---

## 3. Voice pitch profiles — removed
Voice pitch profiles (baritone, high, robotic, alien) were removed: no pitch-shifting is implemented.
