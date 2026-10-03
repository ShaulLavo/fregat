# Plan 328: Purpose-built async runtime

Status: Approved, 2026-10-03. Research and upfront planning delivered; implementation is deferred at the owner's request.
Owner: shared runtime package, Editor, Ghostty and server execution owners.

## Outcome

Build one purpose-built package for the async machinery we already own: worker lifetimes, typed commands/events, explicit movement of data, bounded scheduling and honest state/progress receipts. Preserve the domain APIs and independent execution of retained parsers, terminals and filesystem watches. Same-thread FIFO/sweep consumers can reuse scheduler modules without acquiring a worker or actor registry.

The source working name is `packages/async-runtime`. Choose its public name at the packaging gate; this planning pass creates no package, dependency or implementation. Library adoption is an internal decision, with no Comlink/Coaction proxy or store types leaking into consumer APIs.

The [research index](../docs/async-runtime/README.md) records current workers, terminal work in flight, source/release pins, two distinct architectures and the independent review. Source findings identify proof obligations; they are not runtime benchmark results.

## Direction and rationale

Choose modular owned services as the base. `createService` owns the complete lifecycle/admission/send/settlement transaction. Small scheduling modules remain independently usable; endpoint-specific adapters handle browser workers/ports and the existing Bun worker. Explicit optional scopes share budgets or aggregate diagnostics only where consumers need them.

The alternative, an owner-scoped actor/executor registry, scored 19/25 against 21/25 for modular services. It offers useful aggregate ownership, but adds registration to simple local queues and risks growing a pool/runtime before a consumer benefits. Graft its unified accounting transaction, finite control progress, subscription readiness and optional close/inventory receipts into the base. The [architecture and review](../docs/async-runtime/architecture.md) retain both candidates and the reasons.

Learn from all three libraries:

| Library                                                   | Useful lesson                                                                     | Initial package decision                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [Comlink](../docs/async-runtime/comlink.md)               | Typed remote calls, explicit transfers, endpoint separation                       | Qualify narrow private dispatch against a finite typed channel; lifecycle/error/ordering guarantees belong to us        |
| [Multithreading](../docs/async-runtime/multithreading.md) | Movement/ownership vocabulary, independent jobs, queues and shared-memory tools   | Use static entries and bounded admission; no closure serialization, automatic pool or mandatory shared memory           |
| [Coaction](../docs/async-runtime/coaction.md)             | Authority versus projection, epoch/sequence recovery, action observation barriers | Borrow the invariants; keep bulk buffers/streams and domain authority; factor recovery only after two consumers qualify |

The provisional private backend is a finite request/event channel derived from our best existing owners. Comlink can win if the released artifact meets all cleanup/outcome requirements and reduces total maintained code, including its supervisor and adapters. We do not need its entire remote object model. Full Coaction, worker pools, SharedWorker and new shared-memory representations require a concrete consumer and a bounded comparison; none is part of the initial dependency set.

## Package boundary

- `/service`: an owned lifetime, startup/readiness, generations, exactly-once operation receipts, independent cancellable waits, request/events and bounded close.
- `/schedule`: latest keyed work with deadline-preserving debounce, FIFO mutation lanes, coalesced sweeps and optional owner-scope count/byte admission. Domain classes, validity predicates and restart policy stay outside.
- `/channel`: explicit stream ownership, count/byte credits, subscription readiness/closure and issuer/generation-scoped processing fences. Lossless traffic and replaceable projections have different laws.
- Runtime adapters: static browser Worker/MessagePort and Bun endpoints initially. Node worker_threads is conditional on a real consumer. Core imports no browser globals or Platform features.
- Optional projection/diagnostics adapters: factor only demonstrated shared invariants. App service observability remains the owner's vanilla Zustand store; TanStack retains reads, mutations and cache settlement.

One deep service coordinates the machinery internally. Callers do not manually connect a scheduler, pending map and worker owner or roll back reservations after clone/send failure. Domain wrappers remain only when they enforce real provenance, protocol or ownership rules. Migrate callers and delete superseded plumbing in the same bounded unit.

## Non-negotiable contracts

1. A canceled wait does not stop execution. Queued withdrawal, cooperative stop acknowledgment, generation termination and unknown effects are distinct. Continuing work and resident resources remain accounted after a caller stops waiting.
2. Every admitted operation settles once at its declared barrier. Failure after dispatch can leave effects unknown; recovery never silently replays mutations. Generation identities reject old results and subscribers.
3. Queue entries, payload bytes, running work and actor residency have distinct claims. Completion releases running work; native/WASM/GPU residency needs cleanup or qualified reclamation. Estimates are labeled, and uncertainty has a finite conservative policy.
4. Clone/transfer/share policies are explicit. Admission fails before detachment; queued moved-input withdrawal has an explicit return/consume law. Host terminal writes and cached PDF bytes preserve ownership. Native WASM memory stays with its actor.
5. Lossless streams use bounded credits. Control/fence waits cannot hold the capacity needed to process their own acknowledgments. Events reach registered host subscribers before success or failure settlement without awaiting arbitrary async callback completion.
6. Enqueued, processed, domain-applied, projection-current, frame-submitted and frame-presented are different receipts. Cross-port arrival and worker rAF cannot substitute for their barriers.
7. Startup/close are bounded and idempotent. Port closure alone may not reveal peer death; owned endpoint signals and declared deadlines are necessary. Page rAF suspension cannot prevent command/cleanup settlement.

## Inventory and migration ownership

