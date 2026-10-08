---
'@singapore-editor/collaboration': patch
---

Broker admission credentials use an abortable protocol supplier and are refreshed for every signaling connection and reconnect. Pending credential reads are cancelled when signaling closes.

Keep resolved collaboration credentials outside serializable configuration and request broker admission credentials at each signaling handshake.
