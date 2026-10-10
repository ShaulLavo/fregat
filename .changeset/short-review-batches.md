---
'@singapore-editor/tree-sitter': patch
'@singapore-editor/collaboration': patch
---

Improved merge review by grouping syntax reads into worker batches. Added `TreeSitterReviewSyntax.batch` for reading current and projected snapshots together while preserving review marks and source cleanup.
