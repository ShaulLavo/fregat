---
'@singapore-editor/core': patch
---

Fixed editors mounted in same-origin iframes so `setText()` and `dispose()` work with the textarea input route. Input synchronization, composition, embedded control checks, and row boundary checks now use the element's own browser realm.
