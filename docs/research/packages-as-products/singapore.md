# Singapore: what's impressive, shipped and planned

Research for [Plan 336](../../../plans/336-packages-as-products.md), Track A. Written 2026-10-08
against Fregat `0df5eb872`. Sources: `editor/` (README, ARCHITECTURE, PROGRESS, `docs/**`, every
`packages/*` README and `src`), the root `plans/editor-*.md`, `plans/e0*.md`, plans 111, 112, 122,
156, 229, 262, 272, the revised `plans/delta-db-implementation-plan.md`, `docs/collab-editing/`,
`docs/large-file-ceiling/`, the Editor subtree history (749 commits, 2026-04-01 to 2026-09-29, split
`17a020ad4`; 87 more since the import), `/work/projects/tree-sitter-x`, and Matthew Weidner's
[Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html).

Paths below are relative to `editor/` unless they start with `plans/`, `docs/` or a repo name.
Every claim was checked in code or in a measurement report. Where a number is a single local run,
the entry says so.

Two corrections to the brief before the details:

- **"Workers heavily" is true for everything derived from the text, not for the text itself.** The
  piece table that typing writes to lives on the main thread (`docs/architecture/worker-topology.md`:
  "The main-thread document engine remains the document truth"). Parsing, highlighting, the
  minimap, spellcheck and the TypeScript service run in workers, and each worker keeps its own
  piece-table replica advanced by edit batches. The site should say exactly that.
- **No benchmark against Monaco or CodeMirror exists yet.** What exists: Singapore's text buffer
  against Microsoft's `vscode-textbuffer` (the storage layer under Monaco), a 101-finding parity
  audit against Monaco and CodeMirror 5 source, and a geometry study that used Monaco's mechanisms
  as the control. Track B has to build the editor-level comparison before any "faster than Monaco"
  copy ships.

---

## 1. One-liner candidates

1. **A modern Monaco for the browser, built the way Zed is built.** (The owner's line; needs the
   proof in section 2 beside it.)
2. **The code editor where every version of the document is a value.** Persistent piece table,
   branching undo, anchors that survive deletion.
3. **A browser code editor that keeps the main thread for typing.** Tree-sitter, highlighting,
   the minimap, spellcheck and the TypeScript language service run in workers.
4. **Zed's text model, the browser's own text layout.** Persistent piece table and anchors
   underneath; native layout, the CSS Custom Highlight API and EditContext on top.
5. **Open a 200 MiB file and keep typing.** (Only with the evidence link; see differentiator 7.)
6. **TypeScript intelligence with no server.** The real TypeScript language service in a worker.

Recommendation: 1 as the headline, 3 as the subhead. 2 and 6 work as section titles.

---

## 2. Top 10 differentiators, ranked

Ranked by how much each separates Singapore from Monaco and CodeMirror, weighted by how well the
proof holds up today.

### 1. Every edit returns a new document; old versions stay readable and editable

**Pitch.** The text lives in a persistent AVL piece table. An edit copies the path it touches and
shares the rest, so taking a snapshot costs nothing, undo is a pointer swap, and you can edit an old
version to make a branch. Monaco's piece tree mutates in place; CodeMirror 6 keeps immutable line
trees but no anchors into deleted text.

**Evidence.**

- Design: `docs/storage/piece-table.md`, `packages/textbuffer/docs/design.md`; code in
  `packages/textbuffer/src/` (45 files, about 10,000 lines, no runtime dependencies).
- Benchmarks against the pinned `microsoft/vscode-textbuffer`, Node, i7-14700K, 2026-09-17
  (`packages/textbuffer/docs/benchmarks.md`): faster at load (1.7x short lines, 2.7x one long
  line), sequential typing (1.5x), large paste and delete (2.7x), offset ranges (2.3x) and
  offset-to-position (2.1x). Slower at random inserts (1.3x), random replacements (1.5–2.0x),
  multi-cursor batches (1.5x), line reads (1.2–1.6x) and position-to-offset (1.5x). The control
  has no snapshots, tombstones or anchors, so the doc warns "a ratio compares unequal feature
  sets".
- Capabilities the control does not have: 1,500 edits with 64 old versions kept alive in 2.0–2.5 ms;
  64 branches from one version at 4.3 µs each; 3,000 anchor resolutions after churn in 0.3–0.5 ms.
- A dozen numbered optimisation reports, each with raw evidence: E037–E046 (allocations,
  append-only buffer log, reverse index, treap to AVL, one-pass edits, one-walk rows),
  `docs/performance/piece-heap-cost.md` (252 to 204 bytes per piece; full GC of 1.2M pieces
  62–77 ms to 46–52 ms), E006 text reclamation and tombstone compaction (`docs/storage/`).
- CI gates on exact structural counters (`packages/textbuffer/bench/budgets.json`), not on noisy
  timings.

