# Plan 258: DAP session lifecycle and launch/attach selection

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-39, debugger sessions. Size: L. Scheduled after Plans 207, 204, 206 and 257.
  Later scheduling remains approved work.
- Covers twelve default-input names and supplementary modal action `debugger::Restart`.

## Outcome

Launch or attach a debugger, select a session/thread, pause or continue execution, stop the
active debug target, and rerun or restart with the intended build behavior.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `debug_panel::ToggleFocus` toggles debugger-panel focus. `debugger::Start` opens the process
  picker. `new_process_modal::ActivateDebugTab`, `new_process_modal::ActivateAttachTab` and
  `new_process_modal::ActivateLaunchTab`
  choose/focus the corresponding mode; attach refreshes the process picker.
- `debugger::ToggleSessionPicker` and `debugger::ToggleThreadPicker` open the panel selectors.
  `debugger::Pause` targets a running thread; `debugger::Continue` resumes the stopped program
  using the selected thread ID. Availability follows session state and adapter capabilities.
- `debugger::Rerun` reruns the last scenario, or opens the picker if none exists.
  `debugger::RerunSession` reruns the active scenario including its build task; without a build
  it restarts. `debugger::Restart` directly requests restart. `debugger::Stop` terminates the
  selected target/thread through session ownership and clears its active source position.

Sources: [debugger_ui.rs, registrations](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/debugger_ui.rs#L114),
[running.rs, lifecycle](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/session/running.rs#L1749),
[debugger_panel.rs, last scenario](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/debugger_panel.rs#L312)
and [selectors](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/debugger_panel.rs#L1268),
[new_process_modal.rs, mode tabs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/new_process_modal.rs#L612).

## Existing Fregat and Editor behavior

No DAP transport/session owner exists in the checked `apps/server/src`, `apps/web/src` or
`packages/contracts/src`. `apps/server/src/terminal/service.ts`, `terminal-host/session.ts`
and `packages/pty/src/process.ts` provide process lifecycle; Plan 257 provides build-task runs.
`apps/web/src/features/editor/utils/language-server-plugin.ts` connects LSP documents and source
locations, but LSP and structured Logs do not supply DAP.

Editor view and document contributions are in `/work/projects/Editor/packages/editor/src/`
at this baseline. After Plan 207, reusable source-position decorations belong in
`editor/packages/`; Fregat owns the debugger service, process selection and panels.

## Design

Add a server DAP owner with framed protocol parsing, request sequence correlation, event
projection, timeout/cancellation and complete process/socket disposal. Validate external
frames against typed protocol schemas. Model booting, initializing, running, stopped,
terminating, terminated and disconnected states explicitly by scoped environment/session ID.
Track threads and capabilities from adapter events; commands recheck the selected identity.
Reject stale responses after restart using a session generation.

Register the thirteen `debug.*` and `processPicker.*` equivalents in the command table.
Presets preserve Workspace session/stopped conditions, DebugPanel and RunModal contexts;
include the supplementary modal Restart row. A narrow host provider exposes domain actions.
Queries own session/config/process reads; mutations own launch, attach and lifecycle, settle
cache before completion and serialize per session. The streaming DAP event transport has an
explicit exception and updates the same projection.

Register adapter binary, launch/attach defaults and timeouts in application/machine settings;
secrets use secret storage. Use Plan 257 build/run ownership and retained terminals for debug
output. Render a ToolPane with session/thread pickers and lifecycle controls. Add Editor
source-position decorations only through package contribution APIs.

## Steps

- [ ] Add failing fake-adapter protocol and lifecycle tests before registering commands.
- [ ] Implement typed DAP transport, process ownership, state projection and cleanup.
- [ ] Add saved launch/attach configuration, process picker and task-backed rerun behavior.
- [ ] Build debugger panel/selection and source position, then wire commands and presets.
- [ ] Verify fixture adapters and settings/gates; commit and deploy with server restart.

## Acceptance

- Fake adapter tests cover split/multiple frames, request correlation, initialize/launch/attach,
  pause/continue, rerun build versus direct restart, stop during build, disconnect and stale events.
  No adapter or target process survives disposal; other sessions retain their selection.
- Add `debug-session-lifecycle` under `scripts/agent/scenarios/` with a fixture DAP adapter and
  fixture process list. Exercise all thirteen actions, stopped/running enablement and focus
  restoration. Read screenshots and cache settlement evidence back.
- Run touched transport/session tests, settings reference checks and `bun run gates`. Heavy
  checks use the wave slot wrapper. Use explicit free ports and fixture processes/providers.

## Out of scope

Breakpoints/stepping in Plan 259, values/watches/console in Plan 260, adapter marketplace and TUI UX.
