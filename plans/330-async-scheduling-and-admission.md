# Plan 330: Bounded async scheduling and admission

Status: Approved, 2026-10-03. Execution deferred; planning only in this session.
Owner: shared runtime scheduling and domain execution owners. Parent: [328](328-async-runtime-master.md).
Dependencies: lifecycle/outcome contract [329](329-async-lifecycle-and-transport.md), baseline/acceptance [334](334-async-runtime-verification.md).

## Outcome

Reuse one scheduling implementation for common keyed replacement, deadlines, FIFO ordering and coalesced sweeps. Admission bounds running work, pending operation count and retained payload bytes within an explicitly owned scope. Independent editor and terminal actors keep their execution independence.

## Current code and rationale

[EditorWorkScheduler](../editor/packages/editor/src/editor/workScheduler.ts) has five task classes and latest-per-key replacement, bounded debounce, budgets, validity checks and events. [LatestAsyncRequest](../editor/packages/editor/src/editor/latestAsyncRequest.ts) often creates an independent scheduler. Delayed and nondeferred tasks can start directly; current priorities are not a cross-worker CPU allocation contract.

Server [SerialWorker](../apps/server/src/orchestration/serial-worker.ts), [SweepScheduler](../apps/server/src/orchestration/sweep-scheduler.ts) and [ReactorScheduler](../apps/server/src/orchestration/reactor-scheduler.ts) have distinct FIFO, rerun-coalescing and fixed-point-drain behavior. Preserve these observable guarantees. The host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill, remains the separate OS/process measurement and build supervisor.

[Multithreading research](../docs/async-runtime/multithreading.md) shows why worker count alone is insufficient: every submission is posted, async handlers may overlap, and function-code affinity does not preserve document state. Hardware concurrency is a capability hint, not a memory limit or admission policy.

## Design

Keep the reusable algorithms small and separate by guarantee:

- A latest-work lane replaces only compatible queued work and rejects stale results. Deadline-preserving debounce survives replacement. Domain predicates supply identity/revision/configuration validity.
- A FIFO lane orders mutations and acknowledges each command's declared completion. Handler failure settles that command and leaves the lane usable according to policy.
- A coalesced sweep permits one active run and at most one rerun request. Close stops the timer, rejects new runs and awaits active work within its owner contract.
- A drain coordinator checks a set of independent sources until all are idle in the same observation turn. The application supplies the participant graph, dependency order and give-up policy.
- An optional scope admission budget controls counts/bytes across named lanes or actors belonging to that owner. A scope is passed explicitly; no module singleton, automatic whole-app actor registry or cross-machine global scheduler.

The scheduler belongs to an execution scope, not to each arbitrary call. Reuse a shared scope only where competition actually exists. Actor-affine commands stay with their actor; fair admission does not migrate retained state. An independent pool is deferred until an inventoried stateless workload and bounded memory baseline justify it.

Define separate resource claims. A caller-wait slot can close when its caller stops waiting. A running execution claim remains until completion, acknowledged stop, or confirmed generation resource reclamation. Never release CPU/byte admission merely because a promise rejected. Owned queued payloads return or are consumed under their declared withdrawal/replacement law before dispatch. Actor residency has a separate claim released after qualified cleanup/reclamation, not command completion; uncertain native/GPU retention stays conservatively accounted within a finite quarantine policy.

Bound queue entries and bytes independently; include staged stream chunks, pending results and acknowledged-but-retained domain state in the cost model. Payload-size estimates are labeled estimates; endpoint/workload memory measured in 334 informs the policy. Avoid pretending generic JS can account precisely for native WASM/GPU/process memory.

Every admission attempt is accepted, replaced/coalesced by a declared domain law, or rejected/deferred with a typed capacity outcome. The caller knows whether ownership transferred. Lossless mutation/event lanes never silently drop. A latest projection can replace pending snapshots; edit chains require composition or a complete reset.

Priority influences dispatch among ready tasks inside its declared scope. Fairness/aging or weighted budgets prevent indefinite starvation under sustained high-priority input. Select the smallest policy that the measured mixed workload requires; specify a finite service bound in dispatched opportunities, then verify it. A synchronous computation requires its own checkpoints/atomic flag or whole-actor stop; priority alone cannot preempt it.

Control and shutdown retain progress under saturated data traffic. Reserve finite control capacity and specify progress dependencies. A fence-waiting control must not hold the final credit needed to process its data/acknowledgment. Stop, credit return, readiness and cleanup progress outside saturated ordinary admission while staying bounded; owned termination is the last bound if execution cannot respond. The terminal's frames/bytes have domain cadence; a generic timer does not redefine them.

Use existing settings for app policy. Any new application knob is registered in contracts/settings in the same consumer change, with scope appropriate to execution. A standalone library accepts a caller-owned policy value. Add no hidden env vars or arbitrary production tuning constants.

## Migration boundaries

Keep named task classes in the Editor if their meaning is editor-specific; map them to reusable lane/admission policy through an adapter. Preserve current debounce/maxDelay and failure behavior before tuning. Source publication and inexpensive synchronous input remain synchronous.

Serial/sweep extraction changes implementation, not application scheduling semantics. Reactor fixed-point drain and engine shutdown ordering stay owned by orchestration. Do not serialize independent reactors into one runtime queue, or replace process/systemd scheduling.

Task execution remains usable outside React. App actions continue through existing TanStack query/mutation options/runMutation, including cache settlement. Package state supplies execution facts to those owners; it does not create a second query cache or local pending flags.

## Execution checklist

- [ ] Trace all scheduler call sites and record immediate/delayed/deferred behavior, keyed replacement, failure semantics, drain participants and configured policies.
- [ ] Capture current queue/run/payload peaks and mixed editor/terminal behavior in 334 before choosing caps or fairness policy.
- [ ] Extract latest-work, FIFO and sweep guarantees one at a time with deterministic transition tests; preserve deadlines through replacement and drain reentrancy.
- [ ] Add explicit owner-scope admission and separate wait/running claims. Test overflow, cancellation, clone failure, resource loss and queued transfer ownership.
- [ ] Qualify a sustained mixed workload with an input lane, a streaming terminal, derived editor work and background sweep. Require bounded queue/bytes and finite background progress.
- [ ] Adopt shared scopes only where those measurements demonstrate competition. Retain per-actor state and bypasses explicitly justified by streaming/intent queues.
- [ ] Migrate each old scheduler's callers and delete obsolete implementation/tests in the same verified unit. Keep domain compatibility adapters only when they encode policy.
- [ ] Re-run the affected narrow latency/drain checks, update consumer error/log/settings references if touched, build, ship and record evidence.

## Verification and acceptance

Model tests use deterministic clocks and explicit completion gates. They must catch real failures: continued claims after wait cancellation, unbounded queue growth, missed reruns, starvation, reentrant drain, delayed supersession and shutdown under saturation. Real endpoint tests prove the claims match actual execution.

A scheduler change affecting typing inherits Plan 282's qualified acceptance and current failures; it cannot widen margins or reinterpret a rejected key. Terminal latency inherits Plan 287's renderer-frame gate after presentation qualification. A queue policy can be accepted for verified boundedness/code reduction with unchanged performance, without claiming a speedup.

Done means the required bounds/ordering/fairness are documented and proven, migrated duplicate schedulers are deleted, independent actors remain independent, domain acceptance passes, and no pending/execution resources survive owner teardown.
