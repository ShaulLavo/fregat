---
'@singapore-editor/collaboration': patch
---

Fixed remote carets, names, and selections remaining visible until awareness expiry after `Session.disconnect` or `Session.retire` removes a peer. Presence now clears immediately while retaining the peer's clock floor to reject delayed state replays.
