# Candidate A: compose deep modules at existing owners

Status: Approved planning; implementation deferred. Based on [inventory](inventory.md), `comlink.md`, `multithreading.md`, `coaction.md`, architect rationale/red-flag rubric; source baseline `6d8e768703c1bfc92091dbdd41c9171d5942f263`, 2026-10-03. No product edits, installs, tests or benchmarks.

## Problem

Our worker clients repeat request settlement, endpoint generations, teardown and diagnostics; stateful services, direct streams and same-thread queues need different execution policies. Create one runtime-neutral package with opt-in deep modules, composed by the existing domain owner. The public service hides startup, pending records, transport validation and failure settlement. Channels hide credits, fencing and endpoint teardown. FIFO/sweep hide drain/coalescing races without inventing worker identities. Domain ownership, source synchronization, save policy and presentation remain explicit.

## Usage first

Illustrative names and budgets below are domain declarations, not newly proposed settings or production code. Contracts define finite operations/events and codecs; `parserPolicy` etc. are supplied by existing owners. Worker handlers use static module entries; no closure/function-source shipping.

```ts
// 1. Retained parser service; the document contribution owns source progress.
import { createService } from '@fregat/async-runtime/service'
import { workerModule } from '@fregat/async-runtime/browser'
const parser = createService(parserContract, {
  execution: workerModule(new URL('./parser.worker.ts', import.meta.url)),
  policy: parserPolicy,
  diagnostics: logParserOperation,
})
const synchronized = await documentContribution.synchronize(parser, capturedRevision)
const task = parser.submit(
  'parse',
  { document: synchronized, range },
  {
    key: syntaxAudience,
    mode: 'latest',
    priority: inputPriority,
  },
)
const answer = await task.wait(viewInterest.signal)
if (answer.kind === 'completed') syntaxAudience.accept(answer.value)
// The contribution's accept guard verifies its captured incarnation/revision/configuration.
await parser.close() // owner teardown; stops new calls immediately
```

```ts
// 2. Terminal execution actor; its domain owns native state and submitted-frame truth.
import { createProducer } from '@fregat/async-runtime/browser'
const execution = createService(terminalContract, {
  execution: workerModule(terminalWorkerUrl),
  policy: terminalPolicy,
})
const output = createProducer(terminalBytes, outputLimits)
await completed(
  execution.submit(
    'attachOutput',
    { receiver: output.receiver },
    {
      transfer: output.moveReceiver(),
    },
  ).settled,
)
sent(await output.send(ownedPtyBytes, { transfer: output.moveBytes(ownedPtyBytes) }))
const afterOutput = await output.fence()
await completed(execution.submit('resize', { columns, rows, afterOutput }).settled)
const summarySubscription = execution.subscribe('submittedFrame', installFrameSummary)
// Host public write copies caller-owned bytes; explicit PTY producers own moved buffers.
await summarySubscription.close()
await execution.close() // cleanup/settlement works while page rAF is suspended
```

```ts
// 3. Native watch owns batched OS notifications; Bun adapter preserves ref:false.
import { workerModule as bunWorkerModule } from '@fregat/async-runtime/bun'
const watch = createService(watchContract, {
  execution: bunWorkerModule(watchWorkerUrl, { ref: false }),
  policy: watchPolicy,
})
const batches = watch.subscribe('batch', reconcileWatchBatch)
const attached = await completed(watch.submit('attach', { watchId, path }).settled)
// Native overflow becomes a domain rescan-required batch; never silently lose changes.
await completed(watch.submit('detach', { attachment: attached }).settled)
await batches.close()
await watch.close()
```

```ts
// 4. Same-thread participants retain ordinary ownership; no worker/actor conversion.
import { createFifo, createSweep } from '@fregat/async-runtime/schedule'
const ingestion = createFifo(ingest, ingestionPolicy)
const reaper = createSweep(reapExpired, sweepPolicy)
await completed(ingestion.enqueue(frame).settled)
reaper.request() // coalesces; a request during a run causes one subsequent run
await ingestion.drain() // re-reads the live queue until idle, including nested enqueues
await reaper.close()
await ingestion.close()
```

`completed` and `sent` are the domain's outcome-to-value/error adapters for imperative/TanStack calls and streams. Generic package code does not throw application catalog errors or publish domain cache entries. Domain wrappers are justified only when they enforce source/revision/input ownership or protocol semantics.

## Shape derived from usage

