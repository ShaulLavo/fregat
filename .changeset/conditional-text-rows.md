---
'ghostty-webgpu': patch
---

Improved `GhosttyRenderState.readTextRows()` and renderer `onFrame` snapshots by reusing unchanged row text during scrolling. Returned text stays stable across later writes, resizing, and WebAssembly memory growth.
