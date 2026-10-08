---
'ghostty-webgpu': patch
---

Reduce Canvas fillText row copying and serialization, and reuse captured plain text to paint small edits with the same glyph and cursor pixels.
