---
'@singapore-editor/core': patch
---

Fixed `createHistoryViewer()` refreshing its graph when `restoreHistory()` loads saved history into an attached buffer, including after `clearHistory()`.
