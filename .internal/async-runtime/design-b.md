# Candidate B: an owner-scoped actor runtime

Status: Approved planning; implementation deferred. Candidate for synthesis, not a dependency decision.
Architect phases: Ground complete; Sketch complete; Agree belongs to coordinator synthesis; Implement deferred; Scrap criteria below.
Grounding: inventory.md, comlink.md, multithreading.md, coaction.md and inventory.md.

## Usage, caller's view

One runtime scope belongs to an existing app/service lifetime. Its registry owns only resources registered within that scope.
An editor contribution leases an existing persistent parser actor; it keeps document revisions and source receipts in its domain adapter.

```ts
const scope = createRuntimeScope({ owner: runtimeIdentity, admission: measuredLimits })
const parser = scope.actor(parserDefinition, {
  spawn: browserWorker(
    () => new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' }),
  ),
  residency: parserCost,
  ordering: 'serial',
})
const parsed = await parser.call('parse', domainParseRequest, { class: 'background-derived' })
  .result
// The domain validates its acknowledged source/version before publishing packed results.
const terminal = scope.actor(terminalDefinition, {
  spawn: terminalFactory,
  residency: terminalCost,
  ordering: 'serial',
})
const output = terminal.stream(terminalOutputDefinition, { mode: 'lossless', budget: outputBudget })
// Domain output setup supplies producer port and terminal-specific processed-sequence barriers.
const resized = terminal.call(
  'resize',
  { grid, afterOutput: producerSequence },
  { class: 'input-critical' },
)
terminal.subscribe((event) => terminalHost.accept(event))
await resized.result // Domain receipt proves execution/event order, not compositor presentation.
const watches = scope.actor(watchDefinition, {
  spawn: bunWatchFactory,
  residency: watchCost,
  ordering: 'serial',
})
watches.subscribe((eventBatch) => fileChangeHub.receive(eventBatch))
await watches.call('attach', attachRequest, { class: 'background-derived' }).result
const local = scope.executor(localWorkDefinition, {
  placement: 'local',
  concurrency: 1,
  budget: localBudget,
})
local.submit('drain', drainIntent, { class: 'background-derived' })
const sweep = local.schedule('sweep', sweepIntent, { replaceKey: sweepKey, due: dueTime })
await scope.close({ kind: 'drain', deadline: closeDeadline })
```

A local SerialWorker adapter uses concurrency1/FIFO; SweepScheduler keeps domain timing and latest-key semantics.
Static Worker factories remain at consumer module boundaries so bundlers see canonical Worker URLs.

## Problem

We already have retained services, streams and same-thread queues, with duplicated life/failure bookkeeping.
A common runtime can hide startup, generation-scoped request maps, admission reservations and teardown in one owner object.
Worker placement, document source truth, terminal execution state and process/SW lifetime remain explicit domain decisions.

## Shape, types and signatures

The following is a signature sketch, not compilable implementation. Domain definitions supply validated typed command/result/event maps.

