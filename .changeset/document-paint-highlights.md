---
'@singapore-editor/core': patch
---

Fixed document snapshot syntax colours changing text shaping across token boundaries, and preserved captured kerning and ligature settings. Added `preparePaintSnapshotHighlights` and `activatePaintSnapshotHighlights` to `@singapore-editor/core/paint`: prepare visibility in an inline head bundle before streamed markup, then activate each root synchronously; failures reveal readable content and `mountPaintSnapshot` activates automatically. Emitted text and layout remain readable with JavaScript disabled, while malformed or repeated source slices are refused before allocating highlights.
