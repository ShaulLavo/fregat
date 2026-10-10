---
'@singapore-editor/core': patch
---

Fixed `Editor.captureSnapshot({ scope: 'document' })` refusing syntax colours supplied through CSS variables. Capture now saves the foreground and background colours resolved against the editor's active theme and stylesheet.
