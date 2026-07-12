# Product Requirement Document (PRD) - GIIN Meet Virtualization Hub

## 1. Executive Summary
GIIN Meet is a next-generation collaborative video-conferencing workspace engineered to deliver zero-drop communication, flexible corporate branding, and advanced interactive panels. It leverages a fully decentralized peer-to-peer WebRTC mesh to facilitate screen sharing and voice conferencing, accompanied by interactive whiteboards, live speech transcription, and E2EE encrypted chat widgets.

---

## 2. Core Feature Specifications

### 2.1 WebRTC Mesh & Perfect Negotiation
- **Bidirectional Screen Sharing**: Any participant must be able to share their screens or audio channels simultaneously without causing offer/answer state collisions (glare).
- **Polite Peer Glare Resolution**: When two peers initiate negotiation at the same time, the peer with the lexicographically smaller ID acts as "polite", rolling back its local offer and accepting the remote offer.
- **Auto ICE Restarts**: Automatic ICE restarts must trigger immediately if a peer enters a `disconnected` state, healing high-latency streams before timing out.

### 2.2 3D Spatial Audio & Audio Suppression
- **Position-based Panning**: Sound signals from remote participants must pan horizontally (left to right, scale `-0.7` to `0.7`) corresponding to their position in the meeting layout grid.
- **Hardware Voice Pitch Profiling**: Custom equalizers allow participants to pitch-shift their audio output (e.g., normal, broadcast baritone, robotic, studio high, alien).
- **Decibel Noise Gate**: Sliders (scale `-100 dB` to `0 dB`) mute any audio signal below the threshold to eliminate room noise or heavy breathing.

### 2.3 Brand Layout & UI Styles Engine
- **10 Core Themes**:
  1. *Glassmorphism*: Semi-transparent frosting, light blur panels, ambient drop shadows.
  2. *Neumorphism*: Soft convex and concave borders, dual light/dark bevel shadows.
  3. *Cyberpunk Glow*: Neon borders, active drop shadows, dark slate panels.
  4. *Flat Minimal*: No shadows, simple borders, plain dark/light background.
  5. *Liquid Glass*: Dark gradients (blue-indigo-purple), ultra-glass panels, saturated colors.
  6. *Bento Grid*: Structured tiles, thick solid borders, hard drop shadows.
  7. *Spatial UI*: 3D transformations (`translateZ`), deep shadows, floating containers.
  8. *Skeuomorphism*: Tactile raised button gradients, clicky inset active states, realistic rounded frames.
  9. *Minimalism*: Monochrome grayscale, thin light lines, clean margins.
  10. *Maximalism*: Bright neon backdrops, thick black outlines, bold uppercase buttons.

### 2.4 Collaborative Whiteboard
- **Shapes Toolkit**: Tools to select between Freehand Pen, Straight Lines, Rectangles, Circles, and Sticky Notes.
- **Vector Serialization**: All strokes and shapes must be serialized (`x0, y0, x1, y1, color, width, type`) and broadcasted via real-time signaling channels.
- **Local Sticky Notes**: Absolute-positioned input post-its layered over the canvas with resizing, dragging, and live typing synchronization.

### 2.5 AI Transcript Companion
- **Dual-panel Sidebar**: Combines speech captions with an **AI Copilot** tab.
- **Real-Time Summarizer**: Simulates NLP transcript parsing to yield bulleted Key Decisions, checklist Action Items with assignment targets, and structural Meeting Summary Notes.

### 2.6 Chat Center Upgrades
- **Encrypted Whispers**: Secured text messages directed at individual group members. Cipher texts must be encrypted at database level and decodable only by the sender and target recipient.
- **Markdown Toolbar**: Formatting widgets for bold (`**`), italic (`*`), strikethrough (`~~`), code blocks (`` ` ``), headers (`#`), and blockquotes (`>`).
- **PDF File Previews**: Chat bubbles automatically intercept PDF attachments and load them inside inline frames.

---

## 3. Technology Stack
- **Frontend**: React (v19), TypeScript (v6), Vite (v8)
- **Styling**: Vanilla CSS, global HSL/RGB custom property selectors
- **Database & Signaling**: Supabase Realtime (Realtime Channel broadcast pipelines)
- **Media API**: HTML5 WebRTC API (`RTCPeerConnection`), Web Audio API (`AudioContext`, `StereoPannerNode`, `MediaStreamAudioSourceNode`)
