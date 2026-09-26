# Plan 182: Search view rendering

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — the per-file editors are the cost (windowing is 3 ms of
  2,059 ms); fix is flat rows on `VirtualList`, plus an Editor signature memo and a scroll-listener
  fix. Findings: [docs/search-view-rendering-findings.md](../docs/search-view-rendering-findings.md).
  Implementation waits on the owner questions below; nothing here authorizes it yet.
- Planned at: Platform `d5a901726`, 2026-09-26. Researched at Platform `c130dd35a`, Editor `74e76be`.
  Origin: the virtualizer discussion behind [Plan 181](181-chat-timeline-end-anchoring.md) and
  [Plan 178](178-tree-in-the-app.md).

## Owner direction

2026-09-26: the full search view renders too slowly and needs its own plan. It may end up back on
TanStack Virtual, but that is a finding to reach, not a starting point. The small search (the
sidebar results list) is not in scope: it already runs on `VirtualList`
(`features/search/components/results-view.tsx:173`) and moves with the rest of the app.

## Scope

The full search view, the editor-tab search surface: `components/result-editor-surface.tsx`,
`result-editor-virtual-window.tsx`, `result-file-editor-pool-slot.tsx`, `result-file-editor.tsx`,
`hooks/use-result-editor-virtualizer.ts`, `state/result-virtual-window-store.ts`,
`state/result-editor-pool.ts`, `state/result-syntax-cache.ts`, `utils/result-editor.ts`,
`utils/result-virtual-list.ts`, `utils/result-syntax-plugin.ts`. About 2,800 lines of product code.

## Findings

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

## Decisions

- Decided 2026-09-26: research recommendation. The per-file excerpt cap goes (whatever the owner picks
  for Q1): a file's matches are all reachable. Why: it hides results the summary counts.
- Decided 2026-09-26: research recommendation. Results keep streaming into the open view. Why: the
  streamed retype costs 43–122 ms of stream state, and VS Code's write-once model would show nothing
  until a 20,000-match search completes.
- Decided 2026-09-26: research recommendation. The custom window store, velocity overscan, injectable
  scheduler and editor pool are deleted, not ported to TanStack. Why: with flat rows the sidebar list
  runs the same fling on default overscan with no long task.
- Decided 2026-09-26: research recommendation. Sticky file headers are not part of this plan; they
  come from Plan 178's sticky chain, which names the search results as its first adopter outside the
  tree.
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

**Q2. One row per match or one row per source line?**

- A. One row per match (today): a line with four matches appears four times.
- B. One row per source line, every match on it highlighted. Next and Previous still step through
  matches, and the active match is underlined within its line.

**Recommendation: B.** VS Code's search editor does this, and on dense queries it cuts the rows up to
fivefold with no information lost.

Decided 2026-09-26: owner — B.

## Proposed phases

Phases 1 and 2 stand whatever Q1 decides. Phases 3–5 assume Q1 = A; with Q1 = B, replace 3 with
the B work listed under Q1 and keep 4–5.

1. **Grammar signature memo** (S, Editor repo: `packages/tree-sitter/src/treeSitter/workerClient.ts`).
   Compute `languageDescriptorSignature` once per descriptor object (a `WeakMap`), and leave `wasmUrl`
   out of the string in favour of an identity check. Test: registering the same descriptor twice
   stringifies once. Proof: the probe's signature counters fall to one call per language, and
   `trace` on the broad fling drops by about 360 ms. Rebuild Editor dist, redeploy.
2. **Scroll position without a layout read** (S, Platform: `features/search/state/result-scroll-state.ts`,
   `hooks/use-result-scroll-position.ts`). Remember the scroll top from the scroll event without
   reading layout (coalesce to one read per frame, or take the offset the virtualizer already has), and
   find the anchor row by binary search. Both surfaces use it. Proof: `trace` of the sidebar fling
   loses the 83 ms; `search-type-delete` and `visual-search-performance` still restore position.
3. **Flat rows** (L, Platform search feature; can land as 3a and 3b).
   - 3a (M). Row model and rows: `utils/result-view-model.ts` produces header rows and one row per
     excerpt line with a fixed height; a line row component (`ListRow`, source line cell,
     highlighted text, `SearchResultFileLineActions` as a cell); tokens come from
     `state/result-syntax-cache.ts`, tokenized once per file block (the block's lines joined, one
     session per block and language, per-line cache kept), painted as spans with the token styles.
     Text renders at once and colours arrive without moving anything.
   - 3b (M). Swap the surface: the search editor tab renders the rows through `VirtualList` with
     `useListbox`, the existing keyboard map (`utils/result-editor-keyboard.ts`), file menu, active
     reveal and scroll restore. Delete `result-editor-surface.tsx`, `result-editor-virtual-window.tsx`,
     `result-file-editor-pool-slot.tsx`, `result-file-editor.tsx`, `result-source-line-gutter.tsx`,
     `use-result-editor-virtualizer.ts`, `use-result-file-editor-pool-entries.ts`,
     `result-virtual-window-store.ts`, `result-editor-pool.ts`, `result-virtual-list.ts`,
     `result-syntax-plugin.ts`, the line-window half of `result-editor.ts`, and their tests. The
     200-excerpt cap goes with them. Update `visual-search-*`, `search-result-line-pick` and
     `search-file-actions` (their selectors name editor hosts and rows), `scripts/agent/selectors.ts`
     and `.agents/skills/verify-fregat/features/search.md`.
   - Add the probe as a committed scenario, `visual-search-tiers`: the three tiers of the findings doc
     (`useSettingValue`/`createError`, `export function`/`useState`, `e`/`a`), each with retype,
     wheel-fast, wheel-reading, jump, sidebar control and arrow phases and the mount counter. Proof:
     `trace visual-search-tiers --compare` against the baseline; no task over 50 ms in wheel-fast on the
     broad tier.
4. **One row per line** (S, if Q2 = B; `utils/result-view-model.ts`, `utils/result-items.ts`).
   Group a file's matches by source line; the row carries every range; navigation still steps by
   match. Proof: pathological row count and the `search-result-line-pick` scenario.
5. **Selection without a full rebuild** (M, shared search state: `state/buffer-state.tsx`
   `selectResult`, `utils/result-items.ts`). Moving the active result recomputes every result item:
   175 ms over 20 ArrowDown presses on the pathological set, plus 42 ms in the sidebar's
   `getMeasurements`. Keep an id→index map per result set and update only the active id. Proof:
   `trace` of the arrow phase.

Outside this plan, recorded in the findings: grammar wasm ships as base64 inside JS chunks (bundle
shape, Plan 129's lane), and a workspace opened at a nested ignored repository searches empty.

## Verification

- Before and after each phase: `trace` of the probe tiers on a production build (recipe in the
  findings doc: `vite build --base /` into `/work/tmp`, `apps/server` with `WEB_ROOT` and a throwaway
  `PLATFORM_HOME` on a spare port, `agent:browser --url http://127.0.0.1:<port>/`).
- `renders` on the dev server for the broad tier (not captured during research; the shared dev server
  was down).
- `look` at the search editor in both densities and a light and a dark palette after Phase 3, and
  read the screenshots back.
- Unit tests that survive: `search-result-view-model.test.ts`, `search-result-scroll-state.test.tsx`,
  `result-tree-keyboard.test.ts`, `search-result-editor-utils.test.ts` (the parts that remain).

## Out of scope

The sidebar results list (except Phase 2's shared listener and Phase 5's shared state); the search
backend (`/fs/search/events`), which answers in under 300 ms; the editor's own line virtualizer.
