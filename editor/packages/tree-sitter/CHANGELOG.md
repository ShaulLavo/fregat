# @singapore-editor/tree-sitter

## 0.2.6

### Patch Changes

- 5670c3d: Own source delivery and contribution lifetimes in document analysis. Use typed structural and highlighter operations with immutable worker reads, preserve exact pinned work, and reject partial diff sources before syntax preparation.
- Updated dependencies [5670c3d]
  - @singapore-editor/core@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies [832e149]
- Updated dependencies [fd035f2]
- Updated dependencies [51d2a71]
  - @singapore-editor/core@0.2.5

## 0.2.3

### Patch Changes

- 8cd7175: Expose current committed bytes and pages for the shared Tree-sitter and Markdown WASM runtime through the existing retention fence, with explicit uninitialized state and allocator-live bytes remaining unmeasured.
- Updated dependencies [9d726b3]
- Updated dependencies [33e949e]
- Updated dependencies [4e053fc]
- Updated dependencies [d297a23]
- Updated dependencies [5365760]
  - @singapore-editor/core@0.2.3

## 0.2.2

### Patch Changes

- ec18def: Release disposed runtime source epochs after worker cleanup acknowledges completion, keeping pending cleanup and newer source requests safe on a shared worker.
- 0a2cd77: Load URL grammars through fetch when a browser bundle runs with Node globals.
- 508fa33: Expose fenced Tree-sitter worker resource counts and public retention types. Count Shiki tokenizer storage directly during inspection.
- Updated dependencies [219bebd]
- Updated dependencies [8d4694a]
- Updated dependencies [0f6a1ed]
- Updated dependencies [dd900b4]
- Updated dependencies [2fc90ad]
- Updated dependencies [7f18c08]
- Updated dependencies [508fa33]
  - @singapore-editor/core@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [8bd0e75]
  - @singapore-editor/core@0.2.1
