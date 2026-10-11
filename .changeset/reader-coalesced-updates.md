---
'ghostty-webgpu': patch
---

Changed `accessibility` to coalesce the displayed row list, cursor position and recent-output announcements on a 100 ms refresh delay, with immediate refreshes on enable, focus and history navigation and suspended updates in hidden documents. Intervals containing a resize or font reflow update readable text silently, including output received in that interval; the next output-only interval resumes announcements. Public `onText` subscribers continue receiving every submitted text frame.
