---
'@singapore-editor/tree-sitter': patch
---

Improved full-document and range syntax analysis by using the parser's subtree error flag to skip repeated missing-node checks on error-free trees. Bracket traversal and diagnostics for malformed source are preserved.
