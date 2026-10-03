# Plan 239: Complete recent-project and multi-root workspace workflows

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-20, size L. Depends on Plan 206, Plan 220.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Open or remove recent roots, add a folder and manage the recent-project action menu.

## Zed actions and behavior

### Recent projects

`projects::OpenRecent`, `welcome::OpenRecentProject`, `recent_projects::RemoveSelected`, `recent_projects::ToggleActionsMenu`.

Zed opens its recent-project picker, toggles selected-entry actions and removes a recent record, open root or project group according to entry type. Welcome opens an indexed recent project. [crates/recent_projects/src/recent_projects.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/recent_projects/src/recent_projects.rs#L753), [crates/workspace/src/welcome.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/welcome.rs). Preserve OpenRecent and recent-index payloads.

### Root membership

`recent_projects::AddToWorkspace`, `workspace::AddFolderToProject`.

Zed adds selected local recent paths to the current project or prompts for one or several directories. [crates/recent_projects/src/recent_projects.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/recent_projects/src/recent_projects.rs#L809), [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L4225).

## Existing implementation

[apps/web/src/features/environments/components/project-picker.tsx](../apps/web/src/features/environments/components/project-picker.tsx) selects projects;
[apps/web/src/features/workspace/state/open-root.ts](../apps/web/src/features/workspace/state/open-root.ts) coordinates environment-aware root
opening, cancellation and dirty-root reservations.
[apps/web/src/features/workspace/utils/record-recent-mutation.ts](../apps/web/src/features/workspace/utils/record-recent-mutation.ts) records recents;
[apps/web/src/features/workspace/state/active-project.ts](../apps/web/src/features/workspace/state/active-project.ts) tracks the active root.
[apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts) identifies resources and workspace roots.
The current workspace owner uses one `rootFolder`; adding a folder needs an explicit multi-root model.

## Design

Introduce a stable workspace identity containing an ordered set of root memberships and an
active root. Each membership carries environment, canonical path and repository ownership;
initial implementation adds roots on the current environment, with remote opening and execution trust owned
by Plan 240. Files resolve to the longest containing root, including nested roots. Use that
ownership for tree nodes, search, diagnostics, LSP attachments, settings execution scope and Git
operations; distinguish repositories and roots that share one repository. Extend root-switch
reservations into membership changes with dirty-document decisions. Removing membership keeps
files on disk and retains dirty buffers until the close decision succeeds. Removing a recent
record only forgets its history entry. Register `projects.openRecent`, indexed
`projects.openRecentAt`, `recentProjects.removeSelected/toggleActions/addToWorkspace`, and
`workspace.addFolder` in Workspace/RecentProjects contexts. Reuse Plan 220's picker focus contract
and the environment/navigation coordinator. Server changes are typed contracts and TanStack
mutations that settle membership and recents caches before resolving.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing multi-root ownership tests for duplicate/nested roots and same basenames in two repositories.
- [ ] Introduce workspace/root membership contracts and route tree, search, LSP, settings and Git through the owning root.
- [ ] Extend recents UI and membership mutations with cancellation, dirty guards and separate forget/remove-folder semantics.
- [ ] Register all six actions and payloads; add `zed-recent-multi-root-projects` with local fixture roots.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Run focused environment/root-switch and membership tests against the in-process fixture
server. `zed-recent-multi-root-projects` opens an indexed recent project, uses its actions menu,
forgets a record, adds two roots and removes one membership. The same relative path in two roots
opens distinct documents; search and Git target the correct owner. Dirty cancellation retains
content and membership; removed/forgotten roots retain all filesystem data. A stale environment
reply cannot attach a root after a newer navigation request.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run install-release`, adding `--server --restart` when server code changes.

## Out of scope

Remote opening and execution trust, Plan 240; Git worktree deletion; rebuilding Zed welcome UI; cross-machine multi-root membership; TUI parity.