**Status.** Shipped, `@singapore-editor/textbuffer` 0.2.6, usable alone.

**Demo idea.** A "time travel" strip under the home-page editor: every keystroke adds a dot; drag
back, type, and a branch appears. A toggle shows the piece tree before and after the edit (the
example app already has a piece-tree inspector, `examples/app/src/components/pieceTreeInspector.ts`).

### 2. Anchors that survive deletion, Zed's model

**Pitch.** A position can be held as an anchor: a reference to the text itself, not to an offset.
It resolves against any version, reports whether its text was deleted, and a left or right bias
decides which side of an insertion it sticks to. Selections, folds, jump history and widgets use
anchors, so no call site ever "rebases" a position. CodeMirror makes every caller map positions
through changes; Monaco tracks decorations in a central interval tree.

**Evidence.**

- `docs/positions/anchors.md` (locked semantics, why anchors beat explicit rebasing and interval
  trees), `packages/textbuffer/src/anchors.ts`, `reverseIndex.ts`.
- Deletion keeps pieces in the tree as invisible tombstones, so a deleted anchor still resolves
  deterministically to the gap edge its bias picks.
- E039 replaced a second persistent tree with a persistent vector: typing and deleting write
  nothing to the index (`docs/performance/e039-reverse-index-cost.md`).
- Consumers: jump history (`packages/editor/src/editor/jumpHistory.ts`, 50 anchors per view that
  survive edits, `docs/editing/jump-history.md`), selections, folds.

**Status.** Shipped.

**Demo idea.** Drop three pins in the text, then select and delete a paragraph that contains one.
The surviving pins move with their text; the deleted one turns grey and shows where it would land.
Press undo and it turns live again in place.

### 3. Heavy work runs in workers that keep their own copy of the document

**Pitch.** Tree-sitter parsing, Shiki tokenizing, the minimap, spellcheck and the TypeScript
language service each run in a dedicated module worker. Workers do not get the whole text on every
keystroke: each one holds a piece-table replica that the editor advances with the edit batch, and
results come back as packed typed arrays tagged with the version they describe, so a stale answer
is dropped. A parse that is no longer wanted is cancelled through a `SharedArrayBuffer` flag.
Standalone Monaco's Monarch tokenizer runs on the main thread; CodeMirror parses on the main thread in time slices.

**Evidence.**

- Worker entries: `packages/tree-sitter/src/treeSitter/treeSitter.worker.ts`,
  `packages/editor/src/shiki/shiki.worker.ts`, `packages/minimap/src/minimap.worker.ts`,
  `packages/spellcheck/src/spellcheck.worker.ts`, `packages/typescript-lsp/src/typescriptLsp.worker.ts`.
- Replica protocol: `packages/editor/src/document/workerReader.ts` (`importRead`, then `advance`
  with `applyBatchToPieceTable`), `packages/editor/src/editor/documentDelivery.ts`. Shiki sends
  only the changed range, found with `diffPieceTableSnapshots` (`docs/performance/e007-consumer-copies.md`).
- Tree-sitter reads straight from the replica through a callback, 4,096 code units at a time
  (`packages/tree-sitter/src/treeSitter/source.ts`).
- Cancellation: `Atomics.store` in `packages/tree-sitter/src/treeSitter/workerClient.ts:474–549`,
  polled at `treeSitter.worker.ts:2959`.
- Packed tokens as transferables: `packages/editor/src/syntax/packedTokens.ts`. E035 cut token
  handling from 155 ms to 0.004 ms on 500,000 tokens (`docs/performance/e035-packed-token-store.md`).
- The highlighting service refuses to tokenize on the main thread: with no worker, calls reject
  with `unavailable` (`packages/highlighting/docs/service.md`).
- Typing never waits for analysis: syntax and features run on a 150 ms debounce with a 400 ms
  maximum wait (`docs/performance/input-latency.md`).
- Measured choice: a SharedArrayBuffer text transport was built, matched postMessage speed, and
  was deleted (`docs/performance/sab-transport-2026-09-12.md`, E057).

**Status.** Shipped. The document itself stays on the main thread (see the correction above).

**Demo idea.** A "main thread" meter beside the editor. Paste 50,000 lines of TypeScript; colours
fill in while the meter stays flat, and a busy-loop button proves that a blocked main thread is
the only thing that would stall typing.

### 4. The browser does the text layout; the CSS Custom Highlight API paints syntax; EditContext takes input

**Pitch.** Singapore does not run its own text layout engine. Mounted rows are plain DOM text, so
the browser handles shaping, ligatures, right-to-left text and IME. Syntax colours and selections
are painted with the CSS Custom Highlight API, which colours ranges of text without adding a span
per token. On Chromium, input comes through the EditContext API, so every change arrives as a
range edit with IME candidates included.

