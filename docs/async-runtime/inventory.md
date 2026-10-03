# Terminal integration and broad message-runtime inventory

Research date: 2026-10-03. Production conversion remains incomplete. Research only; no implementation or tests run.
Local/source baseline is `6d8e768703c1bfc92091dbdd41c9171d5942f263`.
Fresh GitHub main is `81b09d4b0dff5f5f39a54df0320a9bdf770572df` after #470.
Live `/platform/release` returned clean web commit `6d8e7687`; server commit `06e8bc03` records dirtyFiles 2.
The live response is release metadata, not a runtime worker census or source-equivalence proof for that dirty server bundle.
Upstream-main comparison found renderer/native-frame changes, not additional worker constructors.

## Current production-source inventory

| Owner                            | Kind and boundary                                                         | Shared-package treatment                                                      |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tree-sitter                      | Dedicated module Worker; retained parsers/chunks and document versions    | Shared lifecycle/request bookkeeping with domain parse affinity               |
| Shiki                            | Dedicated module Worker; retained tokenizers/grammars/themes              | Shared lifecycle/request bookkeeping with domain document serialization       |
| TypeScript LSP                   | Dedicated module Worker carrying JSON-RPC                                 | Lifecycle adapter; retain existing LSP protocol                               |
| Spellcheck                       | Lazy module Worker with dictionary and accepted words                     | Bounded request/lifecycle migration candidate                                 |
| Minimap                          | Dedicated module Worker, transferred canvases and coalesced rendering     | Lifecycle/event channel, domain canvas recovery and frame cadence             |
| PDF.js viewer                    | Dependency-owned browser Worker configured through workerSrc              | Preserve PDF.js protocol; lifecycle/telemetry adapter only                    |
| Native filesystem watch          | Lazy Bun Worker, ref:false, batches and watch attachment acknowledgements | Lifecycle plus bounded event stream; domain watch reattachment                |
| Push notifications               | Browser-managed service worker                                            | Leave browser lifecycle and push permission policy with settings              |
| Demo MSW                         | Mocking service worker launched by setupWorker                            | Keep demo-only interception/mocking lifecycle                                 |
| Demo parent frame                | Window postMessage readiness/error messages                               | Window origin/identity protocol, optional channel adapter only                |
| Native desktop shell             | WKWebView/WebKitGTK message handler and injected response callback        | Native IPC with origin/token/document identity; separate adapter if justified |
| Terminal                         | Main-thread public terminal and OffscreenCanvas-capable renderers         | Dedicated execution worker is planned, not shipped by inspected source        |
| Server serial/sweep/reactor work | Same-event-loop FIFO, timers and draining                                 | Scheduler contracts; no Worker lifecycle conversion                           |
| PTY/LSP/image/discovery helpers  | Native processes and socket transports                                    | Existing process/socket owners retain lifecycle                               |

Repository-wide `rg` searched constructors, service-worker registration, setupWorker, MessageChannel, postMessage and configured dependency worker paths.
Production constructors found five editor Worker owners and server native watch; no SharedWorker allocation found.
Test/benchmark workers and build-emission code are separated from production ownership.
Browser/library internals and native processes may create internal threads; the scan does not count those.
Platform has its own PDF.js viewer worker, server native-watch worker and push service worker; editor workers reach it through imported packages.
PDF.js configures `pdfjs-dist/build/pdf.worker.min.mjs?url` through GlobalWorkerOptions.workerSrc, which constructor-only scans miss.
`openPdf` copies cached bytes before PDF.js transfers them; abort destroys its loading task, and failure triggers destruction.
Successful lifetime remains bound to the retained abort signal; PDF lifecycle browser tests assert loadingTask.destroyed on closure/replacement.
Rendering abort separately cancels page and text-layer tasks. Preserve dependency disposal rather than replacing its private protocol.
PDF.js6 has no eval support, and this code never creates its separate scripting engine; enableXfa is false.
Configured dependency-path scan found no further application worker setup outside PDF.js and existing owners.

