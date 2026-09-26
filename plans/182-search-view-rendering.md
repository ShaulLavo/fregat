# Plan 182: Search view rendering

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — second pass: the result set becomes one Editor over a results
  document, with today's file headers rendered by Platform into Editor block rows. A prototype of that
  shape flings the broad tier with 150 ms of main-thread time and no long task; today's view takes
  2,000 ms with 18 long tasks on the same build. Design: [docs/search-view-results-in-editor.md](../docs/search-view-results-in-editor.md).
  First-pass measurements: [docs/search-view-rendering-findings.md](../docs/search-view-rendering-findings.md).
  Two owner questions (Q3, Q4) stand before implementation. Nothing here authorizes implementation.
- Planned at: Platform `d5a901726`, 2026-09-26. Researched at Platform `c130dd35a`, Editor `74e76be`;
  second pass at Platform `4c78266f8`, Editor `74e76be`, Zed `933d8d9`, VS Code `90da900128e`.
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
  - an edit filter, needed only for editing in place (M)

  The deleted block-surface subsystem's lesson applies: reserve space in the row list, host the DOM in
  a stable layer.

- **Editing in place forwards edits.**
  - The filter keeps each edit inside one result line.
  - Platform maps it to `(file, line, column)` and applies it to that file's live document, which is
    opened on first edit and checked against what the search saw.
  - Changes to those files mirror back as host edits.
  - Undo in the view undoes the source transactions it made (Zed's semantics).
  - Save saves what the view touched.
- **Zed's core model, a multibuffer in the Editor, is the XL alternative** (Q3). A composite snapshot
  over many sessions, with edits split per session and cross-session undo. It removes the mirror, and
  nothing asked for needs it first.
- **VS Code's search editor is the other reference.** Headers are text lines, nothing streams, and edits
  never reach files; go-to re-parses the text. Its useful lessons: keep the mapping beside the text, and
  declare block heights the host already knows.

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
  resizing, which keeps the forwarding small.
- Decided 2026-09-26: research recommendation. Undo in the results view undoes the source transactions
  the view made, through the document transaction receipts the workspace-edit service already uses;
  Save saves the documents the view touched. Why: edits land in the files, so their undo belongs there
  too (Zed's semantics).
- Decided 2026-09-26: research recommendation. Header content is React through portals; the Editor core
  stays framework-agnostic and hands out containers, and `@singapore-editor/react` adds
  `useEditorBlocks`. Why: the header is the existing component, inside the app's providers, and a
  core-owned container never lags its row.
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

**Q3. Where does the multi-file model live?**

- A. A results document plus forwarding. The editor shows one document of matched lines; Platform owns
  the excerpt map and forwards edits to each file's live document, mirroring file changes back. Editor
  work: block rows, pixel heights, host edits, token ranges, then an edit filter (about M + S–M + S + S,
  then M).
- B. A multibuffer in the Editor core, Zed's model. One view over many document sessions without copied
  text, edits split per session, one undo transaction across sessions. It reaches the document
  controller, history, selections, syntax, decorations and LSP sync (XL). Edits are the files' own, with
  no mirror to keep equal.

**Recommendation: A.** It reuses the Editor's one-document machinery, it ships read-only first with no
text-model change at all, and B stays open: A's excerpt map is B's data model if the mirror proves
fragile.

Owner, 2026-09-26: leans B, a real multibuffer. Not final: see Q4.

**Q4. Long lines, now that the whole view is one editor?**

- A. Real source lines with one horizontal scroll for the whole view; headers, the gutter and the
  action strip stay pinned. What Zed and VS Code do.
- B. Real source lines, soft-wrapped to the view width (the Editor's `wordWrap`).
- C. Lines clipped as today (a 160-character preview), with one horizontal scroll. Editing in place then
  cannot reach text past the clip.

**Recommendation: A.** Today each file block scrolls sideways on its own, which one editor cannot do,
and editing needs the real line. Wrap makes the row count depend on width, which moves every header
on resize.

Owner, 2026-09-26: not decided. Per-file sideways scrolling is a feature the owner likes about
today's many-editor view, and asks whether many editors can be made fast instead. A third research
pass measures that (editor recycling, mount cost, per-excerpt horizontal scroll inside a
multibuffer) before Q3 and Q4 are settled.

## Proposed phases

Phases 1, 2 and 3 stand on their own and can ship any time. E1–E3 (Editor repo) and R1–R4 (Platform)
assume Q3 = A and give today's view, read-only, inside one editor; E4 and R5 add editing in place.
With Q3 = B, E1–E3 still hold (block rows are needed either way), R1's excerpt map moves into the
Editor, and E4/R5 become the multibuffer plan.

1. **Grammar signature memo** (S, Editor: `packages/tree-sitter/src/treeSitter/workerClient.ts`).
   Compute `languageDescriptorSignature` once per descriptor object (a `WeakMap`) and leave `wasmUrl`
   out of the string in favour of an identity check. Test: registering one descriptor twice stringifies
   once. Proof: the first pass's probe counters fall to one call per language. Every editor open
   app-wide registers through it too.
2. **Scroll position without a layout read** (S, Platform: `features/search/state/result-scroll-state.ts`,
   `hooks/use-result-scroll-position.ts`). Take the offset from the scroll event without reading layout,
   and find the anchor row by binary search. The sidebar list keeps using it after R2. Proof: `trace` of
   the sidebar fling loses the 83 ms; `search-type-delete` still restores position.
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
- **E4. Edit filter** (M; `plugins.ts`, `editor/src/editor/inputSelectionController.ts` and every edit
  entry).
  - `registerEditFilter(edits → edits | null)` is consulted before any user-originated edit applies:
    typing, IME commit, paste, cut, delete and word-delete, multi-cursor, snippets, auto-close,
    line operations.
  - A refused edit changes neither text nor selection.
  - Tests per entry point, including IME composition across a refused boundary.

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
- **R2. The view on one editor** (L; depends on E1–E3 and R1).
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
- **R5. Editing in place, in-line edits** (L; depends on E4).
  - **Filter:** an E4 filter keeps each edit inside one result row.
  - **Forwarding:** the host maps edits through the excerpt map and applies them to the file's live
    document (`ensureLiveEditorDocument`). The document is opened on first edit, checked against the
    search's line, and refused with an error naming the file when it differs.
  - **Mirroring:** file changes mirror back as host edits.
  - **Undo, dirty and save:** undo in the view reverts the source transactions it made (document
    transaction receipts). The tab shows dirty while a touched document is dirty, and Ctrl+S saves them.
  - **Check:** a debug-only comparison of each edited row against its source line logs a wide event
    on mismatch.
  - **Tests:**
    - typing in two files with multi-cursor lands in both files
    - undo in the view reverts both
    - an edit in the file tab shows in the view
    - an edit over a stale line is refused
  - **New scenario:** `search-edit-in-place`, which edits two results and then reads the files from
    disk after save.
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
