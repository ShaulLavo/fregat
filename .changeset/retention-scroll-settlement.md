---
'@singapore-editor/core': patch
---

Fixed editor retention checks sampling the viewport before the final scroll update. The editor now includes that update in its tracked pending work.