**Evidence.**

- Highlights: `CSS.highlights` registry at `packages/editor/src/virtualization/virtualizedTextViewHelpers.ts:741`;
  `new Highlight()` in `sharedTokenHighlights.ts:58` and `virtualizedTextViewHighlights.ts`;
  `::highlight()` rules built in `style-utils.ts:61`. Paint is tested in Chromium, Firefox and
  WebKit (`packages/editor/vitest.config.ts:146–148`), with a Firefox repaint workaround in
  `geckoHighlightRepaint.ts`.
- EditContext: `packages/editor/src/virtualization/editContext.ts`; `inputRoute: 'edit-context'`;
  `characterboundsupdate` answered with preedit glyph rects so the IME window opens beside the
  text (`inputSelectionController.ts:1756–1892`). Decision and measurements in
  `docs/display/e036-monaco-geometry-comparison.md`: typing 0.31–0.35 ms per event against
  0.30–0.38 ms for the textarea route. Fregat makes it the default.
- BiDi tiers A and B: affinity-aware caret, hit testing and RTL-safe selection paint
  (`virtualization/virtualizedTextViewBidi.ts`, `docs/display/browser-virtualization.md`).
- Grapheme-aware movement and deletion with `Intl.Segmenter` (`packages/editor/src/graphemes.ts:212`).
- Monospace verification: the editor probes the font and drops to measured geometry when the face
  is not truly monospace (0 of 339 columns wrong on monospace fonts; Liberation Sans 339 of 339
  wrong, which the check catches).

**Status.** Shipped. EditContext is Chromium only; other engines use the textarea route.

**Demo idea.** A language toggle on the home-page editor: Arabic and Hebrew comments, emoji with
skin tones, and a CJK IME note. The caret moves correctly through all of it, because the browser
lays it out.

### 5. The real TypeScript language service, in a worker, with no server

**Pitch.** `@singapore-editor/typescript-lsp` bundles TypeScript 6.0.3 and runs its language
service in a Web Worker, speaking LSP to the editor. Completions, hover, signature help,
diagnostics, go to definition, references, cross-file rename, quick fixes, organize imports,
formatting, semantic tokens and workspace symbols work in a static page. Monaco's TypeScript
worker is the closest equivalent; CodeMirror has none built in.

**Evidence.**

- `packages/typescript-lsp/src/` (31 files); `src/worker/libraries.ts` lazy-loads only the
  standard-library `.d.ts` files a program references (67 of 108 for ES2023).
- E054 parity (`docs/architecture/e054-worker-language-server-parity.md`): the worker answers every
  method Fregat's server-side TypeScript backend answers.
- One worker can serve several tabs (`TypeScriptLspWorkspace` with `LspConnectionPool`); the same
  session can run behind a socket through `/server`.
- `@singapore-editor/lsp-plugin` (48 files, about 12,000 lines) speaks to any language server and
  can rank several servers per document, for example TypeScript plus ESLint, sending each feature
  to the best server that supports it (`createLanguageServerSetPlugin`).

**Status.** Shipped.

**Demo idea.** The home-page editor holds two TypeScript files. Rename a symbol in one with F2 and
watch the other change; hover a type; the network tab shows no server calls.

### 6. Branching undo that is saved, restored and browsable

**Pitch.** Undo history is a tree. Undo, then type, and the old branch is kept; any retained state
can be checked out. The graph is serialized as edit scripts (never document text), so reopening a
file restores its whole undo tree, branches included. A history viewer lays the graph out in lanes
and diffs any two states. Neither Monaco nor CodeMirror keeps undo branches.

**Evidence.** `packages/editor/src/history.ts` (E017, a persistent value; 200 states by default),
`historySerialization.ts` (E018), `historyViewer.ts` (E019); `docs/editing/undo-graph.md`,
`e018-persisted-undo.md`, `undo-graph-viewer.md`. The example app has a History panel.

**Status.** Shipped. Persistence storage is the host's job (Fregat uses IndexedDB, keyed by content
hash).

**Demo idea.** Type, undo three times, type something else, and open the history panel: two
branches side by side, click either to jump there. Reload the page and the tree is still there.

### 7. Large files, with measured ceilings

**Pitch.** Singapore opens, edits and saves a 200 MiB file, and its read-only paged view opens a
600 MiB file in about 2.3 MiB of JavaScript heap. Typing stays fast on a 500,000-line file and on
a single one-megabyte line.

**Evidence.**

- Fregat integration, Chromium, single trials (`docs/large-file-ceiling/README.md`,
  `results/resident-20260928.md`): 200 MiB plain text opens in about 1.2 s, typing p95 15.5 ms,
  saves 209,715,200 exact bytes in 7.5 s. Plan 112 cut typing p95 at 100 MiB from 1,026 ms to
  16.6 ms.
