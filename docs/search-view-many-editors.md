# Search view: many fast editors, or one editor with per-file sideways scroll

Third research pass for [Plan 182](../plans/182-search-view-rendering.md), 2026-09-26, at Platform
`e04c94271`, Editor main `860f861` (its built `dist`, copied and patched outside the repo) and Zed
`933d8d9`. Pass 1 ([findings](search-view-rendering-findings.md)) measured why today's view is slow;
pass 2 ([results in the editor](search-view-results-in-editor.md)) designed one editor over the whole
result set. This pass answers the owner's question from 2026-09-26: today's view gives every file block
its own sideways scroll, so can many editors be made fast instead, and can one editor keep that scroll?

## Verdict

- **Many editors get smoother, not fast.** Recycling a fixed pool of editors and removing three
  per-open layout reads takes the broad fling from 1,767 ms of main-thread time with 15 long tasks to
  1,176 ms with 0. One editor does the same fling in 151–155 ms. What remains is style, layout and
  paint of the rows each file brings in (about 590 ms, unchanged by recycling) and React (about
  220 ms). On the pathological tier recycling changes nothing (922 → 850 ms), because big blocks still
  reopen their document every 28 px.
- **One editor can keep per-file sideways scroll.** A prototype gives each file block its own x offset
  by translating that block's rows. The fling costs 158–177 ms against 151–155 ms without it, and 40
  sideways wheel steps cost 2.1 ms of script. Headers and line numbers stay put. The Editor work is one
  bounded feature (M–L), and it does not depend on whether the model is a results document or a
  multibuffer.
- **Zed has one horizontal scroll.** Its scroll width is the longest row of the whole multibuffer, and
  file headers are `Sticky` blocks that do not move sideways. Per-file sideways scroll would be our
  addition.

Recommendation: one editor (shape b below), read-only first, with per-block sideways scroll before it
replaces today's view; editing in place on a multibuffer in the Editor core, the owner's lean.
The two Editor fixes this pass found (caret and padding reads) help every editor in the app and ship
on their own.

Screenshots, in `/work/tmp/research2/182c/`:

| File                                         | Shows                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `1-today-per-file-sideways-scroll.png`       | Today's view, two blocks scrolled sideways by different amounts, each with its own scrollbar            |
| `2-one-editor-per-block-sideways-scroll.png` | The one-editor prototype, first block scrolled 844 px with its own thumb, the rest at 0, headers pinned |
| `3-recycled-editors-after-jump.png`          | Recycled editors after the fling and jump: today's look, unchanged                                      |
| `4-today-after-jump.png`                     | Today's view at the same point, for comparison                                                          |

## 1. Where one editor mount goes

Harness: pass 1's recipe. A production build of this worktree (`vite build --base / --sourcemap`),
served by `apps/server` on port 33971 with a throwaway `PLATFORM_HOME`, driven by the
`research-search-view` probe through `agent:browser trace --url`. Broad tier: `export function`, then
`useState` typed into the open view (745 matches in 254 files), then 20 wheel steps of 1,200 px.
Samples are split into exclusive buckets by the first matching frame on each stack
(`/work/tmp/research2/182c/buckets.ts`).

Today's view, broad wheel-fast, 1,912 ms busy, 228 editors mounted and 227 disposed (8.4 ms each):

| Bucket                                                                      |  ms | Per editor |
| --------------------------------------------------------------------------- | --: | ---------: |
| Style, layout and paint (native)                                            | 585 |     2.6 ms |
| Grammar signature (tree-sitter re-stringifies the grammar per line session) | 308 |     1.4 ms |
| Viewport reads: `measureInitialViewport`, `synchronizeOrigin` padding       | 298 |     1.3 ms |
| Caret geometry on open (`syncDomSelection`, forced layout)                  | 217 |     1.0 ms |
| React commit                                                                | 164 |     0.7 ms |
| `new Editor` and the rest of mount                                          |  52 |     0.2 ms |
| Keymap compile                                                              |  47 |     0.2 ms |
| Row render (`renderContent`)                                                |  44 |     0.2 ms |
| Other editor, syntax, search React, GC                                      | 191 |            |
| Editor dispose                                                              |  16 |     0.1 ms |

- **Forced layout is the editor's own cost.** The three layout reads (515 ms) each pay for a full
  layout, because each follows the previous editor's DOM writes.
- **The caret read is wasted.** A read-only result editor that has never been focused positions a
  caret at offset 0 on every open.
- **The padding read is repeated.** `synchronizeOrigin` calls `getComputedStyle` on every viewport
  size change.
- **Construction and disposal are cheap.** Building and tearing down the editor objects is under
  0.5 ms per editor. The cost is layout, paint and the grammar bug.

## 2. Recycling, measured

The prototype patches four product files in the worktree (not committed) and the Editor `dist` copy,
each behind a runtime flag, so one build measures every variant:

- **Sig:** the grammar-signature memo (Plan 182 Phase 1).
- **Recycle:** a fixed pool of editor slots keyed by position. Only files whose line window is non-empty
  take a slot; a freed slot goes to the next file entering, which reaches the same `Editor` as an
  `openDocument`. A slot with no file parks its editor with `content-visibility: hidden`.
