# Plan 329: Async lifecycle and typed transport

Status: Approved, 2026-10-03. Execution deferred; this session delivers planning only.
Owner: shared runtime package and the owners of its worker adapters. Parent: [328](328-async-runtime-master.md).
Dependencies: the bounded qualification and baseline stage of [334](334-async-runtime-verification.md), existing package publication rules in [207](207-one-repo-with-mirrors.md).

## Outcome

One owned service/channel implementation settles every admitted call exactly once, releases its bookkeeping, identifies the worker generation, preserves explicit buffer ownership, and finishes shutdown within its declared bounds. Domains keep their own command semantics, caches, restart policies and event ordering.

The first consumers are a retained editor service and a batched-event worker. The terminal actor adds the demanding direct-stream/barrier control. The package's callable API is fixed independently of whether its private command transport uses Comlink.

## Current evidence

[Inventory](../docs/async-runtime/inventory.md), [Comlink](../docs/async-runtime/comlink.md) and [multithreading](../docs/async-runtime/multithreading.md) record source pins and limits. Existing owners repeat request maps, startup/error handling and disposal. Tree-sitter and Shiki already reject pending calls and terminate busy workers; minimap awaits a disposal acknowledgment with an unconfirmed missing-ack risk [#487](https://github.com/ShaulLavo/fregat/issues/487).

Comlink provides useful RPC and transfers. Its released and main teardown differ; neither is an execution supervisor. Callback proxies add owned ports, built-in Error serialization loses structured fields, and async exposed methods can overlap. A promise race settles the outside caller without necessarily removing an opaque transport's inside pending record.

## Contract

### Shared callers and replaceable subjects

[PR #1190](https://github.com/ShaulLavo/fregat/pull/1190) supplies two concrete qualification
cases: cancelling one request on a pooled connection removed other requests, and retiring
old work erased a newer request's marker. The response path already checked task identity;
the cancellation path omitted it. [PR #1100](https://github.com/ShaulLavo/fregat/pull/1100)
previously repaired shared file preparation by issuing independent holder leases.
[197](197-editor-highlighting-service.md#approved-follow-up-retire-hover-tokens-across-theme-changes)
records a reproduced late-publication failure across a theme change.

Keep these identities separate in the owner API:

- Caller interest: one request or view receives one idempotently releasable lease. A
  connection may contain many interests. Individual cancellation releases its exact lease;
  disconnect releases the connection's leases.
- Task identity: each execution entry is unique, even when its logical key is reused.
  Completion, failure, final release, retry, and cleanup affect only that captured entry.
  Retiring an entry must not remove its replacement. Retire it before requesting a stop
  so a new caller cannot join work already being cancelled.
- Subject provenance: capture document incarnation and revision, theme, or configuration
  with the work. A current execution entry does not prove its result still belongs to the
  current subject. Publication needs domain authority as well as live task identity.
- Execution generation: the process or worker lifetime is separate from task identity
  and subject revision. Existing protocols retain their own correlation and generation rules.

Callers receive result/release capabilities, never the shared controller or mutable waiter
collection. The concrete owner owns coalescing, result delivery, and the final-interest
policy. A caller signal cancels that caller's wait; owner and transport signals control shared
execution. Cancellation requests do not prove execution has stopped.

Start with concrete semantic-token and theme-bound snippet owners. A replacement subject
gets fresh identity, including A→B→A and close/reopen. Retired owners cannot publish into
their replacement's state. Shared destinations require a current-owner check at publication;
an arbitrary captured callback does not establish that authority. Retirement immediately
revokes new joins and current publication, while the domain defines whether existing callers
may finish or receive cancellation. Final-interest release governs abandonment separately.
Retained registries keep identity checks private. Extract shared bookkeeping only when two consumers
demonstrate that the same implementation deletes meaningful machinery in both. Keep
TanStack's query ownership and LSP JSON-RPC intact. This bounded qualification does not
start the deferred worker transport or scheduling program.

Extend [334](334-async-runtime-verification.md)'s deterministic contract suite with two
requests on one connection, a third on another, individual cancellation, repeated release,
disconnect, final-interest release followed by immediate reacquisition, and A replaced by B
before A completes or cancels. Test reused client IDs and reopened subject identities.
Assert surviving responses, backend stop counts, current registry identity, and cache values.
The theme test must cover both A-before-B and B-before-A completion orders. A helper that
guards deletion while permitting stale cache publication fails qualification.

### Service lifetime and transport

- Lifecycle is a discriminated state: idle, starting, ready, closing, closed, failed. Each started execution lifetime has a new generation. Calls during closing/closed fail before admission; concurrent starts share one attempt.
- Startup means the execution adapter completed its domain initialization and replied ready. Creating a Worker or posting init does not establish readiness. Startup failure and missing ready have bounded outcomes.
- The owner holds the actual worker/endpoint, request records, subscriptions, ports and accounting. Dispose is idempotent and immediately invalidates new operations. Its promise resolves after bounded cleanup or forced endpoint termination, with diagnostic facts about the path used.
- Requests carry protocol version, owner identity, execution generation and a nonaliasing operation ID. Their domain payload carries document/terminal/configuration provenance where needed. Correlation identity is distinct from domain revision and stream sequence.
- A normal success means the handler completed the declared command barrier. A domain failure carries its structured error. Loss after dispatch may leave side effects unknown. No automatic retry of ambiguous effects; the domain must supply an idempotency receipt or an explicitly safe read retry.
- Wait cancellation, withdrawal before dispatch, requested cooperative stop, acknowledged execution stop and whole-actor termination are separate facts. A cancelled waiter never proves rollback. Execution accounting remains claimed while work may continue.
- State mutations serialize within the domain's declared lane. Read-only concurrency is explicit and revision-bound. No global serial queue across independent workers.
- Domain events associated with a command are delivered in order to registered host subscribers before either successful or failed settlement when the domain promises that barrier. Delivery does not await arbitrary async subscriber callbacks; reentrant callbacks cannot hold the actor lane while awaiting another command. Across ports, explicit sequence fences establish progress; arrival order alone is insufficient.
- Structured error encoding preserves safe code/status/message/why/fix and operation/runtime facts. Parse messages once at the boundary; never log text, buffers, secrets or setting values. An application adapter maps package errors into its catalog.
- Clone, transfer and shared references are explicit per operation. Deduplicate transfer entries and define shared-backing-view behavior. Admission rejection happens before capture or detachment. Clone capture time is explicit. Accepted queued moves relinquish logical ownership before physical dispatch; withdrawal/replacement returns the owned buffer/token or consumes it under a declared law. Retained writable aliases violate move ownership and are a runtime-boundary concern, not something types can prove. Caller-owned terminal write buffers remain owned; independent producers may transfer their own buffers. WASM memory stays with its execution owner.
- Subscription registration, producer-installation readiness and graceful/forced/unknown closure have separate typed facts. Subscription disposal removes registrations and owned channels. Late results/events cannot reach a new generation or disposed subscriber. Invalid frames report a bounded protocol failure and preserve the prior valid state.
- Inspection exposes lifecycle/generation, queued/running/pending/subscription/port counts and byte estimates with their precision. Application adapters publish observable state into the owner's vanilla Zustand store; the package does not add a competing React state/cache model.

## Transport decision

Compare two private transports against the same public contract and real payloads:

1. Narrow Comlink use: one finite dispatch table, wrap/expose/transfer, clone-safe outcome values, explicit events and direct data ports. No public remote property/constructor graph or closure migration.
2. Finite typed request/event channel extracted from our strongest current owners: explicit pending records, generation, outcomes, transfer lists, subscriptions and closure.

Default design is the finite typed channel. Comlink may replace its private request codec if it passes every lifecycle/resource test and lowers total maintained complexity. Record the winning artifact/version, adapters, retained map behavior and actual built chunks. Saving a few dispatch lines while adding opaque cleanup machinery is insufficient.

Test the published Comlink artifact separately from unreleased fixed source. Use a released upstream correction or a justified small patch only if its maintenance cost beats the finite channel. Avoid vendoring the entire library to remove unused features. Source copied from upstream retains its license obligations.

LSP retains JSON-RPC, PDF.js retains its dependency protocol, and terminal bytes remain on direct bounded ports. Existing protocol adapters can use owned endpoint lifecycle without nesting a second RPC protocol around their messages.

## Design sketch

Usage begins at the domain owner. It creates an owned service with a static worker factory and codec, opens its lifetime, calls typed domain commands with a declared lane/transfer policy, and disposes the owner. The domain API never exposes Comlink proxy types or generic wire envelopes.

The selected contract sketch is in the [architecture sketch](../docs/async-runtime/architecture.md). Private implementation responsibilities are worker lifetime, channel/request records, structured protocol encoding and runtime-specific endpoint adapters. Each accepted request has one authoritative operation receipt and independent cancellable waits. Removing a waiter never removes continuing execution from accounting. A bounded generation-scoped execution ledger outlives caller transport records after uncertain timeout/death; a late trustworthy receipt can update diagnostics/claims without settling a caller twice. Running completion releases job claims; actor-resident engine/WASM/font/GPU reservations release only after cleanup acknowledgment or adapter-qualified reclamation. Browser terminate() alone does not prove synchronous memory release; uncertain resources remain conservatively charged or quarantined within a finite owner policy.

Browser workers and MessagePorts are initial adapters. Bun native Worker must preserve ref:false where the domain already uses it. Node worker_threads is qualified only if a current consumer needs it; runtime-neutral scheduler modules still run under Node tests. Closed ports do not uniformly emit peer-death events, so declared deadlines/owned endpoint signals remain necessary.

## Execution units

- [ ] Freeze the caller usage/type contract and declared readiness/cancellation/disposal barriers. Add structured errors and boundary schema/type derivation before implementation.
- [ ] Build the smallest static local/real-worker fixture and both transport candidates under identical ownership. Qualify source and minified built artifacts; exercise unavailable capabilities and module/WASM paths.
- [ ] Implement generation-scoped exactly-once settlement, synchronous clone-failure rollback, startup/disposal bounds and request-record removal. Verify reentrant callbacks and close during start.
- [ ] Implement explicit transfer ownership and subscription cleanup. Prove rejected admission retains buffers and shared backing arrays detach only under declared ownership.
- [ ] Add bounded events/direct stream adapters and per-domain sequencing fences; keep streaming data off unary command proxies.
- [ ] Run the transport comparison in 334, choose its backend by correctness and total maintenance cost, and delete the losing implementation from the shipped package.
- [ ] Prove package tarballs and exact consumer mirror installation before introducing cross-family imports. Initial publication remains its own delivery gate.
- [ ] Migrate one bounded consumer under 332/333, delete its duplicate broker in the same unit, and record passed gates. Expand only after the next consumer demonstrates reuse.

## Verification and done when

Use 334's deterministic lifecycle suite plus real browser/Bun endpoints. Cover startup/crash/messageerror/missing reply/clone failure, abort before and after dispatch, close during initialization, delayed old generations and simultaneous completion/cancellation. Every caller settles once, every owned record/listener/port is released, and execution credits remain accurate after waiter cancellation. Disposal also completes while page rAF is suspended.

A passing local fake endpoint proves transitions; a real busy worker proves execution and teardown. Neither substitutes for the other. Count the code removed and the new adapter code together. Product integration passes its domain suites, required build/type checks and live evidence. No performance or package-adoption success is claimed in this planning pass.
