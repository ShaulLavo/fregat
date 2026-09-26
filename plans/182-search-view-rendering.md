# Plan 182: Search view rendering

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — third pass: many editors, recycled and with two layout reads
  removed, fling the broad tier in 1,176 ms with no long task (today 1,767 ms and 15), and one editor
  does it in 151–155 ms. One editor keeps per-file sideways scroll through a per-block x offset:
  158–177 ms in a prototype. Recommendation: one editor, per-block sideways scroll, and editing on a
  multibuffer. Third pass: [docs/search-view-many-editors.md](../docs/search-view-many-editors.md).
  Second pass (design): [docs/search-view-results-in-editor.md](../docs/search-view-results-in-editor.md).
  First pass: [docs/search-view-rendering-findings.md](../docs/search-view-rendering-findings.md).
  Two owner questions (Q3, Q4) stand before implementation. Nothing here authorizes implementation.
- Planned at: Platform `d5a901726`, 2026-09-26. Researched at Platform `c130dd35a`, Editor `74e76be`;
  second pass at Platform `4c78266f8`, Editor `74e76be`, Zed `933d8d9`, VS Code `90da900128e`; third
  pass at Platform `e04c94271`, Editor `860f861`, Zed `933d8d9`.
  Origin: the virtualizer discussion behind [Plan 181](181-chat-timeline-end-anchoring.md) and
  [Plan 178](178-tree-in-the-app.md).

## Owner direction

2026-09-26: the full search view renders too slowly and needs its own plan. It may end up back on
TanStack Virtual, but that is a finding to reach, not a starting point. The small search (the
sidebar results list) is not in scope: it already runs on `VirtualList`
(`features/search/components/results-view.tsx:173`) and moves with the rest of the app.

2026-09-26, after the first pass: the flat-rows fix is not wanted and speed is not urgent. The whole
result set lives inside our editor, as Zed's project search is one editor over a multibuffer of
excerpts: edit in place, with edits landing in the files. It looks exactly as the full search view
looks today. Take Zed's model, not its platform-specific parts.

2026-09-26, after the second pass: leans toward a real multibuffer in the Editor core over the
results document. Each file block scrolling sideways on its own is a feature of today's view the owner
likes, and asks whether many editors can be made fast instead. The third pass measures both.

## Scope

The full search view, the editor-tab search surface: `components/result-editor-surface.tsx`,
`result-editor-virtual-window.tsx`, `result-file-editor-pool-slot.tsx`, `result-file-editor.tsx`,
`hooks/use-result-editor-virtualizer.ts`, `state/result-virtual-window-store.ts`,
`state/result-editor-pool.ts`, `state/result-syntax-cache.ts`, `utils/result-editor.ts`,
`utils/result-virtual-list.ts`, `utils/result-syntax-plugin.ts`. About 2,800 lines of product code.

## Findings (first pass: where the time goes)

Measured on a production build with `agent:browser trace` and an in-page probe, three query sizes
over this repository. Method, tables and evidence directories are in the findings doc.

- **The editors are the cost, not the windowing.** A 20×1,200 px fling over the broad result set
  (803 matches in 261 files) keeps the main thread busy 2,059–2,241 ms of 2,319–2,512 ms, with 16–19
  tasks over 50 ms. The window store, pool and virtualizer hook sample at 3 ms. Editor packages take
  1,369 ms, style and layout 600 ms, paint 300 ms. The fling mounts 227 editors and unmounts 217:
  about 9 ms per file block.
- **Flat rows are 3.4× cheaper on the same data.** The sidebar list, flinged the same way over the
  same results, is busy 613 ms with no task over 50 ms (worst 39 ms).
- **Grammar signature:** each tree-sitter session re-serialises its language descriptors, whose
  `wasmUrl` is the grammar as a base64 data URL (TypeScript 1.9 MB). The broad fling made 424 calls
  and stringified 774 MB in 359 ms. The view creates one session per unique excerpt line.
