---
'@singapore-editor/minimap': patch
---

Queue capped background minimap publication through the existing deferred scheduler so an expired burst deadline keeps derived worker updates outside the synchronous edit callback. Preserve latest ordered edits, summary payloads and the existing deadline.
