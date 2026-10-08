---
'ghostty-webgpu': patch
---

Keep DOM terminal overlays aligned with live canvas geometry through browser anchor positioning and computed pixel padding, with resolved geometry for percentage padding and transformed canvases.

The DOM renderer owns the canvas anchor names while mounted, preserves names present at mount, and restores the previous inline value and priority on disposal.
