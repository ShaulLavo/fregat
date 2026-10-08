---
'@singapore-editor/collab': patch
'@singapore-editor/textbuffer': patch
---

Index placement ancestry and structural successors so typing and pending replay stay bounded on fragmented histories. Publish effective edits through participant subscriptions and skip shared textbuffer subtrees during snapshot diffs.

Breaking API changes: participant subscription callbacks now apply `change.edits` to their previous text projection and read metadata from the change. Callers requesting full text use `participant.text()` or `participant.state().text`. Custom engines must implement `changesBetween(snapshot)` with effective `{ from, to, text }` edits.
