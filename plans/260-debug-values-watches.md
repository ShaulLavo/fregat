# Plan 260: Debug variable trees, watches and evaluation

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: L. Depends on Plan 206, Plan 258, Plan 220. Approved work scheduled later, after these dependencies.

Triage assignment: ZT-41 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Inspect the selected stack frame, expand values, copy names and values, edit supported values, maintain watches, and maximize the active debug pane.

## Zed actions and behavior

- `variable_list::ExpandSelectedEntry` and `variable_list::CollapseSelectedEntry` expand/collapse the selected row; an already expanded row or a leaf advances selection, and an already collapsed row retreats. `variable_list::CopyVariableName` copies a variable name or watch expression. `variable_list::CopyVariableValue` evaluates the variable in the selected frame, falling back to its displayed value; watches copy their displayed value. `variable_list::EditVariable` opens a value editor. `variable_list::AddWatch` uses the selected variable's evaluate-name, and `variable_list::RemoveWatch` removes a selected watch. [crates/debugger_ui/src/session/running/variable_list.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/debugger_ui/src/session/running/variable_list.rs#L568).

- `console::WatchExpression` evaluates the console input in REPL context, records history, clears input, and adds a watch when a frame is selected. [crates/debugger_ui/src/session/running/console.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/debugger_ui/src/session/running/console.rs#L255).

- `debugger::ToggleExpandItem` toggles maximization of the active debug pane. [crates/debugger_ui/src/debugger_panel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/debugger_ui/src/debugger_panel.rs#L1738).

## Existing Fregat and Editor support

Plan 258 supplies the DAP session owner. Current source has terminal lifecycle and LSP navigation in [apps/web/src/features/terminal/utils/commands.ts](../apps/web/src/features/terminal/utils/commands.ts) and [apps/web/src/features/editor/utils/language-server-plugin.ts](../apps/web/src/features/editor/utils/language-server-plugin.ts). The current `DocumentRef` union in [apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts) has no debug document. No DAP values/watch owner was found in `apps/server/src`, `apps/web/src`, or `packages/contracts/src`.

Reusable scoped Editor commands and view contributions already exist in `editor/packages/editor/src/createPlugin.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/createPlugin.ts).

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Add a `debugger` feature with `DebugPanel`, `VariableList` and `DebugConsole > Editor` nodes. Query scopes/variables/evaluation by session, stop generation, thread, frame and variables-reference; reject stale responses after continue or frame changes. Keep watches under stable IDs, including failed evaluations. Capability checks gate setVariable/setExpression. Writes, watch changes and clipboard effects use serialized mutations that settle the relevant cache. Pane maximization belongs to debug layout state, separate from tree expansion. Values and expressions stay out of logs.

## Steps

- [ ] With Plan 258's fake adapter, reproduce missing inspect/watch behavior in a failing focused test and `debug-values-watches` scenario.
- [ ] Add typed scope, paged-child, evaluation and editable-value contracts to the existing DAP owner; key data to the stop generation.
- [ ] Implement selected-row expansion, copy/evaluate fallback, value editing and stable watches; connect console evaluation/history to that owner.
- [ ] Register all nine actions and preset rows; add debug pane maximization without changing selected-variable state.
- [ ] Build variable/watch lists with `ListRow`, `VirtualList`, `useListbox` and pending/error/empty states; add scenario selectors.

## Acceptance

Focused fake-DAP tests cover paged children, leaf arrow behavior, copy fallback, capability rejection, failed evaluation, duplicate watches, and a frame change while a child request is pending. Run `bun run agent:browser scenario debug-values-watches` and `look` to verify keyboard expansion, value editing, console-to-watch, removal and pane maximization. Read the screenshots. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run deploy --server --restart`.

## Out of scope

DAP launch/attach and session lifecycle are Plan 258; breakpoints and stepping are Plan 259. Memory/disassembly viewers and real adapters are outside this plan.
