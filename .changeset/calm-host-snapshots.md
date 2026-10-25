---
'@singapore-editor/collab': patch
---

Fixed `Host.submit()` to preserve queued edits and deliver committed messages when a supplied engine's `snapshot()` throws. Later submissions, including retries of accepted edits, retry queued work without duplicate delivery. Callback failures retain their first thrown value and take precedence over settlement errors.
