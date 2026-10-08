---
'ghostty-webgpu': patch
---

Fixed terminal link hovering to save and restore the pre-hover canvas cursor value and CSS priority, while preserving host declarations that differ from `pointer !important` on exit. Terminal output leaves host cursor styles untouched while no link is visible.
