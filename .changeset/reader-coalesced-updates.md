---
'ghostty-webgpu': patch
---

Changed `accessibility` to coalesce the displayed row list, cursor position and recent-output announcements on a 100 ms refresh delay. Enabling accessibility and focusing the input refresh immediately, and public `onText` subscribers continue receiving every submitted text frame.
