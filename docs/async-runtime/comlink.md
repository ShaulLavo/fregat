# Comlink transport research for the shared async package

Research date: 2026-10-03. Status: ISSUES.
Scope: source and contract analysis; no product edits, package installs, benchmark runs, issues or PRs.
Recommendation: keep Comlink as a bounded transport candidate until the package's ownership and failure contracts are fixed.
A worker runtime needs a supervisor, admission/scheduling, explicit command/event ordering and typed transfer ownership regardless of RPC choice.

## Evidence pins

- Local checkout inspected: `6d8e768703c1bfc92091dbdd41c9171d5942f263`.
- Upstream main: `114a4a6448a855a613f1cb9a7c89290606c003cf`, committed 2025-06-18T00:01:59Z.
- Latest GitHub release: v4.4.2, published 2024-11-07T12:36:34Z.
- Release tag SHA: `fd4b52666b1ec62784f8b45cb1108c7e40bc481d`.
- License: Apache-2.0. Package metadata declares no runtime dependency list and `sideEffects: false`.
- Main differs from v4.4.2 by two commits addressing release/MessagePort closure, including upstream PR #678.
- Release metadata and source were compared without installing or executing Comlink; immutable links below retain the inspected revisions.
- [Release metadata](https://api.github.com/repos/GoogleChromeLabs/comlink/releases/latest).
- [Pinned package metadata](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/package.json).
- [Release-to-main comparison](https://github.com/GoogleChromeLabs/comlink/compare/fd4b52666b1ec62784f8b45cb1108c7e40bc481d...114a4a6448a855a613f1cb9a7c89290606c003cf).

## What upstream actually supplies

Comlink maps method/property/constructor operations to message requests and response promises.
It supports explicit transfers, callback proxies, custom value handlers, endpoint creation and proxy release.
It does not supply worker spawning, scheduling, affinity, admission, queue bounds, crash supervision, timeout or execution cancellation.
Thrown `Error` encoding keeps message/name/stack; repository `code`, `why`, `fix` and runtime facts need our own encoding.
Callback proxies create MessageChannels. Endpoint release does not terminate a Worker.
Async exposed methods may overlap after yielding; FIFO message arrival does not serialize their completion.
Its endpoint interface observes messages and has optional `start`, without death or error notifications.

Source anchors:

- [Types and remote-call mapping](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L100-L161).
- [Proxy callback channels](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L208-L224).
- [Thrown-value encoding](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L240-L273).
- [Invocation and release dispatch](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L335-L387).
- [Pending-call response map](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L402-L423).
- [Request creation](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L632-L646).
- [Endpoint contract](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/protocol.ts#L7-L37).

## Released package versus current source

The released `releaseEndpoint` creates a fresh pending map, while `wrap` listens with its existing map.
Inference from that mismatch: the release reply cannot resolve the promise used to close the client's MessagePort.
The release path still clears ordinary pending resolvers immediately and marks its proxy released.
Main uses one shared map, waits for the release reply, closes the MessagePort and then clears remaining resolvers.
Neither version rejects outstanding calls when clearing those resolvers.
Main still waits indefinitely if its release reply never arrives.
`releaseProxy` has a `void` signature; application code cannot await execution-owner cleanup through that API.
An exposed finalizer runs after sending the release reply, and its returned promise is not awaited.
Consequently our disposal promise must represent a separate cleanup command and acknowledgement, bounded by a supervisor.
Do not plan against main's fixed source while installing the unmodified released package.

- [Released release handshake](https://github.com/GoogleChromeLabs/comlink/blob/fd4b52666b1ec62784f8b45cb1108c7e40bc481d/src/comlink.ts#L427-L432).
- [Released pending-map clearing](https://github.com/GoogleChromeLabs/comlink/blob/fd4b52666b1ec62784f8b45cb1108c7e40bc481d/src/comlink.ts#L481-L487).
- [Main release handshake](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L431-L436).
- [Main release implementation](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/comlink.ts#L491-L498).

## Fit against our workers

| Consumer            | Preserve                                                                                 | Suitable Comlink use                                   | Risk to avoid                                                |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Tree-sitter         | Per-document source retention, versions, optional shared cancellation, worker generation | Registration/warming and discrete parse/query requests | Assuming a canceled wait interrupts a synchronous parser     |
| Shiki               | Incremental tokenizers, document ownership and retained grammar state                    | Explicit open/edit/read/dispose commands               | Moving a document between workers without its retained state |
| TypeScript LSP      | JSON-RPC protocol, project lifetime and exit notification                                | Worker lifecycle adapter only, if useful               | Wrapping existing JSON-RPC in a second RPC layer             |
| Minimap             | OffscreenCanvas ownership, coalesced updates and render cadence                          | Initial canvas handoff and bounded control commands    | One callback RPC per rendered element/frame                  |
| Terminal, Plan 287  | One execution actor, independent PTY port, summary identity, barriers                    | Low-rate actor control, if measured                    | Routing every PTY byte through a main-thread proxy           |
| Server native watch | Bun Worker, ref:false, batched events and watch identities                               | Attach/close controls, if it reduces total code        | Converting each filesystem event to callback RPC             |

Local evidence inspected:

- `editor/packages/tree-sitter/src/treeSitter/workerClient.ts:132-156,322-536`.
- `editor/packages/editor/src/shiki/workerClient.ts:104-109,241-342`.
- `editor/packages/typescript-lsp/src/workerOwner.ts:24-140`.
- `editor/packages/typescript-lsp/src/worker/protocol.ts:1-75`.
- `editor/packages/minimap/src/workerClient.ts:98-202,337-350,418-446`.
- `editor/packages/editor/src/editor/latestAsyncRequest.ts:39-44` creates its own scheduler unless given one.
- `apps/server/src/fs/native-watch-host.ts:44-126` and `native-watch-protocol.ts:1-37`.
- `plans/287-ghostty-worker-mode.md:27-86`, especially independent ports, generation and event-before-settlement.

These are retained-state services and streams. A callable-function abstraction does not define their lifetime.
Plan 287 already requires a common local/worker execution adapter. The shared package should fit that adapter.
Terminal extension closures remain on the host under Plan 287; generic callback proxying must not move them.
A stream/event protocol can share lifecycle and telemetry with request RPC while keeping its payload encoding.

## Three adoption alternatives

### A. Entire public Comlink API, behind our supervisor

Use `wrap`, `expose`, `transfer`, `proxy`, handlers and release in one internal adapter.
Package consumers receive our narrow API; they never import Comlink directly.
Keep constructor/property proxy support private unless a real consumer requires it.
This buys established RPC encoding and callback support at the price of two pending-call layers.
A timeout race alone leaks unresolved internal request bookkeeping until reply/disposal.
Supervisor cleanup may require a private MessageChannel, synthetic transport failure replies, or a maintained patch.
Each workaround must count in the comparison against the explicit protocol.

### B. Comlink dependency, deliberately narrow use

Use only `wrap`, `expose`, `transfer` and method calls to a single `dispatch(command)` entry.
Return a clone-safe result union; avoid relying on Comlink's thrown-Error handler for domain failures.
Use explicit event streams and direct producer ports; avoid callback proxies in the first migration.
Keep per-call options, cancellation and deadline metadata in our command envelope.
This narrows consumer semantics, but importing fewer methods does not guarantee that Rollup removes Proxy support or built-in handler state.
Measure the actual built worker/host chunks; dependency size is unlikely to be the decisive factor.
The release/failure bookkeeping questions from A remain.

### C. Small typed command/event protocol, learned from Comlink

Use a finite method table with a request/result type map, request identity and generation.
Use explicit pending resolve/reject records and a supervisor that settles and removes every record.
Use named event streams/subscription IDs with bounded delivery and explicit unsubscribe acknowledgements.
Use direct transfer lists, backed by operation-specific ownership policy.
Skip generic object/property/constructor proxy semantics entirely.
This gives us direct ownership of cancellation, ordering and disposal without adapting an opaque pending map.
The cost is our own protocol code and portability tests. We already own much of that code in multiple places.
Reuse the existing strongest implementation before adding another implementation.
If copying upstream code rather than concepts, retain Apache-2.0 notices and meet redistribution obligations.

Current preference: compare B and C on one real editor service and one stream before choosing.
Do not fork Comlink merely to trim its size. A fork only earns its cost if it fixes a proven contract gap with less code than C.

## Required package contracts regardless of alternative

1. A caller cancellation, removal of queued work, cooperative execution cancellation and terminating an actor are distinct operations.
2. Request settlement occurs once; late results do not affect a new worker/document generation.
3. Timeout is a local outcome, with explicit knowledge that execution may still commit effects.
4. Never automatically retry an ambiguous state-changing request without an operation identity/replay policy.
5. Per-actor sequencing belongs to the execution adapter. Exposed async methods are not an actor mailbox automatically.
6. Queue bounds and coalescing apply before transfer so rejected work retains caller-owned buffers.
7. Transfers are explicit. Shared wasm memory stays with the actor; copied views are the transferable objects.
8. Caller-owned terminal write buffers remain owned. Direct producers may transfer buffers they own.
9. Events and command replies on independent ports need operation barriers; message arrival order alone is insufficient.
10. Terminal events must reach subscriptions before settling their corresponding operation.
11. Subscription teardown removes producer registrations, pending deliveries and callback channels.
12. Dispose invalidates new calls immediately and settles after bounded actor cleanup, even with suspended page rAF.
13. Structured errors use clone-safe catalog fields, operation/generation facts and allowed internal details.
14. Pure package errors should define their own catalog without importing the server application.
15. Runtime adapters report start failure, messageerror, error, termination and exit where observable.
16. Diagnostics expose queue/pending/subscription counts without retaining document content, secrets or setting values.

## Runtime and build checks

Browser dedicated Worker and MessagePort match Comlink's endpoint shape.
SharedWorker requires its explicit port and connection setup; service-worker lifecycle is a separate runtime contract.
Node `worker_threads` uses upstream `nodeEndpoint`, which translates on/off message handlers.
That adapter is not a supervisor, and its returned wrapper is not itself a MessagePort for `constructor.name` closure detection.
Use our owned underlying endpoint to close Node ports reliably.
Bun's Web Worker shape is plausible for `wrap`/`expose`, but Bun is absent from inspected upstream tests.
Verify the server's actual Worker constructor/options and bundled asset path, including `ref:false` shutdown behavior.

- [Pinned Node adapter](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/src/node-adapter.ts).
- [Node worker example](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/docs/examples/06-node-example/main.mjs).
- [Node tests](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/tests/node/main.mjs).
- [Type checks](https://github.com/GoogleChromeLabs/comlink/blob/114a4a6448a855a613f1cb9a7c89290606c003cf/tests/type-checks.ts).
- [Release build entries](https://github.com/GoogleChromeLabs/comlink/blob/fd4b52666b1ec62784f8b45cb1108c7e40bc481d/rollup.config.mjs).

Our verification must run from a fresh clone with runtime probes and stated skips for unavailable tools.
Use our existing Vitest/browser setup; importing upstream's Karma/build toolchain would add unrelated maintenance.
Prove browser source and built assets separately, then server source and deployed bundle worker resolution.
No host-specific filesystem paths in committed scripts. Capture evidence under the configured evidence directory.

## Bounded decision measurements and gates

Record equal commands, payloads, transfer policy, scheduling and actor lifetime across baseline/B/C.
Benchmark the transport first, then full workload. Keep parser/render cost separately visible.
Use small controls, realistic packed token buffers, incremental edits and large payloads.
Include direct-port terminal output and batched watch events so unary RPC cannot hide stream costs.
Record request throughput, p50/p95/p99 settlement, host CPU, worker CPU, payload bytes and pending/queue peaks.
Record allocation/retained heap after repeated open/edit/dispose and callback subscription cycles.
Record worker startup/first-ready, module chunk sizes and transferred versus copied buffers.
Measure sustained competing workloads to see whether a shared admission policy changes input latency.
No speed claim follows from this research; absolute acceptance thresholds belong to the baseline plan.

Correctness gates before adoption:

- Crash or terminate while requests and subscriptions are active; every caller settles and owned listeners/ports close.
- Missing response, hung cleanup and startup failure finish within configured bounds and clear diagnostic counts.
- `postMessage` clone failure removes pending records and preserves structured error fields.
- Timeout/abort followed by late reply and worker restart cannot settle a newer generation.
- Ordering test deliberately yields inside exposed methods and interleaves independent data/control ports.
- Error round-trip preserves catalog fields without sensitive runtime payloads.
- Buffer ownership test verifies clone preservation, allowed transfer detachment and no transfer on rejected admission.
- Terminal replay/resize/dispose barriers, summary generation and event-before-settlement survive blocked/suspended rAF.
- Node/Bun/browser endpoint teardown leaves no process-liveness handle, listeners or subscriptions behind.
- Released v4.4.2 and main release behavior receive distinct tests if both remain candidates.

Decision rule: reject a candidate that fails a required contract; compare the remaining candidates by total adapter/protocol code and workload measurements.
Adopt Comlink only if its saved transport code exceeds the supervisor/cleanup/error/ordering work it introduces.
If C wins, publish the shared package and delete duplicate transport machinery in the same consumer migrations.

## Limits

ISSUES means Comlink alone cannot fulfill our worker runtime contract, and released teardown differs from inspected main.
Source evidence supports the contract gaps. No integration prototype, runtime reproduction, measured regression or final dependency choice is claimed.
I did not inspect every worker; the inventory lane owns exhaustiveness and current terminal implementation/PR status.