- Paged read-only view (`packages/paged`, `docs/performance/e015-paged-proof.md`): 300 MiB indexed
  in 2.1 s and 600 MiB in 4.3 s, steady heap 2.26–2.30 MiB, first rows in about 2.4 ms while
  indexing continues, a distant jump in about 40 ms. Streaming UTF-8 decode, 8 MiB page cache,
  every read checks the file revision.
- Input gate (`examples/stress/results/input-latency/README.md`, i7-14700K, Chromium 148): dispatch
  p95 1.1 ms on an ordinary file, 1.0 ms on 500,000 lines, 1.8 ms on a one-megabyte line; the gate
  catches an injected 20 ms delay in all 36 groups.
- In-buffer search (E008, `docs/performance/e008-in-buffer-search.md`): queries read 64 Ki-unit
  windows from the piece table; on 500,000 lines, listing went from 500,000 reads to a handful
  (20–250x faster), and Find Next with no match from 0.4–1.2 s to milliseconds.
- Engine string ceilings were measured, including the Chromium trap where decoding past 512 MiB
  returns an empty string with no error.

**Status.** Shipped, with limits: Fregat's host policy defaults to a 10 Mi UTF-16 code-unit
cutoff for syntax and language-server analysis. Singapore's standalone tree-sitter and TypeScript
plugins have no automatic document-size cutoff; their hosts choose and enforce one. Typing with
analysis on at 10 MiB TypeScript is p95 about 250 ms in the measured composition; the 10, 50 and
150 MiB plain-text rows miss one 60 Hz frame (23–32 ms p95). Editing in the paged view is not built.
No 1 GB result exists.

**Demo idea.** A "load the big one" button that streams a generated 300 MiB log into the paged
view with a live heap readout, then a 50 MiB editable file with a keystroke-latency readout.

### 8. Tree-sitter for everything, in a worker, on our own WebAssembly build

**Pitch.** Tree-sitter drives highlighting, folds, bracket and tag matching, structural selection,
indentation and language injections, all off the main thread. 23 languages load on demand. The
tree-sitter runtime is our fork, tree-sitter-x, built with the WASI SDK instead of Emscripten.
Markdown is parsed by a C extension that runs inside the same WebAssembly memory as the parser and
passes all 676 CommonMark and GFM spec examples.

**Evidence.**

- `packages/tree-sitter/src/treeSitter/treeSitter.worker.ts` (3,275 lines); snapshot-tagged
  outputs and stale-result guards; worker caches capped at 6 snapshots and 8,000,000 source units
  (`docs/architecture/worker-topology.md`).
- `packages/tree-sitter-languages`: JS, JSX, TS, TSX, HTML, CSS, JSON, Markdown, MDX, Astro,
  Svelte, Python, shell, Rust, Go, C, C++, C#, Java, PHP, Lua, SQL, YAML, TOML. Each language's
  wasm and queries load on first use (`src/catalog.generated.ts`).
- Imported VS Code themes: Shiki paints TextMate colours over the tree-sitter structure
  (`packages/highlighting/docs/service.md`).
- tree-sitter-x (`/work/projects/tree-sitter-x/README.md`): no Emscripten, C extensions via
  `loadExtension`, 1 MB stack, and an in-wasm `TextBuffer` (1 MB markdown reparse 0.8 ms to
  0.35 ms). The editor pins it (`packages/tree-sitter/package.json:40`); tree-sitter-md uses
  `loadExtension` for its inline resolver. The editor's own languages still read through a JS
  callback; the in-wasm `TextBuffer` is not wired into the editor yet.

**Status.** Shipped.

**Demo idea.** Paste a Svelte or MDX file: three languages highlighted inside one document. Press
the expand-selection key and watch the selection grow node by node.

### 9. Markdown live preview over the raw buffer

**Pitch.** The document stays Markdown. Syntax is hidden and formatted text is drawn over it with
display transforms, so `**bold**` reads as bold and links become links, and the source returns
when the caret enters a construct. Undo, find, folds and anchors keep working on the raw text,
because nothing was converted.

**Evidence.** `packages/markdown` (live preview and authoring commands), `docs/display/transforms.md`,
tree-sitter-md records (`packages/markdown/src/replacements.ts`).

**Status.** Shipped. Block widgets and the Obsidian-style mode wait on Plan 111 phase 5 and Plan 108.

**Demo idea.** The home page's own copy is a Markdown document in the editor, rendered live; click
into a heading to see the `##` appear.

### 10. Modular by construction, and measured by habit

**Pitch.** The core is an editor; everything else is a package that plugs in: gutters, find,
minimap, diff and merge, scope lines with sticky scroll, spellcheck, Markdown, LSP, TypeScript,
React and Solid adapters. The diff view is an ordinary editor plus one plugin, so deleted lines can
be selected and copied. Each design decision in the repository has a numbered report with raw
evidence and a go or no-go, including the ideas that were measured and dropped.

