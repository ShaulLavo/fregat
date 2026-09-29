# Plan 220: Finish keyboard commands for menus, pickers and notifications

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206. Size: M. Triage item: ZT-01.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Navigate and confirm the focused widget, reopen the previous picker and invoke a notification action.

## Covered Zed actions and behavior

`command_palette::RemoveSelected`; `menu::Confirm`; `menu::Restart`; `menu::SecondaryConfirm`; `menu::SelectChild`; `menu::SelectFirst`; `menu::SelectLast`; `menu::SelectNext`; `menu::SelectParent`; `menu::SelectPrevious`; `picker::ConfirmCompletion`; `picker::ConfirmInput`; `toast::RunAction`; `workspace::ReopenLastPicker`.

- `menu::SelectNext`, `SelectPrevious`, `SelectFirst`, and `SelectLast` move the
  active widget selection. `SelectChild` and `SelectParent` delegate hierarchical
  navigation; unsupported operations propagate. `Confirm` commits the selection,
  and `SecondaryConfirm` invokes the delegate's secondary action. Picker confirmation
  waits for pending match updates. See [crates/picker/src/picker.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/picker/src/picker.rs#L960) and
  [crates/ui/src/components/context_menu.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/ui/src/components/context_menu.rs#L885).
- `picker::ConfirmInput` acts on the literal query, preserving its `secondary`
  boolean. `ConfirmCompletion` completes the query through the delegate and keeps
  the picker open. See [crates/picker/src/picker.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/picker/src/picker.rs#L1070).
- `command_palette::RemoveSelected` removes usage history for the selected command.
  Palette secondary confirmation opens its keybinding editor. See
  [crates/command_palette/src/command_palette.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/command_palette/src/command_palette.rs#L162) and `confirm` in that file.
- `workspace::ReopenLastPicker` reveals the stashed modal after the current modal
  dismisses. `toast::RunAction` invokes the active toast's action. See
  [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/workspace/src/workspace.rs#L8550) and
  [crates/workspace/src/toast_layer.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/workspace/src/toast_layer.rs#L18).
- `menu::Restart` is declared as restarting a menu from the beginning in
  [crates/menu/src/menu.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/menu/src/menu.rs#L33). The pinned tree has no `menu::Restart`
  handler. Fregat defines this operation as returning to the first enabled item
  while keeping the query; document this product decision in the command description.

## Existing Fregat and Editor work

The command table is [catalog.ts](../packages/client-core/src/commands/catalog.ts).
[use-listbox.ts](../packages/ui/src/patterns/use-listbox.ts) and
[listbox-keys.ts](../packages/ui/src/patterns/listbox-keys.ts) already handle arrows,
Home/End, tree navigation, and commit. The palette has
[recent-commands-store.ts](../apps/web/src/features/command-palette/state/recent-commands-store.ts),
backed by [recent-commands.ts](../packages/client-core/src/commands/recent-commands.ts),
which records usage but exposes no single-entry removal. These are existing owners to extend.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Add widget command metadata to `packages/client-core/src/commands/` and focused
`Picker`, `menu`, and `CommandPalette` handlers. Extend the shared listbox/menu
owner with actions that keyboard and pointer paths both call. Widget state stays
with its owner; durable picker descriptors and history live in zustand stores.
Retain a typed picker descriptor, query, selection, and return-focus target for
reopening. Clear descriptors when their workspace becomes unavailable.

The notification owner exposes the active toast action to a Workspace handler.
Feature-specific confirmations remain with each delegate. Preserve existing mapped
menu commands and add missing context coverage. Future notebook, call-hierarchy,
and collaboration contexts become active through their owning plans.

## Steps

- [ ] Reproduce missing focused-widget commands in a nested picker scenario before wiring handlers.
- [ ] Register all covered actions and extend shared widget actions, including secondary and literal-query confirmation.
- [ ] Add recent-command removal, deferred picker reopening, and active-toast action dispatch through their owners.
- [ ] Translate the remaining supported contexts into `zed` and `ours`; update shortcut labels through `Kbd` and `useCommandShortcut`.
- [ ] Add `focused-widget-commands` in `scripts/agent/scenarios/`, with selectors in `scripts/agent/selectors.ts`, and ship the verified web change.

## Acceptance

Run focused listbox/dispatcher tests for nested focus, disabled items, empty lists,
and pending-match confirmation. Test history removal without removing the command
from the catalog. In `agent:browser scenario focused-widget-commands`, navigate a
nested picker with Home/End, complete its query, confirm secondary/literal input,
reopen it after dismissal, and invoke a fixture toast action once. Read screenshots
back and record the evidence directory. Text fields without an applicable widget
retain native keys.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-01" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run deploy`, or
`bun run deploy --server --restart` when server code changes. Confirm the served release.

## Out of scope

New widget features owned by later plans, Zed collaboration, TUI UX, and app restart.