- **Forced layout per scroll event:** `attachSearchResultScroll`'s listener reads `scrollTop` on
  every scroll event: 83 ms of the sidebar list's 613 ms, and the same listener runs on the search view.
- **Live bug: 200 matches per file.** A file block shows at most 200 excerpts. The pathological
  query (`e`, 20,000 matches in about 30 files) renders about 2,700 rows; the rest cannot be reached,
  and selecting one scrolls to its file's 200th line.
- **Repeated lines:** each match is its own row, so a line with four matches shows four times.
  `e` averages five matches per line in this repository.
- **The pool reuses nothing.** Slots are keyed by file, and a slot outside the item window never
  keeps its editor, so every file that scrolls in mounts a new `Editor`. Blocks over 16 excerpts slice
  their lines and reopen the document every 28 px of scroll.
- **Streaming is no longer the problem.** Batching (workstream A) and incremental groups (B) landed:
  43–122 ms of stream-state work while a retyped query streams into the open view. The search backend
  answers in 18–293 ms.
- **VS Code** mounts no editor per file in either surface: the search editor is one editor over
  serialized text, written once on completion; the sidebar is fixed 22 px rows with recycled
  templates.

The five research questions are answered in sections 1–5 of the findings doc. The 2026-05-13
workstreams doc is deleted; its A–H verdicts are in the findings doc, section 3.

## Results in the editor: design

Second pass, 2026-09-26. The design, the measurements and the Zed and VS Code teardown are in
[docs/search-view-results-in-editor.md](../docs/search-view-results-in-editor.md).

- **One Editor over a results document.**
  - The document's rows are the matched source lines, one per line (Q2 = B), in the view's file order.
  - A pure Platform excerpt map knows each row's file and source line, and each match's composite
    offsets.
  - File headers are Editor **block rows**, derived from file boundaries as Zed derives its headers.
  - Collapse removes a file's rows with a host edit; the header stays.
- **Today's look, unchanged components.**
  - The Editor reserves each header's height and hands Platform a container.
  - Platform portals the existing `SearchResultFileHeader` into it.
  - Source line numbers come from `createLineGutterPlugin({ labelForRow })`.
  - Match and active-match highlights are range decorations.
  - The hover actions are one strip placed from a point query.
  - Same fonts, 22 px lines on a 28 px stride.
- **Measured on a prototype** (one `Editor`, header rows, React headers from the view snapshot, regex
  tokens), on this repository:

  | Result set                  | Busy in a 20 × 1,200 px fling | Long tasks |
  | --------------------------- | ----------------------------- | ---------- |
  | 82 lines / 41 files         | 54 ms                         | 0          |
  | 733 / 250 (broad)           | 150 ms                        | 0          |
  | 4,391 / 2,411               | 141 ms                        | 0          |
  | 5,714 lines, 20,000 matches | 230 ms                        | 0          |
  - Today's view on the same build and machine: 2,000 ms and 18 long tasks. The sidebar's flat rows:
    613 ms.
  - Opening costs 38–54 ms. Streaming costs at most 20 ms per 64-file batch.
  - The React headers never lagged their rows: 0 blank frames sampled.

- **Exact geometry needs pixel-height blocks.**
  - Today a header is 22 px of pitch in compact and 26 px in cozy, and lines keep a 28 px stride.
  - Zed's blocks are whole lines. A one-row header would move every file 6 px (compact) or 2 px (cozy).
  - Headers must also stay put while the code scrolls sideways; the prototype showed them sliding with
    the text.
- **What the Editor lacks is small:**
  - a block-row renderer in a vertically-scrolling, horizontally-pinned layer (M)
  - pixel heights through the row-height index it already keeps unfed (S–M)
  - host edits into a read-only document, and a token range update (S)
  - `useEditorBlocks` in the React package (S)
  - an edit filter, needed only for editing by forwarding (M)
  - per-block sideways scroll, if Q4 = A (M–L, third pass)

  The deleted block-surface subsystem's lesson applies: reserve space in the row list, host the DOM in
  a stable layer.