**Evidence.**

- 21 packages under `packages/`, all at 0.2.6. Plugin hosts and typed registries
  (`docs/architecture/extension-hooks.md`); Plan 122 cut plugin dispatch from 34–38 µs to
  1.0–1.5 µs.
- Diff: stacked or split, shared region store, word-level changes, syntax prepared before the first
  frame (`packages/diff`). Merge conflicts in core (`packages/editor/src/mergeConflicts.ts`).
- Minimap draws in a worker on two transferred OffscreenCanvases (`packages/minimap/src/workerClient.ts:225–239`).
- Spellcheck: a gzipped cspell trie (347 KB) inflated with `DecompressionStream` in a worker; code
  mode splits camelCase and snake_case.
- Measurement culture: about 30 E-reports in `docs/performance/` and `docs/display/`; the E036
  report rejected three Monaco mechanisms after measuring them (Monaco's caret-blink CPU cost did
  not reproduce).

**Status.** Shipped. `@singapore-editor/highlighting` is not on npm yet.

**Demo idea.** A package picker beside the home-page editor: tick minimap, sticky scroll,
spellcheck, LSP; each one appears live, and the install line and bundle size update.

### Also worth a line (not top 10)

- **Decode effect** (`packages/decode`): animates a file in as if a model were writing it, including
  a diffusion mode where noisy glyphs settle into the text. A good hero animation for the site.
- **Several language servers on one document**, ranked per feature (differentiator 5).
- **Ghost text, snippets with linked mirrors, linked editing, column selection, Unicode
  invisible-character warnings, occurrence highlighting**, all in core.
- **A Vim-style modal mode built only on public APIs**, as a proof (`examples/app/src/modal/`).

---

## 3. Modern web platform inventory

Verified in `packages/*/src`, tests excluded. Line numbers at `0df5eb872`.

### Used

| API                                                    | Where                                                                                                                                                                | What for                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| CSS Custom Highlight API                               | `editor/src/virtualization/virtualizedTextViewHelpers.ts:741`, `sharedTokenHighlights.ts:58`, `virtualizedTextViewHighlights.ts:1124,1629`, `style-utils.ts:61`      | Syntax, selection and decoration paint without per-token spans |
| EditContext                                            | `editor/src/virtualization/editContext.ts:31–38`, `inputSelectionController.ts:1756–1892`                                                                            | Input route on Chromium, IME bounds                            |
| `beforeinput` and `inputType`                          | `editor/src/editor/inputSelectionController.ts:325, 3851`                                                                                                            | Typed text, paragraphs, composition                            |
| `Intl.Segmenter` (grapheme)                            | `editor/src/graphemes.ts:212`                                                                                                                                        | Caret movement and deletion by grapheme                        |
| `caretPositionFromPoint` / `caretRangeFromPoint`       | `virtualizedTextViewHelpers.ts:504–507`                                                                                                                              | Click hit testing                                              |
| `Range.getClientRects`                                 | `virtualizedTextViewGeometry.ts:1987, 2071–2090`                                                                                                                     | Caret and selection geometry, bidi boundary probe              |
| Dedicated module workers                               | Five entries, see differentiator 3                                                                                                                                   | Tree-sitter, Shiki, minimap, spellcheck, TypeScript            |
| Transferables                                          | `editor/src/syntax/packedTokens.ts:100`, `minimap/src/workerClient.ts:239`                                                                                           | Packed token buffers, canvases                                 |
| `SharedArrayBuffer` + `Atomics`                        | `tree-sitter/src/treeSitter/workerClient.ts:141, 474–549`, worker `:2959`                                                                                            | Cancelling a parse in flight                                   |
| `OffscreenCanvas`                                      | `minimap/src/workerClient.ts:225` (`transferControlToOffscreen`), `editor/src/virtualization/glyphAdvances.ts:91`                                                    | Minimap drawn in a worker; glyph measurement                   |
| Canvas 2D `ImageData`                                  | `minimap/src/raster.ts:14`, `renderer.ts:328`                                                                                                                        | Minimap raster                                                 |
| WebAssembly                                            | web-tree-sitter (tree-sitter-x) in `treeSitter.worker.ts:200, 270`; grammar wasm in `tree-sitter-languages/src/catalog.generated.ts`; Oniguruma in `shiki.worker.ts` | Parsing and TextMate tokenizing                                |
| `scheduler.postTask`                                   | `editor/src/editor/workScheduler.ts:230`                                                                                                                             | Flushing deferred work, with a `setTimeout` fallback           |
| `requestIdleCallback`                                  | `editor/src/virtualization/virtualizedTextView.ts:1731`                                                                                                              | Measuring row widths for horizontal scroll                     |
| `ResizeObserver`                                       | `fixedRowVirtualizer.ts:1361`, `browserMetrics.ts:302`                                                                                                               | Viewport and metric changes                                    |
| CSS anchor positioning                                 | `plugin-ui/src/anchoredSurface.ts:107, 175, 201`                                                                                                                     | Hover and popup placement                                      |
| CSS `contain`, `color-mix()`                           | `editor/src/style.css:114–257`, `minimap/src/style.css:42`; `editor/src/theme.ts:554`                                                                                | Layout isolation; theme colours                                |
| `DecompressionStream`                                  | `spellcheck/src/dictionaryData.ts:29`                                                                                                                                | Inflating gzipped dictionaries                                 |
| Streaming `TextDecoder`                                | `paged/src/document.ts:231, 277`                                                                                                                                     | Decoding byte ranges of huge files                             |
| `AbortSignal.any`                                      | `lsp/src/client.ts:170`, `paged/src/document.ts:298`, `editor/src/editor/documentDelivery.ts:222`                                                                    | Combined cancellation                                          |
| `WeakRef`, `FinalizationRegistry`                      | `textbuffer/src/textPages.ts:39–78`, `editor/src/theme.ts:108`                                                                                                       | Releasing text pages and style rules                           |
| `Promise.withResolvers`, `toSorted`, `findLast`, `.at` | e.g. `highlighting/src/service.ts:333`                                                                                                                               | Modern language baseline                                       |
| `crypto.randomUUID`                                    | `editor/src/syntax/session.ts:150`                                                                                                                                   | Session ids                                                    |
| OPFS                                                   | `examples/app/src/sourceCache.ts` (demo only)                                                                                                                        | Caching files fetched from GitHub                              |

