> [!IMPORTANT]
> **STATUS: 🟢 CURRENT (audited against the code 2026-08-21).** Every bullet below was checked against the implementation; sections 1-9 are Done. What remains is section 10's UI-level test coverage. (Reference paths repaired 2026-06-12: platform paths are repo-relative, VS Code paths point at the vendored `references/vscode/`, and `zed:` paths are upstream-relative — the zed checkout is not vendored; see https://github.com/zed-industries/zed.)

# Workspace Search Next Steps

This tracks the remaining work to bring the current provider/search-buffer implementation to Zed parity first. VS Code is a secondary reference for mature details, especially when Zed does not expose a behavior clearly or when we want additional polish after the Zed-shaped flow works.

Priority rule for every item:

1. Match Zed project search behavior first.
2. Use VS Code to fill gaps, validate edge cases, or improve polish after the Zed baseline is clear.
3. If Zed and VS Code differ, document the product choice before implementing the VS Code-shaped behavior.

## Current Local Implementation

- Shared contract: `packages/contracts/src/workspace-search.ts`
- Shared matcher and glob policy: `packages/contracts/src/workspace-search-match.ts`
- Server disk provider: `apps/server/src/fs/search.ts`
- Server tool runner (`fd`/`rg` spawn, tolerated-failure warnings): `apps/server/src/fs/search-tool-runner.ts`
- Server workspace path/metadata index: `apps/server/src/fs/workspace-index.ts`
- Server endpoint: `apps/server/src/fs/routes.ts` (`GET /fs/search/events`)
- Web SSE client: `apps/web/src/lib/workspace-search-client.ts`
- Web providers: `apps/web/src/features/search/utils/providers.ts`
- Search buffer state: `apps/web/src/features/search/state/buffer-state.tsx`
- Search runtime/batching: `apps/web/src/features/search/utils/buffer-runner.ts`
- Dirty overlay: `apps/web/src/features/search/hooks/use-run-dirty-buffer-overlay.ts`
- Virtualized results view: `apps/web/src/features/search/components/results-view.tsx`
- Result row display/highlighting: `apps/web/src/features/search/components/match-row.tsx`
- Match display window helper: `apps/web/src/features/search/utils/match-display.ts`
- Search editor tab surface: `apps/web/src/features/search/components/result-editor-surface.tsx`
- Sidebar controller: `apps/web/src/features/workspace/components/search-results.tsx`

## Settled Product Decisions

These were open questions in earlier revisions of this document. They are settled
by construction, and are recorded here so they are not reopened by accident.

- **Result tabs are live, not snapshots.** There is exactly one search buffer per
  workspace root, keyed `search-buffer:<root>`, and it tracks the active search.
  Multiple saved result tabs are therefore not supported and are not planned.
- **Open-buffer matches come before disk matches**, not merged into disk order.
  The composite provider searches dirty buffers first, then disk with the dirty
  paths suppressed.
- **One result row per match, not per line.** A line with several matches yields
  several rows; `rg` reports one submatch per match and we keep that granularity.
- **Multiline queries are an unsupported feature, not an error.** Content search
  is skipped and a `multiline-query-unsupported` warning is emitted; name search
  still runs.

## Behavior By Section

### 1. Separate Text Search From File Search

Zed and VS Code primarily treat workspace search as content search. For Zed-first parity, default workspace search should stay content-focused. Filename lookup should be a separate workflow in practice, or at least rendered as a file-level result rather than a fake line match.

Product choice: the sidebar workspace search is content-only. No filename-search workflow is planned.

Status: Done for the Zed-first sidebar baseline.

Completed:

- Sidebar workspace search issues content-only queries by default.
- Filename hits remain visually separate and do not inflate content match counts when lower-level callers enable name search.
- Name-only hits render as file-level rows instead of collapsible content groups.

References:

