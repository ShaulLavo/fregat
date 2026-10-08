---
'@singapore-editor/collaboration': patch
---

Fixed `Session` retaining every received message ID during long sessions. Added `replayWindowSize`, defaulting to 8,192 IDs per sender, and `retire(peer)` to release a permanently retired peer session's replay state. `receive` now reports whether a message reached its handler.