### Not used (do not claim)

WebGPU, WebGL, `SharedWorker`, `MessageChannel`, `BroadcastChannel`, `Atomics.wait`/`waitAsync`,
`scheduler.yield`, `isInputPending`, the Popover API, View Transitions, `content-visibility`,
CSS nesting, `@layer`, `:has()`, container queries, IndexedDB and OPFS inside the packages (hosts
own storage), `document.fonts`/`FontFace`, `PerformanceObserver` and long-animation-frame,
`ClipboardItem` and async clipboard reads (copy and paste use clipboard events), `using`/`Symbol.dispose`.

Copy rule for the site: "modern APIs everywhere" should become a specific list: CSS Custom
Highlight API, EditContext, `Intl.Segmenter`, OffscreenCanvas in a worker, module workers with
`SharedArrayBuffer` cancellation, WebAssembly, CSS anchor positioning, `scheduler.postTask`.
There is no GPU rendering in Singapore; that story belongs to ghostty-webgpu.

---

## 4. Collaborative editing: Weidner's approach on our code

### The approach

Weidner's model, in his words, avoids the "conceptual complexity" of CRDTs and OT:

1. Every character gets a globally unique ID. Runs of IDs are compressed as `{bunchId, counter}`.
2. Clients send "insert after ID X" and "delete ID Y". The client mints the new IDs itself.
3. One server applies operations in the order it receives them, literally. Deleted characters stay
   in its list as tombstones so later inserts can still name them.
4. A client keeps the last state the server confirmed. When a server operation arrives, it rolls
   back to that state, applies the server's operations, drops the ones the server acknowledged,
   and replays its own pending ones on top.
5. His Articulated library makes rollback cheap with a persistent B+tree, the same reason our
   piece table is persistent.

### What we already have that fits

| Weidner needs                                     | Singapore has                                                                                                             | Where                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Deleted characters stay addressable               | Deletion marks pieces invisible; identity is kept                                                                         | `docs/positions/anchors.md` (Deletion Representation: "Future collaboration can reuse the same visibility model") |
| References to text, not offsets                   | Anchors `(buffer, offset, bias)` resolve against any version and report liveness                                          | `packages/textbuffer/src/anchors.ts`                                                                              |
| Compressed ID runs (`bunchId, counter`)           | A piece's `(buffer, start)` is its insertion identity; typing extends the newest piece in place, which is bunch extension | `pieceTableTypes.ts`, `buffers.ts`, `tree.ts` coalescing                                                          |
| Cheap rollback to the confirmed state             | Every snapshot is a persistent value; restoring one is a reference swap                                                   | `docs/storage/piece-table.md`                                                                                     |
| Consumers that don't care where an edit came from | Tree-sitter, LSP sync, decorations, spellcheck, minimap and find consume published changes without checking origin        | `docs/collab-editing/e-fregat-host-and-delta-db.md`                                                               |
| Workers that can follow a remote edit stream      | Worker replicas already advance by edit batches                                                                           | `packages/editor/src/document/workerReader.ts`                                                                    |

