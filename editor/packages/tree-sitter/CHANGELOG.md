# @singapore-editor/tree-sitter

## 0.2.9

### Patch Changes

- Updated dependencies []:
  - @singapore-editor/core@0.2.9

## 0.2.8

### Patch Changes

- [#1153](https://github.com/ShaulLavo/fregat/pull/1153) [`3903cbe`](https://github.com/ShaulLavo/fregat/commit/3903cbe89bfd62e0c37553bc226059919a8c90b8) - Added `TreeSitterWorkerOwner.mergeUnit()` to find the enclosing syntax unit, its signature and whether its parent allows unordered children. Added merge-unit queries for TypeScript, TSX, JavaScript, JSON, CSS, Markdown, Python, Rust and Go, with complete-line fallback when syntax units are unavailable. Merge-unit ranges enclose requested line separators, use the deepest registered injected language, and preserve local import aliases and every grouped Go field name.

- [#1178](https://github.com/ShaulLavo/fregat/pull/1178) [`958e7df`](https://github.com/ShaulLavo/fregat/commit/958e7df9bcab0ded8273b6dc00049a8642b87486) - Improved `ConfirmedWindow.pairs(batch)` and `MergeReviewDetector.detect()` to reduce the cost of reviewing confirmed edits. Added an optional base snapshot argument to `MergeReviewSyntax` so projected versions can reuse retained syntax.

  Added `TreeSitterWorkerOwner.projectMergeUnits()` and `createTreeSitterInputEdits()` to review projected versions with bounded parent-context parsing and incremental fallback. Fixed damaged-line error lookups scanning unrelated syntax while keeping highlighting trees unchanged.

  Fixed projected merge-unit requests retaining new syntax trees and sources after cancellation or query failure. Highlighting eviction now releases only projections of its own snapshot, so unrelated review sessions add no cleanup work.

- [#1164](https://github.com/ShaulLavo/fregat/pull/1164) [`9dc5a14`](https://github.com/ShaulLavo/fregat/commit/9dc5a14f8595f34a78af996f5fa665a880467ce7) - Added `MergeReviewDetector` through `@singapore-editor/collaboration/merge-review` with per-range syntax groups to report confirmed concurrent edits sharing syntax units, breaking a clean parse, duplicating a signature, or leaving stranded text. Added `TextbufferEngine.effectActive()` to identify active edits. Improved `TreeSitterWorkerOwner.mergeUnit()` with cancellable Markdown work, cached parent eligibility, and optional error/token analysis for review readers.

- [#1090](https://github.com/ShaulLavo/fregat/pull/1090) [`57caf44`](https://github.com/ShaulLavo/fregat/commit/57caf442e11406603fc42df2d43c7c0682bfede8) - Improved full-document and range syntax analysis by using the parser's subtree error flag to skip repeated missing-node checks on error-free trees. Bracket traversal and diagnostics for malformed source are preserved.

- [#1181](https://github.com/ShaulLavo/fregat/pull/1181) [`8c0cfab`](https://github.com/ShaulLavo/fregat/commit/8c0cfab1b08ce87a87cf00c3a5d9e9c2f2bf026f) - Fixed the bundled parser runtime's `TreeCursor.gotoFirstChildForIndex` and `TreeCursor.gotoFirstChildForPosition` methods to select the requested child and report success correctly, including the first child and late children in large documents.

- [#1176](https://github.com/ShaulLavo/fregat/pull/1176) [`f0e5906`](https://github.com/ShaulLavo/fregat/commit/f0e59061c8d2b189d82f9bc8e52590ba98668da1) - Added `mergeReview` to `createCollaborationPlugin` for confirmed concurrent-edit highlights, author-version hovers, local dismissal and bounded resolutions that reach every peer. Added `onMergeReview(unit, versions)` for host actions.

  Added `createTreeSitterReviewSyntax` for demand-only review reads from immutable document snapshots, and `mergeUnit` touching selection for intersected syntax units. Author projections reuse the confirmed syntax tree through `projectMergeUnits` and preserve nested injected languages, including code fences. Added `createEditorSnapshotBuffer` and `DocumentDelivery` to the internal document-worker entry point for snapshot reader integrations.

  Fixed completed merge resolutions reappearing as new review actions. Added `ConfirmedWindow.isAfter` for retained causal ancestry, and restricted review detection to remote confirmations with deferred demand for concurrent pending acknowledgements.

  Added `TooltipPart.presentation: 'controls'` for content-sized shared hovers with pane-bounded placement and a visible button footer. Review actions remain visible while long version comparisons scroll. Fixed host focus outlines appearing around comparison content; keyboard focus remains visible on buttons, and content sections use tone-only separation.

- [#1209](https://github.com/ShaulLavo/fregat/pull/1209) [`d14c74e`](https://github.com/ShaulLavo/fregat/commit/d14c74ee69c4d70a50bdce678d1980f8f9f563c2) - Improved `MergeReviewDetector` memory use when reviewing concurrent replacement edits. Improved merge-review syntax queries in large documents that contain parse errors.

- [#1218](https://github.com/ShaulLavo/fregat/pull/1218) [`6619ccf`](https://github.com/ShaulLavo/fregat/commit/6619ccf6858c74fc2452fe976e0b6f5cf0b4a5ad) - Improved merge review with bounded worker batches that let highlighting interleave, preserve snapshot retention, and observe both batch and entry cancellation. Added `TreeSitterReviewSyntax.batch` for reading current and projected snapshots together and the `readOnly` parse option to skip edit-parser warm-up for immutable snapshots. Read-only parsing reuses mutable snapshots without changing their intent; mutable parsing and editing rebuild immutable bases.
- Updated dependencies [[`01157ea`](https://github.com/ShaulLavo/fregat/commit/01157ea95298f194a8fa8e9f67a17fb6b3cab89d), [`2efacca`](https://github.com/ShaulLavo/fregat/commit/2efacca2529252417548ede3694d58f520c782bd), [`f88c132`](https://github.com/ShaulLavo/fregat/commit/f88c1329594cc6d6e1e64a711727e319c7709c88), [`eb6bbed`](https://github.com/ShaulLavo/fregat/commit/eb6bbed11023d2c59a281a5772bb649976bbf5a8), [`85cc87e`](https://github.com/ShaulLavo/fregat/commit/85cc87ed98a35c21ff430e757a75f2d2721604a8), [`0c1b7fb`](https://github.com/ShaulLavo/fregat/commit/0c1b7fb03285785082f4d7b62ce991fbd487dcf4), [`f0e5906`](https://github.com/ShaulLavo/fregat/commit/f0e59061c8d2b189d82f9bc8e52590ba98668da1), [`60d3c72`](https://github.com/ShaulLavo/fregat/commit/60d3c723c842180fd3fa3c6e8f8f7970f1330307), [`31010b1`](https://github.com/ShaulLavo/fregat/commit/31010b183be61ad044eb57438a58c91dd1c8de79), [`590379e`](https://github.com/ShaulLavo/fregat/commit/590379e72a231dc9cdca814c84a3eba64cedb1a6), [`2b9aeac`](https://github.com/ShaulLavo/fregat/commit/2b9aeaceb70c88c77ff0bc85b4bf3fbef3d52b9b), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390), [`c254ada`](https://github.com/ShaulLavo/fregat/commit/c254ada9561d41b3696d41ec3e6dd599892bf079), [`5ca1d34`](https://github.com/ShaulLavo/fregat/commit/5ca1d349ab0ec22a1951cc3ba1048b028b7f8f5a), [`671416f`](https://github.com/ShaulLavo/fregat/commit/671416f1c1f3fd150b4bb797b915933ceb7f9cfb), [`9488cc4`](https://github.com/ShaulLavo/fregat/commit/9488cc4dba071e4e995de4cb3fd0485f6e8c510a), [`7b04e6e`](https://github.com/ShaulLavo/fregat/commit/7b04e6e32d054a9045ba5a7f9108cd0db354f56e), [`67c4603`](https://github.com/ShaulLavo/fregat/commit/67c4603448625f31c59175738df0eae89132c869)]:
  - @singapore-editor/core@0.2.8

## 0.2.7

### Patch Changes

- [#1086](https://github.com/ShaulLavo/fregat/pull/1086) [`dc7cbcf`](https://github.com/ShaulLavo/fregat/commit/dc7cbcf53ca16c6f2a5a9ceebe92f4e9ec973f13) - Improved syntax queries by reading only the source range requested by each predicate and reusing node text within a query. Parser reads keep their existing chunking and Unicode handling. Fixed standalone installations so Markdown shares the host parser runtime with both isolated and hoisted dependencies.

- [#1062](https://github.com/ShaulLavo/fregat/pull/1062) [`be29143`](https://github.com/ShaulLavo/fregat/commit/be291434dbf24dc53e2a93d3727685c445dd0896) - Fixed `typeScript()`, `javaScript()` and `html()` to include lazy-loaded JSDoc and regular-expression grammars for embedded syntax highlighting; ordinary comments keep their comment style. `TreeSitterSyntaxSession` loads injection grammars when the document requests them and covers every discovered injection, with explicit degraded status when the nesting limit is reached. `treeSitterCapturesToEditorTokens` uses optional `injectionDepth` capture metadata to preserve nested syntax colors.

- [#1087](https://github.com/ShaulLavo/fregat/pull/1087) [`faaac2b`](https://github.com/ShaulLavo/fregat/commit/faaac2b1d750f2f504bbfa5b7033b98ab71128ad) - Improved full-document highlighting by reading accepted capture names and UTF-16 ranges directly from the parser runtime. Highlight order, complete-match predicates, injections and fold results are preserved.

- [#1089](https://github.com/ShaulLavo/fregat/pull/1089) [`9a4f594`](https://github.com/ShaulLavo/fregat/commit/9a4f59425ea0a5fa88a296d053cc6b5a28b2d3c0) - Improved full-document highlighting by deduplicating captures with a bounded capture-name map. Equal-span capture precedence, injected-language highlighting and range queries are preserved.

- [#1083](https://github.com/ShaulLavo/fregat/pull/1083) [`be5519a`](https://github.com/ShaulLavo/fregat/commit/be5519aa8240f92a0a3e238591b1453f3d1e6bde) - Improved complete syntax parsing speed while preserving bracket depths and missing-node diagnostics.

- [#1006](https://github.com/ShaulLavo/fregat/pull/1006) [`66c8e8a`](https://github.com/ShaulLavo/fregat/commit/66c8e8a6807ddf4b50ace5340449617cb2db1946) - Stop visible-range syntax diagnostic walks after the requested end when highlighting large files.

- [#1021](https://github.com/ShaulLavo/fregat/pull/1021) [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e) - Paint bounded provisional syntax for large documents while complete analysis continues in cancellable worker slices. Replace provisional highlights when complete analysis arrives.
- Updated dependencies [[`14961f2`](https://github.com/ShaulLavo/fregat/commit/14961f2ec73d2f4d77fbeda18d5ab9a9ac2e5844), [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e), [`dc7cbcf`](https://github.com/ShaulLavo/fregat/commit/dc7cbcf53ca16c6f2a5a9ceebe92f4e9ec973f13), [`be29143`](https://github.com/ShaulLavo/fregat/commit/be291434dbf24dc53e2a93d3727685c445dd0896), [`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3), [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e), [`b87998c`](https://github.com/ShaulLavo/fregat/commit/b87998cb5866e069eb5588aa5648b93d090fdb02), [`461b848`](https://github.com/ShaulLavo/fregat/commit/461b848c6caeab2f3bf31a5ba007680066f1bf94), [`665f08d`](https://github.com/ShaulLavo/fregat/commit/665f08d283bb0a5a98dca4f9dbaf0c06033c5c3b), [`60b056a`](https://github.com/ShaulLavo/fregat/commit/60b056a2750a4ac5f6f9c0411d35a6ede467a378), [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e), [`f6e371c`](https://github.com/ShaulLavo/fregat/commit/f6e371c5b5722c9564db3f86e99c4086ff168693), [`3121607`](https://github.com/ShaulLavo/fregat/commit/31216072f9ec0bf4d203718507642ba1d77efa66), [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e), [`c05b4fd`](https://github.com/ShaulLavo/fregat/commit/c05b4fd700300756f704d2d5e009dc7bbcd4798f), [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e)]:
  - @singapore-editor/core@0.2.7

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
