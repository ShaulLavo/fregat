# Measurement grounding for the shared async package

Status: research input to [Plan 334](../../plans/334-async-runtime-verification.md), which owns stages, ordering and execution. Execution is deferred. Research date 2026-10-03; no implementation, installation, test, browser, or benchmark run occurred here.

## Governing evidence and boundaries

Read [inventory](inventory.md), `comlink.md`, `multithreading.md`, and `coaction.md` from this research run, plus [Plan 282](https://github.com/ShaulLavo/fregat/blob/6d8e768703c1bfc92091dbdd41c9171d5942f263/plans/282-fast-paired-input-latency-check.md), [Plan 283](https://github.com/ShaulLavo/fregat/blob/6d8e768703c1bfc92091dbdd41c9171d5942f263/plans/283-ghostty-output-and-input-latency.md), [Plan 287](https://github.com/ShaulLavo/fregat/blob/6d8e768703c1bfc92091dbdd41c9171d5942f263/plans/287-ghostty-worker-mode.md), `https://github.com/ShaulLavo/heavy-runner/blob/main/README.md`, and `.agents/skills/verify-fregat/SKILL.md`.

- Plan 282 ships an explicitly failed verdict: 215/216 keys pass, actual quiet default 855.026 seconds; short-lines/multiple/undo/inputToApplied remains unclassified. Preserve `passed:false`, exit 1, unchanged budgets and its follow-up ownership. This is historical evidence, not a clean baseline for the package.
- Plan 282 quiet default is Platform+native; loaded default is native+disabled. Full retains ten configurations. Loaded worker-backed Tree-sitter and four compositions use `max(frozen margin, 5 ms)`; quiet/advisory margins stay frozen. That floor must not spread to other workloads.
- Plan 282's repaired execution/dependency receipt changed instrument identity without another collection. First future use regenerates controls; old controls cannot qualify changed instrumentation.
- Plan 099 units 2–7 remain separately owner-gated. This package program supplies prerequisites and comparisons; it does not authorize those units or duplicate document authority/contribution synchronization.
- Plan 283 owns terminal renderer targets, native/WASM correctness and hardware presentation instrumentation. Plan 287 owns worker-mode product acceptance, including independent-producer responsiveness and per-actor clock/frame qualification. Package integration reuses those gates.
- Preserve accepted SAB text deletion. Optional shared-memory studies require a new concrete consumer and an explicit decision to revisit that representation. No universal SAB branch, isolation change or shared-document storage benchmark belongs to the initial program.

## Candidate stages (reference)

Each stage starts only after its prerequisite passes. Record the question, selected arms, receipt hashes, scenario, stopping rule and outcome before the next stage. A full cross-product of libraries, runtimes, schedulers and document sizes is unnecessary.

| Stage                            | Smallest scope                                                                                                                          | Outcome needed before proceeding                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0. Reconcile inputs              | Refresh in-flight terminal PRs, current built exports, exact dependency versions and package mirror prerequisites.                      | Explicit baseline commit/product hashes, transport contracts and current known failures.        |
| 1. Correctness and observability | One local endpoint and one real browser Worker, then one actual Bun Worker. Deterministic protocol/failure traces.                      | Caller/actor ownership, acknowledgments, bounded cleanup and observable positive controls pass. |
| 2. Transport choice              | Current request broker A, narrow Comlink B, finite typed channel C; equal actor, work, payload and supervisor contracts.                | Choose by required correctness, total adapter complexity and actual-built workload costs.       |
| 3. Scheduling and lifetime       | Chosen transport only; existing local schedulers versus scoped admission candidate. One editor plus independent finite background jobs. | Preserved typing, bounded queues, actual cancellation and independent actor progress.           |
| 4. Streams and actors            | Terminal independent producer/control ports; batched Bun watcher attach/events/detach.                                                  | Lossless bounded delivery, cross-port barriers, cleanup and actual consumer acknowledgments.    |
| 5. Optional projection           | One accepted small metadata projection only; compare domain summary with optional mirror protocol/Coaction.                             | Recovery/authority correctness and reusable need justify the added package layer.               |
| 6. Product acceptance            | Narrow affected scenarios and approved Editor/terminal gates; exact consumer mirror installs and built artifacts.                       | Measured gates, UI evidence, cleanup and delivery contracts pass.                               |

## Stage 1: make the failure observable first

Use numbered operations with a worker-side operation ledger and explicit receipts for received, admitted, execution-started, execution-stopped/completed, state-committed and cleanup-completed. Ledger is test instrumentation, not payload logging. Confirm a known-good request produces each required receipt before diagnosing its absence.

- Exercise startup/import failure, clone/transfer failure, unexpected worker error/exit, missing reply, endpoint closure, graceful disposal and hung cleanup. Every admitted request settles exactly once; counters, listeners, owned ports/subscriptions and retained actor state reach the declared final state within the contract's bounds.
- Before-admission cancellation must prove no execution start and no buffer transfer. Running cooperative cancellation must acknowledge a stop checkpoint; waiter rejection alone records execution state as running or unknown. Force termination proves death, invalidates generations, recreates domain resources if required and settles callers.
- Let an aborted request finish late, then restart the worker and reuse a logical request subject. Old-generation replies/events cannot publish or settle new-generation work. Never use an opaque overwritten ring slot as identity; include the 65,537 outstanding-callback case as a cheap deterministic endpoint test, not 65,537 real parsers.
- Yield within two stateful commands to expose ordering. Assert actor mutation order and events-before-corresponding-settlement from Plan 287. Concurrent safe reads may overlap only where the domain contract permits them.
- Fault after commit and before response. Require unknown outcome unless an authoritative receipt proves completion. Do not automatically replay state-changing work without tested operation deduplication/idempotency.
- Prove clone preservation, permitted transfer detachment, subarray backing-buffer ownership, duplicate views, transfer failure and no transfer after rejected admission. Native wasm memory stays actor-owned; ordinary terminal writes preserve caller buffers.
- Verify release/cleanup separately for installed Comlink v4.4.2 and any patched/current-source candidate. Released/current differences do not disappear behind a common dependency label.
- Baseline failures retain their receipts. Fix or isolate the exact known failure under its existing owner before a candidate-versus-baseline correctness claim. A candidate need not inherit a baseline lifecycle bug to preserve comparable computation.

Runtime scope expands by consumer: browser built module worker first, Bun when a server adapter is included, Node only for a supported package export. Chromium, Firefox and WebKit get relevant lifecycle/transfer/OffscreenCanvas correctness coverage where supported. Stated capability skips are not passes for a promised export. Software GPU correctness can run in CI; timing requires qualified hardware.

## Stage 2: transport comparison without changing the workload

Start with one retained editor worker request path: Tree-sitter registration/open, acknowledged small edits, one viewport query and packed result transfer. Preserve source chunks, parse/query logic, cancellation capability, worker/document generation and disposal semantics across A/B/C. If terminal scaffolding is ready, use one low-rate control request as a second consumer; preserve its direct output port.

Use a tiny scalar control to expose framing cost, an existing ordinary fixture with small incremental edits, and an existing supported large-file fixture with realistic packed results. Do not multiply every fixture by every runtime at the first comparison. Actual product-tier admission stays equal. A disabled-analysis large file cannot be presented as a large-parser throughput sample.

Record request count/bytes, transfer versus clone policy, pending peaks, host serialization/post cost, actor queue delay, execution duration, response construction/delivery, caller settlement, first-ready/module startup and disposal. Capture actual host/worker chunk sizes and dependency exports from production bundling. Compare error/cleanup/supervision adapter code as well as removed broker code. A Proxy transport with a second pending map may save fewer lines than its public API suggests.

Qualification probes include actual minified Vite workers and Bun/deployed server worker resolution, actual CSP, Unicode function text, static and dynamic imports, bundler/transpiler helper references, alias/package imports and endpoint release. Multithreading function shipping is an optional screened candidate for independent jobs only; stateful actors use explicit module entries. No measurement follows from a development-only success.

Screen B and C against required contracts, then measure surviving candidates in four fixed balanced pairs per selected trace, AB/BA twice, using one session with equal warmup and reset/readiness contracts. Complete both sides of a pair. Freeze operation/sample counts before collecting; select counts from existing scenario/benchmark defaults and retain raw records. Report p50/p95/p99 descriptively where sample counts support them; bootstrap paired run differences separately from request tails. This screen adds no new product regression margin.

Stop transport exploration after the contracts pass and one arm clearly reduces total maintenance without losing approved product performance. A neutral timing result is acceptable for a justified code reduction. If the arm adds more cleanup/protocol code than it removes, retain the simpler arm. Do not build an entire library compatibility layer to rescue a tiny transport comparison.

## Stage 3: admission, cancellation and retained memory

Replay one fixed editor burst/scroll/undo trace while independent finite CPU jobs run. Preserve document services on their retained owners. Compare existing scheduler behavior with a scoped scheduler candidate using identical work; do not simultaneously change transport, pooling and caching.

Record arrival, admission, runnable/start/stop, queue age by class, coalesced/replaced jobs, discarded-before-start count, stale-result count, actual stopped work, wasted execution after waiter cancellation and jobs/bytes at peak. Class priority is a relative order; admission cannot preempt a synchronous worker unless it has a cooperative stop path or worker termination. Verify independent high-priority actor progress with a deliberately long background job positive control.

Start at fixed one/two/four independent-job workers only if a pool is actually proposed. This is a placement experiment, not an automatic hardwareConcurrency policy. Fixed actor counts remain equal across arms. Stop the arm at the existing heavy-job ceiling or any declared finite queue bound, preserving failure evidence; do not increase ceilings to finish it.

Retained-lifetime trace: open the existing fixture, attach three independent views sharing the existing analysis owner, edit, close views, replace/reopen subject, crash/recreate one actor and dispose. Repeat the same bounded lifecycle trace until the predeclared count completes; compare per-cycle logical counts and retained heap at matched checkpoints. Borrow Plan 282's source/render readiness and zero-owner/worker/context checks. Full-source instrumentation retention must not create its own growth curve.

Memory reporting distinguishes payload bytes, queued credits, retained document/token/cache bytes, JS heap, WASM allocation, GPU resource counts and OS renderer/process RSS. Summed actor heaps and process RSS measure different things and can overlap. Retained snapshots/caches must follow domain leases and revisions; a projected count or cache hit is not an authoritative source-applied receipt.

## Stage 4: streams and cross-port barriers

Use a finite numbered terminal byte stream emitted by an independent producer worker with owned transferable buffers, alongside control resize/replay/dispose messages. A second case routes writes through the ordinary host API and verifies caller ownership. Split UTF-8/control sequences across chunks using existing terminal fixtures; require exact final history, ordering and no missing/duplicate bytes.

Pause the execution consumer to fill its declared byte-credit window, then resume; producers must backpressure before crossing the bound. Record produced, credited, received, parsed/applied and consumed sequences and queue bytes. A postMessage call returning proves enqueue, not consumer processing. Credits acknowledge the stage named by the protocol; control barriers state the output sequence they depend on.

Force control/data interleaving and inject delayed old-generation summaries. Resize waits for the required input/output boundary; replay/disposal acknowledge processed operations and final cleanup. Events reach subscriptions before their command settles. Summary identity includes terminal generation, submitted frame, processed sequences, native revision and committed layout. Latest projections may coalesce; lossless PTY bytes cannot.

Suspend page rAF and introduce a known host-main stall while producer/output execution continues. Execution and disposal settlement must complete under the declared contract without waiting for host paint; displayed-state freshness is measured separately. The host stall is the positive control for independent producer responsiveness, not a workload we hide from the baseline.

Bun watcher proof uses actual temporary filesystem events in one finite burst, attach acknowledgment after the watcher is active, bounded batching, unsubscribe and worker replacement. Verify filesystem state and delivered event identities, not raw platform event-count equality. Keep same-thread FIFO/sweep/reaction-loop ordering tests distinct from worker throughput; they share no implied thread-pool benefit.

## Stage 5: optional state mirrors and shared memory

A mirror proposal must name its authority and consumer. Test a small metadata snapshot with duplicates, one missing delta, authority replacement and delayed old snapshot; invalid patch application keeps the previous complete snapshot. Distinguish actor epoch, connection generation, domain revision and projection sequence. Action completion can wait for a projection barrier only when its API explicitly promises it.

Use one paused mirror during a fixed 10,000-update metadata burst, a bounded case from the Coaction lane, to compare full snapshots, composed deltas and optional Coaction. Record pending bytes, applied/recovery counts, resync coalescing, final equality and subscriptions after cleanup. A dropped delta requires composition or full sync. JSON-only transport does not receive token buffers, capabilities or PTY bytes.

Only after a concrete accepted shared-memory consumer exists: test Mutex owner death, writer starvation, timeout/abort contract, fixed-buffer OOM, cross-realm held proxies/cache after compaction, null channel payload and send/receive during compaction. No throughput study precedes these proofs. A failure excludes that implementation; it does not justify building an allocator in the shared package.

## Product gates and statistical boundaries

- Editor: use Plan 282's current runner, exact frozen budgets, supported fixtures, existing p95 group statistic, key-local seeded randomized AB/BA, two pairs only under its strict blocking guard and otherwise four. Verdict remains median paired difference above the declared budget with bootstrap interval excluding zero. Advisory groups never affect acceptance or stopping. Its conditional intervals have no claim of sequential coverage.
- Editor sensitivity: fresh instrument identity requires the real 20 ms pre-handler input and frame-stage controls, plus the named native frame key's 25 ms, then 30 ms only if needed. Reuse only exact-identity validated controls. A synthetic protocol delay cannot qualify presentation sensitivity. Known short-lines undo rejection is reported separately, never silently grandfathered as a pass for the new package.
- Terminal worker mode: Plan 287 permits no more than one renderer frame of p95 input/write regression versus the main entry. Use the actually qualified frame period, not a hard-coded 16.7 ms. Main-thread output CPU must fall to host work; report total CPU alongside it. Keep Plan 283's native/xterm CPU and input/write targets with no loss of existing wins; package work cannot excuse a renderer target failure.
- Terminal timing uses Plan 283's four balanced pairs, existing fixed frame/sample counts and hardware idle qualification. CPU attribution requires at least 100 OS CPU ticks per side and an effect exceeding one tick; unresolved rows remain null with reason. GPU foreign-load and idle-gate failures invalidate the affected timing window. SwiftShader demonstrates correctness only.
- New metrics without an approved numeric margin remain descriptive decision evidence until a domain owner adopts a baseline-derived margin. Never invent a universal 5% regression budget, reuse loaded Editor floors for RPC, or claim faster completion from lower synchronous postMessage cost alone.

## CPU, clocks and presentation qualification

Host-main trace time, worker CPU and whole renderer-process CPU are separate measures. Moving work into a worker can lower host CPU while preserving or increasing total CPU. Record renderer PID identities, worker/thread identities where observable, browser/GPU process CPU and whole-job CPU; avoid double-counting worker time already inside renderer totals. Trace stacks estimate attribution and have overhead; use separate untimed attribution runs for deep instrumentation.

Actor-local `performance.now()` values are not directly subtractable across realms. Record time origin/clock mapping, bracketed cross-actor joins and their uncertainty. Tie operations to processed sequence/native revision, submitted frame and compositor presentation identity. Render-end, postMessage receipt, acknowledgment, GPU submission and screenshot capture are distinct endpoints. A matching glyph in a screencast is a correctness check, not a latency clock. Missing/unqualified worker-frame presentation yields a stage-duration report, not input-to-presentation latency.

## Portable execution, evidence and stopping

Future scripts run from a fresh clone using checkout-derived paths, OS temp/configured evidence roots and explicit capability probes. No hard-coded host paths in committed tests. Root and exact Editor/ghostty mirror installs build without sibling workspaces. Source tests do not substitute for published package manifests, real worker assets and bundled server checks. Runtime/product receipts include commit/dirty paths, lock/dependency graph, config, source/WASM/font/bundle hashes, browser/GPU/runtime versions, scenario, order seed, sample count and instrument identity.

Actual heavy work uses the installed runner from the required directory, `--class browser|build|bench` and `--quiet` for timing. Quiet admission and execution have independent configured bounds, default 600 seconds. Split stages/configurations into independently admitted bounded jobs if needed; preserve pair/control boundaries and receipts. Aggregate completed configuration time is not one actual CLI wall time. Expiry exit 75, interruption or crash earns no complete verdict; no infinite retry loop or automatic ceiling increase.

Use the project's isolated `verify-fregat` scenarios, canonical selectors and fixture provider for product proof. Required UI evidence includes real actions/results, logs/errors, screenshot read-back, trace comparison for performance, renders for render claims and caches for settlement claims. Restore/stop all owned producers, workers, ports, contexts and temporary servers even after partial setup. Evidence stays. Owner data and live provider accounts are excluded.

Stop and report the smallest cause when correctness fails, sensitivity fails, a qualified gate rejects, a job exceeds its bound, GPU/clock identity cannot be qualified or instrumentation alters retained state. Repair the cause, re-run only affected correctness, then regenerate controls if execution/instrument identity changed. Another proof round after Plan 282's existing bounded stop requires its owner's authorization; do not rewrite that exception into an unbounded package loop.

Re-run after changes to payload ownership, ordering, worker generation, scheduler policy, dependency/build/runtime graph, WASM/fonts/renderer, clocks or measurement code. Do not repeat a green matrix for unrelated prose or code paths. Broaden only to the newly affected consumer/runtime/renderer. A benefit smaller than qualified noise can still justify simpler shared code; a complex scheduler/state layer needs a concrete consumer benefit or reduced total implementation.

These proposals informed Plan 334. Runtime correctness, new baselines, transport selection and performance remain unconfirmed; the owning plans govern future execution.
