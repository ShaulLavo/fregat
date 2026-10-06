# @singapore-editor/highlighting

## 0.2.6

### Patch Changes

- 5670c3d: Own source delivery and contribution lifetimes in document analysis. Use typed structural and highlighter operations with immutable worker reads, preserve exact pinned work, and reject partial diff sources before syntax preparation.
- Updated dependencies [5670c3d]
  - @singapore-editor/core@0.2.6
  - @singapore-editor/tree-sitter@0.2.6
  - @singapore-editor/diff@0.2.6
  - @singapore-editor/tree-sitter-languages@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies [832e149]
- Updated dependencies [fd035f2]
- Updated dependencies [51d2a71]
  - @singapore-editor/core@0.2.5
  - @singapore-editor/diff@0.2.5
  - @singapore-editor/tree-sitter@0.2.5
  - @singapore-editor/tree-sitter-languages@0.2.5

## 0.2.3

### Patch Changes

- Updated dependencies [9d726b3]
- Updated dependencies [33e949e]
- Updated dependencies [4e053fc]
- Updated dependencies [d297a23]
- Updated dependencies [8cd7175]
- Updated dependencies [5365760]
  - @singapore-editor/core@0.2.3
  - @singapore-editor/tree-sitter@0.2.3
  - @singapore-editor/diff@0.2.3
  - @singapore-editor/tree-sitter-languages@0.2.3

## 0.2.2

### Patch Changes

- d9617a2: Share exact immutable diff syntax across concurrent views with independent disposable readers. Keep active sources pinned, bound idle sides, and reject late or colliding source results.

  Qualify shared sources by the provider's full document path and language id, preserving path-sensitive grammar selection.

  Diff plugins release reader interests on detachment. The destructive `releasePreparedSyntax` API is removed.

- Updated dependencies [219bebd]
- Updated dependencies [8d4694a]
- Updated dependencies [fac4d60]
- Updated dependencies [d9617a2]
- Updated dependencies [0f6a1ed]
- Updated dependencies [ec18def]
- Updated dependencies [0a2cd77]
- Updated dependencies [dd900b4]
- Updated dependencies [2fc90ad]
- Updated dependencies [7f18c08]
- Updated dependencies [508fa33]
  - @singapore-editor/core@0.2.2
  - @singapore-editor/diff@0.2.2
  - @singapore-editor/tree-sitter@0.2.2
  - @singapore-editor/tree-sitter-languages@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [8bd0e75]
- Updated dependencies [0652d86]
  - @singapore-editor/core@0.2.1
  - @singapore-editor/tree-sitter-languages@0.2.1
  - @singapore-editor/diff@0.2.1
  - @singapore-editor/tree-sitter@0.2.1
