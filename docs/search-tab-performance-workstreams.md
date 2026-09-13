> [!IMPORTANT]
> **STATUS: 🟡 NEEDS UPDATE (reviewed 2026-06-06).** Tied to a one-off 2026-05-13 trace; mark what was addressed. (File paths repaired 2026-06-12: platform paths are repo-relative.)

# Search Tab Performance Workstreams

## Source Trace

- Trace file: `/Users/shaul/Downloads/Trace-20260513T172814.json`
- Captured: `2026-05-13T14:28:14.492Z`
- Breadcrumb window: `12.28s`
- App target in trace: `localhost:5173` web app with `localhost:3001` server
- Workspace searched: the platform repo root (at its pre-move location)
- Main observed query path: `/fs/search/events`

Important caveat: this trace was captured in Vite/dev mode with React DevTools instrumentation. Absolute timings are inflated, but the repeated bottleneck shape is clear enough to plan work.

## Executive Summary

The search tab bottleneck is primarily frontend result rendering after streamed search events arrive. The search endpoint itself is not the dominant issue in this trace.

Observed request timings:

| Query   | Case sensitive |  Duration | Chunks |  Payload |
| ------- | -------------- | --------: | -----: | -------: |
| `const` | true           | `174.8ms` |     18 | `14.5KB` |
| `const` | false          | `286.7ms` |     27 | `54.0KB` |
| `c`     | false          | `343.9ms` |     32 | `18.9KB` |
| `co`    | false          | `256.4ms` |     46 | `54.2KB` |
| `con`   | false          | `160.0ms` |     40 | `53.8KB` |
| `cons`  | false          | `266.3ms` |     27 | `59.7KB` |
| `const` | false          | `142.8ms` |     43 | `54.3KB` |

UI symptoms:

- `119` dropped frames in the trace window.
- Search-result updates line up with `58ms` to `216ms` main-thread tasks.
- React commits are clustered around streamed result chunks and query changes.
- Result editor rows trigger editor layout, gutter/plugin, text measurement, and DOM cleanup work.

## Current Hot Spots

### 1. Streamed Search Batches Trigger Too Many UI Commits

Files:

- `apps/web/src/features/search/use-search-buffer.ts`
- `apps/web/src/features/search/search-buffer-state.tsx`

Current behavior:

- `SEARCH_BATCH_SIZE = 50`
- `SEARCH_BATCH_MS = 24`
- Each flush calls `appendEvents`, then rebuilds snapshot state.
- Each append causes `matches`, grouped results, result rows, and editor view models to become new references.

Trace evidence:

- Main-thread long tasks occur immediately after `/fs/search/events` chunks and completions.
- React profiler repeatedly reports `groups` and `matches` as referentially unequal, sometimes deeply equal.

### 2. Search Result Editor Surface Is Expensive During Loading

Files:

- `apps/web/src/components/workspace/search/components/` (formerly `features/search/search-buffer-editor.tsx`)
- `apps/web/src/features/search/search-result-editor-surface.tsx`
- `packages/editor-react/src/index.ts`
- `packages/editor-core/src/editor/Editor.ts`
- `packages/editor-core/src/plugins.ts`
- `packages/editor-core/src/virtualization/virtualizedTextViewRows.ts`

Current behavior:

- Search tabs switch to `SearchResultEditorSurface` as soon as groups exist.
- The surface builds file blocks, virtual rows, editor pool slots, editor documents, range decorations, line gutters, find plugins, and optional syntax plugins.
- Pool slots keep hidden editor instances mounted.
- When the same file receives more streamed matches, the file block/editor document can be recreated, which can reload syntax/search highlights for excerpts that were already rendered.
- `SearchResultFileEditor` gives `EditorHost` a document revision based on generated excerpt text. When TS-heavy result text changes on every query or streamed append, `@singapore-editor/react` treats it as a new document revision and calls `openDocument`, which tears down and recreates syntax/highlighter sessions.

Trace evidence:

