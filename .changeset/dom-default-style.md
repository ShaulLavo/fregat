---
'ghostty-webgpu': patch
---

Improved DOM rendering with contained fixed-row layout, direct plain-row text projection, and reused styles while preserving every terminal column, immutable snapshot, styled cell, selection, cursor, and wide glyph. Reused live canvas style declarations while keeping per-frame flow and padding updates. Fixed DOM `setTheme` colours when a host mutates and reapplies an RGB object.
