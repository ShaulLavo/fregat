---
'@workspace/contracts': patch
'@singapore-editor/collaboration': patch
---

Added collaboration signaling, ICE, connection policy and presence settings. Broker admission tokens and TURN credentials use the secret store.

Keep resolved collaboration credentials outside serializable configuration and request broker admission credentials at each signaling handshake.
