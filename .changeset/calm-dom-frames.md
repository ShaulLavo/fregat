---
'ghostty-webgpu': patch
---

Reduce repeated DOM terminal layout work by containing the fixed-size text frame and retaining unchanged overlay, input-caret, and composition styles. Live canvas positioning continues to follow same-frame layout changes and author CSS.
