# Async runtime architecture decision

Status: selected planning direction, 2026-10-03. Implementation and qualification remain deferred under [Plan 328](../../plans/328-async-runtime-master.md). This record explains the design; the plans own execution.

## Problem

Our retained services already have domain APIs, caches, generations and worker affinity. Their startup/pending-map/cancellation/disposal mechanics repeat, while scheduling and admission are inconsistent across independent request owners. Terminal worker conversion adds direct streaming ports, native/GPU residency and stricter barriers. A generic remote object proxy solves only part of that problem.

The shared package should make ownership and progress cheap to get right without relocating parser, terminal, watch or document policy. One service must coordinate admission, channel bookkeeping and endpoint lifetime internally. Merely putting three existing brokers behind forwarding helpers would add a layer without removing the problem.

## Alternatives and selection

| Dimension         | A: independently usable modules with owned services                 | B: owner-scoped actor/executor registry                                     |
| ----------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Composition       | A domain creates a service; local queues need only schedule modules | A supplied scope registers actors/executors and coordinates their lifetimes |
| Shared budget     | Explicit opt-in scope for competing owners                          | Central within each supplied scope                                          |
| Stateful work     | Static actor-affine endpoint                                        | Static registered actor; independent jobs use separate executor abstraction |
| Small local work  | Direct FIFO/sweep primitives                                        | Executor/registry participation                                             |
| Strongest feature | Fits existing owners and standalone package consumers               | Aggregate inventory/close and unified accounting                            |
| Main risk         | Public modules could leak coordination if createService is shallow  | Registry/pool surface could precede a consumer benefit                      |
| Independent score | 21/25                                                               | 19/25                                                                       |

[Candidate A](design-a.md), [candidate B](design-b.md) and [independent review](design-review.md) retain the full exploration. Neither alternative is a global singleton. Select A because its service already hides the complete coordination transaction and its scheduler modules remain useful alone. Adopt B's optional aggregate close/inventory, finite control progress, subscription readiness and precision-labeled residency accounting. Reject mandatory actor registration and speculative independent-job pooling.

This selection is a package-boundary decision. The private command codec remains provisional: finite typed request/event dispatch versus narrow Comlink, qualified against identical lifecycle and payload contracts.

## Usage before implementation

These are schematic owner usages, with concrete domain codecs/receipts deliberately supplied by each consumer. They are not compiled public signatures or evidence that a new document-delivery API exists.

```ts
// Retained spellcheck service: dictionary and accepted words remain domain state.
const spelling = createService(spellcheckDefinition, browserWorker(spellcheckEntry))
await spelling.open()
const task = spelling.submit('check', capturedDocumentRequest)
const receipt = await task.wait(viewAbortSignal)
await spelling.close()
```

```ts
// Terminal actor: host writes preserve buffers; independent producer owns its bytes.
const execution = createService(terminalDefinition, terminalWorkerEndpoint)
const events = execution.subscribe('events', deliverToHost)
await events.ready
const output = await execution.attachProducer('output')
await output.sendOwned(producerOwnedBytes)
const processed = await output.fence()
const resized = await execution.submit('resize', { layout, processed }).settled
await execution.close()
```

```ts
// Same-thread work: no worker/actor registration is necessary.
const commands = createFifo(commandPolicy)
const sweeps = createSweep(sweepPolicy)
await commands.submit(runCommand).settled
sweeps.request() // one active run, at most one coalesced rerun
await sweeps.close()
```

A Bun watch service supplies a static unreferenced endpoint, attachment commands and bounded batched events. LSP/PDF.js can retain their protocols and use only an endpoint lifecycle helper if it removes real duplication. Local domain objects stay local; logical barriers match threaded behavior without gratuitous serialization.

## Public contract shape

Types derive from one operation/event definition, with schema validation at transport boundaries. The concrete definition encodes allowed lanes, latest-replacement law, ownership/cost and effect/barrier semantics. A caller cannot mark an irreversible mutation latest-only through a per-call flag. Opaque handles carry issuer/generation identity, which receivers also validate at runtime.

```ts
type OperationReceipt<T, E> =
  | { kind: 'completed'; value: T }
  | { kind: 'failed'; error: E }
  | { kind: 'withdrawn'; input: InputDisposition }
  | { kind: 'stopped'; evidence: StopReceipt }
  | { kind: 'unknown'; evidence: LossReceipt }

type WaitReceipt<T, E> = OperationReceipt<T, E> | { kind: 'waitCancelled' }

interface Task<T, E> {
  readonly settled: Promise<OperationReceipt<T, E>>
  wait(signal?: AbortSignal): Promise<WaitReceipt<T, E>>
  requestStop(): Promise<StopRequestReceipt>
}
```

`settled` is the authoritative operation receipt, not one view's abortable wait. A bounded deadline can settle it unknown while execution remains recorded; a late trustworthy completion updates accounting/diagnostics without resolving it again. Unknown does not prove rollback, termination or release of resident memory. Domain adapters turn receipts into application catalog errors/cache settlement without putting those frameworks in core.

A service exposes open/submit/subscribe/attachProducer/close/inspect. Subscriptions expose separate registered, ready and closed facts. Producer handles expose preserving and owned movement, bounded send and a receiver-issued fence. A fence includes stream/producer identity, generation and processed sequence; a raw numeric sequence cannot cross streams or reincarnations safely. Close returns graceful/forced/unknown cleanup facts and accounting uncertainty, rather than claiming all memory is freed.

