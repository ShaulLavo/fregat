---
'ghostty-webgpu': patch
---

Fixed `onFrame` and `onTextFrame` snapshots retaining many old screen copies when rows stay unchanged. Snapshot storage is compacted when retained packets exceed twice the live rows' payload, preserving lazy reads and previously held snapshot contents.