- `zed:crates/project/src/project_search.rs`
- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/match.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/fileMatch.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchResultsView.ts`

### 2. First-Class Search Modes

Workspace search now has first-class search options in the shared contract and in the sidebar/search-buffer flow.

Status: Done for the Zed-first sidebar/search-buffer baseline.

Completed:

- Added case-sensitive, regex, and whole-word options.
- Added include/exclude glob fields behind a compact filter toggle.
- Extended `WorkspaceSearchQuery` so providers receive the search mode and glob options.
- Exposed workspace search through `/fs/search/events`.
- Added server-side `rg`/`fd` option translation and matching fallback support.
- Added dirty open-buffer parity using the shared matcher.
- Kept search mode selections stable through reruns and cleared query text.
- Added focused tests for disk search, endpoint query parsing, URL serialization, open-buffer parity, and search-buffer option state.

References:

- `zed:crates/search/src/project_search.rs`
- `zed:crates/project/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/common/constants.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchView.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchWidget.ts`

### 3. Replace In Files

Workspace search now has Zed-shaped replace support in the sidebar/search-buffer flow. Cached/open editor sessions are edited in memory and marked dirty; unopened clean files are patched through the existing file-write path with mtime checks.

Status: Done for the Zed-first sidebar/search-buffer baseline.

Completed:

- Added replace text, visibility, status, and summary/error state to search buffers.
- Added replace controls to the sidebar and search-buffer editor.
- Added replace-next, per-match, per-file, and replace-all actions.
- Added a client-side planner for literal and regex replacement, including capture groups.
- Validates each search match against current file/session text before editing.
- Applies cached/open-file replacements through editor document sessions and dirty tracking.
- Applies unopened-file replacements through fetch, validated patching, and `/fs/write` with mtime checks.
- Reruns the active search after successful replace so stale matches disappear.
- Surfaces concise summaries for skipped matches, failed files, and partial replace results.
- Added focused tests for replace planning, replace runner behavior, and replace state persistence.

References:

- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/match.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/fileMatch.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/replace.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/media/searchview.css`

### 4. Result Tree Semantics

Workspace search now has editor-grade result tree semantics for the grouped, virtualized React result list. It keeps Zed-shaped active match navigation and collapse behavior as the baseline, with VS Code-shaped ARIA tree semantics and row labels for accessibility.

Status: Done for the Zed-first sidebar/search-buffer baseline.

Completed:

- Added stable result row IDs for file groups, content matches, and filename-only rows.
- Added active result state shared by the sidebar and search-buffer editor.
- Added collapse-all and expand-all result controls.
- Preserved and pruned collapse state across reruns when file paths remain present.
- Added previous/next match navigation with wrapping and collapsed-parent reveal.
- Added local keyboard navigation for visible result rows.
- Added ARIA `tree` / `treeitem` roles with level, selected, expanded, and active descendant state.
- Added richer summary counts for total matches, file count, and active match index.
- Added focused tests for row ID stability, collapse state, active selection, navigation wrapping, hidden-match reveal, and keyboard helper semantics.

References:

- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchResultsView.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/searchTreeCommon.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/searchResult.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/folderMatch.ts`
- `references/vscode/src/vs/workbench/contrib/search/common/constants.ts`

### 5. Search Result Editor Fidelity

Zed renders project search results as an editor-like multibuffer with excerpts. Our search-buffer tabs render results through real editor instances.

Product choice: keep the sidebar as the compact result tree, and render search-buffer tabs as readonly editor-backed virtual result documents.

Status: Done for the Zed-first search-buffer tab baseline.

Completed:

- Search-buffer tabs render grouped results as readonly virtual editor documents when matches exist.
- File headers and excerpt lines are generated from structured search state with source mappings back to paths and matches.
- Active search result state syncs with the editor cursor and selection, including reveal of the current match.
- Enter opens the source file or match for the current generated line.
- Editor find and native selection/copy behavior are available inside result tabs.
- Destructive edit keybindings and text input are blocked for the generated result document.

Status: Done. The structured result editor shipped (the refactor plan was deleted
in `a92f810`); result files render through a pooled editor with a virtual window.
"Live vs snapshot" and "multiple saved tabs" are answered under Settled Product
Decisions above.

Optional polish, not blocking:

- Richer multibuffer styling for file headers and excerpts if the plain text projection ever feels too flat.

References:

- `zed:crates/search/src/project_search.rs`
- `zed:crates/project/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchResultsView.ts`

### 6. Ordering, Batching, And Limits

Ordering, limits, and progress reporting now follow Zed’s shape, with VS Code’s count presentation.

Status: Done.

Completed:

- Stable file ordering while streaming, through `compareSearchPaths` (natural
  ordering with ASCII fast paths and bounded caches).
- Open-buffer matches come before disk matches; see Settled Product Decisions.
- Both limits are tracked: `search.maxResults` bounds matches and
  `search.maxResultFiles` bounds distinct files. The file budget is spent once
  across dirty buffers and disk, and tripping it emits a `file-limit-reached`
  warning. The `done` event reports `fileCount`.
- Partial-result warnings arrive as their own event and attach to the run, so
  results stay on screen (section 8).
- Per-provider timing lands in `WorkspaceSearchMeasurement`: per-provider
  duration, first-result latency, result count, stat count and duration, plus
  workspace-index readiness and fallback reason.

References:

- `zed:crates/project/src/project_search.rs`
- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/searchResult.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/textSearchHeading.ts`

