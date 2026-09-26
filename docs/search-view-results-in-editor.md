# Search results inside the editor: design research

Round-2 research for [Plan 182](../plans/182-search-view-rendering.md), 2026-09-26, at Platform
`4c78266f8` and Editor `74e76be`. The first pass ([findings](search-view-rendering-findings.md))
measured why today's view is slow. This pass designs the owner's direction: the whole result set
lives in one editor, as Zed's project search is one editor over a multibuffer of excerpts, and it
looks the way the full search view looks today.

## Verdict

Build it as **one Editor over a results document**. The document's text is the matched source lines,
one row per line. A Platform-side excerpt map says which file and line each row came from. File
headers are **block rows**: the Editor reserves their height and gives the host a container, and
the host renders today's `SearchResultFileHeader` into it through a React portal. Syntax comes per
file block from the snippet-token worker, and edits in place are forwarded to the source files'
live documents.

A throwaway prototype of that shape (one `Editor`, headers as injected rows, React headers placed
from the view snapshot) flings result sets of 82 to 5,714 rows with **54–230 ms of main-thread time
and no task over 50 ms** (150 ms on the broad tier). Today's view, measured on the same build and
machine in the same session, takes **2,000 ms with 18 long tasks** on the broad tier. Opening it
costs 38–54 ms, including 2,411 header rows. Streaming 64 files per batch costs at most 20 ms per
batch.

Most of the pieces exist in the Editor today. The ones it lacks are small and bounded:

- **Block rows** with host content, pinned horizontally, with pixel heights. Injected rows
  already reserve rows with no offset space, and the virtualizer keeps a variable-height index with no
  producer.
- **Host edits into a read-only document.**
- **A token range update.**
- **An edit filter**, needed only for editing in place.

A multibuffer core in the Editor, Zed's actual model, is the larger alternative. It is not needed for
anything the owner asked for.

## 1. What today's view looks like

Screenshots: `/work/tmp/fregat-evidence/20260926T095646Z-scenario-research-search-look/` (hover) and
`…100143Z…` (geometry), production build, compact density, `useSettingValue` (159 matches in 63 files).

- **File header:** a `ListRow` (20 px compact, 24 px cozy) with:
  - a collapse chevron button
  - the file icon, the name, and the muted directory
  - a `N matches` count chip
  - `Replace` while replace is open.
- **Result line:**
  - a 22 px line of 12 px code on a 28 px stride (22 + 6 gap)
  - the source line number in a column on the left
  - syntax colour, and match highlights with the active one marked
  - an open-in-editor icon at the right edge on hover, plus `Replace` while replace is open.
- **Long lines:** each file block is its own editor, so a long line gives that block its own
  horizontal scrollbar. Lines are previews, trimmed to 160 characters by the view model and to 240 by
  the server.

Measured geometry (row tops in the scroll content, compact):

| From                                 | To              | Distance        |
| ------------------------------------ | --------------- | --------------- |
| Header top                           | First line top  | 22 px (cozy 26) |
| Line top                             | Next line top   | 28 px           |
| Last line top (files with ≥ 2 lines) | Next header top | 28 px           |
| Last line top (files with 1 line)    | Next header top | 34 px           |

The extra 6 px after single-line files comes from `FILE_RESULTS_EDITOR_MIN_HEIGHT = 28`, the per-file
editor's minimum height. It is not a design choice.

**Two consequences:**

