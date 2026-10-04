---
'ghostty-webgpu': patch
---

Add an explicit experimental Canvas pixel paint mode with a lazily loaded packed WASM compositor, and preserve native cell ownership in both Canvas paint modes. The main terminal entry accepts the renderer mode; the worker entry reports an explicit capability error for Canvas modes.
