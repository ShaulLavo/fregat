---
'@singapore-editor/core': patch
---

Fixed syntax highlights disappearing after a cancelled or incomplete range query. The editor keeps the last painted highlights and lets later range queries retry the backend.