- CPU profile repeatedly points at React layout effects, `Editor.setPlugins`, `syncPlugins`, `setGutterContributions`, row reconcile/remove, and editor text metrics.
- `SearchResultEditorSurface`, `SearchResultDocumentBoundary`, `SearchResultFileEditorPoolSlot`, and `SearchResultFileEditor` appear repeatedly in React profiler markers.
- TS-heavy result sets are worse than Markdown-heavy result sets because TypeScript syntax/highlight sessions are more expensive to rebuild, so the full reload is more visible on every keystroke.

### 3. Per-Row Width Measurement Adds Layout Pressure

Files:

- `apps/web/src/features/search/search-results-view.tsx`
- `apps/web/src/features/search/search-match-row.tsx`
- `packages/editor-core/src/virtualization/browserMetrics.ts`

Current behavior:

- The result list measures container width and match row preview width via `clientWidth` and `ResizeObserver`.
- Editor text metrics build cache keys by reading computed styles and measuring probes.

Trace evidence:

- CPU profile self time includes `get clientWidth`, `browserTextMetricsCacheKey`, and `measureBrowserTextMetrics`.
- React layout effects are a major inclusive cost.

### 4. Referential Instability Keeps Components Updating

Files:

- `apps/web/src/components/workspace/search/components/` (formerly `features/search/search-buffer-editor.tsx`)
- `apps/web/src/features/search/search-results-view.tsx`
- `apps/web/src/features/search/search-result-items.ts`
- `apps/web/src/features/search/search-result-view-model.ts`
- `apps/web/src/features/search/search-buffer-state.tsx`

Current behavior:

- Group arrays, match arrays, row items, option objects, callbacks, and fallback elements are recreated frequently.
- `resetKey` changes with `snapshot.matches.length`, which can force boundary reset behavior during streaming.

Trace evidence:

- React profiler flags `groups`, `matches`, `options`, handlers, `fallback`, `resetKey`, and `children` as referentially unequal.
- `SearchResultsView` total React timing was one of the largest named component totals.

### 5. Measurement Is Not Yet Product-Representative

Files:

- `apps/web/src/features/search/search-result-editor-surface.perf-entry.tsx`
- `package.json`
- `apps/web/package.json`

Current state:

- The trace is useful for direction, but it is dev-mode and includes React DevTools overhead.
- We need repeatable profiling fixtures to validate improvements.

Trace evidence:

- CPU profile includes React DevTools extension work such as `measureHostInstance`.
- Initial profiler startup contributes noise at the beginning of the trace.

## Parallel Workstreams

These workstreams are designed so different people can work in parallel with low merge-conflict risk. Each stream should land with focused tests or profiling evidence.

### Workstream A: Search Event Batching And Scheduling

Goal: reduce React commit frequency while preserving streamed feedback.

Owner write scope:

- `apps/web/src/features/search/use-search-buffer.ts`
- `apps/web/src/features/search/tests/search-buffer-state.test.ts`

Tasks:

1. [x] Replace fixed `50 events / 24ms` flushing with frame-aware or adaptive batching.
2. Consider flushing at most once per animation frame while loading.
3. Flush immediately for terminal events (`done`, `error`) after pending matches are appended.
4. Keep first-results latency reasonable, possibly with a small first batch and larger later batches.
5. Add tests that prove match events are batched, terminal events flush pending matches, and aborted runs do not commit stale batches.

Acceptance criteria:

- For a 200-match streamed search, commit count is materially lower than today.
- First visible results still appear quickly.
- No stale results appear after typing a new query.
- Existing search-buffer tests pass.

Risks:

- Too-large batches can make search feel frozen.
- Terminal event ordering must remain correct.

### Workstream B: Incremental Search State And Stable Group References

Goal: stop rebuilding all derived result objects on every append.

Owner write scope:

- `apps/web/src/features/search/search-buffer-state.tsx`
- `apps/web/src/features/search/search-result-items.ts`
- `apps/web/src/features/search/tests/search-buffer-state.test.ts`

Tasks:

1. [x] Investigate storing grouped results or a path index in search state instead of deriving all groups from `matches` on every render.
2. [x] Preserve existing group object references when a streamed batch appends to other files.
3. [x] Preserve the existing group object and existing match object identities when a streamed batch appends more matches to the same file.
4. [x] Avoid deeply equal but referentially new `matches` arrays for unchanged file groups.
5. [x] Expose enough stable per-file identity that the result editor can distinguish "same file with appended excerpts" from "new file/document".
6. [x] Keep collapse pruning, active result resolution, replace actions, and navigation semantics intact.

