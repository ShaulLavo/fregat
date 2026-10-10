# Known limits

This page records Singapore's hard limits, bounded work and degraded behavior. It is a starting inventory, checked against the source on 2026-10-09. It includes limits in optional packages; attaching a package makes its limits relevant to your editor.

Text lengths count UTF-16 code units unless an entry says bytes or pixels. A code unit is neither a UTF-8 byte nor a grapheme. Many emoji occupy two code units, and a grapheme can contain several characters.

The [browser quirks document](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/display/browser-quirks.md) records engine bugs and their workarounds. This page records what the editor can measure, display, analyze or transfer. Cache eviction and transport chunk sizes generally bound retained work; they do not set a maximum document size.

Each entry names its source and any work that owns changing it. "No lifting plan identified" means this survey found no plan that commits to removing that specific limit.

## Text measurement and scrolling

### BiDi row measurement

- Limit. A rendered row containing right-to-left text is refused at **32,000 code units or more**. A BiDi grapheme longer than **50 code units** is also refused, even in a shorter row.
- Source. `BIDI_LINE_MEASUREMENT_CEILING`, `MAX_ROW_TEXT_NODE_LENGTH`, `bidiMeasurementRefusal`, `hasOversizedGrapheme` and `setUnmeasurableBidiRowText` in [virtualizedTextViewRows.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/virtualizedTextViewRows.ts#L109).
- What you see. The row becomes an endpoint-only placeholder. Its label reports the line or grapheme geometry ceiling. Interior text and interior caret geometry are unavailable in that row. The document text remains in the buffer.
- Why. BiDi needs the browser's visual ordering. Splitting its text into independently positioned horizontal chunks would lose that ordering. The ceiling bounds native layout and geometry work; the 50-unit node bound also limits range measurement within a text node.
- Ownership. No lifting plan identified. Proportional text below has an independent ceiling and remains editable beyond it.

### Proportional row measurement

- Status. Implemented in [PR #1186](https://github.com/ShaulLavo/fregat/pull/1186), awaiting merge and release.
- Limit. Native intact-row geometry applies strictly below **5,000 UTF-16 code units**. At **5,000 or more**, proportional rows use bounded shaped-run approximation. The independent `BIDI_LINE_MEASUREMENT_CEILING` remains **32,000**.
- Source. `PROPORTIONAL_INTACT_NODE_CEILING = 5_000` in [nativeCarets.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/nativeCarets.ts), `nativeRowCarets` in [virtualizedTextViewGeometry.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/virtualizedTextViewGeometry.ts), and `shouldChunkLine` and `updateRowTextChunks` in [virtualizedTextViewRows.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/virtualizedTextViewRows.ts).
- DOM budget. A mounted plain left-to-right proportional row (printable ASCII and tabs) below the ceiling retains one intact text node. Its horizontal window starts at zero and includes the complete rendered row. Monospace and inline replacements retain their horizontal text windows. Native geometry is measured lazily on mounted rows; canvas shaping still owns document-wide projection and wrapping.
- What you see. Longer proportional rows remain editable with approximate caret, selection and wrapping geometry. The row reports `data-editor-shaping-geometry="approximate"` and `data-editor-shaping-ceiling="5000"`. The diagnostic `view.nativeShaping.degraded` records `reason: "line-length"`, `length`, `ceiling` and `path: "bounded-shaped-runs"`. The existing oversized-BiDi placeholder behavior above still applies to right-to-left rows. Inline replacements and rendered control characters keep their existing geometry owners.
- Why. An intact text node preserves kerning, ligatures and native insertion positions within the mounted-row budget. Splitting a native shaping run can change the painted text. The longer-row fallback bounds retained text and geometry work.
- Ownership. #1186 owns this implementation and its cost evidence. No lifting plan identified. The ceiling was selected from three-engine 2k, 5k, 10k and 15k cost experiments: 5k was the largest tested candidate with edits below 8.3 ms and WebKit scroll frames near 16 ms. It bounds intact-row work; these experiments do not establish key-to-paint latency or a budget on every device.

### Native scroll height

- Limit. The default physical scroll extent is **16,000,000 CSS pixels**. Virtualized views lazily probe the browser's sticky-position limit when logical content height exceeds **4,000,000 pixels**, one quarter of the default. The measured cap can be lower, especially in Firefox. There is no fixed Firefox value in the source.
- Source. `DEFAULT_MAX_SCROLL_HEIGHT` in [fixedRowVirtualizer.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/fixedRowVirtualizer.ts#L90), `stickyScrollHeightLimit` in [scrollViewport.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/scrollViewport.ts#L137), and `renderSnapshot` in [virtualizedTextView.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/virtualizedTextView.ts#L1639).
- What you see. The virtualizer maps the larger logical document onto a capped native scroll extent and shifts the painted origin near the viewport. This is a physical-coordinate limit, not a line-count refusal. Native scrollbar distance no longer equals logical document distance.
- Why. Browser element-height and sticky-translation ceilings would otherwise leave the end of a large document unreachable or incorrectly painted. Discovery waits until a large document needs it to avoid forced layout on ordinary opens.
- Ownership. The mapping and probe already handle this cap. No plan identified to remove the browser's physical limit. Engine-specific details belong in [browser quirks](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/display/browser-quirks.md).

### Visible paint snapshots

- Limits. A visible-paint snapshot accepts at most **32 layers** and **8,192 rectangles in total**. Layer identifiers must contain **1 to 128 code units**, and rectangle color strings **1 to 256 code units**.
- Source. `MAX_VISIBLE_PAINT_LAYERS`, `MAX_VISIBLE_PAINT_RECTANGLES`, `copyEditorVisiblePaintLayers` and rectangle validation in [visiblePaint.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/editor/visiblePaint.ts#L3).
- What you see. A contributor that exceeds these bounds throws a `RangeError` while copying its snapshot. The snapshot cannot carry that paint payload. This is a snapshot contract, not a cap on document syntax tokens.
- Why. Copied paint contributions need bounds on rectangle counts and string payloads.
- Ownership. No lifting plan identified.

### Emitted document snapshot syntax paint

- Requirement. Emitted document-snapshot HTML uses native CSS Custom Highlight ranges to preserve continuous text shaping across syntax-colour boundaries. Run `preparePaintSnapshotHighlights(document)` from `@singapore-editor/core/paint` in a small inline head bundle before emitting roots. It installs a JavaScript-only visibility gate that keeps snapshot layout while streamed markup waits for activation. Call `activatePaintSnapshotHighlights(root, paint)` synchronously after each root; every activation attempt reveals its root, including refusals and exceptions. The interactive ready-state transition releases remaining gates as parsing finishes, before deferred or module scripts load, including when activation is missing. A fresh document key prevents serialized readiness from bypassing the gate. Both APIs work without an Editor, parser or worker; `mountPaintSnapshot` activates automatically.
- Admission. Emit the complete root produced by `mountPaintSnapshot`. Activation validates the ordered, contiguous source slices and full source coverage before allocating ranges. Repeated, overlapping, missing, reordered, oversized or nested malformed slices are refused; traversal and range work are bounded by the decoded document's text, rows and runs.
- JavaScript off. Emitted text, links, headings, gutters and captured row layout remain readable. Syntax colours on continuous-text rows require activation; with JavaScript disabled those rows use their base text colour. Font files must still load for the captured font metrics to match.
- Source. [documentPaintHighlights.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/virtualization/documentPaintHighlights.ts) and [paint.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/paint.ts). Dispose the returned handle when removing or replacing emitted roots. Independent bundles allocate names against the document's shared highlight registry.
- Ownership. [Plan 340](https://github.com/ShaulLavo/fregat/blob/main/plans/340-singapore-site-embedding.md) owns emitted first-frame and live-takeover qualification.

## Document size and analysis

### Whole-document string boundary

- Boundary. `MAX_HEAP_OPERATION_LENGTH` is **268,435,456 code units**, or `256 * 1024 * 1024`. `exceedsHeapOperationBudget` returns true strictly above it. The buffer records this flag from its initial length.
- Source. The constant, predicate and `isTooLargeForHeapOperation` in [documentSession.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/documentSession.ts#L643). Explicit full-text reads live in [documentTextSnapshot.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/documentTextSnapshot.ts#L152) and [reads.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/textbuffer/src/reads.ts#L117).
- What you see. This is an advisory heap-operation boundary. It does not refuse loading or editing, and it does not prevent callers from requesting a full string. Such a request can still exhaust memory or reach the JavaScript engine's string limit. Range reads and chunk iteration remain the intended paths for large documents.
- Why. One UTF-16 string at the boundary has roughly 512 MiB of character storage before copies and other allocations. Routine editing should leave the piece table in chunks.
- Ownership. [E033's completed full-text boundary work](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/e033-full-text-boundary.md) owns explicit extraction and the `check:full-text` gate. It does not establish a universal editable-file size guarantee. No lifting plan identified for this advisory value.

### Fregat's large-file feature cutoffs

- Thresholds. The Fregat host defaults to syntax and language-server analysis through **10,485,760 code units**, and a minimap through **52,428,800 code units**. Larger documents lose the corresponding feature. Equality stays allowed. These are configurable host defaults; Singapore's plain core and analysis packages have no matching automatic document-size cutoff.
- Source. `editor.largeFile.analysisLimitMiCodeUnits` defaults to **10**, and `editor.largeFile.minimapLimitMiCodeUnits` to **50**, in [settings/keys.ts](https://github.com/ShaulLavo/fregat/blob/main/packages/contracts/src/settings/keys.ts#L567). `documentAnalysisAllowed` multiplies by **1,048,576** in [large-file-policy.ts](https://github.com/ShaulLavo/fregat/blob/main/apps/web/src/features/editor/utils/large-file-policy.ts#L1). The feature policy is applied in [prepared-document.ts](https://github.com/ShaulLavo/fregat/blob/main/apps/web/src/features/editor/utils/prepared-document.ts).
- What you see. Text remains editable while the host skips expensive analysis or minimap work. A standalone integration chooses its own policy.
- Why. File storage and interactive analysis have different costs. A document that fits memory can still take too long to parse or analyze.
- Ownership. These knobs already let the host change the thresholds. [Plan 336's highlighted-open work](https://github.com/ShaulLavo/fregat/blob/main/plans/336-packages-as-products.md#singapore-highlighted-open) owns bounded syntax startup, not removal of the host policy.

### Tree-sitter provisional coverage

- Limit. Viewport-first analysis applies to range-mode sources larger than **65,536 code units**, with Markdown and MDX excluded. A provisional prefix starts at zero, extends **4,096 units** past demand, and stops at **65,536 units**.
- Source. `TREE_SITTER_BOOTSTRAP_UNITS` in [source.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter/src/treeSitter/source.ts#L3), admission in [session.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter/src/session.ts#L228), and range selection in [treeSitter.worker.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts#L1325).
- What you see. Initial colors can be provisional and can change after complete analysis. The provisional tree has no injected-language analysis, folds, diagnostics or bracket structure. Requests outside its coverage, and previews with grammar recovery errors, wait for complete context.
- Why. Bounded initial parsing can paint the viewport before full-document analysis finishes. Starting at zero preserves grammar entry context; partial structure cannot describe the whole document.
- Ownership. [Plan 336's viewport-first work](https://github.com/ShaulLavo/fregat/blob/main/plans/336-packages-as-products.md#approved-viewport-first-follow-up) owns this behavior and its correctness checks. The prefix cap is a work budget, not a maximum file size.

### Tree-sitter operation budgets

- Limit. Parsing and range queries each use a **20,000 ms** elapsed-work budget. Cancellation checks enforce it cooperatively, so it is not an exact wall-clock deadline for every native call.
- Source. `PARSE_BUDGET_MS`, `QUERY_BUDGET_MS`, `isCancelled` and cancellation replies in [treeSitter.worker.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts#L196).
- What you see. Work that exceeds the budget returns a cancellation outcome. Complete analysis may remain unavailable. The session preserves its last usable tree and colors; provisional colors can remain while complete analysis is cancelled.
- Why. Expensive grammar work must give up, and stale analysis must not block newer work indefinitely.
- Ownership. [Plan 336](https://github.com/ShaulLavo/fregat/blob/main/plans/336-packages-as-products.md#viewport-first-execution-decisions) owns cancellation accounting and retained provisional results. No lifting plan identified for the 20-second budget.

### Nested language injections

- Limit. Injection depth is **8**, with the host root at depth zero. Once a parent reaches depth 8, the worker stops adding its child injections.
- Source. `MAX_INJECTION_DEPTH` and `appendInjectionLayers` in [treeSitter.worker.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts#L195).
- What you see. Deeper embedded languages lose their injected-language analysis. The response records `injection-failed` with the message "Injection nesting exceeds the supported depth." Other parsed layers remain available.
- Why. Recursively embedded grammars need a finite bound. Non-progressing injections also have a separate guard.
- Ownership. [E065](https://github.com/ShaulLavo/fregat/blob/main/plans/e065-injection-and-range-query-cost.md) owns injection-discovery cost, but does not commit to lifting the depth cap.

### Structural merge query state

- Limit. Merge-unit queries pass Tree-sitter **`matchLimit: 128`** and **`maxStartDepth: 0`**. The match limit bounds in-progress query states, not the number of returned syntax tokens or search matches.
- Source. `QUERY_OPTIONS`, `unitAt` and `parentEligibility` in [mergeUnits.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter/src/treeSitter/mergeUnits.ts#L5).
- What you see. A pathological merge query can omit matches after exhausting the native query-state budget. A structural merge unit may then be unavailable or chosen from the remaining matches. This code adds no dedicated overflow notice.
- Why. Structural queries run at candidate nodes; bounded state prevents patterns from consuming unbounded native query memory. Starting at depth zero keeps each candidate query local.
- Ownership. No lifting plan identified. This value belongs specifically to structural merge queries.

### Shiki long-line tokenization

- Limit. The default maximum line length is **20,000 code units**, configurable through the worker client's `maxTokenizationLineLength` option. Lines strictly longer than the limit skip grammar tokenization.
- Source. `DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH` in [workerClient.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/shiki/workerClient.ts#L93), and `createScopedLineTokenizer` in [scopedTokens.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/shiki/scopedTokens.ts#L36).
- What you see. The oversized line becomes one plain token with `untokenized: true`. The previous grammar state passes through unchanged, so subsequent multiline coloring can lack context from the skipped line.
- Why. Grammar tokenization has no time bound on this path. The length check avoids expensive minified or generated lines.
- Ownership. The option already permits changing the limit. No lifting plan identified for the default.

## Search and language tools

### Find highlight count

- Limit. The find widget retains and paints at most **19,999 matches**. `findMatches` uses the same default cap when called directly, and accepts a caller-supplied limit.
- Source. `FIND_MATCHES_LIMIT` in [search.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/find/src/search.ts#L11), and `research` in [findController.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/find/src/findController.ts#L562).
- What you see. Highlight coverage stops at the cap. The widget still counts all matches and can navigate beyond the painted list. Replace all and selection of all matches use a separate **1,073,741,824-match** limit, `FIND_REPLACE_ALL_LIMIT`; they do not reuse the painting cap.
- Why. Retaining, tracking and painting every occurrence can stall editing in a repetitive document. Counting and navigation can operate without retaining the whole match set.
- Ownership. Count and navigation beyond the paint cap are already implemented. No lifting plan identified for the retained highlight cap.

### Selection used to seed find

- Limit. A selection of **524,288 code units or more** is not copied into the find input automatically.
- Source. `SEARCH_STRING_MAX_LENGTH` and `selectionSearchString` in [findController.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/find/src/findController.ts#L86).
- What you see. Opening find with that selection does not seed the query from its text. This is a selection-seeding limit, not a maximum length for a manually entered query.
- Why. Opening the widget should avoid copying an enormous selection into an input field.
- Ownership. No lifting plan identified.

### TypeScript result lists

- Limits. The built-in TypeScript worker returns at most **100 completion items** after filtering, and asks TypeScript for at most **256 workspace symbols**. Its typed-word completion filter scans at most **128 code units** backwards.
- Source. `MAX_COMPLETION_ITEMS`, `MAX_TYPED_WORD` and `completion` in [completion.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/typescript-lsp/src/worker/completion.ts#L10), and `MAX_WORKSPACE_SYMBOLS` in [symbols.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/typescript-lsp/src/worker/symbols.ts#L8).
- What you see. A capped completion list has `isIncomplete: true`, allowing the client to request another filtered list as you type. Workspace symbol search returns a bounded set. For a longer identifier, completion filtering uses its trailing bounded fragment.
- Why. Filtering before capping keeps relevant completions available while bounding list transport and display work.
- Ownership. No lifting plan identified. External language servers choose their own result limits.

### Spellcheck exclusions

- Limits. Spellcheck skips lines and supplied text regions strictly longer than **16,384 code units**. Tokenization also skips non-whitespace chunks strictly longer than **256 code units**.
- Source. `MAX_SPELLCHECK_LINE_LENGTH` and `MAX_STRUCTURED_LENGTH` in [tokenizer.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/spellcheck/src/tokenizer.ts#L26), with line and region checks in [controller.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/spellcheck/src/controller.ts#L191).
- What you see. Skipped text has no spelling diagnostics from this package. Other regions remain checked.
- Why. Generated and minified text should not force large text reads and repeated token scans on each keystroke.
- Ownership. No lifting plan identified.

## Clipboard, paging and collaboration

### Rich-text clipboard output

- Limits. Styled copy accepts at most **65,536 source code units**, including separators, and at most **1,048,576 UTF-8 bytes** of generated HTML. Exceeding either bound returns no rich-text payload.
- Source. `MAX_RICH_TEXT_SOURCE_LENGTH`, `MAX_RICH_TEXT_OUTPUT_BYTES`, `richTextForCopy` and `BoundedMarkup` in [richText.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/src/editor/richText.ts#L10).
- What you see. Copy still provides plain text. The oversized selection loses clipboard colors and formatting.
- Why. HTML can be several times larger than the source, and clipboard preparation runs synchronously during the copy gesture.
- Ownership. No lifting plan identified.

### Experimental paged viewer

- Default limits. `PAGED_PROOF_OPTIONS` permits **2 views**, **128 rows per window request**, **524,288 decoded code units per window or copy**, and **2 in-flight page reads**. Its byte cache is **8,388,608 bytes**, with **65,536-byte pages** and at most **4,096 checkpoints**. Callers can supply different positive limits through `PagedOptions`.
- Source. `PAGED_PROOF_OPTIONS`, `createView`, `readLines`, `copyRange` and checkpoint retention in [document.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/paged/src/document.ts#L36), and truncation in [window.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/paged/src/window.ts).
- What you see. Opening a third view, requesting too many rows, or copying too large a range throws. A displayed window whose requested text exceeds the code-unit budget reports `truncated: true` and retains a prefix of its text. Exactly 524,288 code units fit without truncation. Extra reads wait for an in-flight slot. Cache eviction and wider checkpoint spacing can cause more source reads. The viewer is read-only and experimental.
- Why. Range-based UTF-8 inspection needs explicit bounds on resident text, concurrent I/O and index memory.
- Ownership. [Plan 112](https://github.com/ShaulLavo/fregat/blob/main/plans/112-large-file-ceiling.md) owns the large-file and paged path. These are configurable proof defaults, not a maximum source-file byte size.

### Collaboration message framing

- Limits. One framed message carries at most **8,388,608 bytes**. Frames are at most **16,384 bytes**, including a **68-byte header**, and a transfer can contain at most **65,536 frames**. The negotiated SCTP limit can reduce frame size; values at or below the header size cannot carry a payload.
- Source. `MESSAGE_LIMIT`, `CHUNK_LIMIT`, `HEADER`, `frameMessage` and `FrameReceiver` in [framing.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/src/framing.ts#L1).
- What you see. Oversized messages and invalid transfer bounds throw. A large document therefore needs a protocol that uses several bounded messages; the limit applies per message.
- Why. Ordered, digest-checked transfers keep incomplete-transfer memory bounded and respect data-channel message sizes.
- Ownership. [E067](https://github.com/ShaulLavo/fregat/blob/main/plans/e067-webrtc-collaboration-plugin.md) owns the collaboration transport. No lifting plan identified for this per-message cap.

### Collaboration session membership

- Limit. A collaboration session admits at most **8 peers**, including the local peer.
- Source. The constructor adds the local member, and `connect` refuses a new member when `members.size >= 8`, in [session.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/src/session.ts#L170).
- What you see. Connecting a ninth member throws a `RangeError` with the message "A session supports up to eight peers." Reconnecting an existing member does not take another slot.
- Why. The transport uses a small peer mesh. Room size needs a bound on connections and protocol work.
- Ownership. [E067](https://github.com/ShaulLavo/fregat/blob/main/plans/e067-webrtc-collaboration-plugin.md#scope) explicitly excludes rooms over eight peers. No lifting plan identified.

### Collaboration presence

- Limits. Presence tracks at most **256 peer clock entries**, accepts at most **32 selections per presence state**, and requires peer and document identifiers of at most **256 code units**.
- Source. `MAX_PEERS`, `MAX_SELECTIONS`, `MAX_ID`, clock admission and presence validation in [presence.ts](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/src/presence.ts#L40).
- What you see. New peer clock entries beyond the cap and invalid remote selection states are ignored. Invalid local presence input and constructor identifiers throw. This bounds presence display and validation; it is not a statement of supported concurrent document editors.
- Why. Incoming presence is remote input. Its maps, selection arrays and identifiers need memory bounds.
- Ownership. [E067](https://github.com/ShaulLavo/fregat/blob/main/plans/e067-webrtc-collaboration-plugin.md) owns presence transport. No lifting plan identified for these bounds.

## Scope of this inventory

This page deliberately leaves out cache-entry counts that only cause recomputation, animation budgets and UI dimensions. Initial worker source synchronization uses chunks; chunk size alone does not establish a document ceiling. The paged viewer and collaboration framing above have explicit rejection or truncation branches, so their limits are listed.

A successful large-file open is also not a hard limit or a promise of interactive typing. Use the [large-file guide](https://shaulavo.dev/singapore/docs/guides/large-files/) and the [retained browser comparison](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08.md) to choose measurements for your integration. Add new confirmed limits here with the exact source and the behavior beyond the boundary.
