# Plan 231: Build a keyboard-accessible document outline

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-12, size L. Depends on Plan 207, Plan 204, Plan 206, Plan 220.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Browse nested symbols, expand or collapse entries and open or reveal their source.

## Zed actions and behavior

### Structure

`outline_panel::CollapseSelectedEntry`, `outline_panel::ExpandSelectedEntry`, `outline_panel::SelectParent`.

Zed maintains a flattened tree of source files, excerpts and symbols; expansion/collapse operates on the selected entry, and SelectParent finds its enclosing row. [crates/outline_panel/src/outline_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/outline_panel/src/outline_panel.rs#L1671).

### Source and focus

`outline_panel::OpenSelectedEntry`, `outline_panel::CopyPath`, `outline_panel::RevealInFileManager`, `outline_panel::ToggleFocus`.

Opening scrolls and focuses the editor at the selected source; copy/reveal uses its file. The panel has its own focus target and leaves filter editing to the filter. [crates/outline_panel/src/outline_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/outline_panel/src/outline_panel.rs#L1396), [crates/outline_panel/src/outline_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/outline_panel/src/outline_panel.rs#L2301).

### Viewport

`outline_panel::ScrollCursorBottom`, `outline_panel::ScrollCursorCenter`, `outline_panel::ScrollCursorTop`, `outline_panel::ScrollDown`, `outline_panel::ScrollUp`.

Zed aligns the selected row to bottom/center/top; ScrollUp/Down advances selection by half the rendered rows. [crates/outline_panel/src/outline_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/outline_panel/src/outline_panel.rs#L1570).

## Existing implementation

[apps/web/src/lib/document-symbols.ts](../apps/web/src/lib/document-symbols.ts) normalizes nested `DocumentSymbol` and flat
`SymbolInformation` replies. [apps/web/src/features/workbench/hooks/use-document-symbol-tree.ts](../apps/web/src/features/workbench/hooks/use-document-symbol-tree.ts)
queries symbols using server identity and settled document revision; its current placeholder data
needs subject identity when reused in the outline. Breadcrumbs consume this tree today.
[packages/lsp/src/workspace.ts](/work/projects/Editor/packages/lsp/src/workspace.ts) tracks document synchronization;
[packages/editor/src/documentSession.ts](/work/projects/Editor/packages/editor/src/documentSession.ts) provides shared revisions and source ranges.

Editor citations name the current read-only checkout. After Plan 207, execute the same package
changes under `editor/packages/` in Fregat and update its public package exports there.

## Design

Add an outline feature with components, hooks, state and pure tree utilities. Reuse the
normalized document-symbol tree and retain its full subject until the next subject is ready.
Select using `selectionRange`; display hierarchy using `range` and children. Keep expansion and
selection per document in a zustand store. Publish `OutlinePanel` and filter-editing context;
register `outline.toggleFocus`, `outline.openSelected`, typed expand/collapse/parent and viewport
commands. Copy/reveal resolves the selected symbol's owning file through host capabilities.
Use `ToolPane`, `ListRow`, `useListbox` and `VirtualList`; expose pending/error/empty separately.
An excerpt-backed outline consumes Plan 229's source mapping when that owner exists.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing nested-symbol and stale-subject fixtures, including flat SymbolInformation replies.
- [ ] Build the outline tree and selection/expansion model, with revision-aware refresh and source reveal.
- [ ] Register all twelve actions and focused contexts; use host reveal capability and native path titles.
- [ ] Add `zed-document-outline` with fixture LSP replies, scrolling and focus restoration.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Run focused document-symbol normalization and outline model tests. `zed-document-outline`
opens nested symbols, expands/collapses, selects a parent, navigates to its selection range,
exercises all viewport placements and copies its path. Edit the document and switch files while
a symbol request is pending; rows and navigation must agree with the shown subject/revision.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run install-release`, adding `--server --restart` when server code changes.

## Out of scope

Workspace symbol queries and call hierarchy, Plan 232; syntax parsing changes; excerpt mapping engine, Plan 229; TUI parity.
