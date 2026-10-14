---
'ghostty-webgpu': patch
---

Added the `presentation` terminal option. `'immediate'` draws the first write of each display frame right away, prefers WebGL2, and asks for a desynchronized (low-latency) canvas; `diagnostics.desynchronized` reports whether the browser granted it.
