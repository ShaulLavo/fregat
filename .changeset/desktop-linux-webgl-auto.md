---
'ghostty-webgpu': patch
---

Changed `backend: 'auto'` and the main-thread automatic renderer to prefer WebGL on desktop Linux, where it measured lower CPU work than WebGPU. macOS and Windows still prefer hardware WebGPU, and explicit `backend: 'webgpu'` keeps its current behavior.
