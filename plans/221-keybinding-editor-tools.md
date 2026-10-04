# Plan 221: Complete the keybinding editor on Plan 206

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 206. Size: M. Triage item: ZT-02.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Create, edit, record, search and inspect bindings, contexts and conflicts in Settings.

## Covered Zed actions and behavior

`keymap_editor::CopyAction`; `keymap_editor::CopyContext`; `keymap_editor::CreateBinding`; `keymap_editor::EditBinding`; `keymap_editor::OpenCreateKeybindingModal`; `keymap_editor::ToggleConflictFilter`; `keymap_editor::ToggleKeystrokeSearch`; `keystroke_input::ClearKeystrokes`; `keystroke_input::StartRecording`; `keystroke_input::StopRecording`; `zed::OpenKeymap`; `zed::OpenKeymapFile`.

- `keymap_editor::CreateBinding` and `EditBinding` open the selected action's
  binding modal. `OpenCreateKeybindingModal` opens a new action search. `CopyAction`
  copies the action name; `CopyContext` copies its predicate. Conflict and keystroke
  filters change the displayed rows. See
  [crates/keymap_editor/src/keymap_editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/keymap_editor/src/keymap_editor.rs#L1328) and its `process_bindings`.
- `keystroke_input::StartRecording` clears prior strokes and focuses the recorder.
  `StopRecording` retains recorded input, removes the stop gesture from it, and
  returns focus to the outer control. `ClearKeystrokes` empties the recording. See
  [crates/keymap_editor/src/ui_components/keystroke_input.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/keymap_editor/src/ui_components/keystroke_input.rs#L385).
- `zed::OpenKeymap` opens the visual editor; `OpenKeymapFile` opens the editable
  user keymap file. See [crates/keymap_editor/src/keymap_editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/keymap_editor/src/keymap_editor.rs#L88) and
  [crates/zed/src/zed.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed/src/zed.rs#L250). In Fregat the latter opens the registry-owned
  settings document at `keybindings.overrides`.

## Existing Fregat and Editor work

Settings already has
[shortcuts-toolbar.tsx](../apps/web/src/features/settings/components/shortcuts-toolbar.tsx),
[shortcut-recorder.tsx](../apps/web/src/features/settings/components/shortcut-recorder.tsx),
[shortcut-recording.ts](../apps/web/src/features/settings/utils/shortcut-recording.ts),
and [shortcut-report.ts](../apps/web/src/features/settings/utils/shortcut-report.ts).
Recording currently follows VS Code-style two-stroke rules and uses raw key handlers.
Plan 206 owns the new override shape and the dispatcher-derived shadow report.
Complete its remaining UI commands here and count already delivered work as complete.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Register Settings commands for row create/edit, copy, filters, recorder start/stop/clear,
and visual/raw settings entry points. Publish `KeymapEditor`, `KeybindEditorModal`,
and `KeystrokeInput` contexts below Settings. The recorder captures keys through
its focus node so recording cannot execute app commands. Composition stays native.

Use the live dispatcher for context parsing, resolution, shadowing, and unbinds.
Persist `{ keys, command | null, context? }` plus Plan 206's `unbind` through the
existing settings mutation owner. Preview resolves the exact draft binding.
Display deeper defaults shadowing shallower user bindings as information. Use
shared UI fields, `Kbd`, `useListbox`, and `VirtualList`; keep feature code in Settings.

## Steps

- [ ] Reproduce a missing row command and a context-specific recording in failing focused tests.
- [ ] Reconcile delivered Plan 206 editor steps, then register the remaining catalog commands and focus contexts.
- [ ] Implement create/edit with typed payloads, predicate validation, copy actions, and the raw settings entry point.
- [ ] Replace recorder shortcut logic with dispatcher capture and start/stop/clear actions; preserve recorded stop-key semantics.
- [ ] Connect conflict/keystroke filters and preview to live resolution, including null and targeted unbind entries.
- [ ] Add `keybinding-editor-tools` browser coverage, read its screenshots, and ship the web change.

## Acceptance

Run the Settings recording, shortcut-row, and conflict tests affected by the change,
plus a dispatcher fixture for deeper-default precedence. Record and save a multi-stroke
binding in `agent:browser scenario keybinding-editor-tools`; verify only its selected
context runs it. Copy its action and predicate, inspect a shadowed binding, stop/clear
recording, and edit the same row in raw settings. A null unbind and targeted unbind
must match the live resolver after reload. Verify mutation/cache settlement with
`agent:browser caches` and read the screenshots back.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-02" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run install-release`, or
`bun run install-release --server --restart` when server code changes. Confirm the served release.

## Out of scope

The Plan 206 matcher cutover itself, a second keymap file format, compatibility
migration, and TUI settings UX.
