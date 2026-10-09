---
'@singapore-editor/tree-sitter': patch
---

Fixed the bundled parser runtime's `TreeCursor.gotoFirstChildForIndex` and `TreeCursor.gotoFirstChildForPosition` methods to select the requested child and report success correctly, including the first child and late children in large documents.
