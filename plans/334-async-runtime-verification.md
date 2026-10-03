# Plan 334: Bounded async runtime qualification and measurements

Status: Approved, 2026-10-03. Execution deferred. This session designs checks; no prototypes, tests or benchmarks ran.
Owner: shared runtime qualification with Editor/terminal measurement owners. Parent: [328](328-async-runtime-master.md).
Dependencies: contract sketches in [329](329-async-lifecycle-and-transport.md)–[333](333-async-terminal-and-server-adapters.md). Q0/Q1 consume these sketches before core completion; T0 selects the private transport, then scheduler/consumer units run their relevant checks before P0. These are stage dependencies, not a cycle requiring finished migrations before qualification.

## Outcome

Resolve each architecture/dependency choice with the smallest test or paired workload that could change it. Record actual source/artifact/runtime identity, prove correctness and cleanup first, then accept boundedness/code reduction or measured performance benefits without misleading proxies.

The prior [SAB transport evidence](../editor/docs/performance/sab-transport-2026-09-12.md) remains the decision for editor text. This program does not schedule its removed paths again. New shared-memory, pool, SharedWorker or Coaction implementations are conditional on a concrete consumer and a decision they can resolve.

## Evidence identity and execution environment

Each run records checkout and dirty paths, dependency release/SHA/tarball, built host/worker/WASM hashes, runtime/browser/GPU/backend, topology, settings-policy fingerprint, scenario seed, payload digest and declared barrier. Source-only library findings and historical product measurements are not fresh baselines.

Committed fixtures run from a fresh clone using checkout-relative/OS-temp/configured paths. Missing optional runtimes/tools skip with an explicit reason; a supported shipping target cannot silently skip. No hardcoded owner home, /work, hostname or private account. One-off host proofs live outside the repository and their evidence stays with the recorded run.

Use the project's heavy runner for suites/browser/build/bench, quiet admission for measurements, and existing on-demand dev routes. A private server has an explicit free port and declared server accounting; it stops after the run. Each quiet run fits its existing hold bound and records declared servers/pressure. Heavy resource policy remains separate from package admission.

App verification uses verify-fregat look/scenario/trace/renders/caches for its real surface and claim. Read screenshots and logs. No deployment or UI evidence is required for this planning-only commit; actual consumer changes inherit their shipping gates.

## Staged decision matrix

| Stage            | Fixed scope                                                                                                                 | Primary evidence                                                                              | Decision/stop                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Q0 qualification | Current codec, narrow Comlink and finite typed channel; one local fixture plus real browser and required Bun built artifact | Equal payload/ownership/outcomes; startup/close/clone errors; minified assets                 | Eliminate a backend that cannot meet contract before timing it |
| Q1 lifecycle     | One real busy worker and deterministic endpoint transition suite                                                            | Exactly-once settlement, genuine stop/cleanup, generation rejection, owned counts             | Any unsettled record/leak/unsafe replay blocks adoption        |
| B0 baseline      | One retained syntax workload, one watch event stream, one streaming terminal; cold and warm separately                      | Queue/run/bytes, engine state, timing barriers, host/whole-process work                       | Freeze scenario/caps/margins before candidate comparisons      |
| T0 transport     | Surviving codecs, same actor/domain algorithm and payload trace                                                             | Host/worker serialization, dispatch/settlement, allocation, built size, total maintained code | Choose codec; remove losing candidate                          |
| S0 scheduling    | One owned mixed scope, current policy vs bounded candidate                                                                  | Queue/byte peaks, wait/run claims, background progress, cancelled wasted execution            | Choose smallest policy meeting bounds and product gates        |
| R0 recovery      | Two applicable projections only if reuse is demonstrated                                                                    | Exact final state, gap/reset/epoch behavior, stalled subscriber caps                          | Factor shared helper or keep domain recovery explicit          |
| P0 product       | Affected Editor/terminal/server surfaces only                                                                               | Existing paired typing and qualified terminal frame/hardware checks plus live evidence        | Ship bounded units or rescope one identified regression        |

Browser capability qualification covers Chromium and affected Firefox/WebKit source and built assets. GPU timing uses hardware only. Node Worker support is conditional on an actual shipping consumer; pure scheduler tests remain Node-portable. Avoid a runtime × renderer × workload × codec Cartesian product. Expand only a cell whose failure implicates another supported contract.

## Correctness cases before measurements

1. Start success/failure/no-ready; duplicate start; close during start; repeated close. A known-good ready request is observed before diagnosing missing readiness.
2. Reply/error/messageerror/clone failure/death/missing reply; reentrant handlers; completion races with cancellation/deadline; late old replies. Every admitted request has one settlement, current generation only, and released owned request/listener/port records.
3. Queued withdrawal before transfer versus caller-wait cancellation after dispatch. A gated real worker continues computation in the latter case until an actual cooperative/forced stop is observed; running credits remain charged. Verify outcome-unknown after committed effects with lost receipts.
4. Ordered mutation lane versus concurrent revision-bound read lane. Use yielded handlers so FIFO posting cannot accidentally pass as FIFO completion. Drain participants can enqueue one another and must converge or give up with an informative outcome.
5. Clone preservation, transfer detachment, shared backing views/deduplicated transfer lists, rejection before ownership moves. Cached PDF bytes and public terminal write inputs remain readable; direct producers own transferred buffers.
6. Lossless direct stream with a stalled consumer, finite count/byte capacity and explicit producer behavior; replaceable complete projections; edit/patch composition and full-reset controls. No dropping lossless data to satisfy memory bounds.
7. Two independent ports with intentionally reordered data/control delivery. Issuer/stream/generation-scoped fences, events-before-success-and-failure replies and exact native/layout/frame provenance must hold under resize/replay/reset/close. Include an async subscriber calling another command, and saturation with a fence-waiting resize, paused data, credit return and close; prove no credit/lane deadlock.
8. Disposal while page rAF is suspended, unresponsive cleanup, lost GPU/port, worker/font/cache resources and host canvas replacement after crash. A cleaned request map is not proof native/GPU resources were reclaimed.
9. Optional projection duplicate/gap/old epoch/invalid update/full-sync race; atomic replacement leaves prior snapshot intact on invalid input. Domain applied revision and presentation barrier remain independently observable.
10. Actual consumer artifact loading: WASM/grammar/font/worker URLs in browser/Bun, ref:false/deployed server bundle paths, structured error round trip and safe logs. Preserve 306's separate loader bug scope.
11. Package tarballs and exact Editor/ghostty mirror install/build with no siblings; required dependency release before consumer mirror. Source workspace success is insufficient.