```ts
type Operation<I, O> = { input: I; output: O }
type OperationTable<S> = { [K in keyof S]: Operation<unknown, unknown> }
type Outcome<T> =
  | { kind: 'completed'; value: T; receipt: ExecutionReceipt }
  | {
      kind: 'failed'
      failure: RuntimeFailure
      execution: 'not-started' | { kind: 'acknowledged'; receipt: ExecutionReceipt }
    }
  | {
      kind: 'withdrawn'
      reason: 'superseded' | 'cancelled' | 'closed' | 'admission'
      execution: 'not-started'
    }
  | { kind: 'stopped'; reason: 'cancelled' | 'closed'; receipt: StopReceipt }
  | { kind: 'unknown'; reason: 'deadline' | 'crashed' | 'closed'; operation: OperationIdentity }
type WaitResult<T> = Outcome<T> | { kind: 'wait-cancelled' }
interface Task<T> {
  readonly settled: Promise<Outcome<T>>
  wait(signal?: AbortSignal): Promise<WaitResult<T>>
  requestStop(): void
}
interface Service<S extends OperationTable<S>, E> {
  submit<K extends keyof S>(
    operation: K,
    input: S[K]['input'],
    options?: SubmitOptions,
  ): Task<S[K]['output']>
  subscribe<K extends keyof E>(
    event: K,
    consume: (value: E[K]) => void | Promise<void>,
  ): Subscription
  close(): Promise<CloseOutcome>
}
declare function createService<S extends OperationTable<S>, E>(
  contract: ServiceContract<S, E>,
  options: ServiceOptions<S, E>,
): Service<S, E>
// Contract owns input/output/event codecs, per-operation ordering and allowed transfers.
// Options own execution adapter, immutable admission/lifetime policy and diagnostics sink.
type SubmitOptions = ({ mode?: 'ordered' } | { mode: 'latest'; key: WorkKey }) & {
  priority?: number
  transfer?: OwnedTransferPlan
}
interface Subscription {
  close(): Promise<CloseOutcome>
}
interface Producer<T> {
  readonly receiver: OwnedReceiver
  send(value: T, options?: MoveOptions): Promise<SendOutcome>
  fence(): Promise<StreamFence>
  close(): Promise<CloseOutcome>
}
interface Fifo<T> {
  enqueue(value: T): Task<void>
  drain(): Promise<void>
  close(): Promise<CloseOutcome>
}
interface Sweep {
  request(): void
  close(): Promise<CloseOutcome>
}
declare function createFifo<T>(
  run: (value: T, signal: AbortSignal) => Promise<void>,
  policy: FifoPolicy,
): Fifo<T>
declare function createSweep(
  run: (signal: AbortSignal) => Promise<void>,
  policy: SweepPolicy,
): Sweep
```

Opaque runtime-issued operation/generation/fence/receiver handles prevent cross-owner reuse at the type boundary; receiving codecs also validate live issuer/generation. `OwnedTransferPlan` is issued by a capability-specific browser/Bun adapter and validated against the operation contract; it is not a core re-export of `Transferable` or a serialized wire envelope. The producer also exposes the two explicit movement helpers shown above. Schemas derive method types; no parallel hand-written input/output protocol types. Concrete branded receipt/error/policy fields are designed in the contracts unit, not optional-field bags added during migration.

Execution adapters are typed capabilities, not mandatory global registrations: static module workers, same-thread handlers and optional Node/SharedWorker endpoints. Core accepts an opaque adapter and does not depend on Worker, DOM, Bun or React globals. Local execution uses the same codecs, generation checks, ordering and outcome semantics as remote execution; transfer capabilities may be unavailable locally and fail explicitly. It must not detach a caller buffer merely to imitate remote execution.

## Lifecycle, scheduling and data invariants

