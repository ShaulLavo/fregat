---
'@singapore-editor/tree-sitter': patch
---

Expose current committed bytes and pages for the shared Tree-sitter and Markdown WASM runtime through the existing retention fence, with explicit uninitialized state and allocator-live bytes remaining unmeasured.
