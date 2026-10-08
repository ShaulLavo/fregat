---
'ghostty-webgpu': patch
---

Fixed worker terminal shutdown confirming disposal before GPU cleanup finished. Shutdown now waits for pending device acquisition and recovery, and reports a timeout if cleanup cannot finish, including while the worker is idle.