- Every admitted task has one settlement record. Creation is lazy and readiness bounded. Clone/send failure removes its pending record. Crash, startup failure, deadline and close settle callers and remove owned listeners/subscriptions. Each generation has a never-reused request namespace; late replies cannot settle a new generation. Supervision owns native error/messageerror/exit/termination, with runtime-specific capability limits disclosed.
- `wait(signal)` stops only that caller's wait; shared retained work continues. `requestStop` withdraws queued work or requests cooperative execution stop. Stop receipt proves execution ended, not side-effect rollback. A lost reply after dispatch gives unknown, even if a worker has since been killed. Already-committed domain effects remain committed. No ambiguous mutation automatically replays.
- Priority orders ready starts; it never preempts running synchronous JS. Delays/debounce enter the same ready queue. Ordered operation lanes serialize across awaits; declared immutable reads may run concurrently. Latest replacement applies only to declared replaceable work and always settles replaced requests; irreversible operations are ordered. Domain configuration exposes existing policy, not library-chosen five-class semantics.
- Each owner has bounded queued count/bytes and running/resident cost reservations. Runtime-scoped budget objects may be explicitly shared to coordinate owners; no global singleton. Fairness across attached owners uses aged priority plus round-robin ties. A finite running credit is released on acknowledged completion/stop or confirmed endpoint death, never on waiter cancellation. Failed/unresponsive generations are quarantined and closed by their lifetime bound. Resident engine/WASM/GPU cost is separate from runnable work and requires domain measurement.
- Admission happens before copying/transferring queued payloads. Accepted clone inputs are captured at admission; accepted moved inputs relinquish logical ownership then and detach only on dispatch. Rejected/replaced undispatched work retains physical caller ownership. Clone is default; moved buffers are caller-declared and alias/dedup validated, because transferring one subarray detaches its complete backing storage. Packed parser results transfer; terminal host writes preserve caller buffers; native WASM memory remains execution-owned.
- Channels distinguish lossless bounded streams from replaceable snapshots. Credit is returned after receiver processing, not message arrival. Event subscription closure removes producer registrations and pending deliveries, then acknowledges; an endpoint lifetime bound handles an unresponsive peer. OS sources that cannot pause define overflow recovery in their domain contract. No per-event callback proxy channels.
- A stream fence identifies the processed generation/sequence of that specific stream. Independent-port control operations validate their declared prerequisite fences. Arrival order alone proves nothing across ports; exact replay boundaries may also need a domain pause/cut protocol. Terminal semantic events are delivered before related command settlement; submitted-frame versus native revision versus presentation confirmation remain separate domain receipts.
- `close` rejects new submissions synchronously and resolves a bounded cleanup outcome, including forced/unknown cleanup. Restart is an explicit owner policy: parser can lazily create a fresh generation for subsequent work; terminal recreation must reacquire canvas/resources; LSP retains JSON-RPC and owner recreation. Generic code resets request/accounting only; domain adapters reconstruct retained state and invalidate source/cache acknowledgments. Never replay pending failed requests implicitly.

## Mirrors, stores, telemetry and TanStack

An optional projection module borrows Coaction's authority epoch, contiguous sequence, atomic snapshot, gap recovery and reconnect-generation guard. It validates explicit base/target sequence and can coalesce to one latest complete snapshot. It owns no canonical application state. Parser contributions keep captured document revisions and acknowledged source cursors under Plan 099; projection sequence is not a document revision. Terminal summaries preserve Plan 287's generation/frame/native/layout identities. Private caches stay with domain workers and expose counts/provenance only.

Core internal lifecycle/accounting state uses caller-readable immutable diagnostic snapshots; no hidden reactive store singleton. An optional Zustand adapter publishes those snapshots into a service-scoped vanilla store, read by `useStore`; no competing React graph or mandatory Coaction. Telemetry is one wide operation event with queue/run/transfer/settlement timing, generation and counts, routed to an injected evlog sink. Never log payloads/source/code/secrets/settings values. Logs do not secretly retain data for inspection.

TanStack remains owner of query/mutation status, cache settlement, retries and scope serialization for application effects. Domain functions await Outcome, convert structured runtime failures through the owning catalog, then settle/invalidate their cache before returning. Query cancellation normally stops its wait; the contribution lease determines whether shared computation also stops. No package retry loop competes with TanStack or automatically replays uncertain mutations. High-volume terminal streams remain the explicit transport exception, with domain cache settlement where required.

## Module and package map

