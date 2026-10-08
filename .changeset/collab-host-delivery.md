---
'@singapore-editor/collab': patch
---

Fixed `Host.submit()` delivery when a broadcast listener throws. Healthy listeners receive every committed outcome in host-sequence order, including reentrant submissions, before the first callback error is rethrown.