1. **A header is 22 px (cozy 26) of pitch, which is not a whole row.** A header that takes one 28 px row
   (Zed's model: `FILE_HEADER_HEIGHT = 2` lines, whole lines only) moves every file 6 px down in compact
   and 2 px in cozy. Exact parity needs block rows with pixel heights.
2. **A header must not scroll sideways.** In one editor there is one horizontal scroll, and the
   prototype shows headers placed in the text content sliding left with the code
   (`/work/tmp/research2/182b/proto/results/hscroll.png`). Block rows need a layer that follows vertical
   scroll only, the way the gutter does.

## 2. Measurements

**Prototype** (`/work/tmp/research2/182b/proto/`, not committed):

- One `Editor` from the Editor repo's built packages, with `lineHeight: 22`, `rowGap: 6`, `fontSize: 12`,
  read-only, and the text set once.
- One injected row per file as the header slot.
- A source-line gutter through `createLineGutterPlugin({ labelForRow })`.
- Match highlights as range decorations, and regex tokens standing in for syntax.
- React headers rendered with `createPortal` into a layer inside the view's `contentElement`, placed
  from `EditorViewSnapshot.visibleRows`.

Data comes from `rg` over this repository, with one row per source line. The phases are the first
pass's: 20 × 1,200 px wheel, 40 × 120 px, and a jump to the middle, in headless Chromium, with the
editor 1040 × 590 px. **Busy** is the summed top-level task time inside the phase, as in the first pass.

| Tier         | Query             | Rows / headers | Open (setText) | Wheel-fast busy / window | Tasks > 50 ms (worst) | Wheel-reading busy |
| ------------ | ----------------- | -------------- | -------------- | ------------------------ | --------------------- | ------------------ |
| narrow       | `createError`     | 82 / 41        | 38 ms (13)     | 54 / 1,032 ms            | 0 (10 ms)             | 64 ms              |
| broad        | `useState`        | 733 / 250      | 42 ms (15)     | 150 / 1,032 ms           | 0 (10 ms)             | 125 ms             |
| wide         | `export function` | 4,391 / 2,411  | 50 ms (27)     | 141 / 1,031 ms           | 0 (7 ms)              | 155 ms             |
| pathological | `a` (20,000 cap)  | 5,714 / 65     | 54 ms (25)     | 230 / 1,032 ms           | 0 (12 ms)             | 183 ms             |

**Control, today's view.** `agent:browser trace` of the first pass's probe scenario was run on a
production build of `origin/main` (`/work/tmp/fregat-evidence/20260926T100838Z-trace-research-search-view`).
Its broad tier (`export function`, then `useState` typed in the view) gives:

- wheel-fast: 2,000 ms busy over 2,289 ms, 18 tasks over 50 ms
- wheel-reading: 349 ms

These agree with the first pass: 2,059–2,241 ms and 16–19 long tasks. The first pass measured the
sidebar's flat-row list on the same fling at 613 ms.

**What the headers cost.** On the broad tier, the React headers add about 30 ms per fling. Wheel-fast
measures 150 ms with React headers, 132 ms with text-only header rows, and 119 ms with no header
content.

**Header lag.**

- A frame sampler compared, every animation frame, each header row fully on screen against a painted
  React header at the same top. **It found 0 blank frames in 185–186 sampled frames per tier.**
- `flushSync` and display-rate placement changed nothing, because nothing was lagging.
- An earlier count of 3–11 "blank" frames per run turned out to be the sampler: it compared a row and a
  header at the viewport's bottom edge, 3 px apart.

**Streaming** (`stream.ts`). The document starts empty. Each batch of 64 files is one host edit
appending its lines, plus the header provider firing:

| Tier         | Batches | Worst batch |    Total | Same, re-setting every token each batch |
| ------------ | ------: | ----------: | -------: | --------------------------------------- |
| wide         |      38 |    13–16 ms | 77–94 ms | 116 ms total, worst 15 ms               |
| pathological |       2 |    17–20 ms | 20–25 ms |                                         |

The times cover the synchronous edit, the header provider and the token call; the row render that
follows lands in the next frame and is part of the busy numbers above.

`Editor.edit` refuses a read-only or `static` document (`documentController.ts:106-108`: editable
**and** `session` only). The prototype streams into an editable session; `syncText` on a static
document costs about the same (87 ms for wide). **Caveats:** the prototype has no tree-sitter, no
Tooltip or Button primitives in its headers, and no hover action strip; the real header component is
what the sidebar list already renders in its rows.

## 3. What Zed does, and what to take

The Zed checkout is at `933d8d9`; the paths below are under `references/zed`.

**What Zed does:**

- **Excerpts:** stored as source-buffer anchor ranges in a `SumTree`. An excerpt's `context` is what
  shows; its `primary` is the match (`crates/multi_buffer/src/multi_buffer.rs:857-881`). There is no
  excerpt id at this head. A multibuffer anchor is `(path key, text anchor)`, so it survives re-cutting
  and merging (`anchor.rs:17-35`).
- **Separators:** the newline between excerpts is virtual, appended to the summary and emitted as a
  synthetic chunk (`multi_buffer.rs:7525-7528`, `8318-8340`). An edit is clamped at an excerpt's
  context end, so the separator cannot be deleted.
- **Edits:**
  - An edit splits per buffer (`multi_buffer.rs:1612-1729`): replace in the first excerpt, delete in
    the rest, grouped and applied once per buffer.
  - Source edits reach the multibuffer by a pull: `sync_from_buffer_changes` rebases each changed
    buffer's `edits_since_in_range` into multibuffer coordinates (`2540-2699`).
  - Undo is one multibuffer transaction mapping to per-buffer transaction ids (`transaction.rs:37-43`,
    `457-515`).
  - Save writes every dirty buffer (`items.rs:954-1027`).
- **Headers:**
  - Headers are derived blocks, generated from excerpt boundaries while syncing the block map and never
    stored (`display_map/block_map.rs:1212-1297`).
  - Heights are whole lines. A rendered block is measured and rounded up to lines
    (`element.rs:3580-3630`).
  - The header renders chevron, icon, name, muted path, and open-file on hover (`element/header.rs`).
- **Project search:**
  - Streams in chunks of 1,024 matches, batches of 64 paths, and yields; a re-search reuses unchanged
    excerpts so nothing flickers (`crates/search/src/project_search.rs:660-1020`).
  - Limits are 5,000 files and 10,000 ranges.
  - Match highlights are anchor ranges.
  - While the results are dirty, search-on-type is off.
- **Syntax:** each excerpt reads its own buffer's syntax snapshot, with no composite parse
  (`multi_buffer.rs:7441-7463`).

**What transfers:**

- a row → source map owned beside the text
- headers derived from file boundaries
- appending or reusing by file as results stream
- syntax from each file's own tokenization
- edits split per file and applied through each file's document
- one undo step per edit group, mapped to per-file transactions

**What does not transfer:**

- GPUI, SumTree dimensions, CRDT anchors and `undo_to_transaction`
- diff transforms
- whole-line block heights (our look needs 22 and 26 px headers)
- the requirement that the editor core itself be a multibuffer (section 5, option B)

## 4. What VS Code does

`references/vscode` is at `90da900128e`.

- **Text model:**
  - The search editor is one editable `ITextModel` in language `search-result`: a `path:` line per
    file, then `  12: text` rows, one per source line, with match ranges as tracked decorations
    (`searchEditorSerialization.ts:238-269`).
  - Headers are text lines. No view zones or widgets are used anywhere.
  - Edits never reach source files. Go-to-location re-parses the text with regexes, so an edit that
    breaks the format silently misnavigates (`extensions/search-result/src/extension.ts:184-277`).
- **Streaming:** none. The model is written once when the search completes.
- **Syntax:** a TextMate grammar that embeds 41 languages keyed by the header's extension.
- **View zones:** VS Code's general block primitive is the view zone. Its height is declared, never
  measured. `LinesLayout` keeps whitespace sorted by `(afterLine, ordinal)` with lazy prefix sums
  (`linesLayout.ts:385-499`).
- **Multi-diff editor:** it avoids one-editor-per-file cost with a template pool (5 spare editors),
  500 px estimates, and viewport-capped items (`multiDiffEditor/virtualizedItemManager.ts:251-294`).

**What to take:** store the mapping, never re-parse text for it; keep the query UI outside the editor
surface, as today; declare block heights, don't measure them, when the host knows them. Search
headers have known heights, so the first block version needs no measure loop.

## 5. What our Editor has, and what it lacks

Editor paths below are relative to `/work/projects/Editor/packages/`.

| Need                                    | Today                                                                                                                                                                                                                           | Gap                                                                                                                                                    | Size |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Row slots between lines                 | Injected rows: `registerInjectedTextRowProvider`, `before`/`after` an anchor buffer row, sparse entries in the display projection, no offset space (`editor/src/displayTransforms.ts:77-86`, `plugins.ts:926-937`)              | none                                                                                                                                                   | —    |
| Caret, selection and copy skip them     | Injected rows have `startOffset === endOffset`; motion walks `nextDocumentRow` past injected runs (`docs/display/transforms.md`); the diff's overlay mode relies on it (`diff/README.md` Modes)                                 | none                                                                                                                                                   | —    |
| Host DOM inside a row slot              | None. The block-surface subsystem that mounted DOM into recycled rows was deleted on 2026-08-22 (`7974443`); its lesson: reserve space in the row list, host the DOM in a stable layer (`docs/parity-monaco-codemirror.md:890`) | A block-row renderer: one container per mounted block, in a layer that follows vertical scroll only, keyed so a remount reuses it                      | M    |
| Pixel heights for block rows            | Uniform geometry: `rowTop = row * stride` (`editor/src/virtualization/virtualizedTextViewLayout.ts:216-217`, `:392-399`); the virtualizer keeps a dense `rowHeightIndex` that nothing feeds (`rowHeightIndex.ts:1`)             | Feed per-row sizes for block rows; `rowTop` and the y → row inverse consult the index                                                                  | S–M  |
| Source line numbers                     | `createLineGutterPlugin({ labelForRow })` (`gutters/src/lineGutter.ts:9-16`); gutter cells can take pointer events (`interactive`, `plugins.ts:947-948`)                                                                        | none                                                                                                                                                   | —    |
| Match highlights                        | `rangeDecorations` with `zIndex` (`editor/src/editor/types.ts:46-57`)                                                                                                                                                           | none                                                                                                                                                   | —    |
| Row under the pointer                   | Point queries (E047), already used by `search-result-line-pick`                                                                                                                                                                 | none                                                                                                                                                   | —    |
| Stream results into a read-only view    | `Editor.edit` requires `editable` + `session` (`editor/src/editor/documentController.ts:106-108`); `syncText` diffs the whole text per call                                                                                     | Host-originated edits on a read-only session document                                                                                                  | S    |
| Syntax per file block                   | `EDITOR_SNIPPET_TOKENS_FEATURE` tokenizes a snippet in the worker; the diff projects per-side tokens onto its synthetic document the same way (`diff/src/editorDiffPlugin.ts:450`, `projectDiffSyntaxTokens`)                   | Replace one range of the token store without rebuilding it (re-setting all tokens every batch added 39 ms over 38 batches, so this is an optimisation) | S    |
| Refuse edits that cross a file boundary | None: edit contributions can apply edits, not veto them (`plugins.ts:766-782`); `registerNonCaretRows` only steers the caret                                                                                                    | An edit filter consulted before every user edit (typing, IME, paste, cut, delete, multi-cursor, snippets)                                              | M    |
| React content                           | `@singapore-editor/react` has `useEditor`/`EditorHost` and no portal support (`react/src/index.tsx`)                                                                                                                            | `useEditorBlocks(controller)`: the mounted blocks as a store the host portals into                                                                     | S    |
| One document over many files' buffers   | Each Editor view shows one document session                                                                                                                                                                                     | Only for option B                                                                                                                                      | XL   |

## 6. Options

**A. Results document plus forwarding (recommended).** Section 7 has the design.

- **Model:** the editor shows its own document, whose rows are the matched source lines. Platform keeps
  the excerpt map and derives header blocks from file boundaries.
- **Reading:** the Editor gains block rows with host content, pixel heights, host edits and a token
  range update.
- **Editing in place:** later, the Editor adds an edit filter. Platform forwards each accepted edit to
  the source file's live document and mirrors source changes back.
- **Size:** Editor M + S–M + S + S (+ M to edit); Platform M + L + M + S (+ L to edit).
- **Why:** it reuses the Editor's single-document machinery (selections, undo, IME, virtualization,
  geometry), and the owner's look needs Platform-rendered headers anyway.
