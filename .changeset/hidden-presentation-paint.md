---
'@singapore-editor/core': patch
---

Fixed syntax colours disappearing in WebKit when an editor mounted under a hidden host becomes visible. Create hidden editors with `presentationReady: false` and call `setPresentationReady(true)` after revealing their host to restore the existing syntax paint.