So the pitch line "a natural fit for our stable anchors" is fair: a left-biased anchor is already
"the position after character X", tombstones are already kept, and persistence already makes the
"restore confirmed state, replay pending" loop a pointer swap plus replay.

### What is missing (from research lane A, `docs/collab-editing/a-textbuffer-mapping.md`)

- **IDs are local, not global.** Buffer numbers come from a snapshot-local `nextBufferSequence`
  (`buffers.ts:815–845`), so two replicas, or two branches of one snapshot, mint the same number
  for different text. Global IDs must be minted once, when an edit is authored, and survive replay.
- **Exact tombstone order is not kept.** Deleted-anchor resolution returns a visible gap edge, and
  inserts never land between two tombstones (`anchors.ts:67–86`, `tree.ts:250`). E006 compaction
  folds tombstone runs into textless stand-ins. "Insert after deleted X" needs the exact order, so
  `resolveAnchor` followed by an offset insert cannot implement it.
- **No ID-addressed edit primitive.** Inserts and deletes go through visible offsets.
- **Undo is snapshot-based.** The E017 graph stores whole-document states; collaborative undo must
  withdraw only your own edits after others have edited around them.

### What E066 plans (approved 2026-10-08)

[`plans/e066-collaborative-text.md`](../../../plans/e066-collaborative-text.md), with the WebRTC
plugin [E067](../../../plans/e067-webrtc-collaboration-plugin.md) and the revised
[Delta DB plan](../../../plans/delta-db-implementation-plan.md) on top:

- `CharId { bunch, counter }` per UTF-16 code unit, mapped onto storage buffers through a
  snapshot-consistent index, so hot paths stay numeric.
- One envelope per transaction: `{ document, epoch, id: { actor, seq }, lamport, deps, change }`.
  The format stays CRDT-ready so a host-free mode can be added later.
- **One deliberate departure from pure Weidner.** Weidner places concurrent inserts after the same
  ID in reverse arrival order, which can interleave text typed backwards. E066 has the host place
  inserts with FugueMax (left and right origins, Fugue's tree), so concurrent typing at one spot
  does not interleave. Lane B warns not to market this as absolute "no interleaving".
- Collaborative documents keep exact tombstones (stand-in compaction off); new primitives insert
  beside a located piece boundary and delete exact ID fragments.
- Participants hold `{ confirmed snapshot, frontier, host sequence }` plus pending edits and
  reconcile atomically; consumers see one published transition.
- Undo reverts only your own edits (Zed's rule: a character is visible when its insert is active
  and no delete of it is active), sent as `setEffects` with explicit target states.
- Any participant can be the host: Fregat's server (Delta DB), or a browser peer over WebRTC (E067,
  up to 8 peers, host election and split/rejoin).
- Gates: ported Loro, Yjs, Diamond Types and Fugue suites; a five-user disconnect scheduler
  converging over 10,000 seeded rounds; keystroke cost within the 8.3 ms bar with 1, 10 and 100
  pending edits during a remote arrival.

Nothing is implemented. Lane A: "No evidence yet proves the proposed design meets 8.3 ms per
keystroke."

### Suggested site copy (planned)

> **Collaborative editing, planned.** Every character gets a stable ID, edits say "insert after
> this character", and one host (your server, or a peer) puts them in order. Your pending edits
> replay on top, and undo only takes back your own work. It follows Matthew Weidner's
> [Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html),
> and it builds on what Singapore already has: tombstones, anchors and persistent snapshots.
> [Plan E066](link).

---

## 5. Planned features worth a "coming soon" line

All Approved in `plans/`. No dates.

| Feature                                     | Plan                     | Line for the site                                                                      |
| ------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Collaborative editing                       | E066, E067, Delta DB     | See section 4                                                                          |
| Peer-to-peer sessions over WebRTC           | E067                     | Edit together with no server seeing your text, cursors and names included              |
| Search across workers in parallel           | E014                     | Find in huge files on every core                                                       |
| Editable paged files                        | E015 (read-only shipped) | Only after a dirty-page and save design exists; today say "read-only"                  |
| Features from tree-sitter queries           | E063                     | Outline, folds and text objects from a language's queries                              |
| One highlight pipeline                      | E064                     | One path from parse to paint for editors, diffs and snippets                           |
| Syntax tree inspector                       | E024                     | See the tree under the caret                                                           |
| Reloadable runtime plugins                  | E025, Plan 122 phase 5b  | Load and reload plugins without a page reload                                          |
| Extension hook contract                     | E027                     | Stable, documented hooks with zero cost for plugins that don't listen                  |
| Proportional-font wrapping                  | E052                     | Prose fonts with correct wrapping                                                      |
| Unified decoration ranges and block widgets | Plan 111 phases 4–5      | Inline widgets and blocks between lines; keystroke under 0.5 ms at 20,000 replacements |
| Multibuffer excerpts                        | Plan 229                 | Edit excerpts from many files in one editor, as in Zed                                 |
| Notebook cells                              | Plan 262                 | Code and prose cells in one document                                                   |
| Vim mode                                    | E028 proof, verdict go   | Proof only today; say "planned"                                                        |

