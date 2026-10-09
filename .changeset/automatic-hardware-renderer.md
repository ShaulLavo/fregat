---
'ghostty-webgpu': patch
---

Fixed initial automatic renderer selection to choose WebGL for software WebGPU adapters, including worker terminals. WebGPU terminals can repaint with a software replacement after device loss. Replacement acquisition failures reach the renderer's `onError` callback and the terminal's `error` event.
