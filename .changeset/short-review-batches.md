---
'@singapore-editor/tree-sitter': patch
'@singapore-editor/collaboration': patch
---

Improved merge review with bounded worker batches that let highlighting interleave, preserve snapshot retention, and observe both batch and entry cancellation. Added `TreeSitterReviewSyntax.batch` for reading current and projected snapshots together and the `readOnly` parse option to skip edit-parser warm-up for immutable snapshots. Read-only parsing reuses mutable snapshots without changing their intent; mutable parsing and editing rebuild immutable bases.
