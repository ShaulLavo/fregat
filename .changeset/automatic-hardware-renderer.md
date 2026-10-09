---
'ghostty-webgpu': patch
---

Fixed automatic renderer selection to choose WebGL when WebGPU offers a software adapter, including in worker terminals. An explicit worker `backend: 'webgpu'` continues to use any available WebGPU adapter.
