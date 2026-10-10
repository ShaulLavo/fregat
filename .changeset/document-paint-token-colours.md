---
'@singapore-editor/core': patch
---

Fixed `Editor.captureSnapshot({ scope: 'document' })` refusing syntax colours supplied through CSS variables. Capture now saves foreground and background colours resolved against the editor's active theme, isolated from unrelated page selectors. Invalid colours and unresolved variables return an unsupported capture.
