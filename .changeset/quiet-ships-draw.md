---
'ghostty-webgpu': patch
---

Added `GhosttyTerminal.scrollSnapshot` to read the current scrollback length, scrollbar and viewport position together. Improved WebGPU frame submission by sharing command encoders across terminal canvases, and deferred mouse-mode synchronization until mouse input.
