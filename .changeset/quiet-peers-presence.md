---
'@singapore-editor/collaboration': patch
---

Added bounded character-based awareness and an optional editor contribution for named remote carets and selections. `Presence` retains peer-session clock floors until room disposal so delayed packets cannot restore expired peers; every presence update, including removal, requires a newer clock.
