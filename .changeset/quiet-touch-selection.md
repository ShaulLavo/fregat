---
'@singapore-editor/core': patch
---

Fixed `Editor.clearDocument()`, `Editor.clear()`, and `Editor.detachSession()` retaining the previous document through touch selection state. These operations now cancel pending touch gestures.
