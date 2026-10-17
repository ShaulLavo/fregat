---
'ghostty-webgpu': patch
---

Added `experimentalCompositor` to `WebGpuTerminalRenderer.create` for testing compute and fullscreen fragment pixel composition. Both options preserve glyph overhang, cursor effects, and transparent backgrounds while using the existing terminal state and glyph atlas.
