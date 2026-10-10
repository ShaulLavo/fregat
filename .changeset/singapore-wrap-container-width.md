---
'@singapore-editor/core': patch
---

Fixed wrapped text overflowing narrow containers with gutters, wide fallback glyphs or fractional widths. Wrapping reserves space for the caret and hanging trailing spaces preserve their source positions without widening the scrolling area.