- **Lite:** an editor that does not hold focus skips caret geometry, and the scroll element's padding
  is read once.
- **NoSyntax:** result editors without the syntax plugin, to bound syntax's share.

Median main-thread time over three traces each (narrow and pathological: two):

| Tier, variant                      | Wheel-fast busy (range) | Long tasks | Worst task | Wheel-reading | Jump   |
| ---------------------------------- | ----------------------- | ---------- | ---------- | ------------- | ------ |
| broad, today                       | 1,767 (1,729–1,912)     | 15         | 69 ms      | 356 ms        | 146 ms |
| broad, Sig                         | 1,589 (1,584–1,740)     | 9          | 72 ms      | 354 ms        | 92 ms  |
| broad, Sig + Lite                  | 1,405 (1,370–1,475)     | 2          | 51 ms      | 297 ms        | 84 ms  |
| broad, Sig + Recycle               | 1,281 (1,273–1,511)     | 1          | 52 ms      | 369 ms        | 93 ms  |
| broad, Sig + Recycle + Lite        | 1,176 (1,098–1,248)     | 0          | 39 ms      | 391 ms        | 81 ms  |
| broad, same, no syntax             | 993 (951–1,127)         | 0          | 45 ms      | 405 ms        | 73 ms  |
| narrow, today                      | 422                     | 3          | 82 ms      | 32 ms         | 116 ms |
| narrow, Sig + Recycle + Lite       | 254                     | 0          | 40 ms      | 22 ms         | 64 ms  |
| pathological, today                | 922                     | 0          | 26 ms      | 1,024 ms      | 60 ms  |
| pathological, Sig + Recycle + Lite | 850                     | 0          | 44 ms      | 1,111 ms      | 56 ms  |
| **One editor (pass-2 prototype)**  | **151–155**             | **0**      | 10 ms      | 137–142 ms    |        |

- **Editors created per broad fling:** 228 today, 17–19 recycled; the pool stops growing once it
  covers the line-window range.
- **What is left after recycling** (broad, Sig + Recycle + Lite, 1,106 ms sampled):
  - style, layout and paint: 590 ms, the same as today's 585
  - React: 222 ms
  - viewport reads while the pool grows: 100 ms
  - everything else in the editor: under 100 ms

  Every file that scrolls in still brings a fresh set of row, gutter and action DOM, and that is what
  the browser styles, lays out and paints.

- **Pathological does not improve.** Its 9 editors are big blocks, and a line window over 16 excerpts
  reopens the document every 28 px of scroll (pass 1). Recycling keeps the editor but not its rows.
- **Removing the per-editor scroll container** (`overflow: hidden`, NoScroller) did not help:
  1,311–3,240 ms, noisy. The paint floor is the rows, not the scroll layers.
- **The one-editor number is a different harness:** a standalone page with plain headers and regex
  tokens, re-run on this machine today. Pass 2's caveat stands: the real view will cost more, and
  there is room for several-fold before it reaches 1,176 ms.

Two traps the pool must avoid, each measured on the way:

- **Slots keyed by position but rendered in pool order.** React then moves editor subtrees on every
  reorder. Editors created drop to 37, but Layerize rises from 134 to 580 ms and busy time to 2,086 ms.
  Slots must render in slot order.
- **Slots over the whole item window** (which overscans up to 1,800 px) keep about 37 live editors, and
  paint goes up. Slots belong only to files whose line window is non-empty.

## 3. One editor with per-file sideways scroll

**Prototype** (`/work/tmp/research2/182c/proto/`, pass 2's one-editor page plus `hscroll=block`):

- **Offsets:** each file block has an x offset. A view contribution sets the CSS `translate` property
  on each mounted row element from its block's offset. `translate` composes with the editor's own row
  transform.
- **Pinned parts:** the editor's own horizontal scroll is off (`overflow-x: hidden`,
  `overscroll-behavior-x: contain`), so headers and the line-number gutter stay put.
- **Scrollbars:** a thin per-block thumb sits in the 6 px gap under the block's last row.
- **Input:** a passive wheel listener moves the block under the pointer on horizontal deltas.

Broad tier, same phases as the other one-editor numbers:

| Measurement                                   | Result                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Wheel-fast busy, per-block on                 | 158, 176, 177 ms (0 long tasks)                                    |
| Wheel-fast busy, per-block off                | 151, 155 ms                                                        |
| 40 horizontal wheel steps over one block      | 2.1 ms of script, 280 style writes                                 |
| Row offsets re-applied during a 20-step fling | 1.6 ms, 24 writes (only rows that changed block)                   |
| Same fling, listener non-passive              | window 1,032 → 1,365 ms: vertical scroll waited on the main thread |

The listener must stay passive. With `overflow-x` hidden there is no native sideways scroll to
cancel, so vertical scrolling stays on the compositor.

**What the prototype does not do**, and the Editor feature has to: hit-testing, caret, selection and
reveal in block coordinates, and long-line chunking. Sites in the Editor, from the code:

