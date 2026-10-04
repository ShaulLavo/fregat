---
'@singapore-editor/diff': patch
'@singapore-editor/highlighting': patch
---

Share exact immutable diff syntax across concurrent views with independent disposable readers. Keep active sources pinned, bound idle sides, and reject late or colliding source results.

Qualify shared sources by the provider's full document path and language id, preserving path-sensitive grammar selection.

Diff plugins release reader interests on detachment. The destructive `releasePreparedSyntax` API is removed.
