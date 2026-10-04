# Plan 235: Complete search commands across project, buffer and chat widgets

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-16, size L. Depends on Plan 207, Plan 204, Plan 206, Plan 220, Plan 233.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Focus search, recall queries, set filters and replace, scope a directory or run a search in a new tab.

## Zed actions and behavior

### Scope and deployment

`buffer_search::UseSelectionForFind`, `pane::DeploySearch`, `project_panel::NewSearchInDirectory`, `project_search::SearchInNew`, `project_search::OpenTextFinder`.

Zed seeds buffer find from selection while retaining editor focus, deploys pane find, scopes a directory, runs a query in a fresh search item and hands existing results to TextFinder. [crates/search/src/buffer_search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/buffer_search.rs#L1181), [crates/search/src/project_search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/project_search.rs#L1708), [crates/search/src/project_search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/project_search.rs#L1293). Preserve DeploySearch payloads, including `replace_enabled: true`.

### Focus and display

`search::FocusSearch`, `project_search::ToggleFocus`, `project_search::ToggleFilters`, `project_search::ToggleAllSearchResults`.

Zed focuses query/results, shows filter fields and expands all groups if any are folded, otherwise folds all. [crates/search/src/project_search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/project_search.rs#L1429).

### History, options and replacement

`search::NextHistoryQuery`, `search::PreviousHistoryQuery`, `search::ReplaceNext`, `search::ToggleCaseSensitive`, `search::ToggleIncludeIgnored`, `search::ToggleRegex`, `search::ToggleReplace`, `search::ToggleWholeWord`.

Zed applies these to the focused search owner with its own query history, options and replacement state. [crates/search/src/search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/search.rs), [crates/search/src/buffer_search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/buffer_search.rs), [crates/search/src/project_search.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/project_search.rs).

## Existing implementation

[apps/web/src/features/search/state/buffer-state.tsx](../apps/web/src/features/search/state/buffer-state.tsx) already holds per-root queries,
flags, histories, replacement visibility and collapsed paths.
[apps/web/src/features/search/hooks/use-replace.ts](../apps/web/src/features/search/hooks/use-replace.ts) implements replace-next/all.
[apps/web/src/features/chat-mode/state/session-search-store.ts](../apps/web/src/features/chat-mode/state/session-search-store.ts) has separate chat state.
[packages/find/src/findController.ts](/work/projects/Editor/packages/find/src/findController.ts) owns buffer find and replace. Several search actions
already map in Editor contexts; the remaining work includes their project and chat contexts.

Editor citations name the current read-only checkout. After Plan 207, execute the same package
changes under `editor/packages/` in Fregat and update its public package exports there.

## Design

Publish focused `BufferSearch`, `ProjectSearch` and `ChatSearch` nodes with small typed actions.
Preserve existing command IDs for mapped options; add search focus/history/filter/scope commands
and typed deployment payloads. Each owner holds its own query, history and result selection.
Chat exposes readable search capabilities; replacement and include-ignored apply only where
supported. A fresh project-search tab needs a distinct search instance ID in document identity,
query keys and persisted view state; current root-only identity cannot hold independent tabs.
Directory scope uses Plan 233's selected directory. Buffer edits use Editor transactions;
project replacement uses existing mutations and settles dirty documents plus result caches.
Plan 230 implements the TextFinder picker; this plan defines its query/result handoff and leaves
that action unavailable until its focus owner exists, avoiding a reverse dependency.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing routing tests for buffer/project/chat with the same key and separate histories.
- [ ] Expose focused owner actions and wire existing flags, replace-next, filters and group collapse.
- [ ] Introduce independent search-tab identity and directory scope; define the TextFinder handoff for Plan 230.
- [ ] Register remaining contexts and exact preset payloads; add `zed-search-command-owners`.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Run focused search-store, replacement and Editor find tests. `zed-search-command-owners`
seeds find without losing editor focus, recalls history, toggles options/filters/replace, scopes
a directory, and runs independent queries in two search tabs. Exercise chat search between file
searches; histories and flags stay separate. Replacement preserves dirty-buffer edits and
settles result caches. Plan 230's scenario verifies the TextFinder handoff when it lands.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run install-release`, adding `--server --restart` when server code changes.

## Out of scope

TextFinder picker and excerpt engine, Plans 230/229; chat transcript replacement; search backend indexing changes; TUI parity.
