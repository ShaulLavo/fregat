---
'ghostty-webgpu': patch
---

Cancel the returned frame handle when a supplied clock disposes the render scheduler during its frame request, releasing queued frame work after teardown.
