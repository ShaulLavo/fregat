# Plan 257: Project tasks, runnables and rerun commands

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-38, tasks and setup tasks. Size: L.
- Depends on Plans 206, 246, terminal commands, 239, project ownership, and 187, visible setup
  terminals. Center-terminal placement follows Plan 209's separate implementation decision.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Choose a project task or source runnable, run it with file/selection context, rerun it with
retained or refreshed context, and edit the worktree's setup tasks.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `task::Spawn` selects a task by name/tag or opens the task picker. Its `reveal_target: center`
  payload places the terminal in the central pane.
- `task::Rerun` reruns the last task, retaining resolved context by default. Its
  `reevaluate_context` payload can resolve current file/selection context again; optional
  concurrency/new-terminal overrides belong to the same task operation. With no previous task,
  Zed opens the picker. `terminal::RerunTask` reruns the focused terminal's task identity.
- `new_process_modal::ActivateTaskTab` focuses the task mode in the process picker.
- `zed::OpenWorktreeSetupTasks` opens the local tasks file and inserts a harmless
  `create_worktree` hook example when needed.

Sources: [zed_actions/lib.rs, payloads](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed_actions/src/lib.rs#L733),
[tasks_ui.rs, rerun](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/tasks_ui/src/tasks_ui.rs#L101),
[terminal_view.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/terminal_view/src/terminal_view.rs#L707),
[new_process_modal.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/debugger_ui/src/new_process_modal.rs#L607),
[zed.rs, setup authoring](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed/src/zed.rs#L2505).

## Existing Fregat behavior

`apps/web/src/features/command-palette/hooks/use-scripts.ts` already discovers saved scripts,
`package.json` and `t3.json`; its `components/script-row.tsx` keeps unimported `t3.json` entries
disabled. `apps/web/src/features/chat-mode/utils/project-scripts.ts` handles script suggestions.
`apps/server/src/orchestration/setup-runner.ts` owns setup lifecycle; Plan 187 moves execution
to visible terminals. `apps/server/src/terminal/service.ts` and `packages/pty/src/process.ts`
own process/terminal lifecycle. Extend these owners. Editor changes are unnecessary for
file/selection capture through its existing host API; language runnable discovery needs a contract.

## Design

Register `task.spawn`, `task.rerun`, `terminal.rerunTask`, `processPicker.activateTask` and
`worktree.openSetupTasks` in the command table. Preserve typed `reevaluate_context: false`
and `reveal_target: center` payloads and Workspace/Terminal/RunModal/WorktreePicker contexts in
Plan 206 preset data. Keep central placement unavailable until Plan 209's host capability exists.

Represent task templates, immutable resolved run contexts and run IDs separately. Context
contains project/worktree, file, line/column, selection and language-runnable metadata.
Reuse current script discovery and add source-runnable providers as typed adapters. Task/run
reads are queries; launch, rerun, cancel and setup writes are serialized mutations that settle
the run cache. Completion, exit status and terminal history come from Plan 187/terminal owners.
Terminal rerun uses its task ID even when another project has the most recent global task.

Keep saved/imported script authorization. Opening or saving setup configuration alone starts
no process. Author setup through the existing saved project-script owner, retaining its
worktree-create flags and preview/import behavior. New execution preferences belong in
application/machine settings; command/context variables are typed inputs, not new env knobs.

## Steps

- [ ] Add failing tests for task identity, context retention/reevaluation and picker fallback.
- [ ] Extend script discovery with typed task templates and language runnable adapters.
- [ ] Add run history and terminal-associated launch/rerun/cancel through existing lifecycle owners.
- [ ] Wire task/setup authoring, commands, contexts and payload-preserving presets.
- [ ] Verify alongside Plan 187, run gates, commit and deploy server changes.

## Acceptance

- Focused task tests with an injected process factory cover two projects, retained/refreshed
  context, terminal-specific rerun, concurrency, exit/failure/cancel and duplicate launch intent.
- Add `project-tasks` and extend `worktree-setup-import` under `scripts/agent/scenarios/`.
  Use fixture runnables/processes. Exercise all five actions and both input payload variants;
  check visible output, no execution on authoring and central placement once its gate is met.
  Read screenshots and cache evidence back.
- Run touched task/setup/terminal tests and `bun run gates`. Heavy checks use the wave slot
  wrapper and explicit free ports. Verify server changes on dev before mesh deployment.

## Out of scope

DAP execution in Plan 258, notebook kernels, new pane architecture and TUI task-picker design.
