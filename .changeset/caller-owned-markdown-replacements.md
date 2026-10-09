---
'@singapore-editor/markdown': patch
---

Improved `markdownInlineReplacements` to return a mutable array owned by the caller, allowing results to be sorted or reversed in place. Each call creates a separate array.
