---
'ghostty-webgpu': patch
---

Release each worker WebGPU device once and wait for pending acquisition and recovery cleanup before confirming disposal. Bound shutdown waits with a timeout, including failures while the worker is idle.