Local anchors:

- `editor/packages/tree-sitter/src/treeSitter/workerClient.ts:378`, `editor/packages/editor/src/shiki/workerClient.ts:284`.
- `editor/packages/typescript-lsp/src/workerOwner.ts:149`, `editor/packages/spellcheck/src/service.ts:90`, `editor/packages/minimap/src/workerClient.ts:135`.
- `apps/server/src/fs/native-watch-host.ts:75`, `apps/server/src/fs/watch-worker.ts:67`.
- `apps/web/src/lib/pdf-viewer/engine.ts:1-56`, `apps/web/src/components/pdf-viewer/tests/lifecycle.browser.tsx:35,127`.
- `apps/web/public/sw.js:1-91`, `apps/web/src/features/settings/utils/push-browser.ts:69-76`.
- `apps/web/src/demo/start.ts:30-59`, `apps/web/src/demo-entry.ts:60-72`.
- `apps/desktop/src/launcher/shell-bridge.ts:59-82` validates document identity and rejects pending chooser calls at pagehide.

Push SW has push/subscription/notification handlers, no fetch cache or page compute RPC.
Its browser lifetime cannot be represented as an app-owned dedicated worker that the package terminates.
MSW uses `mockServiceWorker.js`, its own asset-base scope and HTTP/socket demo interception.
Native shell operations can stay open for human interaction; compute deadlines would be the wrong default.

## Work in flight, freshly verified through gh

