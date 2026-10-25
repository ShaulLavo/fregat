---
'@singapore-editor/tree-sitter': patch
---

Fixed parser initialization on hosts without resizable WebAssembly memory. Parser memory continues to grow while Markdown uses the same runtime as the host. Query ranges use UTF-16 code units to preserve lower-document highlights and incremental language injections.
