---
'ghostty-webgpu': patch
---

Fixed automatic renderer selection to choose WebGL when WebGPU offers a software adapter, including in worker terminals. An explicit worker `backend: 'webgpu'` continues to use any available WebGPU adapter. Device replacement acquisition failures now reach the renderer's `onError` callback and the terminal's `error` event.
