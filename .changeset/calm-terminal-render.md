---
'@singapore-editor/core': patch
---

End rendering when height, gutter, or inline widget callbacks dispose their editor. Release late cells and widgets, finish owned cleanup after callback errors, and preserve live atomic viewport completion.
