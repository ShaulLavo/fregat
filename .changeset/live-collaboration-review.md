---
'@singapore-editor/collaboration': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/core': patch
---

Added `mergeReview` to `createCollaborationPlugin` for confirmed concurrent-edit highlights, author-version hovers, local dismissal and bounded resolutions that reach every peer. Added `onMergeReview(unit, versions)` for host actions.

Added `createTreeSitterReviewSyntax` for demand-only review reads from immutable document snapshots, and `mergeUnit` touching selection for intersected syntax units. Added `createEditorSnapshotBuffer` and `DocumentDelivery` to the internal document-worker entry point for snapshot reader integrations.
