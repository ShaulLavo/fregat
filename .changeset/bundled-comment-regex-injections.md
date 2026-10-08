---
'@singapore-editor/tree-sitter-languages': patch
---

Fixed `typeScript()`, `javaScript()` and `html()` to include lazy-loaded JSDoc and regular-expression grammars for embedded syntax highlighting. JSDoc injection now applies to `/**` documentation comments; ordinary comments keep their comment style.
