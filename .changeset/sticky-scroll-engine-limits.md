---
'@singapore-editor/core': patch
---

Fixed deep scrolling and gutter alignment in Firefox for documents taller than the browser's sticky-position limit, including when content loads or grows after switching to virtualized mode. The editor discovers the browser limit when visible virtualized content exceeds four million pixels, preserving measurement-free construction with supplied `textMetrics` and layout-free unfocused opens of ordinary documents and retrying discovery after temporarily unmeasurable layout becomes available.
