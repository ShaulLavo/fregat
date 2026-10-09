# @singapore-editor/core

## 0.2.7

### Patch Changes

- [#1047](https://github.com/ShaulLavo/fregat/pull/1047) [`14961f2`](https://github.com/ShaulLavo/fregat/commit/14961f2ec73d2f4d77fbeda18d5ab9a9ac2e5844) - Expose mounted rows in document reading order through accessibility ownership, preserving recycled row DOM positions during scrolling.

- [#1026](https://github.com/ShaulLavo/fregat/pull/1026) [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e) - Keep collaborative batches atomic, preserve native edit ordering and Unicode replacements, and defer remote reconciliation behind mutation leases. Respect skipped history and report selective Undo/Redo availability. Recover losing-branch origins before replay and retain shared immutable history records. Validate shared-buffer ownership before attachment and clean up example departures and failed setup.

- [#1086](https://github.com/ShaulLavo/fregat/pull/1086) [`dc7cbcf`](https://github.com/ShaulLavo/fregat/commit/dc7cbcf53ca16c6f2a5a9ceebe92f4e9ec973f13) - Improved syntax queries by reading only the source range requested by each predicate and reusing node text within a query. Parser reads keep their existing chunking and Unicode handling. Fixed standalone installations so Markdown shares the host parser runtime with both isolated and hoisted dependencies.

- [#1062](https://github.com/ShaulLavo/fregat/pull/1062) [`be29143`](https://github.com/ShaulLavo/fregat/commit/be291434dbf24dc53e2a93d3727685c445dd0896) - Fixed `typeScript()`, `javaScript()` and `html()` to include lazy-loaded JSDoc and regular-expression grammars for embedded syntax highlighting; ordinary comments keep their comment style. `TreeSitterSyntaxSession` loads injection grammars when the document requests them and covers every discovered injection, with explicit degraded status when the nesting limit is reached. `treeSitterCapturesToEditorTokens` uses optional `injectionDepth` capture metadata to preserve nested syntax colors.

- [#1078](https://github.com/ShaulLavo/fregat/pull/1078) [`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3) - Keep collaborative undo branches in the editor history graph. Switch branches with one author-selective effect command, restore character-ID selections and jump locations, and persist history against its document and character identities. Continue allocating fresh edit and character IDs when a document reopens, including allocations preserved in rejected history records, and recover local history after rejected commands. Reconstruct restored history viewer change sizes from the live identity-space branch previews.

- [#1026](https://github.com/ShaulLavo/fregat/pull/1026) [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e) - Bind collaborative sessions to native editor input, identity-aware snapshots, author-selective undo and atomic remote updates. Add an invitation-link example using encrypted same-origin and WebRTC transports.

- [#963](https://github.com/ShaulLavo/fregat/pull/963) [`b87998c`](https://github.com/ShaulLavo/fregat/commit/b87998cb5866e069eb5588aa5648b93d090fdb02) - Expose exact plugin transactions with origins and author tags, history-aware edit application, and atomic snapshot reconciliation with selection and composition handling.

- [#1027](https://github.com/ShaulLavo/fregat/pull/1027) [`461b848`](https://github.com/ShaulLavo/fregat/commit/461b848c6caeab2f3bf31a5ba007680066f1bf94) - Keep the end of very tall documents visible and editable by positioning painted rows, gutters and carets within the native scroll range. Preserve logical document positions for selection snapshots and hit testing.

- [#995](https://github.com/ShaulLavo/fregat/pull/995) [`665f08d`](https://github.com/ShaulLavo/fregat/commit/665f08d283bb0a5a98dca4f9dbaf0c06033c5c3b) - Keep the final rows of large documents visible when scrolling beyond the browser's native height limit.

- [#1043](https://github.com/ShaulLavo/fregat/pull/1043) [`60b056a`](https://github.com/ShaulLavo/fregat/commit/60b056a2750a4ac5f6f9c0411d35a6ede467a378) - Add `gutterScroll: 'content'` to scroll all gutter lanes horizontally with the text in reading views. The default keeps gutters fixed at the viewport edge. Switch a live editor with `setGutterScroll`.

- [#1021](https://github.com/ShaulLavo/fregat/pull/1021) [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e) - Fixed syntax highlights disappearing after a cancelled or incomplete range query. The editor keeps the last painted highlights and lets later range queries retry the backend.

- [#894](https://github.com/ShaulLavo/fregat/pull/894) [`f6e371c`](https://github.com/ShaulLavo/fregat/commit/f6e371c5b5722c9564db3f86e99c4086ff168693) - Fixed editor retention checks sampling the viewport before the final scroll update. The editor now includes that update in its tracked pending work.

- [#899](https://github.com/ShaulLavo/fregat/pull/899) [`3121607`](https://github.com/ShaulLavo/fregat/commit/31216072f9ec0bf4d203718507642ba1d77efa66) - Added the `DEFAULT_OVERSCAN` export, the default number of rows the editor renders beyond the visible area.

- [#1026](https://github.com/ShaulLavo/fregat/pull/1026) [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e) - Preserve confirmed remote text when detaching during a mutation lease. Execute author-selective Undo and Redo from every view sharing the buffer, and distinguish example peers across tabs. Initialize text before binding views, mount their paint layers before admitting saved paint, and run editor binding browser tests in their native-input configuration.

- [#988](https://github.com/ShaulLavo/fregat/pull/988) [`c05b4fd`](https://github.com/ShaulLavo/fregat/commit/c05b4fd700300756f704d2d5e009dc7bbcd4798f) - Keep the editor viewport within a sized block host. Large documents stay virtualized when the host uses block layout, preventing excessive row and syntax-highlight allocations. Keep cursor movement accurate when bidirectional text is clipped by the viewport.

- [#1021](https://github.com/ShaulLavo/fregat/pull/1021) [`b035dc6`](https://github.com/ShaulLavo/fregat/commit/b035dc69d20bfa9b3cddd523d958b38d7b741d9e) - Paint bounded provisional syntax for large documents while complete analysis continues in cancellable worker slices. Replace provisional highlights when complete analysis arrives.
- Updated dependencies [[`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3), [`ed8e3ab`](https://github.com/ShaulLavo/fregat/commit/ed8e3ab264586714b15a2589e7c74cb7af241154), [`e39fb2f`](https://github.com/ShaulLavo/fregat/commit/e39fb2ff7be76068a4af41fc0907379d630ea619), [`ac0aae9`](https://github.com/ShaulLavo/fregat/commit/ac0aae9fb4fa9c76661c7640a0dbb88ac53871cc), [`8604785`](https://github.com/ShaulLavo/fregat/commit/8604785002880294450acc2d86831b7d58bb51ad)]:
  - @singapore-editor/textbuffer@0.2.7

## 0.2.6

### Patch Changes

- 5670c3d: Own source delivery and contribution lifetimes in document analysis. Use typed structural and highlighter operations with immutable worker reads, preserve exact pinned work, and reject partial diff sources before syntax preparation.
- @singapore-editor/textbuffer@0.2.6

## 0.2.5

### Patch Changes

- 832e149: Keep current highlight readiness pending across provider and theme replacement overlaps until the current result is accepted, while preserving rebased styles.
- fd035f2: Prepare the ordered provider theme with retained highlighter results so compatible ready documents attach synchronously without another constructor theme request.
- 51d2a71: Keep word-wrap choices in retained logical editor views across native editor remounts.
- @singapore-editor/textbuffer@0.2.5

## 0.2.3

### Patch Changes

- 9d726b3: Release optional active syntax range history using each view's actual token and fold contributors. Preserve shared requests and warm current-frame readiness while preventing canceled optional replies from restoring discarded caches.
- 33e949e: End rendering when height, gutter, or inline widget callbacks dispose their editor. Release late cells and widgets, finish owned cleanup after callback errors, and preserve live atomic viewport completion.
- 4e053fc: Track displayed structural ranges and preparation pins separately from cancelable query waiters. Release original preparation interest during view handoff, report promoted pending stages as stale, and stop failed highlighter replacement after terminal reentrant disposal.
- d297a23: Notify retention subscribers after analysis entry, lease, display demand and query changes settle. Detach subscriptions before terminal provider disposal.
- 5365760: Preserve optional syntax warming suppression across compatible view attachments after discarded history is retired.
- @singapore-editor/textbuffer@0.2.3

## 0.2.2

### Patch Changes

- 219bebd: Inspect retained analysis sessions and reclaim inactive configurations while preserving active leases, document text and Undo history.
- 8d4694a: Route Editor commands through the shared hotkeys focus tree, export preset data, and preserve standalone widget and text replay behavior.
- 0f6a1ed: Remove an unresolved transitive dependency from the Editor browser test preoptimization list.
- dd900b4: Paint ready shared Shiki analysis in existing editor views without an additional edit debounce.
- 2fc90ad: Expose exact deduplicated token-store backing and fenced Shiki worker resource counts, with unmeasured allocations identified separately.
- 7f18c08: Preserve structural providers' range readiness when reusing document analysis, and attach completed full token results synchronously while range queries are unavailable.
- 508fa33: Expose fenced Tree-sitter worker resource counts and public retention types. Count Shiki tokenizer storage directly during inspection.
- @singapore-editor/textbuffer@0.2.2

## 0.2.1

### Patch Changes

- 8bd0e75: Stabilize delayed-readiness first-paint browser checks by awaiting the editor's highlight-settlement signal.
- @singapore-editor/textbuffer@0.2.1
