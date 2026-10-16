---
'ghostty-webgpu': patch
---

Added support for `font.lineHeight` values down to 0.5. Shorter lines centre glyphs vertically and clip them to their cell spans in WebGPU, WebGL2, Canvas2D and DOM renderers.
