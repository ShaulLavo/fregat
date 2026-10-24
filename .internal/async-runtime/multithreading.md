# Multithreading research for the worker-runtime master plan

Research-only lane, 2026-10-03. Status: ISSUES, sufficient evidence to plan; adoption remains unqualified.

## Source pins and scope

- Upstream main: [`a42ce15cf8fb3c61d2b190222cf5b9a49fc34442`](https://github.com/W4G1/multithreading/tree/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442), committer time 2026-03-26T15:49:22Z.
- npm latest: [`multithreading@0.3.52`](https://registry.npmjs.org/multithreading/0.3.52), published 2026-03-26T15:50:49.313Z, registry `gitHead` matches main. GitHub releases API returned zero releases.
- Inspected the published tarball, without installation or execution. Its unpacked size is 171,697 bytes, 57 files; registry shasum `7877426a7cddfddead5ec426e594fd960fa47363`. Browser/Bun/Node source findings below also appear in compiled package files.
- Source reviewed: pool, public spawn API, worker handler, serialization, import rewriting, runtime adapters, Mutex, RwLock, shared JSON allocator/compaction, MPMC channels, build script, and CI workflow. Browser/Bun/Node advertised support is a claim; no runtime qualification occurred.
- Fregat source pin for this read: `6d8e768703c1bfc92091dbdd41c9171d5942f263`. Existing Plan 287 is mutable concurrent work; re-read its shared API agreement before execution.

## Recommendation

Borrow its explicit movement semantics, reusable worker model, load accounting and bounded-channel vocabulary. Treat the implementation as a study subject. Its generic pool is unsuitable as the default owner of retained editor services or terminal rendering, and it does not provide the failure or admission guarantees our common runtime needs.

The package should distinguish a persistent execution actor from a pool job. A document parser, language service and terminal each retain identity and state; an independent checksum or thumbnail job may use a pool. They can share endpoint lifecycle and request settlement without sharing placement policy.

## Confirmed source behavior

### Pool placement and admission

[`src/lib/pool.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/pool.ts)

- Default maximum workers is `navigator.hardwareConcurrency || 4`; workers start lazily. Config sets only `maxWorkers`, with no memory budget, job cost, priorities, actor key, queue limit, idle retirement or worker health inspection.
- Worker rank is `(load << 1) | noFunctionAffinity`. Load counts outstanding tasks. A lower-load worker wins before affinity; affinity means the worker has cached a function ID, not that it owns a document or terminal.
- An empty worker slot wins unless an idle worker with that exact cached function already won. A new function can expand the pool despite an idle worker having other cached code.
- Every `submit` immediately serializes and posts to a worker. The host has no bounded admission queue. A cap on worker count is not a cap on submitted jobs or retained bytes.
- The worker's `onmessage` is async and invokes functions without a per-worker serial queue. Synchronous CPU jobs serialize through the worker event loop; async functions can overlap while awaiting. Pool load therefore counts operations, not runnable CPU demand.
- Host registry and per-worker function caches last until their realm/worker dies; the global function registry survives `shutdown`. There is no eviction.
- Pending callbacks use 65,536 slots, selected by `taskId & 65535`; there is no occupancy guard or full-ID validation. More than 65,536 unresolved submissions can overwrite pending callbacks and resolve a newer caller with an older response. This follows directly from source, but was not reproduced.

### Cancellation, errors and shutdown

[`src/lib/lib.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/lib.ts), [`worker.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/worker.ts)

- Normal completion resolves `join()` with `{ok:true,value}`; task errors resolve `{ok:false,error}`. `abort()` rejects the outer join promise with `Error("Task aborted")`, rather than returning that Result union.
- `abort()` sends no cancellation frame or flag, removes no pending pool entry, and terminates no execution. It cancels the caller's wait while the job still consumes resources and may perform effects.
- Worker `onerror` calls `nukeWorker`, which terminates and clears the worker, resets load and affinity, but does not reject its outstanding callback entries. No per-worker task ownership table exists.
- `shutdown()` terminates all workers and clears the global pool, without settling outstanding requests or awaiting resource cleanup. Later calls create a fresh pool.
- Serialization or synchronous `postMessage` failure occurs after callback insertion and load increment, without rollback of those entries or affinity. The public wrapper reports a failure, while pool accounting still retains the abandoned request.
- Messages have task/function IDs, but no worker generation or protocol version. Errors preserve message/stack only; worker catch paths log the entire serialized function code. Do not copy this logging behavior into a runtime carrying application code or captured values.

### Transfer semantics

[`shared.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/shared.ts), [`transferable.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/transferable.ts)

- `move(...)` marks argument tuples; top-level typed arrays transfer their complete backing buffer, top-level transferable objects transfer, ordinary values clone, and SAB references share.
- This is not recursive transfer discovery inside arbitrary objects. Library handles use registered serialization/deserialization hooks. Duplicate buffer entries are not deduplicated when multiple views share backing storage.
- Moving one subarray detaches every local view over that ArrayBuffer. Our public terminal contract requires caller-owned write buffers to stay owned by the caller, so implicit transfer of typed arguments cannot be the default there.
- `MessagePort` and `OffscreenCanvas` are recognized transfers. That useful transport support does not establish persistent terminal actor ownership or independent-port sequencing.

### Function shipping and runtime compatibility

[`caller_location.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/caller_location.ts), [`patch_import.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/patch_import.ts), [`browser/lib.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/browser/lib.ts), [`node/polyfill.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/node/polyfill.ts)

- `spawn` stringifies the supplied function and caches by that string. Closures, imported outer identifiers, transpiler helpers and bundler helpers do not travel with the function.
- The library finds caller location from an Error stack, skips broad substrings including `lib.js` and `node_modules`, and rewrites dynamic imports using a regex plus argument scanner. This depends on emitted stack format and application bundle structure.
- It resolves bare imports with the library module's `import.meta.resolve`; relative imports resolve against the first caller location used for that function string. Identical function strings called in two modules can reuse the first module's patched imports.
- Worker code uses `btoa(code)` then `import(dataUrl)`. [btoa requires byte-valued strings](https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa#unicode_strings). A function body with literal characters above U+00FF is a source-visible compatibility risk, even in comments.
- README requires CSP allowance for `data:` scripts and `blob:` workers. Actual checked source starts a module worker at `new URL("./worker.ts", import.meta.url)`; emitted package uses `worker.js`, not a blob entry. Production policy must be checked against the actual bundler output, rather than copying README headers.
- Browser adapter supplies a throwing SAB placeholder when isolation is missing; plain spawn does not require actual SAB. Atomics-based locks and JSON do.
- Bun export uses native Worker through the default adapter. README explicitly says stringified functions containing Bun-transformed `using` fail because the required helper globals live in another realm. Compiled internal channel code includes its own helpers, so that warning concerns user functions shipped through `spawn`.
- Node adapter overwrites `globalThis.Worker`, `self` and `ErrorEvent`. Its worker-side postMessage shim passes its second argument directly to `parentPort.postMessage`, but shared worker code supplies `{transfer: list}`. [Node's documented second argument is a transfer list](https://nodejs.org/api/worker_threads.html#portpostmessagevalue-transferlist). This is a concrete adapter mismatch to qualify before any Node adoption; execution was not tested.
- Repository CI runs Deno v2.5.x tests only. Browser, Bun, Node and production bundling support need independent gates.

### Shared memory, guards and lifetime

[`mutex.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/sync/mutex.ts), [`rwlock.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/sync/rwlock.ts), [`json_buffer.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/json_buffer.ts), [`mpmc.ts`](https://github.com/W4G1/multithreading/blob/a42ce15cf8fb3c61d2b190222cf5b9a49fc34442/src/lib/sync/mpmc.ts)

- Mutex uses one shared Int32 lock word, compareExchange and `Atomics.waitAsync`; sync variants block the worker. Guards prevent repeated unlock and expose explicit disposal. No timeout, abort signal, fairness or owner-death recovery is present.
- RwLock represents writer as -1 and readers as a positive count. New readers can enter while a writer waits. Writer starvation is a source-supported risk, not a measured outcome.
- Killing an actor that holds a lock bypasses JS finally/disposal and can strand the shared lock. The pool supplies no recovery protocol.
- SharedJsonBuffer uses a fixed SAB, default 64 KiB, tagged pointer structures, UTF-8 strings and JS proxies. Property changes allocate data in an internal arena; it does not grow the SAB.
- Allocation exhaustion compacts the entire live object graph through a same-size ordinary ArrayBuffer, copies back, relocates pointers and clears local caches; then retries or throws OOM. Partial updates do not make this worst-case compaction cheap.
- Each realm keeps private pointer targets, WeakRef proxies and decoded-string caches. FinalizationRegistry removes local proxy targets nondeterministically. Compaction updates only that instance's active targets and caches. Cross-realm held proxies/cached strings surviving another realm's compaction are an untested correctness risk; the source shows no shared relocation epoch or invalidation broadcast.
- JSON operations require callers to obey external locks. Atomic bump-pointer loads/stores alone do not provide concurrent allocation safety; ordinary object metadata/data reads and writes are not all atomic.
- MPMC uses a shared JSON ring, item/slot semaphores and separate sender/receiver locks, with explicit reference counts and disposal-based closure. It is independent of pool submission, so its backpressure does not bound `spawn`.
- Ordinary successful worker completion disposes top-level hydrated disposable arguments. Forceful worker death skips this, potentially leaving channel handle counts or locks live. Nested handles do not receive automatic recursive cleanup.
- Channel null entries are the empty sentinel; arbitrary `null` messages cannot be represented faithfully despite a generic `T`. Capacity bounds message count, while shared JSON buffer size independently bounds bytes. Separate send/receive access during allocator compaction needs targeted proof before copying the design.

## Fit against our existing contracts

- Tree-sitter retains document chunks, parse trees, grammars, generations and cancellation flags. Keep placement by actor/document owner. Function-cache affinity cannot substitute for that contract.
- Shiki retains document tokenization state and language/theme setup; TypeScript owns one project/language-service lifetime; minimap owns rendering canvases and secondary-view scheduling. A generic spawn closure has no lifecycle agreement for any of these.
- [Plan 287](https://github.com/ShaulLavo/fregat/blob/6d8e768703c1bfc92091dbdd41c9171d5942f263/plans/287-ghostty-worker-mode.md) requires one terminal execution owner, clone-safe errors, identity/generation, ordered events before settlement, output/control sequence barriers, and completion while page rAF is suspended. None follows from this pool's load ranking.
- Preserve the [accepted SAB-text deletion](https://github.com/ShaulLavo/fregat/blob/6d8e768703c1bfc92091dbdd41c9171d5942f263/editor/docs/performance/sab-transport-2026-09-12.md). Existing real parser string/SAB paths showed no established total-request gain; UTF-16 encoding and worker decoding consumed the postMessage saving. Synthetic four-reader improvements do not reopen shared document storage.
- The surviving four-byte cancellation flag is a separate mechanism. It enables a synchronous parser to observe cancellation where capabilities allow it. A normal cancellation message needs the worker event loop to yield. Name these two behaviors separately in the package contract.
- Terminal Plan 287 explicitly uses messages, copied frame summaries and retained actor state without requiring isolation. SharedJsonBuffer must not become its frame-summary or authoritative-state transport by default.

## What the master plan should adopt

1. Separate actor creation/ownership from job submission. Actors use static module worker entries, worker generations and explicit shutdown acknowledgement. Pools accept independent tasks with declared input ownership and cost.
2. Make clone, transfer and shared capability explicit and independently tested. Transfer is an operation with ownership consequences, not a promise that all arguments move safely.
3. Specify cancellation states: withdrawn before admission, caller no longer waits, cooperative execution stopped, forcefully terminated. Require exactly one caller settlement and admission-slot release for every terminal state.
4. Budget runnable work and queued bytes separately from worker count. Measure retained engine/WASM/GPU costs before choosing worker-per-document or actor sharing; hardwareConcurrency is a ceiling hint, not a memory policy.
5. Use common request/response framing and observability where it saves code. Preserve domain event ordering, retained-state ownership and service-worker/process semantics in their adapters.
6. A bounded channel can be a useful API concept. Its implementation can use MessagePort credits and domain batching; adopting a channel does not imply SAB, JSON proxies or shared locks.

## Future experiments and gates, approved to schedule; none run in this lane

| Experiment                | Bounded design                                                                                                                                                                                                                                                                                                                                              | Decision it resolves                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Package qualification     | Published 0.3.52 in one scratch fixture: trivial value, typed result, Unicode function, relative/bare import, imported helper, shared backing views; run development and minified production Vite under actual CSP, plus supported Bun/Node versions. One run per cell, no performance claims.                                                              | Whether adopting package code is viable at all; prefer static entries when function shipping fails.           |
| Request settlement        | Deterministic tests for crash, graceful shutdown, transfer failure, startup failure, abort before/after admission, old-generation response, and 65,537 unresolved requests with cheap fake endpoint dispatch. Assert every request settles once, counters return to zero and IDs cannot alias.                                                              | Minimum runtime correctness contract; failures disqualify an unwrapped upstream backend.                      |
| Actor ownership           | Interleave two document identities with retained revision counters, then crash/recreate one; terminal control/output use two real ports with deliberately reversed scheduling. Require no state mixing and barrier completion independent of page rAF.                                                                                                      | Actor placement and restart contracts, separate from generic pool affinity.                                   |
| Memory/admission baseline | Existing workload only: one large editor plus a streaming terminal, then fixed document/session counts. Record startup time, worker count, queued/retained bytes, process/actor memory where measurable, active service/WASM/GPU allocations and cancellation drain time. Compare fixed 1/2/4 job-pool workers, stop each arm at a recorded memory ceiling. | Whether pool sharing helps and what cost model/budget is needed; no auto-scaling from CPU count alone.        |
| Guard/channel proof       | Only if a concrete accepted consumer needs SAB: one small forced-compaction fixture with two realms holding nested proxies, writer starvation bound, forced owner death, null message, send/receive compaction and closure while blocked.                                                                                                                   | Whether a SAB design is safe enough to discuss for that consumer. Does not reopen deleted editor shared text. |
| End-to-end latency        | After a backend passes correctness, paired fixed traces with baseline message transport and candidate runtime; warm/cold setup separated, p50/p95/p99 input-to-presentation, main CPU, whole-process CPU, queue delay, transfer time and cancellation wasted work. Two balanced repeat runs with output digests.                                            | Adoption by measured benefit or verified boilerplate removal, subject to existing Plan 287 frame/p95 gates.   |

Run only discriminating cells, expanding after a failure exposes another supported contract. Measurements on the owner's host use the private [heavy-runner tool](https://github.com/ShaulLavo/heavy-runner), with scheduling defined by the local `fregat-local` skill. Other execution hosts choose their own resource limits. Dedicated task fixtures own explicit ports. Any committed test remains portable. Preserve raw data, machine/browser/runtime versions, source/bundle hashes, positive controls and clock-join qualifications; no synthetic parser scan gets presented as product latency.

## Review result

ISSUES. Complete source/artifact research, no implementation or benchmark runs. The strongest transferable lesson is to model task admission, retained actor ownership and data ownership separately. Upstream package adoption needs correctness and bundling qualification; shared-memory object storage remains excluded from our initial runtime plan.