- **Hit-testing:** `viewportPointMetrics` computes x from the global `scrollLeft` before it knows the
  row (`virtualizedTextViewRows.ts:3006-3046`). Resolve the row from y first, then add that row's block
  offset. One function.
- **Caret, selection and overlay rects:** every row x becomes content x through `gutterWidth(view) + x`
  (`caretPositionAtX`, `:3084`). There are about 20 such sites across `virtualizedTextViewRows.ts` and
  `virtualizedTextView.ts`, and each subtracts the row's block offset. Custom Highlight API paint
  (tokens, matches, find) moves with the text for free.
- **Long lines:** `horizontalChunkWindow` picks visible columns from the global `scrollLeft`
  (`:1929-1960`). It takes the row's block offset instead. Lines under the chunk threshold need nothing.
- **Reveal:** `scrollLeftForVisibleOffset` and its callers write `scrollElement.scrollLeft`
  (`:2871-2960`). In per-block mode they write the target row's block offset.
- **Drag selection autoscroll** moves the block under the pointer.
- **Selection across blocks** needs nothing new: each row paints its own rects with its own offset.
  Box selection takes columns in the pointer's block.
- **Wheel:** a passive listener reads horizontal deltas. The Editor's own `NativeWheelScrollOwner`
  (`wheelScrollTarget.ts`) is for overlays and stays as it is.
- **Scrollbar:** a thumb per overflowing block, in the block layer under its last row, with drag and
  track click.

Size: M–L in the Editor. It needs block rows (pass 2's E1) to know where a block starts. It does not
care whether the rows come from a results document or a multibuffer.

**Zed** (`references/zed` at `933d8d9`):

- **One scroll position** (x, y) per editor. The scroll width is the width of
  `snapshot.longest_row()` over the whole multibuffer (`crates/editor/src/element.rs:9237-9255`), so
  one minified line widens the whole view.
- **Headers stay put:** `BufferHeader` and `ExcerptBoundary` blocks are `BlockStyle::Sticky`
  (`display_map/block_map.rs:437-442`), and only non-sticky blocks shift by the scroll x
  (`element.rs:3968-3970`).
- **Sideways autoscroll** follows selections in the visible rows only (`scroll/autoscroll.rs:372`).
- **Wrapping:** project search sets nothing of its own; it follows the user's soft-wrap setting.

## 4. The three shapes

|                                            | (a) Recycled many editors     | (b) One editor, per-block sideways scroll                 | (c) One editor, one sideways scroll |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Broad fling                                | 1,176 ms, 0 long tasks        | about 160–180 ms in the prototype                         | 151–155 ms in the prototype         |
| Pathological fling                         | 850 ms (today 922)            | 230 ms (pass 2)                                           | 230 ms (pass 2)                     |
| Look                                       | Today's, unchanged components | Today's, with pixel-height header blocks (pass 2)         | Same as (b)                         |
| Per-file sideways scroll                   | Yes, native                   | Yes, per-block offset and thumb                           | No: one scroll, widest line sets it |
| Selection, multi-cursor, undo across files | No                            | Yes                                                       | Yes                                 |
| Edit in place                              | Per file only, forwarded      | Yes, on the multibuffer                                   | Yes, on the multibuffer             |
| 200-match cap and line-window reopen       | Stay, fixed separately        | Gone                                                      | Gone                                |
| Editor work                                | S (two layout fixes)          | E1–E3 + E5 per-block scroll (M–L); multibuffer later (XL) | E1–E3; multibuffer later (XL)       |
| Platform work                              | M (pool by position)          | Pass 2's R1–R4                                            | Same                                |

(a) is the smallest change and keeps everything the owner likes today. Its ceiling is about 1.1 s of
main-thread time per broad fling, 7× one editor's, and it cannot give selection or editing across
files. (b) costs one Editor feature more than (c) and keeps per-file sideways scroll.

## 5. Probes

All under `/work/tmp/research2/182c/`:

- **Harness:**
  - `server.sh`, `build.sh`: the production build and server on 33971.
  - `run.sh`, `matrix.sh`, `matrix.tsv`, `summarize.py`: traces per variant and their medians.
  - `analyze.ts`: pass 1's phase split. `buckets.ts` and `inclusive.ts`: exclusive and inclusive
    buckets per function. `evnames.ts`: trace events by name.
- **Patches:**
  - `ed/`: the Editor packages copy, with its patched `dist`.
  - `editor-link.sh`: points the worktree's `@singapore-editor/*` links at the copy.
  - `product-patches.diff`: the product-side patches (runtime flags
    `__research182c{Sig,Recycle,Lite,NoSyntax,NoScroller}`), not committed.
  - `research-search-view.ts` (pass 1's probe with the flags and an editor counter) and
    `research-search-hscroll.ts` (today's sideways-scroll screenshot): probe scenarios, not committed.
- **Prototype:** `proto/`, pass 2's page with `hscroll=block`; `proto/hblock.ts` takes the screenshot
  and times the sideways steps.
