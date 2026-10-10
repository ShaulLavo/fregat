---
'ghostty-webgpu': patch
---

Improved per-frame text updates when `onText` or accessibility is enabled by reducing copied text work. Retaining a copied text row now keeps only that row's cell and grapheme data alive.
