# System State & Memory Documentation - GIIN Meet

This document details the database schema configurations, client-side states, and real-time messaging payloads that power GIIN Meet.

---

## 1. Database Schema
Supabase Postgres stores configuration states, user details, and message histories.

### 1.1 `messages` Table
Tracks chats, file payloads, and whispers:
```sql
CREATE TABLE messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  thread_id VARCHAR(255) NOT NULL,
  sender_name VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

### 1.2 `meetings` Table
Tracks workspace scheduled conferences:
```sql
CREATE TABLE meetings (
  id VARCHAR(255) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  passcode VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

---

## 2. Client-Side React States

### 2.1 WebRTC Connections
- `pcsRef`: A reference map containing `{ [peerKey: string]: RTCPeerConnection }`.
- `makingOfferRef`: Track if a peer is in the process of generating an offer: `{ [peerKey: string]: boolean }`.
- `remoteStreams`: Stored stream tracks: `{ [peerKey: string]: MediaStream }`.

### 2.2 Whiteboard Vector Cache
- `whiteboardStrokesRef`: Array containing serialized drawing details:
  ```typescript
  interface Stroke {
    type: 'pen' | 'line' | 'rect' | 'circle';
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    color: string;
    width: number;
  }
  ```
- `stickyNotes`: React array state:
  ```typescript
  interface StickyNote {
    id: string;
    x: number; // percentage
    y: number; // percentage
    text: string;
    color: string;
  }
  ```

---

## 3. Real-Time Signaling Events
All peers broadcast and subscribe to events on Supabase channels:
1. `signal`: WebRTC handshakes (`offer`, `answer`, `candidate`).
2. `join`: Fired when a new user enters a room, carrying webcam/mute states.
3. `leave`: Cleanup user coordinates and disconnect peer connection.
4. `draw-whiteboard`: Vector shape details.
5. `clear-whiteboard`: Wipe whiteboard canvas.
6. `sticky-add` / `sticky-update` / `sticky-delete`: Manage collaborative sticky note states.
7. `live-caption`: Real-time speech transcription chunks.
