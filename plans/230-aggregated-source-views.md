# Plan 230: Add aggregated source views and all-match text finding

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-11, size L. Depends on Plan 207, Plan 204, Plan 206, Plan 229, Plan 235, Plan 237.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Open selected excerpts or selections as an aggregated editable view, open sources in splits and browse all text matches.

## Zed actions and behavior

### Source opening

`editor::OpenExcerpts`, `editor::OpenExcerptsSplit`.

Zed maps selected excerpt ranges back to each source buffer, restores selections, and opens in the active or adjacent pane. Singleton editors propagate the command. [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/editor/src/editor.rs#L10489).

### Selection view

`editor::OpenSelectionsInMultibuffer`.

Zed gathers the singleton editor's selections into a titled multibuffer and selects its source ranges. [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/editor/src/editor.rs#L9193).

### Text finder

`text_finder::Toggle`.

Zed opens a searchable all-match picker seeded from the active item or the last query; repeated Toggle cycles selection. It can import project-search results and open one or multiple matches. [crates/search/src/text_finder.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/text_finder.rs#L123), [crates/search/src/text_finder/delegate.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/search/src/text_finder/delegate.rs#L929).

## Existing implementation

[apps/web/src/features/search/components/result-file-editor.tsx](../apps/web/src/features/search/components/result-file-editor.tsx) renders per-file result editors.
[apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts) has a search document variant;
[apps/web/src/lib/documents/utils/groups.ts](../apps/web/src/lib/documents/utils/groups.ts) already places tabs and splits.
[packages/editor/src/documentSession.ts](/work/projects/Editor/packages/editor/src/documentSession.ts) shares source buffers and transactions among views.
These provide source ownership; Plan 229 supplies the shared excerpt mapping engine.

Editor citations name the current read-only checkout. After Plan 207, execute the same package
changes under `editor/packages/` in Fregat and update its public package exports there.

## Design

Use Plan 229's excerpt document and source anchors for search, selected ranges and editable
agent-review excerpts. Fregat owns tab placement and picker UI; `editor/packages/editor` owns
selection-to-source mapping and edit/undo behavior. Expose typed source-open requests carrying
source identity, ranges and split intent. Publish `Editor` with excerpt capabilities and a
`TextFinder` node beneath the workspace. Project search hands Plan 235's query/results to the
same finder, preserving its subject and flags. Keep read-only review sources typed as read-only.
Queries include workspace, source revision and query options; edits settle each source document
and affected search/review cache before the mutation resolves.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing fixtures for a two-source excerpt selection and repeated finder Toggle.
- [ ] Implement selection views and source-open requests on Plan 229; route active/adjacent placement through Plan 237.
- [ ] Build the TextFinder picker and Plan 235 adapter with cancellation, multi-selection and source previews using shared UI patterns.
- [ ] Register the four actions, capability predicates and preset rows; add `zed-aggregated-source-views`.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Focused excerpt tests prove source selection mapping, duplicate source handling, read-only
sources and shared undo. The `zed-aggregated-source-views` scenario selects ranges in two files,
edits an editable excerpt, opens its sources in a split, and finds all matches. Source tabs and
search results reflect the settled edits; changing workspace cancels stale finder replies.

Run heavy checks through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run install-release`, adding `--server --restart` when server code changes.

## Out of scope

Excerpt engine internals and excerpt expansion/navigation, owned by Plan 229; project-search command ownership, Plan 235; new pane geometry, Plan 237; TUI parity.
