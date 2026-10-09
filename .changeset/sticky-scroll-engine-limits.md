---
'@singapore-editor/core': patch
---

Fixed deep scrolling and gutter alignment in Firefox for documents taller than the browser's sticky-position limit, including after switching to virtualized mode. Added `maxScrollHeight` to `Editor` and `VirtualizedTextView` options for embedders that supply the browser's native scroll extent in CSS pixels. Supplied `textMetrics` retain measurement-free construction and the 16,000,000-pixel default cap; other views measure the browser limit automatically.
