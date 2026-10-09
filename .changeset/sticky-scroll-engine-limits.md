---
'@singapore-editor/core': patch
---

Fixed deep scrolling and gutter alignment in Firefox for documents taller than the browser's sticky-position limit. The virtualized editor now measures the document's native sticky scroll limit and preserves the full logical document height.
