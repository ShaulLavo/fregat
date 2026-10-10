# Plan 238: Expose independent dock and session-sidebar commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-19, size M. Depends on Plan 206 and the relevant Plan 209 region/focus/key contracts;
  independent columns and new dock units need their separately authorized, delivered layout owners.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Show, hide, focus and resize the project tools and session sidebar through the keyboard.

## Zed actions and behavior

### Session/project sidebar

`multi_workspace::FocusWorkspaceSidebar`, `multi_workspace::NextProject`, `multi_workspace::PreviousProject`, `multi_workspace::ToggleWorkspaceSidebar`.

Zed independently toggles its workspace sidebar, moves focus to/from it and activates neighboring projects in sidebar order. [crates/workspace/src/multi_workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/multi_workspace.rs#L39).

### Visibility

`workspace::CloseActiveDock`, `workspace::ToggleAllDocks`, `workspace::ToggleRightDock`.

Zed closes the focused dock; ToggleAllDocks remembers the open set, closes it and restores it on the next toggle. RightDock toggles that independent region. [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L4582), [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L4643).

### Size

`workspace::DecreaseActiveDockSize`, `workspace::DecreaseOpenDocksSize`, `workspace::IncreaseActiveDockSize`, `workspace::IncreaseOpenDocksSize`, `workspace::ResetActiveDockSize`, `workspace::ResetOpenDocksSize`.

Zed targets the focused dock or all visible docks, takes an optional `px` delta with UI-font fallback for zero, and resets to defaults. [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L651), [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L8293).

## Existing implementation

[apps/web/src/features/workbench/utils/panels.ts](../apps/web/src/features/workbench/utils/panels.ts) models sidebar/bottom visibility and
active tools; [apps/web/src/features/workbench/utils/layout.ts](../apps/web/src/features/workbench/utils/layout.ts) persists normalized pane sizes.
[packages/client-core/src/chat/rail/project-order.ts](../packages/client-core/src/chat/rail/project-order.ts) supplies project ordering.
[apps/web/src/keymap/workspace-commands.ts](../apps/web/src/keymap/workspace-commands.ts) already routes sidebar commands by app mode.
Plan 209 establishes independent session/project-tool columns; the current layout has no
independent right-dock owner.

## Scoped workspace dependency

Reconcile existing region navigation independently. New independent columns and right-dock
commands require 209's reviewed region/focus/key decisions and authorized delivered owners.
D2 gates optional compact-terminal relocation; D5 gates changed column/mode keys. Keep handlers
unavailable until their region exists. This plan does not authorize constructing 209's shell or
waiting for every unrelated workspace unit before improving current navigation.

## Design

Implement visibility, open-set history and resize operations in Plan 209's layout owner. Give
each actual dock a region ID, focus node and persisted size; the session sidebar has its own
identity. Activate ToggleRightDock only when Plan 209 assigns its real region and context.
Register typed `dock.toggle/close/resize/reset`, `dock.toggleAll`, and
`sessionSidebar.toggle/focus/selectProject` actions. Map NextProject/PreviousProject to Fregat's
session/project navigator in its displayed ordering through the navigation coordinator.
Resize converts pixel payloads using current container geometry, clamps existing constraints and
persists view state. Derive zero-pixel fallback from UI text metrics; any added configurable knob
belongs to the settings registry. Hiding a focused region returns focus to its retained workspace
target. Hiding terminal tools retains their host and connection; it never ends the shell.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Inventory current regions and implement their navigation against existing owners. For each new region unit, require its reviewed Plan 209 assignment and authorized delivered host before adding visibility, open-set restore and focus-return fixtures.
- [ ] Implement typed layout operations and pixel resize/reset for the unit's available regions, with clamping and persisted view state.
- [ ] Register the unit's actions, owning contexts and preset payloads; reuse project navigation coordination. Keep actions for unavailable regions disabled, and track remaining actions toward all thirteen.
- [ ] Add `zed-dock-sidebar-commands` with a retained fixture terminal and at least two project entries.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Each unit proves navigation and operations against its available regions; its receipt lists
region/action coverage and remaining gated units. Focused layout tests cover active/open target
selection, px/zero fallback, bounds, default reset and remembered open-set restoration when
those operations are delivered. Full-plan acceptance remains open until
`zed-dock-sidebar-commands` independently toggles session/tools/right regions, navigates projects,
resizes active/all visible docks and resets them.
Hiding the focused dock returns focus to the retained pane; terminal fixture identity and input
remain intact when reopened. Reopening preserves persisted size and visibility intent.

Run heavy checks through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run install-release`, adding `--server --restart` when server code changes.

## Out of scope

Defining new region placement beyond Plan 209; cloud workspaces; tab pinning; TUI parity.
