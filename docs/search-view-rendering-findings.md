# Search view rendering: findings

Research for [Plan 182](../plans/182-search-view-rendering.md), 2026-09-26, at Platform `c130dd35a`
and Editor `74e76be`. Replaces `docs/search-tab-performance-workstreams.md` (the 2026-05-13 dev-mode
analysis); its workstream verdicts are in [Old workstreams](#old-workstreams-a-h).

## Verdict

The full search view is slow because it mounts one editor per file block, and a fast scroll mounts
hundreds of them. The windowing costs almost nothing: 3 ms of 2,059 ms of main-thread time in the
worst measured phase. Swapping the virtualizer changes nothing on its own.

The fix is structural: render the result lines as flat, fixed-height rows on `VirtualList`, the shape
the sidebar list already has. On the same results and the same wheel input, the sidebar list spends
613 ms where the search view spends 2,059 ms, with no task over 50 ms against 16. TanStack Virtual is
the right virtualizer once the rows are cheap, and the custom window store, editor pool and line
windows are deleted instead of ported.

Four things are worth fixing whatever the structure:

1. Each tree-sitter session the view creates re-serialises its grammar descriptors, including the
   grammar's wasm, which the build inlines as a base64 data URL (1.9 MB for TypeScript). One fast
   scroll made 424 such calls and stringified 774 MB, costing 359 ms (Editor repo, a one-line memo).
2. The scroll-position recorder reads `scrollTop` inside every scroll event, forcing a layout. It
   costs 83 ms of the sidebar list's 613 ms, and the search view has the same listener.
3. A file shows at most 200 of its matches. The pathological query's view is 76,588 px tall, about
   2,700 rows for 20,000 matches; the rest cannot be scrolled to, and selecting one scrolls to the
   200th line of its file instead (live bug).
4. On a dense query the same source line repeats once per match on it (up to four times in the
   screenshots). `e` averages five matches per line over this repository.

## How it was measured

- **Production build.** `vite build --base / --sourcemap` of `origin/main` into
  `/work/tmp/research2/182/web`, served by `apps/server` from the worktree with `NODE_ENV=production`,
  `WEB_ROOT` set, and a throwaway `PLATFORM_HOME`, on port 33951. `agent:browser --url
http://127.0.0.1:33951/` drives it; a loopback URL off port 5173 and outside `/platform` needs no
  isolated server and passes the production guard. Headless Chromium, 1440×1000, sidebar open, the
  search editor pane about 590 px tall with the terminal panel below it.
- **Probe scenario** `research-search-view` (kept at `/work/tmp/research2/182/research-search-view.ts`,
  not committed): type the query in the sidebar, open the search editor, retype a second query into
  the editor's own input (120 ms per key, results stream into the open view), 20 wheel steps of
  1,200 px ("wheel-fast"), 40 of 120 px ("wheel-reading"), jump to the middle, wheel the sidebar list
  the same 20×1,200 px as a flat-row control, then 20 ArrowDown presses. In-page counters per phase:
  rAF frames, long tasks, editor hosts mounted and unmounted (MutationObserver), and calls to the
  grammar-signature `JSON.stringify` (wrapped).
- **Split.** `/work/tmp/research2/182/analyze.ts` reads a trace, maps every sampled frame through the
  build's source maps, and splits each phase into owners by the deepest application frame (search
  window store and pool, search view model, stream state, sidebar list, editor packages, tree-sitter
  client, react-dom) plus native style, layout and paint from trace events. Samples are interval
  estimates, not self time.
