---
'ghostty-webgpu': patch
---

Improved Canvas repainting for single-row plain-text edits and cursor changes. Font loading refreshes glyph bounds, and bulk writes, styled rows and pixel targets keep full-row painting.