The [inventory](../docs/async-runtime/inventory.md) covers five dedicated Editor worker owners, the server native-watch Bun worker, same-thread orchestration, PDF.js's configured dependency worker, push/MSW service workers, native IPC/processes and terminal work in flight.

The terminal is the demanding stream/ownership consumer. [PR #480](https://github.com/ShaulLavo/fregat/pull/480) merged its async API agreement; #483's worker renderer gate and #494's extension scaffold were open at research time. OffscreenCanvas support and a renderer fixture do not mean the production terminal actor/worker entry or Platform switch has shipped. Refresh those heads before implementation and coordinate through Plans 287/286/283.

PDF.js and LSP retain their existing protocols and qualified lifecycle owners; no second RPC layer. A no-adoption decision is valid where a forwarding wrapper offers no benefit. Browser-managed service workers, native child processes and the heavy runner remain separate execution models. The package does not terminate or globally schedule them.

## Execution map

| Plan                                                                       | Deliverable                                                                     | Dependency/order                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [329: lifecycle/transport](329-async-lifecycle-and-transport.md)           | Freeze usage/types, bounded owned service, compare private codecs               | Starts with 334 Q0/Q1 fixtures using contract sketches                               |
| [330: scheduling/admission](330-async-scheduling-and-admission.md)         | Reusable lanes and explicit bounded scopes                                      | Qualified lifecycle; baseline only for policy decisions                              |
| [331: state/revision contracts](331-async-state-and-revision-contracts.md) | Exact receipts; optional reusable recovery                                      | Freeze identities with 329; factor after two real consumers                          |
| [332: Editor migration](332-async-editor-migration.md)                     | Bounded broker/scheduler migration with current APIs                            | Core/package qualification and standalone publication; 099 source work remains gated |
| [333: terminal/server adapters](333-async-terminal-and-server-adapters.md) | Terminal direct streams and Bun watch; local queue extraction                   | Core plus owning terminal gates; watch can proceed independently                     |
| [334: verification/measurements](334-async-runtime-verification.md)        | Qualified artifacts, lifecycle proof, baselines and decision-driven comparisons | Q0/Q1 → T0/core choice → relevant scheduler/consumer units → P0                      |

When the owner starts implementation, the first unit is one static local/real-worker qualification fixture with identical outcomes/payloads for finite dispatch and narrow Comlink. Prove start/crash/close, continued computation after wait cancellation, buffer ownership, ordering and actual built assets before measuring it. Then choose the private backend, finish only the required core and migrate a small retained service such as spellcheck. Add the terminal two-port control fixture before committing a stream API; do not wait for complete Platform conversion to discover a credit deadlock.

Publish the required shared dependency before a mirrored Editor/Ghostty consumer imports it. Plan 207 owns exact standalone install/build and publication constraints; workspace aliases or a root symlink are insufficient. Publication infrastructure remains a separate bounded delivery unit. Do not create a new mirror without its owning decision.

## Existing gates remain

- [099](099-document-contributions.md) owns document authority/publication/journal/contribution delivery; units 2–7 need the explicit owner request and qualified [282](282-fast-paired-input-latency-check.md) check. This package adds no second document runtime and grants no source-delivery execution permission.
- The accepted SAB text removal stays. Retained strings/chunks, incremental edits, packed result transfers and the separate atomic parser-cancellation flag remain the baseline.
- [287](287-ghostty-worker-mode.md) owns terminal async API/worker conversion, [286](286-ghostty-extensions.md) host extensions and [283](283-ghostty-output-and-input-latency.md) native/hardware timing. Synchronous host hooks, authoritative actor state, direct producer ports and exact submitted-frame summaries remain intact.
- [306](306-bun-json-worker.md) owns the Bun/WASM loading mismatch. Qualification tests emitted assets on actual targets; a codec cannot repair a loader by assumption.
- Existing structural-cutover limits and product release gates remain. Planning delivery schedules implementation later; it does not interrupt active terminal or other sessions' work.

## Measurement discipline

334 defines bounded stages, not a giant matrix. Compare equivalent algorithms/payloads/caches/barriers; separate cold startup, warm requests, streaming throughput and end-to-end behavior. Four fixed balanced pairs are the new transport/scheduler screen; existing 282/283/287 rules override it for their domains. Product owners accept margins before candidate timing. Unqualified clocks/GPU/presentation metrics stay unresolved, and lower main-thread CPU cannot conceal higher total work.

Correctness and cleanup eliminate candidates before timing. Code/lifecycle benefit can justify adoption without a speed claim if product gates pass. Pools, shared memory and reactive stores get no speculative benchmark campaign. An unresolved cell produces the smallest cause-specific next action, with no automatic repeat or expansion until green.

## Completion and stop conditions

Planning delivery is complete when the research, compared designs, independent critique, six execution plans and roadmap links are published and document checks pass. No prototype or runtime measurement belongs to this delivery.

Implementation units finish with deleted duplicate machinery, honest bounded outcomes/resources, standalone packages, the narrow domain checks and real served-consumer evidence. Stop/rescope an abstraction that repeatedly forces bypasses, adds shallow wrappers, loses domain provenance, cannot settle/stop honestly, drops lossless data or adds more maintenance than it removes. Do not make universal package adoption the success metric.

- [x] Inventory code, terminal work in flight and existing authority/measurement gates.
- [x] Research all three libraries at pinned source and distinguish released artifacts.
- [x] Compare structurally different architectures and record an independent review.
- [x] Specify package boundary, migration units, packaging and bounded acceptance.
- [ ] Implement and qualify the core after the owner starts this deferred program.
- [ ] Migrate and ship each bounded consumer under its existing gates.
