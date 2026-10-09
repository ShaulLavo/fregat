---
'@singapore-editor/collab': patch
'@singapore-editor/collaboration': patch
---

Breaking: `DocumentEngine` implementations must provide `sequenceBatch` and `applyBatch`. Update custom session transports to carry `SUBMIT.payload.edits` and `CONFIRM.payload.records` arrays. Fixed repeated pending-edit replay during offline rejoin by advancing unchanged `Participant` acknowledgements without restoring or reapplying the optimistic document.
