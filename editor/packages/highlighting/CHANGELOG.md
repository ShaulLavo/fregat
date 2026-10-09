# @singapore-editor/highlighting

## 0.2.7

### Patch Changes

- Updated dependencies [[`14961f2`](https://github.com/ShaulLavo/fregat/commit/14961f2ec73d2f4d77fbeda18d5ab9a9ac2e5844), [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e), [`dc7cbcf`](https://github.com/ShaulLavo/fregat/commit/dc7cbcf53ca16c6f2a5a9ceebe92f4e9ec973f13), [`be29143`](https://github.com/ShaulLavo/fregat/commit/be291434dbf24dc53e2a93d3727685c445dd0896), [`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3), [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e), [`faaac2b`](https://github.com/ShaulLavo/fregat/commit/faaac2b1d750f2f504bbfa5b7033b98ab71128ad), [`b87998c`](https://github.com/ShaulLavo/fregat/commit/b87998cb5866e069eb5588aa5648b93d090fdb02), [`9a4f594`](https://github.com/ShaulLavo/fregat/commit/9a4f59425ea0a5fa88a296d053cc6b5a28b2d3c0), [`461b848`](https://github.com/ShaulLavo/fregat/commit/461b848c6caeab2f3bf31a5ba007680066f1bf94), [`665f08d`](https://github.com/ShaulLavo/fregat/commit/665f08d283bb0a5a98dca4f9dbaf0c06033c5c3b), [`60b056a`](https://github.com/ShaulLavo/fregat/commit/60b056a2750a4ac5f6f9c0411d35a6ede467a378), [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e), [`f6e371c`](https://github.com/ShaulLavo/fregat/commit/f6e371c5b5722c9564db3f86e99c4086ff168693), [`3121607`](https://github.com/ShaulLavo/fregat/commit/31216072f9ec0bf4d203718507642ba1d77efa66), [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e), [`c05b4fd`](https://github.com/ShaulLavo/fregat/commit/c05b4fd700300756f704d2d5e009dc7bbcd4798f), [`be5519a`](https://github.com/ShaulLavo/fregat/commit/be5519aa8240f92a0a3e238591b1453f3d1e6bde), [`66c8e8a`](https://github.com/ShaulLavo/fregat/commit/66c8e8a6807ddf4b50ace5340449617cb2db1946), [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e)]:
  - @singapore-editor/core@0.2.7
  - @singapore-editor/tree-sitter@0.2.7
  - @singapore-editor/tree-sitter-languages@0.2.7
  - @singapore-editor/diff@0.2.7

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
