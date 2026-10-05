---
'@singapore-editor/minimap': patch
---

Deliver clipped minimap summaries through document contributions while each view keeps its own canvas and rendering demand. Release worker and canvas resources when a document closes, and preserve canonical source acknowledgements across edits, undo and hidden views.
