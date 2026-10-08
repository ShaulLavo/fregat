---
'@singapore-editor/tree-sitter': patch
---

Improved syntax queries by reading only the source range requested by each predicate and reusing node text within a query. Parser reads keep their existing chunking and Unicode handling.