Acceptance criteria:

- Appending matches to one file does not replace every existing group object.
- Appending matches to one file keeps already-rendered matches for that file referentially stable.
- React profiler no longer reports broad deeply-equal `groups[*].matches` churn.
- Existing result navigation and collapse tests pass.

Risks:

- Search state is central; this can affect replace, active result navigation, and collapse state.
- Coordinate with Workstream A to avoid duplicating batching logic.

### Workstream C: Lightweight Loading Surface For Search Tabs

Goal: avoid mounting heavy editor-backed result rows for every streamed update while search is still loading.

Owner write scope:

- `apps/web/src/components/workspace/search/components/` (formerly `features/search/search-buffer-editor.tsx`)
- `apps/web/src/features/search/search-result-editor-surface.tsx`
- `apps/web/src/features/search/search-result-editor-surface.perf-entry.tsx`

Tasks:

1. [x] Decide whether search tabs should render the lightweight `SearchResultsView` while status is `loading`, then switch to `SearchResultEditorSurface` when ready. Decision: keep search tabs on the editor-backed `SearchResultEditorSurface` while loading.
2. Alternatively, keep `SearchResultEditorSurface` mounted but render file headers and plain preview rows until the result set is stable.
3. [x] Remove `snapshot.matches.length` from `SearchResultDocumentBoundary` reset keys if it causes avoidable boundary churn during streaming.
4. [x] Defer spare hidden editor pool slot creation until results are ready while keeping visible result editors mounted.
5. [x] Add perf fixture coverage for loading-state result streaming.

Acceptance criteria:

- Streaming updates no longer mount or update editor instances for every batch.
- The search tab remains usable while loading.
- Ready-state structured editor behavior remains intact.
- The fallback list still works if the structured editor errors.

Risks:

- Switching surfaces can cause scroll/focus jumps.
- Product behavior should stay clear: loading and ready states should not feel like different products.

### Workstream D: Editor Plugin And Gutter Deferral

Goal: reduce editor-core work for readonly search result excerpts.

Owner write scope:

- `apps/web/src/features/search/search-result-editor-surface.tsx`
- `packages/editor-core/src/editor/Editor.ts`
- `packages/editor-core/src/editor/pluginLifecycle.test.ts`
- `packages/editor-core/src/plugins.ts`
- `packages/editor-core/src/virtualization/virtualizedTextViewRows.ts`
- `packages/editor-gutters/src/lineGutter.ts`

Tasks:

1. [x] Audit why `setPlugins`, `syncPlugins`, `setGutterContributions`, and gutter row removal run so often. Initial finding: streamed appends recreated the search source-line gutter plugin because its row label closure captured each rebuilt file document; `syncText` also sent full-document replacement edits to editor sessions.
2. [x] Ensure plugin arrays and gutter plugin instances stay stable when file identity and options are unchanged.
3. [x] Preserve syntax highlight sessions for the same file/language when streamed batches only append new excerpts.
4. [x] Update range decorations incrementally where possible so existing match highlights are not torn down and recreated. `Editor.applyRangeDecorations` now diffs semantic highlight groups and clears only stale names, so appended/moved same-style highlights update the existing registry entry.
5. [x] Consider a cheaper source-line display path for search result excerpts that does not use full gutter plugin lifecycle. Decision: keep the visible source-line gutter for selection/open fidelity, but remove gutter, range decoration, syntax, and find plugin work from hidden pool slots until they become visible.
6. [x] Keep syntax and find plugins disabled until idle, ready, or explicit editor focus. Loading search surfaces use manual deferred mode; visible editors can enable plugins on focus/pointer activation, and hidden slots remain plain document prewarms.
7. [x] Reduce hidden editor pool slot churn. Hidden slots now prewarm only the document/editor host and avoid range highlight, gutter, syntax, and find plugin churn while offscreen.

Acceptance criteria:

