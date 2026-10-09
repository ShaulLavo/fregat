---
'@singapore-editor/collab': patch
---

Breaking: Custom `Engine` implementations must implement `projectEffects(effects)` to return a snapshot with the selected effect states while preserving live state. Added `projectEffects` to `ReferenceEngine` and `TextbufferEngine` for local review snapshots that preserve the edit log. Added `ConfirmedWindow` to find concurrent edits by different authors and their inserted and deleted character ID spans within a bounded confirmed history.
