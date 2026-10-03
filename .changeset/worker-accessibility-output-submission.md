---
'ghostty-webgpu': patch
---

Keep worker output announcements pending until a submitted frame includes the posted write. Preserve ordinary, newline and atomic output notifications across queued pre-output frames.