### 7. Dirty Buffer Overlay Robustness

The dirty overlay scans dirty cached editor text and suppresses stale disk content hits for the same path, following Zed’s project-search/open-buffer behavior.

Status: Done.

Completed:

- A path that stops being dirty invalidates the overlay. The client-only overlay
  replays the previous disk run's matches for non-dirty paths, which is only
  sound while the dirty set grows; once a path leaves it — saved, renamed away,
  or deleted — what is on disk there is unknown, so the disk search re-runs
  instead (`utils/dirty-overlay-refresh.ts`).
- Match range correctness: `rg` reports submatch offsets in UTF-8 bytes and the
  server converts them to JS string indices, so multibyte lines highlight
  correctly. CRLF, long-line preview anchoring, and Unicode are covered by tests.
- Disk and open-buffer providers already share preview and range semantics: both
  build matches through `workspaceSearchPreview` and the same
  `createWorkspaceSearchMatcher`. A separate snapshot contract would add a layer
  without changing behavior.

References:

- `zed:crates/project/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/fileMatch.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/match.ts`

### 8. Error And Warning Model

A tolerated `rg` exit code `2` is partial success, and the product model now reports it. Zed is the behavioral baseline, with VS Code’s wording for the secondary distinctions.

Status: Done.

Completed:

- `WorkspaceSearchEvent` has a `warning` variant carrying `code`, `message`, and
  an optional `detail`. Codes: `content-tool-partial-failure`,
  `file-limit-reached`, `multiline-query-unsupported`.
- A tolerated `rg` exit (code 2 — it printed matches _and_ failed to read part of
  the tree) reaches the user instead of only the server log. Previously this was
  logged and dropped, so a partial result set was reported as a complete one.
- Warnings render on the summary line next to the counts they qualify, in the
  `warning` token, with the full text and any stderr tail in the row title. The
  empty state carries the warning too, so a zero-result partial run explains
  itself. One warning per code per run.
- Prior results survive a fatal error, with `"<error> · Showing previous results"`.
- All five states are distinct: cancellation (aborted run, no state change),
  no results (`No matches`), truncated (`N shown, limit reached`), partial
  (warning next to the counts), and hard failure (error status).
- Warnings ride the run: they are cleared when a new search starts, and are
  persisted with cached results, because cached matches from a partial run are
  still partial.

References:

- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchView.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/searchModel.ts`

### 9. Preview And Highlight Fidelity

Previews carry `previewStartColumn` and match-centred display windows, matching Zed’s excerpt display with VS Code’s range/highlight detail.

Status: Done.

Completed:

- Preview carries full text plus `previewStartColumn`, so a match-centred window
  keeps exact ranges.
- One row per match; see Settled Product Decisions.
- Multiline queries degrade to a warning rather than an error (section 8).
- The active match is distinct from passive matches on both surfaces, and both
  paint from the same `--search-result-match*` tokens.
- High-contrast safe: the tokens remap to system `Highlight`/`HighlightText`
  under `@media (forced-colors: active)`, where every background collapses to one
  color — so the active match also carries an underline, which survives.

References:

- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/match.ts`
- `references/vscode/src/vs/workbench/contrib/search/browser/media/searchview.css`

### 10. Test Coverage Still Needed

Tests verify Zed-first behavior before adding VS Code-specific parity cases.

Status: Mostly done. This is the only section with open work.

Covered:

- Virtualization and result windowing (`search-result-virtual-list`,
  `search-result-virtual-window-store`, `search-result-editor-pool`).
- Shared state across the editor surface and sidebar (`search-buffer-state`,
  `use-search-buffer`).
- Keyboard navigation and collapse behavior.
- Include/exclude globs, on the server and both client providers.
- Regex, case, and whole-word parity across disk and open-buffer providers.
- Partial `rg` failures, both as a unit test of the tool runner's warning sink
  and end-to-end against real `rg` over an unreadable directory (skipped when
  running as root, where the failure cannot be produced).
- Dirty buffers that are saved, renamed away, or deleted.
- File-limit behavior, including that a file already inside the budget keeps all
  of its matches.

Still open:

- Real-browser smoke tests for very large result sets, where virtualization and
  paint cost are the thing under test rather than the view model.

References:

- `zed:crates/search/src/project_search.rs`
- `references/vscode/src/vs/workbench/contrib/search/test/browser/searchModel.test.ts`
- `references/vscode/src/vs/workbench/contrib/search/test/browser/searchNotebookHelpers.test.ts`
