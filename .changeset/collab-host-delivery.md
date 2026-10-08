---
'@singapore-editor/collab': patch
---

Fixed `Host.submit()` delivery when a broadcast listener throws or reconnects during delivery. Healthy receivers get committed outcomes in host-sequence order, including reentrant submissions, and new `Host.subscribe()` registrations begin with the next broadcast. Host and Participant subscriptions rethrow the first callback failure unchanged and report multiple failures once with a count.
