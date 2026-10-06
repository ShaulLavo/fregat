---
'@singapore-editor/lsp': patch
'@singapore-editor/lsp-plugin': patch
---

Synchronize language-server documents through their retained document contribution owner. Preserve scoped protocol versions, connection epochs, source-before-query ordering, URI transitions and final-peer retirement.

Retire documents locally when their managed transport is already closing, preserving physical failures for source updates.
