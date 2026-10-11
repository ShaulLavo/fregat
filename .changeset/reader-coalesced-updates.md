---
'ghostty-webgpu': patch
---

Changed `accessibility` to coalesce the displayed row list, cursor position and recent-output announcements on a 100 ms refresh delay while preserving fresh output across focus, history navigation and wrapping resizes. Enabling accessibility, focusing the input and navigating history refresh immediately, and hidden documents suspend scheduled updates. Public `onText` subscribers continue receiving every submitted text frame.
