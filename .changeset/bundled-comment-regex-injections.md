---
'@singapore-editor/tree-sitter-languages': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/core': patch
---

Fixed `typeScript()`, `javaScript()` and `html()` to include lazy-loaded JSDoc and regular-expression grammars for embedded syntax highlighting. `TreeSitterSyntaxSession` loads injection grammars when the document requests them, and `treeSitterCapturesToEditorTokens` uses optional `injectionDepth` capture metadata to preserve nested syntax colors. JSDoc injection now applies to `/**` documentation comments; ordinary comments keep their comment style.