- **Cost:** two copies of each edited line exist while a file is in view, and the forwarding code keeps
  them equal. Section 7.8 bounds that.

**B. A multibuffer in the Editor core (Zed's model).**

- **Model:** a composite `TextReadSnapshot` over many sessions' piece-table snapshots, with no copied
  text. Composite anchors are `(document, piece anchor)`. Edits split per session, and undo is one
  transaction mapped to per-session transactions.
- **What it touches:** the document controller, history, selections and anchors, syntax scheduling,
  decorations, LSP document sync and the worker protocol all assume one session per view today. The read
  side alone is easy: `TextReadSnapshot` has seven members (`editor/src/documentTextSnapshot.ts:34-43`).
- **Size:** XL in the Editor and M in Platform.
- **What it buys over A:** edits are the files' own edits with no mirror, and undo is exact. Nothing
  in the owner's brief needs that before editing in place ships and shows a mirror problem.

**C. Headers as text lines (VS Code's search editor).** The Editor needs nothing new. The look changes:
headers become code-font lines, with no chips, buttons or icons. **Rejected** by the owner's "looks
exactly as today".

## 7. Design of option A

### 7.1 The results document and excerpt map

- **Text:** one row per source line with a match (decided Q2 = B), with a file's rows in source order
  and files in the view's sort order. No context lines, as today.
- **Excerpt map:** a pure Platform module owns it. Per file it keeps the path, the first row, the
  source line of each row and the match ranges, plus prefix sums over rows.
  - Composite row → `(path, source line)` is a binary search over files, and the reverse is a map
    lookup.
  - Match ranges become composite offsets for decorations.
  - Next and Previous step through them, as today.
- **Collapse:** removing the file's rows from the document as a host edit that is not forwarded, with
  the header staying. This is simpler than a fold, whose placeholder would leave one line showing.
- **Streaming and re-query:**
  - A new batch inserts files at their sorted position as one host edit, with header blocks re-provided.
  - A re-query diffs by path: unchanged files keep their rows, which is Zed's reuse and makes the
    no-flicker rule free.
  - Insertions above the first visible row shift `scrollTop` by their height, because the Editor's
    scroll position is in pixels (`editor/src/editor/types.ts:59-62`).
- **Lines:** real source lines (Q4). The 160- and 240-character preview trims only exist to fit a small
  per-file editor, and editing needs the real line.

### 7.2 Block rows (Editor)

A block row is an injected row with a host payload:

```ts
// @singapore-editor/core/extensions
type EditorBlockRow = {
  readonly id: string // stable per file: the render key
  readonly anchorBufferRow: number
  readonly placement: 'before' | 'after'
  readonly heightPx: number // the row's whole pitch; no row gap
  readonly data?: unknown // host payload, handed back to the renderer
}
type EditorBlockRenderer = {
  mount(container: HTMLElement, block: EditorBlockRow): { update?(block: EditorBlockRow): void; dispose(): void }
}
registerBlockRowProvider(provider: { getBlockRows(context): readonly EditorBlockRow[]; onDidChangeBlockRows? }): EditorDisposable
registerBlockRenderer(renderer: EditorBlockRenderer): EditorDisposable
```

**Layout and geometry:**

- The view reserves `heightPx` in the virtualizer's row sizes. `rowTop` and the y → row inverse read
  the row-height index when any block row exists and keep the uniform arithmetic otherwise.
- The header of this view is 22 px (compact) or 26 px (cozy). The host re-provides blocks when the
  density changes.

**Mounting:**

- Containers live in a **block layer** beside the gutter layer. It follows vertical scroll, is pinned
  horizontally, and spans the viewport width.
- A container mounts when its row enters the mounted window and disposes when it leaves. The same `id`
  reuses the container across re-provides.
- `mount` runs in the row paint pass, so a header never lags its row.

**Interaction:**

- Blocks take pointer events; the text hit-testing never sees them.
- Point queries answer `{ kind: 'block', id }`.

This is the known-height slice of [Plan 111](111-editor-decorations.md) Phase 5 (block widgets).
Measured heights, the measure-and-correct loop and scroll anchoring stay there. The dense index is
enough here because a result set tops out around 25,000 rows. At 100,000 rows the index builds in
0.3 ms and takes 0.5 ms per resized row ([survey § Measurements](editor-decorations/survey.md#measurements)).
The sparse, projection-summed version is Plan 111's.

### 7.3 React content without React in the core

`@singapore-editor/react` gains `useEditorBlocks(controller)`. It registers a renderer whose `mount`
records `{ id, container, data }` in a store and whose `dispose` removes it, and it returns the list
through `useSyncExternalStore`.

The Platform view renders `createPortal(<SearchResultFileHeader … />, block.container)` for each entry.
The header is the existing component, inside the app's providers, with its Tooltip, Button, FileLabel,
actions context and file menu. The prototype's portal path showed no blank frames.

### 7.4 Line chrome

- **Source line numbers:** `createLineGutterPlugin({ labelForRow })` reading the excerpt map, with an
  interactive cell whose click opens the line (the `search-result-line-pick` behaviour).
- **Hover actions** (open, and Replace while replace is open): one action strip in the block layer,
  pinned to the right edge. The row under the pointer comes from a point query, and its top from the
  view snapshot, as today's `data-hovered` row does. Keyboard users get Enter on the caret line
  (7.6).
- **Selected and active states:**
  - The header's `selected` follows the file of the active match.
  - The active match gets its own decoration layer, as today.
  - The cursor line paint stays off, as today (`SEARCH_RESULT_CURSOR_LINE_HIGHLIGHT`).

### 7.5 Syntax

- **Per file block:** one `EDITOR_SNIPPET_TOKENS_FEATURE` request for the block's lines joined, in the
  file's language. The tokens are offset into the composite and applied to that range.
- **Paint order:** text paints at once in the foreground colour, and colour arrives without moving
  anything.
- **What it replaces:** `result-syntax-cache.ts`'s one tree-sitter session per unique line, which with
  the grammar-signature cost was 359 ms of one fling in the first pass, and `result-syntax-plugin.ts`.
- **Accuracy:** lines are parsed out of context, as today. When a file is open, its own session's
  tokens for those lines are exact. That is a later refinement.

### 7.6 Keyboard, selection, copy

- **Caret:** the caret is the editor's own.
  - Arrows move by line and skip header blocks. Shift extends, and a selection can span files, which
    today's per-file editors cannot do.
  - Enter opens the match at or after the caret. F4 and Shift+F4 go to the next and previous match
    (VS Code), and Next and Previous in the header bar do the same.
  - `utils/result-editor-keyboard.ts` shrinks to Enter and the menu keys.
  - The sidebar tree keeps its own keyboard model.
- **Copy:** copy gives the selected lines joined by newlines, without headers, which is what Zed and
  VS Code do. The file menu's Copy Path stays on the header.
- **Active result:** the match at or after the caret. It stays in step with the sidebar selection
  through the shared search state (`state/buffer-state.tsx`).

### 7.7 Virtualization

The Editor's own row virtualizer windows everything. The custom window store, velocity overscan, pool
and line windows are deleted, which also deletes the 200-excerpts-per-file cap and its live bug.
Measured scale: 4,391 rows plus 2,411 blocks open in 50 ms and fling in 141 ms, and 20,000 matches
(5,714 rows) fling in 230 ms.

### 7.8 Editing in place

In-line edits come first:

- **The filter:** it accepts an edit only when it lies inside one result row and inserts no newline.
  Typing, deleting within a line, multi-cursor across files, and single-line paste all qualify. An edit
  that touches a row boundary or a header is refused, and text and selection stay as they were.
- **Forwarding:** the host maps each accepted edit through the excerpt map to a path, source line and
  column, and applies it to the file's live document. `ensureLiveEditorDocument` opens the document on
  the first edit, and edits there join the document's own history, dirty state and auto-save. Opening
  it verifies that the line still reads as the search saw it; otherwise the edit is refused, with an
  error naming the file.
- **Mirroring back:** a change to a file in view, from its tab, an external write or a reload, is
  mapped into the results document as a host edit. A change that deletes a result line removes the row.
- **Undo:** Ctrl+Z in the results view undoes the last group of source transactions it made (Zed's
  semantics), through the document transaction receipts the workspace-edit service already uses.
  Undo in a file tab mirrors back like any other change.
- **Save:** Ctrl+S saves the documents the view has touched, and the tab shows dirty while any of them
  is.
- **Re-query while edited:** results keep coming from live buffers (matches already carry
  `source: 'open-buffer'`), so the view shows the edited text.

Full excerpt editing (Enter inside a result, and Zed's context lines with expand controls) is a later
phase: the excerpt map then tracks row ranges per match instead of single rows.

**The mirror's risk and its bound:**

- Every edit crosses the boundary on the main thread, in one operation, tagged with its origin, so
  there is no interleaving.
- A debug-only check compares each excerpt row with its source line after every forwarded edit and
  logs a wide event on mismatch, so a divergence is visible in the log.
- If the mirror turns out fragile, option B is the escape, and the excerpt map is its data model.

## 8. Risks

- **Two copies while editing** (7.8). Contained by origin tags, the debug check, and in-line edits
  first.
- **Plan 122 changes contribution registration.** The block provider and renderer should land as
  building blocks of its `createPlugin`, if it lands first, instead of adding to the current
  registration family.
- **Long lines.** Real source lines can be very long, and one horizontal scroll serves the whole view
  (Q4). The Editor already chunks long lines horizontally.
- **Prototype limits.** Its headers are plain elements and it has no tree-sitter, so expect the real
  view to cost more than the prototype. Even a several-fold increase stays under today's 2,000 ms, and
  the first pass put today's cost in editor mounts, which this design removes.

## Probes

All under `/work/tmp/research2/182b/proto/`:

- `gen-data.ts`: the tiers, from `rg`.
- `main.tsx`: the prototype page. URL flags: `tier`, `headers=react|text|none`, `stream=N`,
  `via=sync`, `streamTokens=full`.
- `drive.ts`: the phases, the trace split and the blank-frame sampler.
- `stream.ts`: streaming batches.
- `hscroll.ts`: horizontal pinning.
- `results/`: JSON summaries, traces and screenshots.

Screenshot and geometry scenario of today's view: `research-search-look` (not committed; kept at
`/work/tmp/research2/182b/research-search-look.ts`).