Use deterministic fake endpoints only for state-machine branches and bounded extreme ID/capacity cases. Real workers/ports/resources prove execution behavior. Mock only external systems; tests use actual state and in-process app fixtures where applicable.

## Baseline and paired comparisons

Capture cold worker startup/first-ready separately from warmed retained-service requests. Freeze payload bytes, edit trace, domain algorithm, cache warmness, result digest and transfer policy. Measure transport stages independently, then the full workload; lower postMessage time alone cannot earn adoption.

Collect queue delay, accepted/replaced/rejected work, runnable/continuing execution, actual cancellation stop/drain, p50/p95/p99 settled times, message and copied/transferred bytes, host/worker CPU, whole renderer/native/GPU/process CPU where observable, peak/retained memory and owned resource counts. Label estimates and missing per-actor visibility. Do not subtract unsynchronized performance.now clocks across actors.

Typing measurements reuse [282](282-fast-paired-input-latency-check.md)'s current qualified identity, positive controls, stopping rules and margins. Its recorded default has an unresolved rejection; this plan cannot declare it passed or collect its deferred loaded/full matrices by implication. Work requiring 099 units 2–7 retains both their explicit owner request and a qualified typing gate.

Terminal measurements reuse [283](283-ghostty-output-and-input-latency.md)/[287](287-ghostty-worker-mode.md). Identify the compositor presentation of the exact submitting worker frame and qualify actor clock joins before reporting input-to-presentation. Submitted worker diagnostics/rAF/reply timestamps are not presentation. Use hardware qualification and the existing balanced-pair/CPU-resolution policy; plan 287 permits at most one actual renderer-frame p95 latency regression.

For new transport/scheduler cases, have the owning domain accept any effect/regression margin from the applicable baseline and product gate before collecting candidate timing. Use four fixed balanced pairs, comprising two complete AB+BA blocks, for the new transport/scheduler screen. An unresolved result gets one cause-specific next action; there is no automatic extension. This new pilot rule never overrides 282/283/287's stricter existing rules. Record paired intervals/quantiles and warm-up policy; do not treat correlated edits as independent samples.

Positive controls deliberately block the host, slow the worker, fill a queue, omit an acknowledgment or delay a projection. They must change the metric being used to judge that mechanism. A/A qualifies drift/measurement sensitivity before a speed claim. Define one fixed open/edit/dispose cycle count and resource baseline; use deterministic owned counters plus available heap/native evidence. Do not demand exact global heap equality or unlimited soak runs.

## Acceptance and stopping

- Required correctness, buffer ownership, outcome accounting and cleanup all pass; otherwise stop that candidate and fix/rescope the root cause.
- Queue/count/byte caps hold at their boundary, and claimed fairness holds for actually ready work within a finite dispatch-opportunity bound under sustained high-priority demand. A halted independent actor is not ready work. Tune only a parameter with measured demand and a declared setting/policy owner.
- Performance acceptance uses the owning product margin and matched artifact identities. Speedup is optional if lifecycle correctness or verified total code reduction is the benefit, with no material product regression.
- A moved main requires re-verification only for overlapping paths/shared contracts. An unrelated green base move follows the existing merge rule; no habitual benchmark repetition.
- A failed/unqualified cell produces one narrow next action and an explicit unresolved conclusion. Preserve accepted historical results; do not widen a gate until it becomes green.
- Finish a stage when its declared decision is resolved. Repeat only after a relevant source/artifact/policy/instrument change, exposed failure or previously unresolved supported target.

## Execution checklist

- [ ] Freeze source/release inventory and qualification manifest; refresh terminal work in flight.
- [ ] Complete Q0/Q1 correctness/artifact/ownership gates and discard failing codecs.
- [ ] Capture B0 baseline and predeclare each candidate margin/stopping rule.
- [ ] Complete T0 and record dependency/code-size/maintenance choice; delete losing production alternative.
- [ ] Complete S0 only for a demonstrated competing scope and choose bounded policy.
- [ ] Complete R0 only for demonstrated reusable projection behavior; record factoring/no-factoring decision.
- [ ] Complete affected P0 gates under the owning plans; preserve unrelated/unqualified exclusions.
- [ ] Commit portable checks, retain compact evidence/raw receipts, run required build/type/gates and standalone packaging checks, then verify live delivery for migrated consumers.

## Reporting

Each delivered unit records the question, exact command/artifacts, control and result, accepted claim, remaining limitation and next triggered action. Evidence goes under docs/async-runtime or the existing domain evidence home; checklists/order remain in these plans. Research pins do not become runtime PASS results. This planning delivery records no new performance figures.
