---
'ghostty-webgpu': patch
---

Reduce Canvas pixel renderer uploads during scrolling and single-row edits, and share decoded cells between row identity checks and painting. Preserve exact pixels when transport fails and when a custom target uses a row-sized scratch buffer.
