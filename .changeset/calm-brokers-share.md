---
'@singapore-editor/collaboration': patch
---

Breaking: Custom credential-bearing WebSocket clients must offer the public `singapore-collaboration` protocol, which `WebSocketSignaling` adds automatically; the broker selects only that protocol in response headers. Added trusted-proxy client address resolution, configurable IPv6 prefix quotas, and per-member admission limits to `startSignalingServer`, with a default of 16 connections per authenticated member. Shared admission retains global and per-address limits. The bundled example now requires a private file of unique member-token pairs and rejects the former shared-token format. Fixed reattachment with a retained peer ID and isolated each WebRTC peer's handshake memory share.
