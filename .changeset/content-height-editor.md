---
'@singapore-editor/core': patch
---

Added `scrollMode: 'content'` and `setScrollMode('content')` for editors that grow with their content and use page scrolling. Caret and search reveal scroll outside ancestors, and oversized content layouts report a bounded refusal. Fixed wrapped row heights after a web font loads.
