---
'@singapore-editor/collab': patch
---

Fixed `UndoManager` retaining cleared transactions and caller metadata. Confirmed history actions now leave the replay journal while pending rejection recovery and caller-owned graph transactions remain usable.
