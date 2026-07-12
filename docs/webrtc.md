# WebRTC Mesh signaling - Perfect Negotiation

In a multi-user mesh video conference, any user can share their screen or toggle tracks at any time. Standard WebRTC connection logic breaks down when both users send offers simultaneously (creating a "glare" conflict). 

GIIN Meet implements the **Perfect Negotiation** pattern to resolve glare conflicts.

---

## 1. Polite vs. Impolite Peers
Every participant is assigned a unique client ID (`myKey`) upon joining.
When negotiating a connection, peers classify each other lexicographically:
- **Polite Peer**: If my ID is smaller than the remote ID (`myKey < remoteKey`).
- **Impolite Peer**: If my ID is larger than the remote ID.

```typescript
const polite = myKey < senderKey;
```

---

## 2. Collision Handling
When a glare collision occurs (e.g. an incoming offer arrives while in `have-local-offer` state):
- The **Impolite Peer** ignores the incoming offer and keeps its local offer active.
- The **Polite Peer** rolls back its local offer:
  ```typescript
  await pc.setLocalDescription({ type: "rollback" });
  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ```

This ensures that only one offer/answer pair is successfully negotiated, preventing connection state drops.
