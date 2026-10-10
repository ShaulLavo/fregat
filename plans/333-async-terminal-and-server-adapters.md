# Plan 333: Terminal, server and dependency-owned async adapters

Status: Approved, 2026-10-03. Execution deferred; this session records contracts and migration plans.
Owner: Ghostty execution/host owners, server filesystem/orchestration owners and Platform dependency consumers. Parent: [328](328-async-runtime-master.md).
Dependencies: [329](329-async-lifecycle-and-transport.md), [330](330-async-scheduling-and-admission.md), [334](334-async-runtime-verification.md). Terminal product ownership stays in [287](287-ghostty-worker-mode.md), extensions in [286](286-ghostty-extensions.md), native renderer/performance in [283](283-ghostty-output-and-input-latency.md).

## Outcome

The terminal actor and native-watch event worker share lifecycle, bounded channels and command bookkeeping. Server local FIFO/sweep mechanisms reuse qualified scheduler code while application drain/shutdown orchestration remains explicit. Third-party and browser-managed workers retain their protocols and owners.

## Terminal work in flight

The dated [inventory](../docs/async-runtime/inventory.md) distinguishes merged API agreement [#480](https://github.com/ShaulLavo/fregat/pull/480), open native worker-renderer gate [#483](https://github.com/ShaulLavo/fregat/pull/483), open extension scaffold [#494](https://github.com/ShaulLavo/fregat/pull/494) and native-only renderer merge [#470](https://github.com/ShaulLavo/fregat/pull/470). These are background dependencies, not PRs managed by this planning task. Refresh their source and state before implementation.

Renderer feasibility/cleanup tests are not a public worker entry, production actor protocol, full dual-entry suite or Platform switch. Plan 287 remains the owner of those deliverables. This package introduces no competing worker migration or release deadline for that plan.

## Terminal boundary

The execution actor owns native/WASM terminal state, renderer resources, worker fonts, scheduling and authoritative reads. Host/main owns DOM, subscriptions, synchronous extension setup/input claim/pass, IME, focus, measurement, browser permissions and clipboard integration.

Preserve every accepted 287 guarantee:

- Main and worker entries share one async domain API. Local execution uses the same declared authoritative barriers; DOM/input hooks remain synchronous. Extension closures never cross the worker boundary.
- The host chooses main-thread or worker execution through the imported entry. Within that entry, auto selects a supported rendering backend and reports it. Explicit unsupported worker/OffscreenCanvas/backend capability fails with a structured error; it does not silently change execution topology.
- Direct PTY/output MessagePort producers reach execution independently of the page's unary command transport. Admission/credits stay usable on that path. Losing a data sequence never becomes silent success.
- Control commands name output/operation fences where ordering matters. Resize, reset, replay, selection, captures and disposal settle after their own barrier; events precede the corresponding command settlement. Retained summaries identify generation, frame, processed sequences, native revision and committed layout together.
- Caller-owned writes preserve buffers. Direct producers may transfer their owned buffers. WASM memory stays in execution. Fonts have explicit worker FontFaceSet sources/descriptors; DOM dimensions/DPR/insets come from the host.
- Font/layout generations reject stale work and hold the previous complete geometry until replacement. Submitted-frame summaries support sync geometry, not false authoritative/current-state reads or presentation claims.
- Dispose invalidates host calls immediately, frees ports/fonts/timers/native/GPU resources through bounded execution cleanup, and settles while page rAF is suspended. Closing a view/client does not kill the machine's shared terminal process.
- Crash loses worker-native state and transferred canvas resources. The terminal owner creates replacement host canvas/resources and reconstructs a session through its domain recovery policy; generic restart cannot reuse a detached OffscreenCanvas or guarantee native-state persistence.
- OSC 52 remains default-deny/write-only; native parsing and browser completion are separate. Custom OSC/native upstream prerequisites and extension behavior remain with 286/287.

Transport/owner API receives terminal protocol codecs and direct stream definitions; it does not import TerminalSession, font/GPU schemas or extension hooks. Terminal low-rate controls may use the transport selected in 329; high-rate frames/bytes retain explicit bounded protocols.

## Server boundaries

NativeWatchHost uses one lazy Bun Worker with ref:false, typed attachment acknowledgments and batched file events. Preserve watcher identities, attachment failures, next-generation startup and FileChangeHub invalidation/recovery. Event delivery must define domain batch/coalescing laws; converting each filesystem event into callback RPC adds needless machinery.

SerialWorker extraction preserves FIFO/per-enqueue failure/continued drain. SweepScheduler extraction preserves periodic/on-demand starts and at most one rerun. ReactorScheduler's fixed-point drain remains a domain coordinator because participants enqueue one another. Engine/App shutdown order remains explicit, including early LSP/terminal cleanup and stopping new provider work.

Wallpaper decoding and Claude discovery are child processes with hard-kill deadlines. LSP processes retain their JSON-RPC session pool and shutdown races. Dedicated-worker abstractions do not replace their process isolation or supervisors. OS heavy-job slices, FIFO admission and quiet measurement holds belong to the private [heavy-runner repository](https://github.com/ShaulLavo/heavy-runner) and execution-host instructions.

Queries/mutations retain origin/root/lifetime, TanStack state and cache settlement. Package scheduling does not retarget operations when selected machine changes, or turn a cancelled UI wait into rollback of committed server effects.

## Other workers and message endpoints

PDF.js's worker URL/task protocol stays library-owned. Use its loading task destroy and render cancellation APIs; preserve copied cached input bytes, scripting/evaluation restrictions and existing consumer lifecycle tests. Add a common diagnostics/lease adapter only if supported APIs expose useful facts, without installing our RPC inside its worker.

Production push service worker and demo MSW service worker have browser-managed install/activation/event lifetimes. Keep them outside worker count/admission/disposal ownership. They may reuse a proven neutral codec only if a real message contract needs it. Page/window demo readiness and native shell IPC retain origin/host authentication boundaries.

Command completion releases running work, not actor-resident native/WASM/font/GPU reservations. Release residency after acknowledged cleanup or qualified adapter reclamation. Uncertain resources retain conservative finite accounting; report forced termination separately from memory reclamation.

## Execution checklist

- [ ] Refresh the terminal/native-renderer PRs and source; agree the small package interface with 287/286 owners, avoiding shared-host edits from competing lanes.
- [ ] Qualify the shared owner/direct channel against 287's real worker fixtures and preserve native/font/GPU cleanup proof. Add production actor-generation/barrier fixtures, not success inferred from feasibility diagnostics.
- [ ] Integrate package control/stream plumbing in the existing local/worker execution adapter. Keep domain public API and synchronous host input/extension behavior coherent in every API-changing unit.
- [ ] Complete 287's operation matrix/worker entry and migrate its Platform/site consumers through 287. This plan records shared-runtime integration; it does not mark those phases done independently.
- [ ] Prove exact standalone ghostty mirror/tarball dependency install/build before consumer delivery; initial shared-package publication is a separate gate under 207. Patch versions only.
- [ ] Migrate native watch worker controls/events, delete its duplicate broker, test attachment/crash/recovery/teardown and reverify FileChangeHub behavior.
- [ ] Extract server FIFO and sweep mechanisms in separate narrow units; preserve fixed-point drain and app cleanup order. Prove failure/reentrant enqueue/close behavior without live-provider automation.
- [ ] Audit PDF/task and service-worker lifecycle boundaries; retain their protocols. Record explicit excluded owners and any supported diagnostics reuse.
- [ ] Build/typecheck affected consumers. Server changes verify on dev, then deploy with server restart; web-only consumers use web deploy. Read served release and relevant browser evidence.

## Verification and acceptance

Terminal checks include real WebGPU/WebGL worker resources, direct producer traffic, byte/cursor/selection/copy/IME/accessibility correctness, fonts/layout changes, ordered semantic events, port/control fences, partial teardown, crash/recreate and suspended rAF. Only supported worker backends are required; all shipped local renderers retain their existing suites.

Use 287's full common-entry contract and 283's qualified hardware/frame/clock instruments. SwiftShader is correctness evidence. A page-main CPU reduction cannot hide an increase in whole renderer/native/GPU work. Preserve the one-renderer-frame p95 latency bound after the exact presentation instrument qualifies.

Server checks use a real native watch worker, real temporary filesystem and current watch failure fixtures, plus local queue/sweep/drain integration tests. Verify ref:false, deployed worker asset resolution, no stranded pending attachments and no filesystem-event/per-retry log flood. No real account/provider automation is added.

Done means each migrated adapter's contract passes and superseded plumbing is deleted; dependency/browsers remain owned correctly; affected product releases run on the mesh. Native terminal production readiness is still reported by 287, never by this package alone.