The sketch's InputDisposition and receipts are qualified adapter-specific types, not optional-field wire bags. In particular, withdrawal of an admitted queued move must return an owned token/buffer or consume it under an explicit law. The contracts unit chooses representations from real consumers before freezing the API.

## Internal ownership and resources

| Record            | Lifetime/release                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Waiter            | View/caller waiting; cancellation removes that wait only                                                |
| Operation         | One exactly-once declared-barrier receipt                                                               |
| Execution         | Dispatch through completion, acknowledged stop or qualified generation loss; may outlive caller receipt |
| Queued payload    | Admission through dispatch/withdrawal/replacement under explicit clone/move law                         |
| Running claim     | Actual execution interval; remains after wait cancellation                                              |
| Resident claim    | Retained parser/dictionary/WASM/fonts/GPU resources until qualified cleanup/reclamation                 |
| Subscription/port | Explicit registration, installation readiness, generation, closure and owned endpoint teardown          |

Admission plus pending-record insertion plus generation binding is one internal transaction. Clone/send/start failure rolls it back; consumers never coordinate those steps. Admission rejects before capture/detachment. Clone capture time is explicit. A queued move relinquishes logical ownership before dispatch; a retained mutable alias breaks that law even if TypeScript accepts it. Transfer lists account for whole backing buffers and duplicate views. Start with the smallest needed movement surface; queued move support cannot ship without a tested return law.

Native/GPU residency is estimated, not a hard JS memory ceiling. Completion does not free an actor. Cleanup acknowledgment or adapter-qualified native reclamation releases the relevant reservation; invoking browser terminate() is not a synchronous memory-free receipt. Unknown retention stays conservatively charged/quarantined under a finite owner policy, with uncertainty in inspection.

Generations are nonaliasing within an owner lifetime. Late replies/events never reach a replacement endpoint or disposed subscriber. Startup has a real initialized-ready acknowledgment. Close rejects new work immediately, is idempotent, requests bounded cleanup and escalates through the endpoint adapter without requiring page rAF.

## Ordering and progress

Domain mutation lanes serialize handlers through their declared barrier; async handler overlap is explicit only for qualified revision-bound reads. FIFO post order alone is insufficient. Independent actors retain separate execution; a scope admission policy cannot preempt a synchronous parser or move its retained state.

Events associated with success or failure are delivered in order to registered host subscribers before command settlement where the domain promises that contract. Delivery invokes host subscribers without awaiting arbitrary async callback completion. Reentrant callbacks that submit/await another command cannot hold the actor's lane. Subscriber exceptions are isolated and reported through owner policy; they cannot prevent the command receipt or other subscribers' delivery.

Lossless bytes/events/edits have count and byte credits and explicit saturation behavior. Complete derived projections may replace compatible queued projections; patch chains require composition or a full reset. No generic drop/latest policy applies to terminal bytes or irreversible effects.

Finite control capacity is necessary but insufficient. A fence-waiting resize cannot hold the last credit needed to process its data. Credit returns, readiness, stop and cleanup have bounded progress outside saturated ordinary work. The contracts fixture proves the dependency graph under paused data/reordered ports/close. Forced termination is a last bound, not the routine progress algorithm.

Fairness concerns ready work in a declared shared scope and has a finite dispatch-opportunity bound. It does not promise CPU preemption, global OS scheduling or progress from an independently halted actor. Actor costs and policy stay caller-owned, and application knobs use the existing settings registry.

## Authority and barriers

Editor's main-thread document buffer remains authoritative. Plan 099 owns source publication/journal/contribution delivery and its execution gate; this package creates no second document runtime. Terminal's execution actor owns native state; the host owns DOM/input/permissions and one copied submitted-frame summary. Watch policy owns path registrations/recovery. Generic helpers never reconstruct their lost state.

Operation identity, document/terminal revision, stream processed fence, projection epoch/sequence, applied acknowledgment, submitted frame and compositor presentation are different facts. Optional recovery code validates epoch/base/target and atomically installs immutable snapshots only after two real consumers demonstrate common behavior. JSON metadata is useful; buffers/ports/canvases/native memory do not fit a universal reactive-store protocol.

Accepted SAB text deletion remains. Shared atomic parser cancellation is a separate control mechanism. A worker crash does not recover native/parser/GPU authority automatically; domains decide reconstruction and safe replay from their own receipts.

## Modules and dependency direction

One package has explicit exports for service, scheduling, channels and runtime-specific adapters. Core imports no top-level DOM/Bun/Node globals, Platform features, React or query stores. Optional diagnostics publish into a caller-owned store. Pure local scheduling works independently; Node worker_threads requires a concrete consumer before adding a runtime adapter.

Editor/Ghostty public domain APIs conceal private codec types. Plan 207's exact packed standalone installs and dependency publication precede mirrored consumers. Emitted workers, WASM, fonts and URL bases are qualified independently from workspace source imports. Naming/distribution is resolved at that gate without silently creating a repository/mirror.

## Decision proof and rejected shortcuts

[Plan 334](../../plans/334-async-runtime-verification.md) owns qualifications and measurements. Lifecycle/ownership/progress/artifact checks precede timing; finite dispatch and narrow Comlink face the same tests and complete maintenance comparison. Four fixed balanced pairs screen new transport/scheduler timing; existing product gates remain authoritative. No benchmark or implemented API is claimed here.

Reject a timeout race that leaks opaque pending records, a pool that counts workers but not queued bytes/continuing execution, a JSON store that relocates authority, a control queue that deadlocks its own fence, and a wrapper that cannot delete meaningful machinery. The package succeeds through reusable guarantees and smaller verified owners, not universal import counts.
