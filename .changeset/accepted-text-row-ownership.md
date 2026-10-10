---
'ghostty-webgpu': patch
---

Improved native WebGL and WebGPU text updates when `onText` or accessibility is enabled by reusing accepted rows. Rows copied by `readTextRows()` now keep only their own cell and grapheme data alive.
