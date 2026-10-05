---
'ghostty-webgpu': patch
---

Share the default WebGPU device across terminals and submit their separate canvas command buffers together in one render turn. Retain independent terminal resources, device leases, and frame snapshots before delivering callbacks.
