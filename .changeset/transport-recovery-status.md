---
'@singapore-editor/collaboration': patch
---

Added `onRecovery` callbacks to `BroadcastTransport`, `WebRTCTransport`, and `WebSocketSignaling`, scoped to the send or receive direction, peer link, or broker URL and direction. WebRTC signaling publication and reception have separate scopes; only a successful publication clears a send failure. Added `WebRTCTransport.onPeerLeft` and failure scopes in `onError` so applications can keep active connection errors visible until the affected transport recovers or the peer departs.
