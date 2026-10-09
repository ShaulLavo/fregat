---
'@singapore-editor/collab': patch
'@singapore-editor/collaboration': patch
'@singapore-editor/tree-sitter': patch
---

Improved `ConfirmedWindow.pairs(batch)` and `MergeReviewDetector.detect()` to reduce the cost of reviewing confirmed edits. Added an optional base snapshot argument to `MergeReviewSyntax` so projected versions can reuse retained syntax.

Added `TreeSitterWorkerOwner.projectMergeUnits()` and `createTreeSitterInputEdits()` to review projected versions with bounded parent-context parsing and incremental fallback. Fixed damaged-line error lookups scanning unrelated syntax while keeping highlighting trees unchanged.

Fixed projected merge-unit requests retaining new syntax trees and sources after cancellation or query failure. Highlighting eviction now releases only projections of its own snapshot, so unrelated review sessions add no cleanup work.
