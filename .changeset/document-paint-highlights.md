---
'@singapore-editor/core': patch
---

Fixed document snapshot syntax colours changing text shaping across token boundaries, and preserved captured kerning and ligature settings. Added `activatePaintSnapshotHighlights` to `@singapore-editor/core/paint` for synchronously activating emitted snapshot HTML before its first visible frame; `mountPaintSnapshot` activates automatically. Emitted text and layout remain readable with JavaScript disabled, using base colours on continuous-text rows.