| Export                               | Deep responsibility and dependency boundary                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/service`                           | Typed operation/event contract, owner lifetime, exact settlement, generations and per-owner task lanes. Runtime-neutral; finite wire protocol private. |
| `/schedule`                          | Bounded admission/fairness, FIFO drain and sweep/coalescing. Usable alone without services, workers or mirrors.                                        |
| `/channel`                           | Credits, processed fences and subscription lifecycle; codec-driven payloads, optional transfer capability.                                             |
| `/projection`                        | Optional atomic snapshot/delta recovery; authority placement and domain revisions remain caller-owned.                                                 |
| `/browser`, `/bun`, optional `/node` | Static endpoint adapters, native lifecycle observations, owned transfer/producer capabilities and resource close. Platform globals isolated here.      |
| optional `/zustand`                  | Publish core snapshots into caller-owned vanilla stores. Zustand peer dependency; React/TanStack absent from core.                                     |

Working source `packages/async-runtime`; public name awaits packaging choice. One coherent package, explicit independent exports, no app/domain/private-workspace dependencies, no root barrel that initializes every adapter. Static module URLs must work from actual built package artifacts under browser CSP/Bun deployment. No ambient global Worker polyfill, stringified closures, JSON-only bulk data or required SAB. Preserve completed SAB-text deletion; the independent atomic parser cancellation capability remains optional.

Plan 207 applies before consumer delivery: exact Editor/ghostty mirror trees install/build without root siblings; `workspace:*` publish rewriting alone is insufficient. Publish required runtime versions before consumer mirror commits need them; publication/authentication/trusted-publisher setup is separately gated. The runtime's own exact standalone tree/tarball contains its worker assets, exports and portable qualification scripts. New public package-source edits stay canonical in Fregat; no new mirror is silently created.

## Transport decision, alternatives and synthesis position

Provisional base is the finite operation/event protocol, reusing strongest current pending-record/generation code rather than adding a fourth broker. Compare privately against narrow Comlink `dispatch(command)` using only method calls/explicit transfers, clone-safe Outcome and separate streams; no properties/constructors/callback proxies. This is a bounded contracts-unit gate: one real retained parser service, one direct producer/control fixture, 100 numbered calls plus crash/abort/send-failure/late-generation/hung-cleanup cells, and 20 open/close cycles. Test released 4.4.2 separately from inspected main if it remains a candidate. Both must clear all owned records/ports/listeners within declared bounds and preserve ownership, structured errors and event/barrier ordering.

Draft superseded by Plan 334: after correctness, four fixed balanced pairs on equal payloads record p50/p95/p99 settlement, queue/heap peaks, host/worker CPU, bytes and startup/bundle size. Declare the baseline-specific acceptance budget before runs. Comlink wins only if total maintained transport plus supervisor/cleanup/error/ordering code is smaller without added unresolved requests or workload regression. Reject timeout-only races that leave its opaque pending map unbounded. If Comlink requires a maintained fork or synthetic replies solely for basic settlement, compare that complete cost against the finite protocol. No dependency choice or speed claim is settled by source inspection.

An actor-centric registry/pool alternative hides uniform discovery and fleet placement behind one runtime but requires every FIFO/sweep and existing domain service to adopt actor identities, exposes common placement policy, and risks domain caches becoming runtime registry state. Candidate A instead lets a document/runtime/terminal owner compose only needed modules. Graft a central owner inventory/budget view if consumers prove the need; reject compulsory registration and implicit singleton placement. Interface depth is judged by complete caller operations, not number of classes: service creation hides request/lifetime machinery; channel send/fence hides credit/order bookkeeping; queue drain hides nested enqueue races.

Full Coaction adoption would deeply hide reactive state/mirror mechanics but expands every consumer's authority and JSON restrictions. Keep it optional for a proven metadata store. Multithreading's function pool hides dispatch but exposes closure/build constraints and lacks retained-state/crash settlement contracts. A pool export is absent initially; add it only after identifying and measuring a real independent existing job with static entry, deterministic data input and bounded cost. No speculative thumbnail/checksum job farm.

## Tradeoffs, risks and next unit

We accept multiple independent execution owners in exchange for existing state isolation and migration choice; composing modules does not make every async operation a remote actor. We accept explicit domain contracts and transfers in exchange for safe provenance/ownership. We accept separate queue/running/resident budgets in exchange for honest resource accounting; a cancelled waiter cannot pretend CPU stopped. We accept optional mirrored metadata in exchange for preserving canonical domain state and ordinary Zustand reads.

Risks/questions to resolve with evidence: Does caller setup still leak too much ordering policy despite deep service ownership? Can credits/fences cover terminal and watch traffic without forcing one wire format? Which endpoint lifecycle signals are actually reliable on supported Bun/Node/browser builds? What measured resident-cost hints justify shared budgets? Does optional projection have two real consumers before shipping? These are experiment questions, not reasons to ask for speculative user permission.

Next implementation unit, after the separate implementation authorization: build portable local/browser endpoint qualification and one finite typed service proving exact settlement, close/death generations and explicit clone/transfer; compare narrow private Comlink against it before any product migration. Plan 099 units 2–7 and Plan 282 measurement qualifications remain gated; Plans 287/286 retain their native/host/extensions/frame contracts and accepted execution order. This package design does not authorize their remaining work or duplicate their journals, mirrors or authority.

PASS: Usage-first modular candidate and finite transport gate supplied. ISSUES: Exact API/codecs/budget receipt fields need contracts-unit refinement and runtime proof. BLOCKED: None for planning; implementation deferred.
