---
'@singapore-editor/tree-sitter': patch
'@singapore-editor/core': patch
'@singapore-editor/markdown': patch
---

Improved syntax queries by reading only the source range requested by each predicate and reusing node text within a query. Parser reads keep their existing chunking and Unicode handling. Fixed standalone installations so Markdown shares the host parser runtime with both isolated and hoisted dependencies.