| Work                                                  | Status at query                                     | Meaning                                                                 |
| ----------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| [PR480](https://github.com/ShaulLavo/fregat/pull/480) | MERGED 2026-10-03T09:28:04Z; head c3b41a17          | Approved async API/ownership contract in Plan287                        |
| [PR483](https://github.com/ShaulLavo/fregat/pull/483) | OPEN; head 6d0b5701068169a15f30804d35bf5b334223edc7 | Native dedicated-worker renderer gate, fixture/test-only                |
| [PR494](https://github.com/ShaulLavo/fregat/pull/494) | OPEN; head 56e5730411f43d700f8c96066e202620e3f0a0d5 | Internal host extension indexes/lifecycle scaffold                      |
| [PR470](https://github.com/ShaulLavo/fregat/pull/470) | Merge is present in current main 81b09d4b           | Zig becomes only GPU frame builder; bounded frame/presentation recovery |

These are background references; this lane neither worked on nor linked/modified those PRs.
Main ghostty is now 0.3.4; live/local baseline metadata had 0.3.3.
Plan283 native full-move prerequisite is landed in GitHub main, but this does not complete terminal worker conversion.
PR483 must recheck renderer contracts after #470 because its tests invoke changed renderer source.
Refresh all heads/checks before executing any migration; do not stop or rewrite another session's lane.

## What PR483 proves and what remains

Pinned PR sources were read without modifying the checkout.
The browser test starts real dedicated rendering and independent output-producer workers.
It transfers the OffscreenCanvas and a MessagePort to rendering; the producer transfers its own byte buffer.
The fixture loads a FontFace into worker fonts and proves 2D glyph ink, native text/cursor/key/paste and Zig/render metrics.
It injects worker rAF/timer clocks, exercises both WebGPU and WebGL, and observes animation frames.
Cleanup checks renderer frames/timers, native session disposal, font removal, output-port closure and backend release.
The injected failure occurs after a native rendered frame; cleanup precedes rethrow propagation.
The collector's unit tests deliberately reorder error, result, cleanup and producer observations.
A 15-second host timeout and 5-second output/frame fixture timers bound the test.

- [Protocol](https://github.com/ShaulLavo/fregat/blob/6d0b5701068169a15f30804d35bf5b334223edc7/ghostty-webgpu/src/render/tests/fixtures/worker-protocol.ts).
- [Execution fixture](https://github.com/ShaulLavo/fregat/blob/6d0b5701068169a15f30804d35bf5b334223edc7/ghostty-webgpu/src/render/tests/fixtures/native-render.worker.ts).
- [Browser gate](https://github.com/ShaulLavo/fregat/blob/6d0b5701068169a15f30804d35bf5b334223edc7/ghostty-webgpu/src/render/tests/worker-renderer.browser.test.ts).
- [Arrival-order collector tests](https://github.com/ShaulLavo/fregat/blob/6d0b5701068169a15f30804d35bf5b334223edc7/ghostty-webgpu/src/render/tests/worker-run.test.ts).

This protocol contains startup/result/cleanup signals, not production terminal commands, identities, generations or barriers.
It does not prove arbitrary startup failure cleanup, GPU/device loss reincarnation, background-tab settlement or public API parity.
Cleanup observation booleans alone do not prove all handles are closed; the gate complements host handle/resource inspection.
No hardware performance or compositor presentation timing is proved by this source inspection.

## Required terminal contracts and ownership

Plan287 owns the async public Terminal API and dual local/worker adapters; Plan286 owns host extensions.
TerminalSession, native wasm memory, parser, glyph atlas, render frame and GPU resources stay with one execution actor.
The host owns DOM, dimensions/DPR/insets, input claim/pass, IME, focus, accessibility and permission/user-activation work.
No extension closure crosses the worker boundary. Only typed operation/event data crosses.
Authoritative reads/mutations return promises in both entries; host subscriptions and extension registration stay synchronous.
The last-submitted-frame summary groups terminal generation, frame, operation sequences, native revision and committed layout.
Row text is copied into that summary; large selection text is requested on demand.
Events arrive at host subscribers before corresponding command settlement.
Confirmed appearance changes after acknowledgement; font/layout generations reject stale commits.

Shared package owns channel identity, pending settlement, generation rejection, admission bookkeeping and generic sequencing helpers.
Terminal owns command semantics, operation barriers, output replay policy, native revision/frame/layout coherence and presentation.
The PTY producer can transfer its own bytes directly through an owned MessagePort without a main-thread hop.
WebSocket and Platform socket wrappers remain with the actor that owns them; transferable port support does not transfer sockets.
Independent output/control ports need explicit processed-sequence barriers for replay, resize, reads and disposal.
Any package queue must preserve progress of output/control acknowledgements needed to release its own waits.
Caller-owned `write` buffers remain owned. wasm memory is never transferred.
Disposal immediately invalidates host calls; its promise settles after bounded execution-owner cleanup.
Promise settlement/control acknowledgement must not depend on page rAF continuing.

OffscreenCanvas ownership is one-way at handoff. A dead actor's canvas/resources cannot be assumed reusable.
Terminal's recovery owner recreates the DOM canvas, chooses permitted backend, reacquires GPU and replays approved state.
The package reports failure/generation and releases resources; it cannot reconstruct terminal content or native GPU state generically.
Do not silently pick main-thread execution on missing worker support; Plan287 requires a structured capability failure.
`auto` may select a supported worker backend; an explicit backend requires that backend.
Worker fonts require explicit face URLs/descriptors and worker FontFaceSet loading, separate from document fonts.
Background rendering can pause; processing/cleanup control still needs a policy and bounded supervisor.
Clipboard user activation and OSC52 permission policy remain host/domain responsibilities.

## Packaging and migration order

1. Land/reverify Plan287 phase1a renderer gate after native-only main, without delaying unrelated extension scaffold.
2. Finish package contract/transport decision and publishable export design against terminal requirements before its implementation.
3. Implement shared package with real endpoint conformance tests; preserve domain APIs while replacing internal duplication.
4. Plan287 phase1b owns common async public API, local execution adapter and same-PR consumer conversion.
5. Phase1c integrates the shared channel/lifecycle adapter and ships worker entry, direct port barriers, fonts and capability errors.
6. Expand dual-entry common coverage for selection/clipboard/IME/accessibility/scrollback under phase2.
7. Integrate landed Plan286 hooks and cost gates; ship public API only after its recorded release-version approval.
8. Phase4 switches Platform/site, captures visual evidence and deploys under Plan287.
9. Server-watch migration can follow independently once Bun lifecycle/stream guarantees pass; SW/MSW/native IPC stay scoped.

Existing ghostty package emits through tsc, has no worker export today, and publishes dist/types/wasm assets.
Shared runtime must resolve from a packed standalone ghostty consumer without Platform aliases or checkout-only workspace links.
Choose a public dependency name/version and independent package distribution, or deliberately bundle its internal implementation.
Keep generic package dependency direction below ghostty/editor/server; import no Platform settings, DOM globals or feature modules at top level.
Test new worker entry declarations for legacy/current TS paths and actual runtime exports.
Pack/install external consumer smoke must load emitted Worker URL, wasm, bridge and font assets under non-root URL bases.
Editor's canonical `new Worker(new URL(..., import.meta.url), {type:'module'})` build handling is evidence to reuse, not a guarantee tsc solves ghostty packaging.
Patch-bump all affected packages and retain existing package-smoke portability.

## Measurement limits and acceptance

Use Plan283 paired hardware comparisons and heavy-runner quiet windows; SwiftShader qualifies correctness only.
Worker rAF or renderer onTextFrame proves submission/summary creation, not compositor presentation.
Qualify each worker's canvas presentation identity and clock mapping before subtracting host and worker timestamps.
Record performance time origin, actor identity, generation and sequence, plus clock uncertainty; unqualified cross-clock latency stays null with reason.
Keep page-main CPU separate from worker CPU, renderer-process total and GPU-process CPU.
Use paired local/worker input/write/output cases with identical fonts/DPR/native pipeline and foreground/background state.
Plan287's p95 input/write allowance is one renderer frame; require independent-producer output responsiveness with a known page-main stall positive control.
Include sustained multiple terminals, transport bytes/queue peaks, device/context loss and repeated dispose/recreate handle counts.
No shared-memory or pooling optimization is justified by the offscreen correctness fixture alone.

The terminal is the strongest ownership/streaming contract test for the package, while server watch tests Bun lifetime and batched events.
ISSUES: renderer feasibility exists, but production actor protocol, packaged worker entry, parity/recovery and qualified worker timing remain planned.
No implementation, runtime reproduction or new measurements were performed in this lane.

## Retained services and local scheduling

Tree-sitter retains parsers/chunks, validates document versions, lazily recreates after crashes, rejects pending requests and terminates immediately on disposal. Packed result arrays transfer; retained input strings/chunks and the independent atomic cancellation flag remain. Shiki retains document tokenizers/themes and packed token stores, serializes per document, lazily recreates and also terminates immediately on disposal. Their existing cleanup is useful input to the shared contract.

Platform highlighting uses one shared service for editor/diff/preview/fence consumers; standalone callers create explicit services. Minimap owns transferred canvases per contribution and coalesces payload/render work. Its disposal waits for an acknowledgment without a timeout observed in source; this is an unconfirmed risk, tracked in [#487](https://github.com/ShaulLavo/fregat/issues/487). Spellcheck belongs to the app runtime, initializes dictionaries lazily and restores accepted words after crash. TypeScript keeps JSON-RPC and announces server exit on crash rather than silently reusing a dead session.

EditorWorkScheduler has five domain task classes, latest-per-key replacement, bounded debounce, validity predicates and budgets. Many LatestAsyncRequest controllers instantiate independent schedulers; those priorities are local, and immediate/delayed paths can start directly. Large-file policy independently enables analysis/minimap by document size; domain/settings own it. Server SerialWorker, SweepScheduler and ReactorScheduler respectively own FIFO, one-active/one-rerun timer coalescing and fixed-point drain. Reactor participants can enqueue each other; preserve their graph and shutdown order.

The existing topology reference has stale disposal/unpacking descriptions; [#485](https://github.com/ShaulLavo/fregat/issues/485) tracks that mismatch. This inventory used implementation source. Neither issue was runtime reproduced in this planning pass.