- **Tiers** over this repository. The vscode clone was planned as a fourth tier, but a workspace opened
  at `references/vscode` returns 0 matches for `import`, while `rg` in that directory finds 151,110
  lines. That is a search bug outside this plan, noted under
  [Outside this plan](#outside-this-plan).

| Tier         | First query       | Result              | Retyped in the view | Result              |
| ------------ | ----------------- | ------------------- | ------------------- | ------------------- |
| narrow       | `useSettingValue` | 159 in 63 files     | `createError`       | 134 in 60 files     |
| broad        | `export function` | 5,226 in 2,614      | `useState`          | 803 in 261          |
| pathological | `e`               | 20,000 (cap) in ~29 | `a`                 | 20,000 (cap) in ~33 |

The search request itself took 18–293 ms end to end (`search.query` events in the run log), so the
backend is not the bottleneck.

## 1. Where the time goes

Main-thread time per phase in the production build. "Busy" is the summed task time inside the phase
window. The owner columns come from samples; style, layout and paint come from trace events.

| Tier, phase                 | Busy / window | Tasks >50 ms (worst) | Editor packages | Window + pool | Stream state | react-dom | Style | Layout | Paint |
| --------------------------- | ------------: | -------------------: | --------------: | ------------: | -----------: | --------: | ----: | -----: | ----: |
| broad, open results         |     340 / 561 |              1 (107) |             138 |             2 |            2 |        17 |    31 |      9 |    84 |
| broad, retype (streaming)   |   495 / 1,628 |               0 (47) |              50 |             1 |           43 |        36 |    30 |     16 |   206 |
| broad, wheel-fast           | 2,241 / 2,512 |              19 (92) |           1,369 |             3 |            0 |       162 |   456 |    186 |   316 |
| broad, wheel-reading        |   853 / 2,465 |               0 (17) |             262 |             3 |            0 |        53 |    98 |     52 |   380 |
| broad, sidebar wheel-fast   |   613 / 1,602 |               0 (39) |               0 |             0 |            1 |       124 |    59 |     33 |   305 |
| narrow, wheel-fast          |   513 / 1,359 |               4 (91) |             278 |             1 |            0 |        40 |   108 |     44 |    93 |
| pathological, retype        |     538 / 959 |               2 (96) |              59 |             1 |          122 |        55 |    51 |     17 |    85 |
| pathological, wheel-fast    |   882 / 1,576 |               0 (26) |             319 |             2 |            0 |       184 |   112 |     41 |   216 |
| pathological, wheel-reading | 1,016 / 2,617 |               0 (18) |             283 |             2 |            0 |       152 |   167 |     61 |   336 |
| pathological, arrow-nav     |   553 / 1,319 |               0 (33) |              12 |             1 |          175 |        72 |    20 |      4 |   127 |

"Editor packages" counts every sample with an Editor-repo frame on the stack, including the
tree-sitter client. The sidebar row belongs to the second broad trace, whose own wheel-fast was 2,059
busy over 2,319 ms with 16 long tasks (within 8% of the first). Traces:
`/work/tmp/fregat-evidence/20260926T093040Z-trace-research-search-view` (narrow),
`…093113Z…` (broad), `…093213Z…` (pathological), `…093908Z…` (broad with the sidebar control).

What the counters add (scenario runs `…093813Z…`, `…093825Z…`, `…093840Z…`, `-scenario-research-search-view`):

| Tier, phase              | Editors mounted / unmounted | Rows created | Signature calls | Stringified | Stringify time |
| ------------------------ | --------------------------: | -----------: | --------------: | ----------: | -------------: |
| broad, open results      |                      19 / 0 |           30 |              56 |      106 MB |          49 ms |
| broad, wheel-fast        |                   227 / 217 |          670 |             424 |      774 MB |         359 ms |
| broad, wheel-reading     |                     29 / 34 |           90 |             174 |      138 MB |          66 ms |
| narrow, wheel-fast       |                     51 / 47 |          118 |              72 |       85 MB |          38 ms |
| pathological, wheel-fast |                       9 / 8 |          434 |             564 |      150 MB |          88 ms |

Split for the plan's categories, broad wheel-fast:

- **Stream ingestion and state rebuild:** none while scrolling; 43 ms (broad) to 122 ms
  (pathological) while a retyped query streams into the open view. Batching and incremental groups
  landed (workstreams A and B).
- **React commit:** 162 ms of react-dom self time; most of it mounts and unmounts editor subtrees.
- **Editor mount and layout:** the bulk. About 930 ms of editor-package JavaScript beyond the
  tree-sitter client, led by three forced layout reads that every new editor makes once:
  `readRowClientRectScale` (`offsetWidth` plus a rect per row, 265 ms), `scrollElementPadding`
  (`getComputedStyle`, 204 ms) and `measureInitialViewport` (113 ms). Each read comes after the
  previous editor's DOM writes, so each one pays for a full layout.
- **Syntax:** 364–439 ms in the tree-sitter client, of which the signature stringify is 359 ms. The
  view creates one tree-sitter session per unique excerpt line, and every session registers its
  language again.
- **Style recalc and paint:** 421–456 ms style and 304–316 ms paint, driven by the editor DOM churn:
  about 450 editor subtrees built and torn down in 2.3 s.

Per mount, that is roughly 9 ms of main thread for one file block (about 2,100 ms busy over 227
mounts).

## 2. Is windowing the bottleneck?

No. `result-virtual-window-store`, `result-virtual-list`, the virtualizer hook, the pool and the pool
entries together sample at 1–11 ms per phase, never above 2% of the phase. The editors they mount
take 1,369 of the 2,245 sampled ms in broad wheel-fast (86% of the JavaScript) and cause most of the
style, layout and paint.

Three details of the current windowing make the editor cost worse, and none of them is a virtualizer
problem:

- **The pool never reuses an editor.** Slots are keyed by file id, so a file scrolling in always
  mounts a fresh `Editor`. A retained hidden slot renders its editor only while its line window is
  non-empty, which needs it within 560 px of the viewport; the item window's overscan is at least
  640 px, so a slot outside the item window never holds an editor. No caller passes
  `prewarmEditorPool`, so it is always true, and it retains nothing but an empty `div`.
- **Line windows reopen the document.** A block with more than 16 excerpts renders a slice of its
  lines, and the slice moves with every 28 px row stride. The document revision includes the slice
  bounds and the whole text, and the editor syncs with `textSyncMode: 'open'`, so each step is a full
  `openDocument` with new rows and a new syntax session. The pathological wheel-fast created 434 rows
  while mounting only 9 editors.
- **The editor cannot virtualize against the outer scroller.** Its own line virtualizer needs to be the
  scroll container, which is why the app slices lines itself. That mismatch is the reason for the line
  windows.

## 3. The old workstreams, A–H

<a id="old-workstreams-a-h"></a>

| Workstream                       | Verdict     | Evidence                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Event batching                | Done        | `utils/buffer-runner.ts`: the first batch flushes on the next frame, later ones after 48 ms plus a frame; terminal events flush pending matches. Stream state is 43–122 ms per streamed query in production.                                                                                               |
| B. Incremental groups            | Done        | `appendSearchGroups` keeps untouched groups and their matches; `result-view-model.ts` caches file blocks per group in a `WeakMap`. Still open: `searchResultVirtualRows` rebuilds every row object per change, and a re-query that reconciles against the previous results regroups all matches per batch. |
| C. Lightweight loading surface   | Obsolete    | The editor surface stays mounted while loading (decided then, still true). The boundary reset key is gone with the old boundary. Hidden pool slots never hold an editor (section 2), so the "defer spare slots" task has nothing left to defer.                                                            |
| D. Plugin and gutter deferral    | Obsolete    | The source-line gutter is a React column (`result-source-line-gutter.tsx`); there is no find plugin and no deferred plugin mode in the code. The cost it targeted moved to editor mounts and per-line syntax sessions.                                                                                     |
| E. Per-row width measurement     | Done        | `state/preview-budget.ts`: one `ResizeObserver` for every preview cell, one glyph measurement. Applies to the sidebar list.                                                                                                                                                                                |
| F. Profiling harness             | Partly done | `visual-search-*` scenarios and `agent:browser trace` exist, dev build only. This research adds a production-build recipe and a phase analyzer (above); the scenario to commit is described in Phase 3.                                                                                                    |
| G. Backend sanity                | Done        | `search.query` log events: 18–293 ms per query across the tiers, 20,000-match cap included. Abort on query change was not re-checked.                                                                                                                                                                      |
| H. Same-file incremental updates | Not done    | `result-file-editor.tsx` uses `textSyncMode: 'open'` with a revision of window bounds plus text, so appends and line-window moves reopen the document. Syntax reloads are cheap because tokens come from the per-line cache (`result-syntax-cache.ts`), but rows rebuild.                                  |

What the 2026-05-13 trace said that is still true: the result surface's editor work dominates, and
text-metric reads force layout. What is no longer true: streamed batches as the main cost, per-row
width observers, gutter and plugin churn.

## 4. Would `VirtualList` serve?

Not as a drop-in under the current editors: it would change the 3 ms, not the 1,369 ms. What it
would need there: exact variable sizes from excerpt counts (known up front, no measurement), velocity
overscan (an overscan prop driven by scroll speed, or `rangeExtractor`), and editor reuse across items,
which a React-keyed virtualizer does not give.

With flat rows it serves as it is. Every row has one height (header rows use the row token; line rows
one fixed stride), so the full view becomes the sidebar list's shape at a wider width: `items`,
`getKey`, `renderRow`, `useListbox`, scroll restore through `initialOffset`, the active row kept
mounted. Velocity overscan and the injectable scheduler have no job left: the sidebar list runs the
same fling with default overscan and no long task. At the 20,000-match cap the item array is at most
about 20,000 rows plus headers, which `VirtualList` handles today (Plan 181 makes its key stable;
Plan 178's count mode is not needed). Sticky file headers can follow later from Plan 178's sticky
chain, whose stated first adopter outside the tree is the search results.

## 5. What VS Code does

From `references/vscode` at `90da900128e`:

- **Search editor** (`contrib/searchEditor/browser`): one `CodeEditorWidget` over one text model. On
  completion, `serializeSearchResultForEditor` writes every result as plain text: a `path:` line per
  file, then `  12: line text` per matching line, with one line per source line and match ranges as
  decorations. It does not stream into the editor: a progress bar runs while searching, and the model
  is replaced once in `onSearchComplete`. Syntax colour comes from the `search-result` grammar, which
  embeds 41 language grammars keyed by the path line. The editor's own virtualizer windows it.
- **Search view** (the sidebar): an object tree over `ListView`, every row 22 px
  (`SearchDelegate.ITEM_HEIGHT`), templates recycled, no editor per row, refreshed through an 80 ms
  `RunOnceScheduler` while results stream.

Neither mounts an editor per file. The sidebar model (fixed rows, recycled templates) is the one
Platform can reach without new Editor features: the one-editor model needs file headers inside the
editor, which the Editor has no block widgets for.

## 6. Ranked fixes

| #   | Fix                                                                | Expected win, from the measurements                                                                                                  | Size | Owner           |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------- |
| 1   | Memoise the tree-sitter client's language signature per descriptor | −359 ms of 2,241 ms (broad wheel-fast) and 774 MB of garbage; every editor open app-wide registers through it too                    | S    | Editor          |
| 2   | Record the scroll position without a layout read per scroll event  | −83 ms of 613 ms on the sidebar list's fling; the same listener runs on the search view                                              | S    | Platform search |
| 3   | Flat rows on `VirtualList` for the full view                       | Busy time toward the sidebar control: 613 ms against 2,059 ms, long tasks 16 → 0. Deletes about 1,700 lines. Fixes the 200-match cap | L    | Platform search |
| 4   | One syntax session per file block, per-line token cache kept       | Fewer worker round trips and registrations; part of 3                                                                                | S    | Platform search |
| 5   | One row per source line                                            | Up to 5× fewer rows on dense queries (`e`: 2.23 M matches on 448 k lines); VS Code's search editor does this                         | S    | Platform search |
| 6   | Selection without rebuilding every result item                     | Pathological arrow-nav: 175 ms in `result-items` plus 42 ms in the sidebar's `getMeasurements` over 20 presses                       | M    | Platform search |

Keeping an editor per file and fixing inside (real pooling across files, one syntax session per
block, an Editor mode that virtualizes against an outer scroller) is the alternative to 3. From the
split above it can remove the signature cost, part of the mount cost and the reopen churn, roughly
halving the busy time, but it still builds editor DOM for every file that scrolls in, and it needs
Editor-repo work that 3 does not.

## Outside this plan

- **Grammar wasm ships as JavaScript.** The production build (mesh release included) carries each
  tree-sitter grammar as a base64 data URL inside a JS chunk: TypeScript 1.9 MB, TSX 1.9 MB, SQL
  14.7 MB, with a single `.wasm` file in `assets/`. Base64 is a third larger than the binary, is
  parsed as a JS string, and cannot stream-compile. It is also what makes fix 1 expensive. Belongs
  with the bundle-shape work (Plan 129).
- **Nested ignored repositories search empty.** Opening `references/vscode` (ignored by Platform's
  `.gitignore`, but its own git repository) as the workspace, `import` returns 0 matches; `rg` in the
  same directory finds 151,110 lines. `apps/server/src/fs/search-gitignore.ts` says its matcher has to
  agree with `rg`. Observed, not diagnosed.

## Probes

`/work/tmp/research2/182/`: `research-search-view.ts` (the scenario), `analyze.ts` (phase split with
source maps), `run-matrix.sh` (tiers), `phases.sh` (counter table), `signature-bench.ts` (the
signature on a TypeScript-sized descriptor without its wasm: 4.3 µs; the wasm data URL makes it
~0.85 ms). The dev-build trace of the existing `visual-search-performance` scenario is
`/work/tmp/fregat-evidence/20260926T092717Z-trace-visual-search-performance` (wheel-scroll: 1,696 ms
busy over 1,912 ms, 14 long tasks, window and pool 10 ms). `renders` was not captured: the shared
dev server on 5173 stopped answering during the session; react-dom time in the production samples
stands in for it.