- Profiling shows less time in `Editor.setPlugins`, `syncPlugins`, gutter contribution updates, and row removal.
- When `rg` yields additional matches for the same file, existing rendered excerpts keep their syntax/search highlights and only new excerpt rows do incremental work.
- Search result excerpt selection/open behavior remains correct.
- No regressions in normal editor tabs.

Risks:

- Editor-core changes can affect unrelated editor surfaces.
- Keep editor-core changes small and covered by tests or targeted manual verification.

### Workstream H: Same-File Incremental Editor Updates

Goal: stop treating same-file search result excerpt changes as full editor document reloads.

Owner write scope:

- `apps/web/src/features/search/search-result-editor-surface.tsx`
- `apps/web/src/features/search/search-result-view-model.ts`
- `packages/editor-react/src/index.ts`
- `packages/editor-core/src/editor/Editor.ts`
- `packages/editor-tree-sitter/src/session.ts`

Tasks:

1. Confirm the reload path: `SearchResultFileEditor` changes `document.revision`, `@singapore-editor/react` recomputes `documentKey`, then `syncDocument` calls `editor.openDocument`.
2. Keep the same editor document/session alive when the path/language/document identity is unchanged and only the generated excerpt text changes.
3. Prefer an incremental text update path that lets tree-sitter apply edits instead of disposing the syntax session.
4. Keep document identity stable by file path and result mode; do not include match count or generated text hash in the identity.
5. Treat query changes and same-file appended matches differently:
   - Same file plus appended excerpts should update the existing session incrementally.
   - Different file/language should still open a new document.
6. Add a TS-heavy perf fixture where the query changes repeatedly and results remain mostly in the same `.ts` files.

Acceptance criteria:

- Typing through a TS-heavy search no longer fully reloads syntax/highlights for every visible same-file result editor.
- Existing TS excerpts keep syntax/search highlights when new matches append to the same file.
- Tree-sitter uses `applyChange`/incremental edit for same-document result updates where possible.
- Markdown behavior stays at least as good as today.
- No normal editor document sync regression.

Risks:

- The React editor adapter currently keys controlled documents by `documentId`, `documentMode`, `revision`, and session identity. Changing this needs care so normal file editors still refresh correctly.
- Search result documents are generated readonly documents, so they may need a dedicated "controlled generated document can update incrementally" path rather than changing all editor sync semantics.

### Workstream E: Remove Per-Row Layout Measurement

Goal: eliminate `clientWidth` and `ResizeObserver` per visible row in search results.

Owner write scope:

- `apps/web/src/features/search/search-results-view.tsx`
- `apps/web/src/features/search/search-match-row.tsx`
- `apps/web/src/features/search/search-match-display.ts`

Tasks:

1. Replace per-row `useMeasuredPreviewMaxLength` with a parent-level width or fixed max preview model.
2. Prefer CSS truncation where exact preview character count is not necessary.
3. If replacement previews require length control, compute one max length per list width and pass it down.
4. Ensure open-buffer `unsaved` badge and replace button still fit.
5. Add tests for preview window logic if the match display helper changes.

Acceptance criteria:

- No per-row `ResizeObserver` for search match previews.
- No visible preview regressions in compact and wide layouts.
- Profiling shows less layout-effect and `clientWidth` activity.

Risks:

- Preview text may become less centered around the match if width handling is too crude.
- Verify narrow sidebar and wide search-tab layouts separately.

### Workstream F: Profiling Harness And Regression Budget

Goal: make performance improvements measurable and repeatable.

Owner write scope:

- `apps/web/src/features/search/search-result-editor-surface.perf-entry.tsx`
- `scripts`
- `package.json`
- `docs`

Tasks:

1. Add or document a production-mode profiling workflow for the search tab.
2. Disable React DevTools during the baseline run.
3. Capture standard scenarios:
   - first query from empty state
   - typing `c` -> `co` -> `con` -> `cons` -> `const`
   - toggling case-sensitive
   - selecting results while loading
   - ready-state scroll through 200 matches
4. Track metrics:
   - dropped frames
   - number of long tasks over `50ms`
   - worst main-thread task
   - search request duration
   - React commits during one search
   - time to first result
   - time to ready state
5. Save before/after traces or summaries in a consistent place.

