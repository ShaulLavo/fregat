---
'ghostty-webgpu': patch
---

Reuse unchanged terminal rows during scrolling in the WebGL and WebGPU frame builders. Preserve exact glyph placement, colors, selection, cursor, history, and upload ranges while rebuilding incoming or changed rows.
