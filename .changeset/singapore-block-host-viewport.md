---
'@singapore-editor/core': patch
---

Keep the editor viewport within a sized block host. Large documents stay virtualized when the host uses block layout, preventing excessive row and syntax-highlight allocations.

Keep cursor movement accurate when bidirectional text is clipped by the viewport.