```ts
type Methods = Readonly<Record<string, { readonly input: unknown; readonly output: unknown }>>
type Generation = number & { readonly generation: unique symbol }
type RequestId = string & { readonly requestId: unique symbol }
type Budget = {
  readonly queuedBytes: number
  readonly activeBytes: number
  readonly runnable: number
}
type ErrorData = {
  readonly code: string
  readonly message: string
  readonly why: string
  readonly fix: string
  readonly internal: unknown
}
type Evidence<D> =
  { readonly kind: 'reported'; readonly receipt: D } | { readonly kind: 'unreported' }
type Outcome<T, D> =
  | { readonly kind: 'completed'; readonly value: T; readonly receipt: D }
  | { readonly kind: 'failed'; readonly error: ErrorData; readonly effects: Evidence<D> }
  | {
      readonly kind: 'not-started'
      readonly reason: 'withdrawn' | 'admission-denied' | 'scope-closed' | 'deadline'
    }
  | {
      readonly kind: 'unknown'
      readonly reason: 'actor-lost' | 'deadline' | 'waiter-cancelled'
      readonly request: RequestId
    }
type CancellationFact =
  | { readonly kind: 'waiter-settled'; readonly executionMayContinue: true }
  | { readonly kind: 'withdrawn-before-dispatch' }
  | { readonly kind: 'stop-acknowledged' }
  | { readonly kind: 'requested'; readonly executionMayContinue: true }
  | { readonly kind: 'already-finished' }
type ActorState =
  | { readonly kind: 'starting'; readonly generation: Generation }
  | { readonly kind: 'ready'; readonly generation: Generation }
  | { readonly kind: 'closing'; readonly generation: Generation }
  | { readonly kind: 'closed' }
  | { readonly kind: 'lost'; readonly generation: Generation; readonly error: ErrorData }
interface Call<T, D> {
  readonly result: Promise<Outcome<T, D>>
  cancel(mode: 'waiter' | 'withdraw' | 'cooperative'): Promise<CancellationFact>
}
interface Actor<M extends Methods, E, D> {
  call<K extends keyof M>(
    method: K,
    input: M[K]['input'],
    options: CallOptions,
  ): Call<M[K]['output'], D>
  subscribe(deliver: (event: E) => void): Subscription
  stream<T>(definition: StreamDefinition<T>, options: StreamOptions): ProducerBinding<T>
  close(options: CloseOptions): Promise<CloseReport>
}
interface Executor<M extends Methods, D> {
  submit<K extends keyof M>(
    method: K,
    input: M[K]['input'],
    options: CallOptions,
  ): Call<M[K]['output'], D>
  schedule<K extends keyof M>(
    method: K,
    input: M[K]['input'],
    options: ScheduleOptions,
  ): ScheduledCall<M[K]['output'], D>
}
interface RuntimeScope {
  actor<M extends Methods, E, D>(
    definition: ActorDefinition<M, E, D>,
    options: ActorOptions,
  ): Actor<M, E, D>
  executor<M extends Methods, D>(
    definition: JobDefinition<M, D>,
    options: ExecutorOptions,
  ): Executor<M, D>
  close(options: CloseOptions): Promise<CloseReport>
  inspect(): RuntimeSnapshot
  observe(listener: (snapshot: RuntimeSnapshot) => void): () => void
}
```

Factories create endpoint leases internally; definitions validate external command/event/result values and bound payload cost before enqueueing.
Transport envelopes remain private. Definition receipt D is domain evidence, not a re-exported wire shape.
CallOptions carries origin/root/lifetime, scheduling class, deadline and ownership mode; definition supplies reliable payload-byte accounting.
ActorOptions declares serial/concurrent-read execution; ExecutorOptions declares local/static-pool placement and finite capacity. Persistent actors never migrate between pool workers.
StreamDefinition supplies payload validation, byte cost and clone/transfer ownership; StreamOptions chooses lossless credits or replaceable complete projections.
ProducerBinding supplies an adapter-owned transferable port when supported, plus explicit credit/close operations; caller never sees internal message envelopes.
Subscription registers synchronously and has `dispose(): void`, `ready: Promise<Outcome<void,D>>` and `closed: Promise<CloseReport>`.
CloseReport records graceful versus forced actor termination, unresolved execution evidence and resource cleanup facts.

## Module map and flow

| Private owner                      | Knowledge owned                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| runtime/scope                      | Registry lifetime, bounded aggregate admission, close and immutable diagnostics          |
| runtime/actor                      | Endpoint lease, generation, mailbox policy, pending settlement and control progress      |
| runtime/executor                   | Independent job placement, active reservations and optional idle retirement              |
| runtime/admission                  | Queue count/bytes, runnable and resident cost, class fairness, deadlines and replacement |
| transport/channel                  | Request/event validation, transfer ownership, correlation and bounded stream credits     |
| adapters/browser, bun, node, local | Observable endpoint failure/closure and static factory adaptation                        |
| adapters/diagnostics-store         | Optional publication to caller-owned vanilla Zustand                                     |

