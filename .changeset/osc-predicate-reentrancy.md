---
'ghostty-webgpu': patch
---

Fixed `subscribeCustomOsc` payload corruption when its capture predicate writes to the same terminal. Each observation preserves the original OSC payload through reentrant terminal writes.