Acceptance criteria:

- Each performance PR can compare against a repeatable baseline.
- Dev-mode and prod-mode numbers are clearly separated.
- The team has a simple checklist for validating regressions.

Risks:

- Browser trace automation can be flaky.
- Do not block implementation on perfect automation; a documented manual workflow is enough for the first pass.

### Workstream G: Backend Search Sanity Check

Goal: confirm backend search is not hiding a second-order issue.

Owner write scope:

- `apps/server/src/fs/search.ts`
- `apps/server/src/app.ts`
- `apps/web/src/features/search/search-providers.ts`
- `packages/contracts/src/workspace-search.ts`

Tasks:

1. Add server-side timing/progress logging behind a dev flag or trace event if appropriate.
2. Check whether `/fs/search/events` chunks can be coalesced server-side without hurting first-result latency.
3. Confirm abort behavior cancels `rg` promptly when the query changes.
4. Confirm payload size is not inflated by unnecessary preview data.
5. Keep this lower priority unless a production trace shows network/backend time dominating.

Acceptance criteria:

- Query changes abort stale work quickly.
- Event payloads contain only data used by the UI.
- Server timings can explain request duration when needed.

Risks:

- Backend changes will not solve the main frontend long tasks by themselves.
- Coordinate event-shape changes with Workstreams A and B.

## Suggested Delegation Plan

Parallel round 1:

- Person 1: Workstream A
- Person 2: Workstream E
- Person 3: Workstream F
- Person 4: Workstream C design spike, without broad editor-core edits
- Person 5: Workstream G quick sanity check

Parallel round 2:

- Person 1: Workstream B after Workstream A decides batch semantics
- Person 2: Workstream D after Workstream C identifies which editor work remains during loading
- Person 3: Workstream H, using TS-heavy searches as the primary benchmark
- Person 4: Re-profile and compare before/after traces

Coordination points:

- Workstreams A and B both touch search state update behavior.
- Workstreams C and D both touch the structured editor surface.
- Workstreams D and H both touch syntax/highlight lifecycle; H owns document/session reload behavior, D owns plugin/gutter lifecycle.
- Workstream F should define the measurement format before other streams report wins.
- Workstream G should not change event contracts without talking to A and B.

## Target Performance Budget

Initial budget for the search tab:

- No long task over `100ms` for a 200-result search in production mode.
- Fewer than `3` long tasks over `50ms` during a single query completion.
- First visible result under `150ms` after the server emits the first match batch.
- Ready-state rendering should not drop a visible sequence of frames.
- Typing into the search input should keep input event handling under one frame budget for common queries.

These are starting targets, not final product SLAs. Update them after the first production-mode baseline.

## Verification Checklist

Run after each workstream:

1. Search for `const` in the platform repo root.
2. Type through `c`, `co`, `con`, `cons`, `const`.
3. Toggle case-sensitive, regex, whole-word, and filters.
4. Select next/previous match while results are loading.
5. Collapse and expand result groups.
6. Open a result into the editor.
7. Run replace-next and replace-all smoke checks if the touched code can affect replace.
8. Capture a new trace or at least record dropped frames and long tasks.
9. Repeat the typing scenario with a TS-heavy result set and confirm visible highlights do not fully reload on every keystroke.

Likely test commands:

```sh
bun test apps/web/src/features/search
bun test apps/server/src/fs
```

Use the repo's actual package scripts if they differ for the current branch.

## Open Product Questions

- Should search tabs show live streaming results, or should they show a lightweight loading list and only switch to the editor surface when ready?
- Should search tabs preserve a snapshot of results, or always mirror the latest active search?
- Is syntax highlighting required during loading, or only after user focus / idle / ready?
- Is exact preview truncation worth layout measurement cost, or is CSS truncation good enough?

## Definition Of Done For The Whole Effort

- A production-mode trace confirms the frontend long-task clusters are reduced.
- Search input remains responsive while typing common queries.
- Streaming still provides useful early feedback.
- Structured search result tabs retain keyboard navigation, open-result behavior, collapse/expand, and replace controls.
- Tests cover batching, state stability, active result behavior, and any editor-core changes.