An actor call reserves queue bytes, then running cost, dispatches with current generation, and holds active reservation until acknowledged finish or confirmed actor termination.
Caller timeout/cancellation settles its wait once; it does not prove rollback or free resources still occupied by execution.
Late replies may release old bookkeeping but never publish into a new generation or return another request's value. Diagnostics retain only safe operation facts, never content/secrets.
Close blocks new calls, withdraws definitely queued work, requests domain cleanup, and escalates through its bounded endpoint owner.
Control traffic has a finite reserved quota for cancellations, credit acknowledgements, barrier progress and cleanup.
Lossless streams apply credits before transfer. Replaced work releases bytes only when buffers/records are no longer retained.

## Interface depth and red-flag review

Scope hides five coordination jobs behind actor/executor acquisition and close: endpoint creation, start failure, admission, settlement and cleanup.
Definitions expose domain input/output/cost knowledge once; consumers do not coordinate low-level scheduler/broker/owner objects per operation.
Worker factories and producer ports remain exposed because deployment topology and ownership transfers are actual caller decisions.
Actors call domain handlers with adaptation plus scheduling/failure policy; they do not add a bare forwarding wrapper around existing LSP/PDF protocols.
LSP/PDF retain their dependency protocols and disposal; optional telemetry observes them. SW/MSW/native shell/subprocess lifetimes stay outside compute ownership.

## Existing contracts and boundaries

Plan099's buffer authority, synchronous publication and gated units2–7 remain untouched; worker parser state is derived and revision-tagged.
Keep accepted string/chunk transport and deleted SAB text path absent. Existing atomic parser cancellation is a separate optional domain execution hook.
Plan287 owns native terminal truth, direct output/control barriers, submitted-frame provenance and one-way canvas/GPU/font recovery.
Plan286 keeps host/input hooks synchronous and extension closures local; terminal events precede operation settlement.
Scope admission is local to its explicit owner. No global singleton, cross-machine scheduler or sharing across unrelated app scopes.
A declared residency cost is accounting, not proof of a hard process/GPU memory limit; real memory evidence must qualify the limits.
Runtime snapshots publish through caller-owned Zustand and `useStore`; optional projection helpers validate epoch/base/sequence while domain revisions remain explicit.
TanStack continues to own feature reads/mutations/cache settlement; runtime Calls execute below queryFn/mutationFn, with streams under existing exceptions.

## Alternatives and tradeoffs

Rejected modular-only alternative: exposing independent Scheduler, WorkerOwner and RpcClient makes each consumer coordinate their reservation/lifetime order.
It hides individual mechanisms, but leaks which pending work still owns capacity and how close/crash changes three objects together.
We accept scope/registry overhead in exchange for one owned settlement/admission transaction.
We accept explicit actor definitions and factories in exchange for retained-state placement and portable built assets.
We accept separate executor and actor contracts in exchange for safe independent pooling without parser/terminal migration.
Standalone publication must precede cross-family consumer delivery; exact Editor/ghostty mirrors install without sibling workspaces per Plan207.
Exports keep adapters optional and avoid Platform imports/top-level browser globals; public name/version is resolved at packaging gate.

## Risks, scrap conditions and next unit

Can a scoped registry remove more caller bookkeeping than it introduces for simple local sweeps? Test this in the first migration sketch.
Can strict queue-byte accounting bound retained document references without copying every payload? Definitions need representation-specific ownership facts.
Can pooled jobs and persistent actors share aggregate admission without starving terminal output/control? Prove finite quotas and fairness with adversarial traces.
If independent consumers repeatedly need runtime-internal overrides or parallel registries, scrap the registry-first design and reconsider modular composition.
Next implementation unit, deferred: one scope with local/static-worker conformance, a retained parser fixture and a direct-port terminal barrier fixture, proving settlement/reservations before choosing RPC backend.
