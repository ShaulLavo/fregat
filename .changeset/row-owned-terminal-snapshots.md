---
'ghostty-webgpu': patch
---

Fixed terminal snapshots retaining old screen copies when rows stay unchanged. Rows returned by `readRows`, `readTextRows`, `onFrame`, and `onTextFrame` now retain only their own cell records and graphemes while preserving lazy reads and held snapshot contents.