---

## 6. Honest gaps vs Monaco and CodeMirror

What the site and READMEs must not overclaim.

**Proof gaps**

- No editor-level benchmark against Monaco or CodeMirror (open, typing, scroll, memory). The only
  head-to-head is the text buffer against `vscode-textbuffer`, where Singapore is 1.3–2.0x slower
  on random edits and multi-cursor batches and 1.2–1.6x slower on line reads. Sequential typing is
  1.5x faster cold and the same warm.
- Input-latency numbers are local gates on one machine, not a universal budget.
- Bundle size is unmeasured. `@singapore-editor/core` is about 84,000 lines of source in 213
  files and ships as unbundled ESM; CodeMirror 6's small core is one of its selling points.

**Architecture**

- The document lives on the main thread. "Workers heavily" covers derived work only.
- EditContext is Chromium only. Browser tests run mainly in Chromium; highlight paint and the
  highlighting engines are also tested in Firefox and WebKit.
- `::highlight()` cannot set font properties, so syntax colours cannot use bold or italic
  (`docs/display/e036-monaco-geometry-comparison.md`). Monaco and CodeMirror themes can.
- Rows are fixed height; variable-height rows and proportional-font wrapping are open (E052).

**Features Monaco has that Singapore lacks or only partly has**

- Inlay hints and CodeLens (only merge-conflict actions use a lens-like row).
- Bounded undo memory beyond the 200-state cap, and Monaco's large-replace path: find still stops
  at 19,999 matches (`FIND_MATCHES_LIMIT`).
- Text drag and drop is partial; multi-cursor clipboard metadata was missing in the audit.
- The ecosystem: VS Code language extensions, TextMate grammars for hundreds of languages (Shiki
  bridges colours, not language features), and years of edge cases.
- Accessibility is not proven at Monaco's level. ARCHITECTURE lists "accessibility completeness"
  as a non-goal; the EditContext route mirrors the caret into the document selection as Monaco
  does, and an `aria-live` announcer exists, but no screen-reader audit has been recorded.
- Mobile and touch are not a target.

**CodeMirror strengths to respect**

- A large community extension ecosystem and years of production use.
- Small core and tree-shakeable extensions.
- Lezer grammars parse incrementally on the main thread without workers, which is simpler to host.
  Singapore needs worker and wasm asset hosting; `SharedArrayBuffer` cancellation is used only on
  cross-origin-isolated pages (`workerClient.ts:141` checks for it).

**Maturity**

- Version 0.2.6 across all packages, patch bumps only until launch. The public API is still
  moving; internal bridges are pending deletion (ARCHITECTURE §5.12).
- The 2026-08 parity audit (`docs/parity-monaco-codemirror.md`) found 101 gaps (47 missing,
  52 partial). Milestones M1–M16 closed much of it (sticky scroll, column selection, grapheme
  movement, EditContext, cut and drop handling now exist in code), but no recount has been
  published. Track B should recount before any parity claim.
- Large files: Fregat defaults to a 10 Mi UTF-16 code-unit analysis cutoff. Standalone Singapore
  plugins have no automatic document-size cutoff. With analysis on in the measured composition,
  a 10 MiB TypeScript file types at about 250 ms p95. Plain-text typing at 10, 50 and 150 MiB
  misses a 60 Hz frame. No 1 GB claim.
- Collaboration, vim mode, multibuffers and editable paging are plans, not features.

---

## Checklist for Tracks B, C, D and F

- [ ] Build the editor-level comparison against Monaco and CodeMirror 6 (open 1/10/50 MiB, typing
      p95 on 500k lines and a 1 MB line, scroll, heap) on the existing `examples/stress` harness,
      with date, machine and method.
- [ ] Publish the text-buffer table with both its wins and losses, and its "unequal feature sets"
      caveat.
- [ ] Measure and publish bundle size for core and for a typical package set.
- [ ] Recount the parity audit against current code before any "parity" wording.
- [ ] Use the specific API list from section 3; never say WebGPU or GPU rendering for Singapore.
- [ ] Say "workers for parsing, highlighting, the minimap, spellcheck and TypeScript", not "the
      document lives in a worker".
- [ ] Label collaboration, vim, multibuffers and editable paging as planned, linked to plans.
- [ ] Home-page "edit this" demo: TypeScript worker (rename across two files), branching undo
      panel, anchors that survive deletion, main-thread meter during a big paste.
- [ ] Large-file page: 200 MiB editable and 600 MiB paged numbers, with Fregat's 10 Mi analysis cutoff
      stated beside them.
