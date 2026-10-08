---
'@singapore-editor/collaboration': patch
---

Added `onRecovery` callbacks to `BroadcastTransport`, `WebRTCTransport`, and `WebSocketSignaling`, scoped to the send or receive direction, peer link, or broker URL. Added `WebRTCTransport.onPeerLeft` and failure scopes in `onError` so applications can keep active connection errors visible until the affected transport recovers or the peer departs.
