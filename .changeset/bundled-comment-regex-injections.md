---
'@singapore-editor/tree-sitter-languages': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/core': patch
---

Fixed `typeScript()`, `javaScript()` and `html()` to include lazy-loaded JSDoc and regular-expression grammars for embedded syntax highlighting; ordinary comments keep their comment style. `TreeSitterSyntaxSession` loads injection grammars when the document requests them and covers every discovered injection, with explicit degraded status when the nesting limit is reached. `treeSitterCapturesToEditorTokens` uses optional `injectionDepth` capture metadata to preserve nested syntax colors.