- **Editing in place forwards edits** (pass 2's design; Q3 = D). The third pass recommends a
  multibuffer for editing instead (M1, R5).
  - The filter keeps each edit inside one result line.
  - Platform maps it to `(file, line, column)` and applies it to that file's live document, which is
    opened on first edit and checked against what the search saw.
  - Changes to those files mirror back as host edits.
  - Undo in the view undoes the source transactions it made (Zed's semantics).
  - Save saves what the view touched.
- **Zed's core model, a multibuffer in the Editor, is XL** (M1). A composite snapshot over many
  sessions, with edits split per session and cross-session undo. It removes the mirror, and the
  read-only view needs none of it, so it follows the read-only phases.
- **VS Code's search editor is the other reference.** Headers are text lines, nothing streams, and edits
  never reach files; go-to re-parses the text. Its useful lessons: keep the mapping beside the text, and
  declare block heights the host already knows.

## Many editors or one: third pass

Measured on a production build with pass 1's harness, runtime flags selecting each variant, three
traces per variant. Tables and method: [docs/search-view-many-editors.md](../docs/search-view-many-editors.md).

- **Where an editor mount goes** (today, broad fling, 228 mounts, 8.4 ms each):
  - style, layout and paint: 585 ms
  - the grammar-signature bug: 308 ms
  - two viewport reads that force layout (`measureInitialViewport`, `synchronizeOrigin`): 298 ms
  - caret geometry on every open: 217 ms, although a result editor is read-only and unfocused
  - React commit: 164 ms

  Construction and disposal are under 0.5 ms per editor.

- **Recycling works, with a ceiling.** Slots keyed by position turn 228 editor builds per fling into
  17–19 `openDocument` calls.

  | Broad wheel-fast, median | Busy     | Long tasks |
  | ------------------------ | -------- | ---------- |
  | Today                    | 1,767 ms | 15         |
  | Signature memo           | 1,589 ms | 9          |
  | Recycled pool            | 1,281 ms | 1          |
  | Pool + two layout fixes  | 1,176 ms | 0          |
  | One editor (prototype)   | 151 ms   | 0          |
  - After recycling, style, layout and paint stay at 590 ms: every file that scrolls in brings fresh
    row, gutter and action DOM.
  - The pathological tier barely moves (922 → 850 ms), because big blocks reopen their document every
    28 px.

- **The pool has two traps.** Rendering slots out of slot order makes React move editor subtrees
  (Layerize 134 → 580 ms). Slots over the whole overscanned item window keep about 37 live editors.
- **Per-file sideways scroll fits in one editor.**
  - **Prototype:** it translates each block's rows by that block's x offset, with a thin thumb in
    the gap under the block. The fling costs 158–177 ms against 151–155 ms, and 40 sideways steps cost
    2.1 ms of script.
  - **Pinned parts:** headers and line numbers stay put.
  - **Wheel listener:** it must be passive. A non-passive one made vertical scroll wait on the main
    thread.
  - **Editor work (M–L):** hit-testing resolves the row before x, about 20 row-x → content-x sites
    subtract the row's offset, and long-line chunking and caret reveal use the block's offset.
- **Zed has one horizontal scroll.** The whole multibuffer's longest row sets its width, and file
  headers are `Sticky` blocks that stay put.

## Decisions

- Decided 2026-09-26: research recommendation. The per-file excerpt cap goes (whatever the owner picks
  for Q1): a file's matches are all reachable. Why: it hides results the summary counts.
- Decided 2026-09-26: research recommendation. Results keep streaming into the open view. Why: the
  streamed retype costs 43–122 ms of stream state, and VS Code's write-once model would show nothing
  until a 20,000-match search completes.
- Decided 2026-09-26: research recommendation. The custom window store, velocity overscan, injectable
  scheduler, editor pool and line windows are deleted, not ported to TanStack. Why: the Editor's own row
  virtualizer windows the results document; the prototype flings 4,391 rows and 2,411 headers with no
  long task.
- Decided 2026-09-26: research recommendation. Sticky file headers are not part of this plan. Why:
  today's view has none; inside the editor they would be a sticky block row, Editor work that can follow.
- Decided 2026-09-26: research recommendation. Header blocks have pixel heights, so spacing matches
  today exactly: header to first line 22 px (cozy 26), 28 px between lines and before the next header.
  Why: the owner asked for exactly today's look; whole-row headers are off by 6 px per file in compact.
  Single-line files lose the extra 6 px that today's 28 px per-file editor minimum adds below them.
- Decided 2026-09-26: research recommendation. The keyboard in the view is the editor's: arrows move
  the caret and skip headers, selection spans files, Enter opens the match at or after the caret, F4 and
  Shift+F4 step matches. The sidebar tree keeps its own keys. Why: that is what "inside our editor"
  means; `result-editor-keyboard.ts` shrinks to Enter and the menu keys.
- Decided 2026-09-26: research recommendation. Copy gives the selected lines without headers, as Zed and
  VS Code do.
- Decided 2026-09-26: research recommendation. Editing in place starts with in-line edits (no newline
  inserted or removed, never across rows or on a header); full excerpt editing and context lines with
  expand controls come later. Why: in-line edits map one row to one source line with no excerpt
  resizing, which keeps the first editing phase small whichever model Q3 picks.
- Decided 2026-09-26: research recommendation. Undo in the results view undoes the edits the view made
  in the files, one step per edit group, and Save saves the documents the view touched. Why: edits land
  in the files, so their undo belongs there too (Zed's semantics). On a multibuffer this is its own
  undo; with forwarding (Q3 = D) it goes through the document transaction receipts the workspace-edit
  service already uses.
- Decided 2026-09-26: research recommendation. Header content is React through portals; the Editor core
  stays framework-agnostic and hands out containers, and `@singapore-editor/react` adds
  `useEditorBlocks`. Why: the header is the existing component, inside the app's providers, and a
  core-owned container never lags its row.
- Decided 2026-09-26: research recommendation. An unfocused editor stops measuring its caret on open,
  and the scroll element's padding is read once (Phase 1b). Why: 217 + 298 ms of forced layout in one
  broad fling, and every editor open in the app pays them. With the signature memo they take the fling
  from 1,767 to 1,405 ms and its long tasks from 15 to 2, whatever Q3 decides.
- Decided 2026-09-26: research recommendation. Per-block sideways scroll does not depend on Q3's
  model: it needs block rows to know where a block starts, and nothing else from the text model.
- Decided 2026-09-26: research recommendation. `docs/search-tab-performance-workstreams.md` is deleted.
  Why: it analysed a dev-mode trace of code that has since changed; the verdicts moved to the findings.

## Owner questions

**Q1. What renders a result line in the full search view?**

- A. A flat, fixed-height `ListRow` per line on `VirtualList` (the sidebar list's shape): source line
  number, syntax-coloured text with match highlights, line actions. Mouse selection and copy work
  across mounted rows; there is no caret and no Shift+arrow selection inside a file block.
- B. Keep one editor per file block and fix inside: pool editors across files, one syntax session per
  block, and an Editor mode that virtualizes against an outer scroller (Editor repo work).
- C. One editor for the whole result set, VS Code search editor style. The Editor has no block
  widgets for file headers, so headers become plain text lines.

**Recommendation: A.** Measured 3.4× less main-thread time on the same data with no long task, and it
deletes about 1,700 lines; B still builds editor DOM for every file that scrolls in and roughly halves
the cost at best.

Decided 2026-09-26: owner — none of these yet. Speed is not urgent; the view may stay slow for now.
The direction is the whole result set inside our editor, the way Zed's project search is one editor
over a multibuffer of excerpts, while looking exactly as the view looks today. That means the Editor
hosting app-rendered (React) blocks for file headers and line chrome, and it needs design first:
take Zed's model, not its platform-specific parts. The round-2 design is under
[Results in the editor: design](#results-in-the-editor-design); Q3 and Q4 follow from it.
The independent fixes (Editor grammar-signature memo, scroll listener) still ship on their own.

**Q2. One row per match or one row per source line?**

- A. One row per match (today): a line with four matches appears four times.
- B. One row per source line, every match on it highlighted. Next and Previous still step through
  matches, and the active match is underlined within its line.

**Recommendation: B.** VS Code's search editor does this, and on dense queries it cuts the rows up to
fivefold with no information lost.

Decided 2026-09-26: owner — B.

**Q3. What renders the full search view, and where does the multi-file model live?**

- A. Recycled many editors: today's components on a fixed pool of editors reused by position, plus
  Phase 1b.
  - **Speed:** broad fling 1,176 ms with no long task (today 1,767 ms and 15). Pathological 850 ms
    (today 922).
  - **What it keeps:** today's look, and per-file sideways scroll for free.
  - **What it cannot do:** selection, multi-cursor and undo across files. Editing in place is per file.
  - **Size:** S in the Editor, M in Platform.
- B. One editor over a results document for the read-only view. Editing in place then lands on a
  multibuffer in the Editor core, the owner's lean.
  - **Speed:** 151–155 ms broad and 230 ms pathological in the prototype.
  - **Reuse:** the read-only phases (E1–E3, E5, R1–R4) ship without any text-model change. When
    editing starts, the excerpt map becomes the multibuffer's excerpt table, and block rows,
    per-block scroll and React headers carry over.
- C. One editor on a multibuffer in the Editor core from the start (XL before anything ships).
- D. One editor with editing forwarded to the files' own documents and mirrored back (pass 2's
  recommendation).

**Recommendation: B.** It is the owner's multibuffer, with the read-only view shipping first. A
measured 7× faster than A's best (151–155 ms against 1,176 ms on the same fling), and A's remaining
cost is the row DOM each file brings, which one editor's virtualizer already recycles.

**Q4. How do long lines scroll sideways, now that the whole view is one editor?**

- A. Each file block scrolls sideways on its own, as today: a per-block x offset in the Editor, with a
  thin scrollbar under each overflowing block. Headers and line numbers stay put. Editor E5 (M–L),
  before the new view replaces today's.
- B. One horizontal scroll for the whole view, as Zed and VS Code do. The widest line of any file sets
  the scroll width.
- C. Soft wrap to the view width (the Editor's `wordWrap`).

**Recommendation: A.** It keeps the feature the owner likes. It measured 158–177 ms against 151–155 ms
per fling and 2.1 ms of script for 40 sideways steps. The Editor work is one bounded feature that does
not depend on Q3.

## Proposed phases

Phases 1, 1b, 2 and 3 stand on their own and can ship any time.

- **As recommended (Q3 = B, Q4 = A):** E1–E3 and E5 (Editor repo) with R1–R4 (Platform) put today's
  view, read-only, inside one editor with per-block sideways scroll. E5 lands before R2 replaces
  today's view, so the feature is never missing. M1 and R5 then add editing in place on a multibuffer.
- **Other answers:**
  - Q3 = A: Phases 1, 1b, 2 and 3, then P1 below and the 200-match cap fix; nothing else.
  - Q3 = C: M1 moves before R2.
  - Q3 = D: M1 is replaced by an edit filter and R5 by forwarding (pass 2's design,
    [results in the editor § 7.8](../docs/search-view-results-in-editor.md)).
  - Q4 = B drops E5. Q4 = C drops E5 and R2 turns on `wordWrap`.

1. **Grammar signature memo** (S, Editor: `packages/tree-sitter/src/treeSitter/workerClient.ts`).
   Compute `languageDescriptorSignature` once per descriptor object (a `WeakMap`) and leave `wasmUrl`
   out of the string in favour of an identity check. Test: registering one descriptor twice stringifies
   once. Proof: the first pass's probe counters fall to one call per language. Every editor open
   app-wide registers through it too.
2. **Scroll position without a layout read** (S, Platform: `features/search/state/result-scroll-state.ts`,
   `hooks/use-result-scroll-position.ts`). Take the offset from the scroll event without reading layout,
   and find the anchor row by binary search. The sidebar list keeps using it after R2. Proof: `trace` of
   the sidebar fling loses the 83 ms; `search-type-delete` still restores position.
   1b. **No forced layout on open for an unfocused editor** (S, Editor:
   `virtualization/virtualizedTextViewHighlights.ts` `renderCaret`,
   `virtualization/virtualizedTextViewHelpers.ts` `scrollElementPadding`,
   `virtualization/scrollViewport.ts` `synchronizeOrigin`).
   - **Caret:** an editor without focus skips caret geometry, and positions its caret when it takes
     focus or its selection changes. If an unfocused caret must stay visible somewhere, measure it in
     the next frame's read phase instead.
   - **Padding:** the scroll element's padding is read once, and read again only when the view changes
     it (reserved overlay width) or the text metrics are invalidated.
   - **Tests:** opening a document in an unfocused editor reads no layout (a counting stub for
     `getBoundingClientRect` and `getComputedStyle`), and focusing it places the caret.
   - **Proof:** with Phase 1, today's broad fling went from 1,767 to 1,405 ms and from 15 long tasks to
     2 in the research build. `trace research-search-view` before and after.
3. **Selection without a full rebuild** (M, shared search state: `state/buffer-state.tsx` `selectResult`,
   `utils/result-items.ts`). Keep an id → index map per result set and update only the active id.
   Proof: `trace` of 20 ArrowDown presses in the sidebar on the pathological set (175 ms in
   `result-items` today).

**Editor (Singapore) phases.** Tests use the simple path: `new Editor(element)`, `setText`, one
provider.

- **E1. Block rows** (M; `editor/src/displayTransforms.ts`, `virtualization/displayProjection*.ts`,
  `virtualizedTextViewRows.ts`, `virtualizedTextViewLayout.ts`, `fixedRowVirtualizer.ts`,
  `rowHeightIndex.ts`, `plugins.ts`, `public/extensions.ts`).
  - **API:** a block row is an injected row with `heightPx` (its whole pitch, no row gap), a stable
    `id` and host `data`. `registerBlockRowProvider` and `registerBlockRenderer` (`mount(container,
block) → { update?, dispose }`), shaped as building blocks of Plan 122's `createPlugin` if that
    lands first.
  - **Geometry:** the view feeds per-row sizes into the retained row-height index whenever block rows
    exist; `rowTop` and the y → row inverse read it.
  - **Mounting:** a block layer beside the gutter layer follows vertical scroll only and spans the
    viewport width. Containers mount with their row in the row paint pass, are reused by `id`, and
    dispose when the row leaves the mounted window.
  - **Interaction:** blocks take pointer events; point queries answer `{ kind: 'block', id }`; caret,
    selection and copy skip them, as injected rows already do.
  - **Tests:** row tops after blocks of mixed heights, point queries on and around a block,
    `revealOffset` across blocks, caret motion over a block, copy across a block, horizontal scroll
    leaving blocks in place, container reuse when blocks are re-provided.
- **E2. React blocks** (S; `react/src/index.tsx`). `useEditorBlocks(controller)` returns the mounted
  blocks `{ id, container, data }` through `useSyncExternalStore`; the host portals into each container.
  Test: a portal renders into a mounted block and unmounts when its row leaves.
- **E3. Host edits and token ranges** (S; `editor/src/editor/Editor.ts`, `documentController.ts`,
  `syntax/tokenStore.ts`).
  - Host-originated `edit(…)` on a read-only session document; user input stays refused.
  - Replace one offset range of the token store with new tokens, leaving the rest.
  - Tests: a host append to a read-only document; typing into it is still refused; a range replace
    leaves tokens outside the range untouched.
- **E5. Per-block sideways scroll** (M–L; `virtualization/virtualizedTextViewRows.ts`,
  `virtualizedTextView.ts`, `scrollViewport.ts`, `virtualizedTextViewHighlights.ts`, the block layer
  from E1; depends on E1).
  - **API:** a view option `horizontalScroll: 'view' | 'per-block'`. In per-block mode each block row
    starts a scroll group that runs to the next block row, with its own x offset.
  - **Rows:** the view's native horizontal scroll is off (`overflow-x: hidden`,
    `overscroll-behavior-x: contain`), and each mounted row carries its group's offset as a CSS
    `translate`. `horizontalChunkWindow` takes the row's group offset in place of `scrollLeft`.
  - **Coordinates:** `viewportPointMetrics` resolves the row from y before x and adds that row's
    offset. The row-x → content-x sites (`caretPositionAtX` and about 20 more) subtract it.
  - **Reveal and drag:** caret reveal and drag autoscroll write the target row's group offset.
  - **Input:** a passive wheel listener moves the group under the pointer on horizontal deltas. A
    non-passive one makes vertical scrolling wait on the main thread (measured).
  - **Scrollbar:** a thin thumb under each overflowing group's last row, in the block layer, with drag
    and track click.
  - **Tests:** a hit test in a scrolled group; caret and selection rects in two groups with different
    offsets; reveal scrolls only its group; horizontal wheel over one group moves only that group;
    chunk windows of a long line follow its group; headers and gutter do not move.
- **M1. Multibuffer in the Editor core** (XL; its own Editor plan before sizing: document controller,
  history, selections and anchors, syntax scheduling, decorations).
  - **Model:** a composite `TextReadSnapshot` over excerpts of many document sessions, Zed's model
    (pass 2 § 3). Composite anchors are `(document, piece anchor)`. Headers are E1 block rows, so
    separators carry no text.
  - **Edits:** split per session and clamped at an excerpt's end (Zed `multi_buffer.rs:1612-1729`). One
    undo step maps to per-session transactions. Changes made elsewhere reach the view by rebasing each
    session's edits into composite coordinates.
  - **Syntax:** each excerpt reads its own session's tokens.
  - **Open cost:** Zed opens a buffer for every matched file. At 2,400 files that is the cost to avoid:
    an excerpt reads the search's text until its first edit opens the file's session.

**Platform phases** (`features/search/`).

- **R1. Results document model** (M; new `utils/results-document.ts`, tests beside the view-model
  tests).
  - **Input and output:** from `WorkspaceSearchFileGroup[]`, build the text (one row per source line,
    real lines), the excerpt map (`row → (path, source line)`, per-file first row and prefix sums), the
    header blocks with heights by density, the match ranges in composite offsets, and the gutter labels.
  - **Incremental updates:** streamed batches become insert edits at sorted positions. A re-query diffs
    by path and reuses unchanged files. Collapse removes a file's rows. Each update returns the scroll
    shift for rows inserted above a given row.
  - **Pure and tested:** the pathological tier (20,000 matches), a mid-list insertion, collapse and
    expand, a re-query that keeps half the files.
- **R2. The view on one editor** (L; depends on E1–E3, E5 and R1).
  - **New component:** `components/results-editor.tsx`. It uses `useEditor` with a read-only session
    document, `lineHeight` 22, `rowGap` 6, `fontSize` 12 and the cursor-line paint off.
  - **What it wires:**
    - header blocks portalled to `SearchResultFileHeader` (unchanged, still `selected` for the active
      match's file)
    - `createLineGutterPlugin({ labelForRow })` with a click that opens the line
    - match and active-match decorations
    - a hover action strip (open, Replace) placed from a point query in the block layer
    - Enter, F4 and Shift+F4
    - the file menu on a header's context menu and on Shift+F10
    - scroll restore through the editor's scroll position
    - the focus target
  - **Deleted, with their tests:** `result-editor-surface.tsx`, `result-editor-virtual-window.tsx`,
    `result-file-editor-pool-slot.tsx`, `result-file-editor.tsx`, `result-source-line-gutter.tsx`,
    `result-file-line-actions.tsx`, `result-file-line-action-row.tsx`, `use-result-editor-virtualizer.ts`,
    `use-result-file-editor-pool-entries.ts`, `result-virtual-window-store.ts`, `result-editor-pool.ts`,
    `result-virtual-list.ts`, the line-window half of `result-editor.ts`, and the 200-excerpt cap.
  - **Scenarios:** update `visual-search-*`, `search-result-line-pick` and `search-file-actions`, whose
    selectors name per-file editor hosts, along with `scripts/agent/selectors.ts` and
    `.agents/skills/verify-fregat/features/search.md`.
- **R3. Syntax per file block** (M; replaces `state/result-syntax-cache.ts` and
  `utils/result-syntax-plugin.ts`).
  - One `EDITOR_SNIPPET_TOKENS_FEATURE` request per file block (lines joined, the file's language).
  - The tokens are offset into the composite and applied with E3's range replace.
  - Text paints at once, and colour arrives without moving anything.
  - Test: tokens land on the right rows after a mid-list insertion.
- **R4. Proof** (S–M).
  - A committed `visual-search-tiers` scenario: the prototype's tiers (`createError`, `useState`,
    `export function`, `a`), each with retype, wheel-fast, wheel-reading, jump and arrow phases.
  - `trace visual-search-tiers --compare` against a baseline recorded before R2: no task over 50 ms in
    wheel-fast on any tier.
  - `look` at the view in compact and cozy and in a light and a dark palette, comparing header
    spacing against today's screenshots.
- **R5. Editing in place on the multibuffer** (L; depends on M1).
  - **Model:** the view's excerpt table comes from R1's excerpt map. An edit lands in the file's own
    session, which is opened on first edit and checked against the search's line; the edit is refused
    with an error naming the file when the line differs.
  - **Undo, dirty and save:** undo in the view is the multibuffer's undo. The tab shows dirty while a
    touched document is dirty, and Ctrl+S saves those documents.
  - **Tests:**
    - typing in two files with multi-cursor lands in both files
    - undo in the view reverts both
    - an edit in the file tab shows in the view
    - an edit over a stale line is refused
  - **New scenario:** `search-edit-in-place`, which edits two results and then reads the files from
    disk after save.
- **P1. Only if Q3 = A: recycled editor pool** (M; `components/result-editor-virtual-window.tsx`,
  `result-file-editor-pool-slot.tsx`, `result-file-editor.tsx`, `state/result-editor-pool.ts`).
  - Slots keyed by position, taken only by files whose line window is non-empty, rendered in slot order.
  - A freed slot parks its editor under `content-visibility: hidden` until the next file takes it.
  - **Proof:** editors built per broad fling 228 → about 19, no long task in `trace research-search-view`.
- Later, not sized here: full excerpt editing (Enter inside a result), and context lines with Zed's
  expand controls.

Outside this plan, recorded in the first pass: grammar wasm ships as base64 inside JS chunks (bundle
shape, Plan 129's lane), and a workspace opened at a nested ignored repository searches empty.

## Verification

- Before and after each phase: `trace` of the probe tiers on a production build (recipe in the
  findings doc: `vite build --base /` into `/work/tmp`, `apps/server` with `WEB_ROOT` and a throwaway
  `PLATFORM_HOME` on a spare port, `agent:browser --url http://127.0.0.1:<port>/`).
- `renders` on the dev server for the broad tier (not captured during research; the shared dev server
  was down).
- `look` at the search editor in both densities and a light and a dark palette after R2, and read the
  screenshots back against today's (`/work/tmp/fregat-evidence/20260926T100143Z-scenario-research-search-look`).
- Unit tests that survive: `search-result-view-model.test.ts`, `search-result-scroll-state.test.tsx`,
  `result-tree-keyboard.test.ts`, `search-result-editor-utils.test.ts` (the parts that remain).
- Editor phases prove themselves in the Editor repo's tests and its `examples/app`; the prototype at
  `/work/tmp/research2/182b/proto/` is the measurement recipe for the one-editor shape.

## Out of scope

The sidebar results list (except Phase 2's shared listener and Phase 3's shared state); the search
backend (`/fs/search/events`), which answers in under 300 ms; the editor's own line virtualizer.
