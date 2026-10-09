---
'@singapore-editor/core': patch
---

Fixed `changesSinceDocumentSyncPoint` and `changesBetweenDocumentSyncPoints` returning `null` edits when a later deletion or replacement overlapped an earlier edit. They now return the combined edits, so consumers keep updating incrementally.
