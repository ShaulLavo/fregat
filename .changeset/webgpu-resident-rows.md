---
'ghostty-webgpu': patch
---

Improved WebGPU terminal scrolling by retaining unchanged rows in GPU buffers and uploading changed record ranges. WebGPU devices with multiple glyph storage batches retain their existing rendering layout.
