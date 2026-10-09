---
'@singapore-editor/collaboration': patch
'@singapore-editor/collab': patch
'@singapore-editor/tree-sitter': patch
---

Added `MergeReviewDetector` through `@singapore-editor/collaboration/merge-review` to report confirmed concurrent edits sharing syntax units, breaking a clean parse, duplicating a signature, or leaving stranded text. Added `TextbufferEngine.effectActive()` to identify active edits. Improved `TreeSitterWorkerOwner.mergeUnit()` with cancellable Markdown work, cached parent eligibility, and optional error/token analysis for review readers.
