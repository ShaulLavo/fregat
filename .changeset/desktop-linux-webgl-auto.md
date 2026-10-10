---
'ghostty-webgpu': patch
---

Changed `backend: 'auto'` and the main-thread automatic renderer to prefer WebGL on desktop Linux, where it measured lower CPU work than WebGPU. macOS and Windows still prefer hardware WebGPU, and explicit `backend: 'webgpu'` keeps its current behavior. Automatic selection continues after WebGL resource allocation failures, and managed WebGL context-loss recovery tries the remaining backends in platform order.
