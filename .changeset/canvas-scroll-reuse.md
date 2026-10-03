---
'ghostty-webgpu': patch
---

Reuse unchanged Canvas terminal rows through bounded scroll-by-blit, with exact row matching and cursor-safe repainting. Respect scheduled row membership when a render source returns additional rows.
