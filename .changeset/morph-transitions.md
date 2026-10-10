---
'@singapore-editor/decode': patch
---

Added `createMorphPlugin`, which animates text changes: text that survives an edit slides to its new place, removed text fades out, and new text streams in. Undo, redo and edits of at least `minEditChars` characters morph; `durationMs` and `bounce` shape the motion.
