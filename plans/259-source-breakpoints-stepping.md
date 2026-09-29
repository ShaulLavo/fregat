# Plan 259: Source breakpoints, logpoints and stepping

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-40, debugger breakpoints. Size: L. Scheduled after Plans 207, 204, 206 and 258.
  Later scheduling remains approved work.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Set and disable source breakpoints, edit log messages and conditions, navigate breakpoint
properties, and step over, into or out of code with the stopped location visible.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `editor::ToggleBreakpoint` toggles source breakpoints at cursor rows, using buffer anchors.
  `editor::EditLogBreakpoint` opens the log-message editor for an existing or new breakpoint.
- `debugger::ToggleEnableBreakpoint` changes the selected breakpoint's enabled state;
  `debugger::UnsetBreakpoint` removes the selected source breakpoint.
  `debugger::NextBreakpointProperty` cycles through log message, condition, hit condition and
  closed editor; `debugger::PreviousBreakpointProperty` traverses that cycle backward.
- `debugger::StepOver`, `debugger::StepInto` and `debugger::StepOut` target the selected stopped
  thread using configured stepping granularity. Running threads do not enable these commands.

Sources: [editor.rs, logpoint editing](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L6415)
and [breakpoint toggle](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L6661),
[breakpoint_list.rs, properties and enablement](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/session/running/breakpoint_list.rs#L380),
[running.rs, stepping](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/session/running.rs#L1769).

## Existing Fregat and Editor behavior

Fregat has source navigation and document ownership in
`apps/web/src/features/editor/state/workspace-document-service.ts` and
`utils/language-server-plugin.ts`. Plan 258 supplies DAP sessions and stopped-state projection.
There is no existing source-breakpoint owner in Fregat.

Editor `packages/editor/src/plugins.ts` defines interactive `EditorGutterContribution` cells,
source row mapping and disposal. `packages/gutters/src/lineGutter.ts` and `foldGutter.ts`
demonstrate their lifecycle. The verified baseline files live under `/work/projects/Editor/`;
new reusable breakpoint/active-line contributions belong in `editor/packages/` after Plan 207.
Hosted diff or injected rows must resolve their real source location before creating a breakpoint.

## Design

Register `debug.breakpoint.toggle`, `editLog`, `toggleEnabled`, `remove`, `nextProperty`,
`previousProperty` and `debug.stepOver`, `stepInto`, `stepOut` in the command table. Presets
preserve Editor, BreakpointList and `Workspace && debugger_stopped` contexts. Commands resolve
the current selected breakpoint or document cursor and session/thread IDs. Property text
editing keeps normal typing and listbox focus semantics.

A Fregat breakpoint owner stores requested source identity, tracked anchor, enabled state,
condition, hit condition and log message. Keep requested and adapter-verified locations
separate, per session. Send complete enabled source breakpoint sets with DAP `setBreakpoints`,
correlate replies and handle breakpoint events. An empty set removes the final breakpoint.
Edits/renames remap anchors; deleted sources invalidate their locations visibly. Unsupported
condition/logpoint capabilities disable those controls.

Editor renders interactive gutter markers, verification state and the active stopped line;
Fregat owns persistence, property UI and DAP. Mutations serialize by session/source and settle
breakpoint caches. Step requests recheck stopped thread/generation, clear stale active position
on continue and navigate the next stopped stack frame. Register stepping granularity and
persistent execution settings in application/machine scope. Store view selection separately.

## Steps

- [ ] Add failing fixture DAP tests for requested/verified mapping and breakpoint replacement.
- [ ] Implement source breakpoint ownership, anchor remapping and capability-driven properties.
- [ ] Add Editor gutter/active-line contributions and accessible property controls.
- [ ] Wire source/list commands, stepping and preset contexts; regenerate settings references.
- [ ] Verify source behavior and cleanup, run gates, commit and deploy server changes.

## Acceptance

- Focused fake-adapter tests cover one-based DAP line conversion, relocated/unverified points,
  disabling/removing the last point, log/condition/hit properties, stale replies and two sessions.
  Editor tests cover edits above a breakpoint, folded/multiple cursor rows, synthetic rows and
  gutter disposal. Step calls target the selected stopped thread exactly once.
- Add `debug-breakpoints-stepping` in `scripts/agent/scenarios/` with fixture adapter/source
  files. Exercise all nine actions, the property cycle in both directions, verification markers
  and stopped-line navigation after each step. Read screenshots and cache evidence back.
- Run touched breakpoint/Editor tests, settings reference checks and `bun run gates`.
  Heavy commands use the wave slot wrapper; servers take explicit free ports.

## Out of scope

Data/exception breakpoints, variable/watch inspection in Plan 260, reverse stepping and TUI UX.
