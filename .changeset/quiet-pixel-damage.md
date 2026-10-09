---
'ghostty-webgpu': patch
---

Breaking: Move custom drawing and overlays off `terminal.canvas` onto a separate canvas.
Improved `canvas2d-pixels` scrolling and small edits to upload fewer pixels while preserving exact output and failed-upload recovery.
Changed: The renderer owns `terminal.canvas` and its drawing context, and pixel mode assumes no active clip.
