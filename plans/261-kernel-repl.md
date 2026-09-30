# Plan 261: Kernel-backed REPL and kernel lifecycle

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: L. Depends on Plan 206, Plan 257, Plan 246. Approved work scheduled later, after these dependencies.

Triage assignment: ZT-42 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Execute selected code or a runnable cell in a local kernel, see anchored results, keep the caret in place or advance, and interrupt or restart the kernel.

## Zed actions and behavior

- `repl::Run` and `repl::RunInPlace` use `Editor && jupyter`. The shared run path derives runnable ranges from the newest selection, chooses the worktree/language kernel, reuses the editor session and anchors outputs to source. Run advances; RunInPlace retains the caret. [crates/repl/src/repl_editor.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/repl_editor.rs#L204) and [crates/repl/src/repl_sessions_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/repl_sessions_ui.rs).

- `notebook::InterruptKernel` sends an interrupt request to a running kernel. `notebook::RestartKernel` shuts down the current process and relaunches its specification. These handlers become available to notebook nodes in Plan 262. [crates/repl/src/notebook/notebook_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/notebook/notebook_ui.rs#L548); transport and results live in [crates/repl/src/kernels/native_kernel.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/kernels/native_kernel.rs) and [crates/repl/src/session.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/repl/src/session.rs).

## Existing Fregat and Editor support

Process/terminal ownership exists in [apps/server/src/terminal-host](../apps/server/src/terminal-host) and [apps/web/src/features/terminal](../apps/web/src/features/terminal). Typed document ownership exists in [apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts). Editor snapshots, anchored selections and transactions are in `editor/packages/editor/src/documentSession.ts` after Plan 207, verified in [the current Editor source](../../Editor/packages/editor/src/documentSession.ts). No Jupyter transport or kernel session owner was found in the current server/contracts/web source.

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Build a server kernel owner that uses Plan 257 task/process lifecycle and Plan 246 terminal ownership. Use typed kernel/session/execution IDs, a restart generation and request-to-output correlation; interrupt must remain callable while execution is busy. Queries own discovery/status/output snapshots; mutations own start/run/interrupt/restart/shutdown and settle caches. Streamed protocol frames carry a documented streaming exception. Register interpreter paths, environments and kernel choices at machine scope. Validate MIME output at the display boundary and apply Plan 179 isolation to HTML. Keep source/output content out of structured logs.

## Steps

- [ ] Add a fake Jupyter transport and a failing selection-run test plus `kernel-repl` scenario before implementation.
- [ ] Define discover/start/busy/idle/interrupted/restarting/dead states, request ordering, generation guards and shutdown ownership.
- [ ] Implement runnable-range selection and source-anchored outputs using existing Editor APIs; distinguish advance from in-place execution.
- [ ] Wire interrupt and restart independently of the execution queue; publish kernel capability contexts and all four commands.
- [ ] Render text, errors and supported rich results; register machine settings, generate `bun run settings:reference`, and add browser selectors.

## Acceptance

Fake transport tests cover selection/cell extraction, ordered execution, correlated stream/result/error messages, interrupt during a busy request, process death, restart rejecting old output, and caret behavior for both run actions. `kernel-repl` executes two fixture snippets, interrupts one and restarts without accessing a real kernel or provider. Run `agent:browser scenario kernel-repl`, `look`, and `caches` to verify output and settlement. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run deploy --server --restart`.

## Out of scope

Notebook cell documents are Plan 262. Remote kernels, automatic interpreter installation and real provider/kernel calls are outside this implementation verification.
