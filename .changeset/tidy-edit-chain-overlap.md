---
'@singapore-editor/core': patch
---

Fixed `changesSinceDocumentSyncPoint` and `changesBetweenDocumentSyncPoints` returning unavailable edits when later deletions or replacements overlap earlier edits. Retained history now composes these edits in the original document's coordinates.
