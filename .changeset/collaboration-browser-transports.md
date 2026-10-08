---
'@singapore-editor/collaboration': patch
---

Added `WebRTCTransport` and `BroadcastTransport` for browser collaboration, plus `WebSocketSignaling` and a self-hostable Bun broker. `RoomCrypto` encrypts room signaling with an invitation secret. The broker requires admission and explicit connection, rate and deadline limits. Independent peer handshakes keep slow TURN or ICE work from stalling the room, and duplicate tab identities report an authenticated error.
