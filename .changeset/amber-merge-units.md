---
'@singapore-editor/tree-sitter': patch
'@singapore-editor/tree-sitter-languages': patch
---

Added `TreeSitterWorkerOwner.mergeUnit()` to find the enclosing syntax unit, its signature and whether its parent allows unordered children. Added merge-unit queries for TypeScript, TSX, JavaScript, JSON, CSS, Markdown, Python, Rust and Go, with complete-line fallback when syntax units are unavailable. Merge-unit ranges enclose requested line separators, use the deepest registered injected language, and preserve local import aliases and every grouped Go field name.
