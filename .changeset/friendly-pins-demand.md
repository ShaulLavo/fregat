---
'@singapore-editor/core': patch
---

Track displayed structural ranges and preparation pins separately from cancelable query waiters. Release original preparation interest during view handoff, report promoted pending stages as stale, and stop failed highlighter replacement after terminal reentrant disposal.
