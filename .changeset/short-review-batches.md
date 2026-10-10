---
'@singapore-editor/tree-sitter': patch
'@singapore-editor/collaboration': patch
---

Improved merge review with bounded worker batches that let highlighting interleave, preserve snapshot retention, and observe both batch and entry cancellation. Added `TreeSitterReviewSyntax.batch` for reading current and projected snapshots together. Added the `readOnly` parse option to skip edit-parser warm-up for immutable snapshots.
