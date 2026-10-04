# @singapore-editor/diff

## 0.2.2

### Patch Changes

- fac4d60: Diff region stores clear expanded context when an input without `cacheKey` changes content or hunk positions.
- d9617a2: Share exact immutable diff syntax across concurrent views with independent disposable readers. Keep active sources pinned, bound idle sides, and reject late or colliding source results.

  Qualify shared sources by the provider's full document path and language id, preserving path-sensitive grammar selection.

  Diff plugins release reader interests on detachment. The destructive `releasePreparedSyntax` API is removed.

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
