# Plan 182: Search view rendering (research)

## Status and authorization

- Status: PROPOSED, a quick research plan. Requested 2026-09-26 (owner). Nothing here authorizes
  implementation; the output is a findings doc and a follow-up plan.
- Planned at: Platform `d5a901726`, 2026-09-26. Origin: the virtualizer discussion behind
  [Plan 181](181-chat-timeline-end-anchoring.md) and [Plan 178](178-tree-in-the-app.md).

## Owner direction

2026-09-26: the full search view renders too slowly and needs its own plan. It may end up back on
TanStack Virtual, but that is a finding to reach, not a starting point. The small search (the
sidebar results list) is not in scope: it already runs on `VirtualList`
(`features/search/components/results-view.tsx:173`) and moves with the rest of the app.

## Scope

The full search view, the editor-tab search surface: `components/result-editor-surface.tsx`,
`result-editor-virtual-window.tsx`, `result-file-editor-pool-slot.tsx`,
`hooks/use-result-editor-virtualizer.ts`, `state/result-virtual-window-store.ts` (its own windowing,
with velocity-based overscan and an injectable scheduler), `state/result-editor-pool.ts`,
`state/result-syntax-cache.ts`, `state/preview-budget.ts`, `utils/result-editor.ts`,
`utils/result-virtual-list.ts`. About 2,400 lines. Each visible file block mounts a pooled editor.

## What exists

- `docs/search-tab-performance-workstreams.md`: an analysis of one 2026-05-13 dev-mode trace
  (dropped frames, 58–216 ms tasks after streamed chunks), with workstreams A–H. Marked "needs
  update" since 2026-06-06; which workstreams landed is unknown.
- Scenarios: `visual-search-performance`, `visual-search-scroll-content`, `visual-search-drive`,
  `visual-search-headers`, `search-result-line-pick`, `search-type-delete`, `search-file-actions`.
  Feature map: `.agents/skills/verify-fregat/features/search.md`.
- `editor-fast-scroll` for the editor alone, as a control.

## Questions

1. **Where does the time go today?** `trace visual-search-performance` and
   `trace visual-search-scroll-content` on the production build, across three result sizes (a
   narrow query, a broad query, a pathological one like `e` over this repo). Split the time into
   stream ingestion and state rebuild, React commit, pooled editor mount and layout, syntax, and
   style recalc.
2. **Is windowing the bottleneck, or what it windows?** Compare the cost of the window store
   against the cost of the editors it mounts. If the editors dominate, a different virtualizer
   changes nothing.
3. **Which of the old workstreams landed?** Walk A–H against current code and mark each done,
   partly done, obsolete or open, with the evidence.
4. **Would `VirtualList` (TanStack 3.14.13, after Plan 181) serve here?** Only if question 2 says
   windowing matters. What it would need: variable file-block heights measured from editor line
   counts, velocity overscan, the pool hand-off.
5. **What does the fast reference do?** VS Code's search editor (`references/vscode`): how it
   windows results and whether it mounts a real editor per file.

## Deliverable

`docs/search-view-rendering-findings.md` with the traces (evidence directories named), answers to
the five questions, and a ranked list of fixes with expected wins. Then either a follow-up
implementation plan or a recorded "no action". The old workstreams doc is updated or deleted.

## Out of scope

The sidebar results list; the search backend (`/fs/search/events`) unless question 1 shows it
dominates; the editor's own line virtualizer.
