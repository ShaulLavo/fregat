---
'ghostty-webgpu': patch
---

Fixed comparison packets to include and hash every runtime WASM asset, including the Canvas pixel compositor. Packets built with `--runtime-ref` now keep these assets tied to the selected source revision.
