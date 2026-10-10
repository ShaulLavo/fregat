# @singapore-editor/core

## 0.2.8

### Patch Changes

- [#1105](https://github.com/ShaulLavo/fregat/pull/1105) [`01157ea`](https://github.com/ShaulLavo/fregat/commit/01157ea95298f194a8fa8e9f67a17fb6b3cab89d) - Fixed `Editor` font changes reporting ResizeObserver loop errors when an overlay adjusts the text viewport.

- [#1130](https://github.com/ShaulLavo/fregat/pull/1130) [`2efacca`](https://github.com/ShaulLavo/fregat/commit/2efacca2529252417548ede3694d58f520c782bd) - Fixed fractional row, caret, and gutter positioning when scrolling large documents beyond the browser's native height limit.

- [#1107](https://github.com/ShaulLavo/fregat/pull/1107) [`f88c132`](https://github.com/ShaulLavo/fregat/commit/f88c1329594cc6d6e1e64a711727e319c7709c88) - Added `scrollMode: 'content'` and `setScrollMode('content')` for editors that grow with their content and use page scrolling. Caret and search reveal scroll outside ancestors, and oversized content layouts report a bounded refusal. Fixed wrapped row heights after a web font loads.

- [#1225](https://github.com/ShaulLavo/fregat/pull/1225) [`eb6bbed`](https://github.com/ShaulLavo/fregat/commit/eb6bbed11023d2c59a281a5772bb649976bbf5a8) - Fixed document snapshot syntax colours changing text shaping across token boundaries, and preserved captured kerning and ligature settings. Added `preparePaintSnapshotHighlights` and `activatePaintSnapshotHighlights` to `@singapore-editor/core/paint`: prepare visibility in an inline head bundle before streamed markup, then activate each root synchronously; failures reveal readable content and `mountPaintSnapshot` activates automatically. Emitted text and layout remain readable with JavaScript disabled, while malformed or repeated source slices are refused before allocating highlights.

- [#1223](https://github.com/ShaulLavo/fregat/pull/1223) [`85cc87e`](https://github.com/ShaulLavo/fregat/commit/85cc87ed98a35c21ff430e757a75f2d2721604a8) - Fixed `Editor.captureSnapshot({ scope: 'document' })` refusing syntax colours supplied through CSS variables. Capture now saves foreground and background colours resolved against the editor's active theme, isolated from unrelated page selectors. Invalid colours and unresolved variables return an unsupported capture.

- [#1117](https://github.com/ShaulLavo/fregat/pull/1117) [`0c1b7fb`](https://github.com/ShaulLavo/fregat/commit/0c1b7fb03285785082f4d7b62ce991fbd487dcf4) - Fixed syntax colours disappearing in WebKit when an editor mounted under a hidden host becomes visible. Create hidden editors with `presentationReady: false` and call `setPresentationReady(true)` after revealing their host to restore the existing syntax paint.

- [#1176](https://github.com/ShaulLavo/fregat/pull/1176) [`f0e5906`](https://github.com/ShaulLavo/fregat/commit/f0e59061c8d2b189d82f9bc8e52590ba98668da1) - Added `mergeReview` to `createCollaborationPlugin` for confirmed concurrent-edit highlights, author-version hovers, local dismissal and bounded resolutions that reach every peer. Added `onMergeReview(unit, versions)` for host actions.

  Added `createTreeSitterReviewSyntax` for demand-only review reads from immutable document snapshots, and `mergeUnit` touching selection for intersected syntax units. Author projections reuse the confirmed syntax tree through `projectMergeUnits` and preserve nested injected languages, including code fences. Added `createEditorSnapshotBuffer` and `DocumentDelivery` to the internal document-worker entry point for snapshot reader integrations.

  Fixed completed merge resolutions reappearing as new review actions. Added `ConfirmedWindow.isAfter` for retained causal ancestry, and restricted review detection to remote confirmations with deferred demand for concurrent pending acknowledgements.

  Added `TooltipPart.presentation: 'controls'` for content-sized shared hovers with pane-bounded placement and a visible button footer. Review actions remain visible while long version comparisons scroll. Fixed host focus outlines appearing around comparison content; keyboard focus remains visible on buttons, and content sections use tone-only separation.

- [#1227](https://github.com/ShaulLavo/fregat/pull/1227) [`60d3c72`](https://github.com/ShaulLavo/fregat/commit/60d3c723c842180fd3fa3c6e8f8f7970f1330307) - Fixed syntax colours on inline widgets in WebKit so plain text beside Markdown links keeps its foreground colour. Fixed `captureSnapshot({ scope: 'document' })` to preserve inline widget token colours and capture editors with no gutter.

- [#1154](https://github.com/ShaulLavo/fregat/pull/1154) [`31010b1`](https://github.com/ShaulLavo/fregat/commit/31010b183be61ad044eb57438a58c91dd1c8de79) - Fixed editors mounted in same-origin iframes so `setText()`, native selection reconciliation, and textarea input work in the editor's own document. Row boundary checks, caret hit testing, embedded control checks, and `dispose()` also work after the iframe is removed.

- [#1217](https://github.com/ShaulLavo/fregat/pull/1217) [`590379e`](https://github.com/ShaulLavo/fregat/commit/590379e72a231dc9cdca814c84a3eba64cedb1a6) - Added `Editor.captureSnapshot({ scope: 'document' })` and the `@singapore-editor/core/paint` entry to capture complete content-layout documents and replay their text, styles, links and gutters at a new width. Unsupported preview content returns an explicit refusal.

  Added stable heading anchors to Markdown preview and preserved heading names and anchors in document paint.

- [#1186](https://github.com/ShaulLavo/fregat/pull/1186) [`2b9aeac`](https://github.com/ShaulLavo/fregat/commit/2b9aeaceb70c88c77ff0bc85b4bf3fbef3d52b9b) - Fixed wrapping, horizontal scrolling and text extents for proportional `fontFamily` values such as FreeSans. Mounted plain ASCII/tab rows below 5,000 UTF-16 code units retain native kerning, ligatures and insertion positions; longer rows stay editable with bounded approximate geometry. Tab stops now follow the current browser’s native half-character minimum, including editors initialized while hidden.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Fixed character wrapping without glyph measurements to restart tab stops on each displayed row. Rows containing tabs now fit column widths that fall between tab stops.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Fixed wrapped text overflowing narrow containers with gutters, wide fallback glyphs or fractional widths. Wrapping reserves space for the caret and hanging trailing spaces preserve their source positions without widening the scrolling area.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Fixed word wrapping to keep emoji and combining sequences together. Wrapped row breaks now stay the same when text arrives in separate storage chunks.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Fixed measured word wrapping to split an oversized word after moving it to a fresh row. Words now stay within the wrapping width when the preceding row ends at a space.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Fixed source offsets when rewrapping keeps a row's text unchanged. Trailing whitespace markers now include spaces split across wrapped rows while leaving interior spaces unmarked.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Fixed tab advances after a soft wrap to use the tab stops of the displayed row. Word-wrapped text containing tabs now fits the same width as its painted rows.

- [#1123](https://github.com/ShaulLavo/fregat/pull/1123) [`ad3b61f`](https://github.com/ShaulLavo/fregat/commit/ad3b61f41df9e3ce05d0a888fed2485ef77ff390) - Breaking: `InlineReplacementRender` receives the display text and its starting offset within the replacement. Update direct renderer calls to pass that text and `0` for a complete replacement. Added `wrap: 'text'` to split textual replacements into independently rendered row fragments while ordinary widgets keep their existing wrapping behavior.

- [#1119](https://github.com/ShaulLavo/fregat/pull/1119) [`c254ada`](https://github.com/ShaulLavo/fregat/commit/c254ada9561d41b3696d41ec3e6dd599892bf079) - Fixed deep scrolling and gutter alignment in Firefox for documents taller than the browser's sticky-position limit, including when content loads or grows after switching to virtualized mode. The editor discovers the browser limit when visible virtualized content exceeds four million pixels, preserving measurement-free construction with supplied `textMetrics` and layout-free unfocused opens of ordinary documents and retrying discovery after temporarily unmeasurable layout becomes available.

- [#1226](https://github.com/ShaulLavo/fregat/pull/1226) [`5ca1d34`](https://github.com/ShaulLavo/fregat/commit/5ca1d349ab0ec22a1951cc3ba1048b028b7f8f5a) - Breaking: Added `characterWidth` to each row in `SavedDocumentPaint`; include the effective font's zero-glyph advance when constructing document paint, and regenerate saved document snapshots. Fixed word wrapping for larger headings and other presentation-styled rows, with matching document snapshot replay and support for editors with no gutter. Styled rows rewrap after theme changes, stylesheet changes and late font loads, with a caret-width reserve measured in the row's font.

- [#1097](https://github.com/ShaulLavo/fregat/pull/1097) [`671416f`](https://github.com/ShaulLavo/fregat/commit/671416f1c1f3fd150b4bb797b915933ceb7f9cfb) - Added `tokenStoreBackingBytes` to `documentAnalysis.inspectRetention()` and its entry reports to count shared packed buffers once, including lazy token end indexes after allocation; worker heaps and WASM remain unmeasured.

  Added `documentAnalysis.inspectLeases()` for count-based cleanup that reads lease metadata without inspecting token results.

- [#1103](https://github.com/ShaulLavo/fregat/pull/1103) [`9488cc4`](https://github.com/ShaulLavo/fregat/commit/9488cc4dba071e4e995de4cb3fd0485f6e8c510a) - Fixed `changesSinceDocumentSyncPoint` and `changesBetweenDocumentSyncPoints` returning `null` edits when a later deletion or replacement overlapped an earlier edit. They now return the combined edits, so consumers keep updating incrementally.

- [#1116](https://github.com/ShaulLavo/fregat/pull/1116) [`7b04e6e`](https://github.com/ShaulLavo/fregat/commit/7b04e6e32d054a9045ba5a7f9108cd0db354f56e) - Fixed the editor's hidden font measurement probe extending the native scroll height in Firefox. The retained probe now stays at the top of the scroll container.

- [#1245](https://github.com/ShaulLavo/fregat/pull/1245) [`67c4603`](https://github.com/ShaulLavo/fregat/commit/67c4603448625f31c59175738df0eae89132c869) - Fixed the current-line background to cover every wrapped row of the logical line in both the text and gutter, including when the caret is on a continuation row.
- Updated dependencies []:
  - @singapore-editor/textbuffer@0.2.8

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
