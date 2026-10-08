---
'@singapore-editor/collaboration': patch
---

Fixed `Session` retaining every received message ID during long sessions. Added `replayWindowSize`, defaulting to 8,192 IDs per sender, and `retire(peer)` to release a permanently retired peer session's replay state. `receive` now reports whether a message reached its handler. History requests now require a chunk `index`, retain verified prefixes and recover missing suffix chunks individually, allowing transfers larger than the replay window to progress through reordered delivery. Each peer has one active history download with bounded request credits; growing synchronization targets reuse verified prefixes. Submission retries rotate through bounded batches, and host pulses renew discovery and activation. Handoff acknowledgements target the connected outgoing host, preserving pulse delivery after departure.
