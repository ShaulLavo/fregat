---
'@singapore-editor/collaboration': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/core': patch
'@singapore-editor/collab': patch
'@singapore-editor/plugin-ui': patch
---

Added `mergeReview` to `createCollaborationPlugin` for confirmed concurrent-edit highlights, author-version hovers, local dismissal and bounded resolutions that reach every peer. Added `onMergeReview(unit, versions)` for host actions.

Added `createTreeSitterReviewSyntax` for demand-only review reads from immutable document snapshots, and `mergeUnit` touching selection for intersected syntax units. Author projections reuse the confirmed syntax tree through `projectMergeUnits` and preserve nested injected languages, including code fences. Added `createEditorSnapshotBuffer` and `DocumentDelivery` to the internal document-worker entry point for snapshot reader integrations.

Fixed completed merge resolutions reappearing as new review actions. Added `ConfirmedWindow.isAfter` for retained causal ancestry, and restricted review detection to remote confirmations with deferred demand for concurrent pending acknowledgements.

Added `TooltipPart.presentation: 'controls'` for content-sized shared hovers with pane-bounded placement and a visible button footer. Review actions remain visible while long version comparisons scroll. Fixed host focus outlines appearing around comparison content; keyboard focus remains visible on buttons, and content sections use tone-only separation.
