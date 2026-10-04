---
'@singapore-editor/tree-sitter': patch
---

Release disposed runtime source epochs after worker cleanup acknowledges completion, keeping pending cleanup and newer source requests safe on a shared worker.
