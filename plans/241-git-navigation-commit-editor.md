# Plan 241: Complete Git panel navigation and commit-editor workflows

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206, Plan 220, Plan 207, and Plan 204 for hosted multiline drafts. Size: L. Triage: ZT-22.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Switch changes/history, navigate trees/graph controls, filter recent branches, expand/cancel the commit editor and amend a commit.

## Zed behavior

- `git_panel::ActivateChangesTab`, `git_panel::ActivateHistoryTab`,
  `git_panel::ExpandSelectedEntry`, `git_panel::CollapseSelectedEntry`, `git_panel::FirstEntry`,
  and `git_panel::LastEntry` target the focused changes tree or history tab.
  See `crates/git_ui/src/git_panel.rs:2039`, `:2384`, and `:7158`.
- `branches::OpenRecent`, `branch_picker::CycleBranchFilter`, `branch_picker::ToggleFilterMenu`,
  and `git_picker::ActivateBranchesTab` open or filter the branch picker.
  See `crates/git_ui/src/branch_picker.rs:452`, `crates/git_ui/src/git_picker.rs`, and
  `crates/zed_actions/src/lib.rs:365`, where `branches::OpenRecent` aliases `git::Branch`.
- `git_graph::FocusNextTabStop` and `git_graph::FocusPreviousTabStop` traverse graph controls.
  `git_graph::ScrollUp` and `git_graph::ScrollDown` move the selected commit by half the visible
  row count. See `crates/git_ui/src/git_graph.rs:1977` and `:2096`.
- `git::Amend` first enters amend mode and loads the previous commit message; a second invocation
  commits while the commit editor owns focus.
  `git::ExpandCommitEditor` opens the commit modal; `git::ToggleFillCommitEditor` switches the
  panel editor between bounded and full height. See `crates/git_ui/src/git_panel.rs:3597`,
  `:6362`, and `crates/git_ui/src/commit_modal.rs`.
- `git::Cancel` is bound to Escape in `GitPanel && CommitEditor` in
  `assets/keymaps/default-linux.json:1080`. No corresponding handler was found in the pinned
  Rust source. Implement Fregat draft cancellation explicitly and test its restoration policy.

## Existing implementation

[HistoryList](../apps/web/src/features/git/components/history-list.tsx) already virtualizes
commits with listbox navigation. [HistoryGraph](../apps/web/src/features/git/components/history-graph.tsx)
and [history layout](../apps/web/src/features/git/utils/history-layout.ts) draw commit lanes.
Graph lanes exist; interactive graph controls remain to be added.
[CommitControls](../apps/web/src/features/git/components/commit-controls.tsx) uses a single-line
input; [useCommitAction](../apps/web/src/features/git/hooks/use-commit-action.ts) owns submission.
[GitService](../apps/server/src/git/service.ts) has streamed commit progress. The
[file-backed commit editor](../apps/web/src/features/git/components/message-file-commit.tsx) is
an adjacent workflow. Editor document sessions exist in
`/work/projects/Editor/packages/editor/src/documentSession.ts` for a multiline hosted draft.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Register the covered commands in the catalog and web command table. Plan 206 presets own
  all chords. Use `Git`, `ChangesList`, `GitGraph`, `GitGraphSearchBar`, `GitBranchSelector`,
  `GitPicker`, and `CommitEditor` focus contexts, including nested hosted editors.
- Extend the existing history view with an interactive graph owner, search control, and ordered
  tab stops. Use its viewport geometry for half-page selection.
- Own drafts by machine and repository in a zustand store. Share one document between compact,
  expanded, and modal views. Cancel restores the pre-amend draft and exits the draft workflow;
  generation cancellation retains its separate action.
- Add a typed amend operation to contracts and server commit planning, including expected HEAD
  and unborn/detached-state handling. Reuse commit progress, repository serialization, and
  cache settlement. Preserve failed drafts and report structured errors.
- Use shared `ToolPane`, `VirtualList`, `useListbox`, dialog, and loading primitives. Keep branch
  picker queries and mutation keys with Git. Feature integration goes through narrow owners.

## Steps

- [ ] Add failing command tests for tab/entry targeting, graph stepping, and the two amend stages.
- [ ] Add repository-keyed draft ownership and multiline compact/expanded/modal editor views.
- [ ] Add amend contracts, server operation, streamed progress, and expected-HEAD checks.
- [ ] Extend graph controls and branch picker filters, then register context-scoped preset rows.
- [ ] Add `git-navigation-commit` scenario and selectors.

## Acceptance

Run the affected Git component tests and a real temporary-repository amend test. Verify
first invocation changes only draft state, second invocation amends only the selected repository,
and failure retains the message. The `git-navigation-commit` scenario navigates tree boundaries,
changes/history, graph search tab stops, half-page commit selection, branch filters, and both
commit expansion modes. Cancel restores the prior draft and focus.

### Execution checks

Use fixture/mock providers only. Run heavy checks through
`bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Register the named scenario in `scripts/agent/scenarios/index.ts`. Run it with `bun run agent:browser scenario <name>` and capture
`bun run agent:browser look`; read screenshots back and report the evidence directory.
Any private dev server takes an explicit free `--port` and stops afterward. Run `bun run gates`
and typecheck changed packages. Commit by path, push, and ship through the mesh using
`bun run deploy` or `bun run deploy --server --restart` for server changes. Performance claims
require `trace --compare` and render counts before and after.

## Out of scope

Stash lifecycle, range staging, remote mutation variants, and a second history renderer.
