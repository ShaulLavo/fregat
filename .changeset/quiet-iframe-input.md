---
'@singapore-editor/core': patch
---

Fixed editors mounted in same-origin iframes so `setText()`, native selection reconciliation, and textarea input work in the editor's own document. Row boundary checks, caret hit testing, embedded control checks, and `dispose()` also work after the iframe is removed.
