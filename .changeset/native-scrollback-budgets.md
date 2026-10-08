---
'ghostty-webgpu': patch
---

Added `scrollbackByteLimit` to limit terminal scrollback by allocated page bytes, including the active screen. `0` clears history and disables further scrollback. Limits apply to whole pages, and positive byte limits have a minimum based on screen size.
