# Plan 287: ghostty-webgpu worker mode

## Status and authorization

- Status: APPROVED 2026-10-02 by the owner: "I do like the worker idea. And I do think we should add
  it as a mode … either import the regular one that runs on the main thread or you import the
  offscreen canvas version, which [Fregat] will end up using."
- Owns: `ghostty-webgpu/` (a new worker entry point) and Platform's terminal feature
  (`apps/web/src/features/terminal/`), which switches to it.
- Order: starts after Plan 283's Zig frame full move, so the worker carries the new pipeline and
  nothing is ported twice. Coordinates its public API with Plan 286's extension model.
- Versions: patch-only through launch, including breaking changes. No release-version approval
  wait; minor and major bumps remain owner decisions.

## Outcome

A host picks where the terminal runs by what it imports:

- `ghostty-webgpu`: today's terminal on the main thread.
- `ghostty-webgpu/worker`: the same `Terminal` API, with Ghostty, the Zig frame builder, glyph
  rasterization and WebGPU running in a dedicated worker on an `OffscreenCanvas`. Output never
  runs on the page's main thread.

Fregat uses the worker entry. Both entries pass the same test suite.

## Decisions

- Messages, not shared memory. An earlier Fregat experiment with `SharedArrayBuffer` ended at the
  same speed as ordinary worker messages and was removed; WebAssembly adds nothing here because the
  main thread already reads wasm memory in place. No cross-origin isolation requirement.
- The worker owns the terminal state. The main-thread object is a thin host: the DOM element, input
  events, IME, focus, accessibility, scrollbar and the public API. It keeps a per-frame summary the
  worker posts after each frame (cursor, selection, visible row text, scroll state) for synchronous
  reads such as IME placement and hit-testing.
- Copy: Ctrl/Cmd+C asks the worker for the selected text and writes it with the async clipboard API
  inside the keydown's activation, so large selections are never pushed every frame.
- PTY: the host can hand the worker a transferable `MessagePort` so output bytes go straight to
  the worker; a host that writes through the main-thread API still works. Browser `WebSocket`
  objects and Platform's socket wrapper stay with their owning actor. Independent output and
  control ports use explicit sequence barriers for replay, resize and disposal.
- Glyphs rasterize in the worker on an `OffscreenCanvas` 2D context; host fonts load through the
  worker's `FontFaceSet`.
- An explicit WebGPU or WebGL backend requires that backend in the worker and fails with a
  structured error when it is unavailable. Only `auto` selects a supported worker backend.
  Missing worker or `OffscreenCanvas` capability fails with a structured error; choosing the
  main-thread entry remains the host's decision.

### Shared API agreement with Plan 286 — approved 2026-10-03

Both entries share method names and arguments. The main entry keeps its synchronous authoritative
operations; the worker entry returns promises for those operations. The common interface is generic
over the return convention. Common suites and extensions use await-style calls, which work with
both conventions. The execution owner keeps `TerminalSession` local and synchronous within its
actor. There are no compatibility wrappers or a promise facade over the main entry.

- `Terminal.create(options)` returns `Promise<Terminal>` in both entries. Options accept readonly
  nested extension values and presets. A native runtime object stays with its execution actor and
  is excluded from the common high-level creation options.
- Authoritative operations stay synchronous in the main entry and return promises in the worker
  entry: writes, input encoding, reset, scroll, selection mutations, appearance/geometry changes,
  history and buffer reads, selection text and coordinates, cell measurement, live geometry,
  serialization and captures. An atomic selection request returns text and coordinates from the
  same revision.
- A named last-submitted-frame summary supplies synchronous displayed rows, IME placement,
  hit-testing and cursor rectangles. It identifies terminal generation, frame, processed operation
  sequences, native revision and committed layout. Grid, cell metrics, cursor, selection coordinates
  and viewport belong to that same submitted frame. Row-text patches are owned copies; selection
  text is requested on demand. The summary is displayed state, separate from authoritative reads.
- DOM elements, subscriptions, focus/blur and host registrations remain synchronous. Confirmed
  appearance snapshots change after native execution or worker acknowledgement. Disposal immediately
  invalidates the host; main-entry cleanup is synchronous and worker disposal resolves after
  execution-owner cleanup. Worker settlement runs while page rAF is suspended.
- `Extension.setup(scope)` and `terminal.use(extension)` execute on the host/main side in both
  entries. `use` synchronously returns the typed `{ api, dispose }` attachment. Input claim/pass
  hooks run synchronously before native input encoding is queued; native protocol replies bypass
  these hooks. No extension closure crosses the worker boundary.
- Semantic events originate with native execution and reach host subscribers in order. Custom OSC
  hooks observe native-parsed unsupported numbers and return `void`; core-owned numbers retain
  native behavior and typed events. Duplicate custom-number registrations are rejected. Custom
  OSC observations require Plan 286's official upstream-pin prerequisite after the Zig-frame move.
- OSC 52 retains its existing default denial and write-only browser bridge. Parser acceptance uses
  an explicit policy snapshot in the execution actor; host browser completion is reported
  separately. Clipboard reads and new permission grants are outside worker adaptation. Compare
  native read-query behavior before and after the adapter change.
- Clone-safe errors carry operation and runtime facts. Request/event envelopes carry terminal
  identity and generation; events precede command settlement. Caller-owned write buffers stay
  owned by the caller. Explicit port producers may transfer their own buffers; wasm memory stays
  with the native actor.
- Worker fonts use explicit face sources and descriptors, loaded into the worker's `FontFaceSet`.
  Host measurements supply DOM dimensions, padding, insets and DPR. Font/layout generations reject
  stale commits and hold the previous complete geometry until its replacement is ready.

Plan 287 owns the shared return-convention contract, host/execution adapters and Phase 4
Platform/site worker migration. Existing main-entry consumers keep their synchronous calls until
that migration. Plan 286 owns extension lifecycle, contribution indexes and new hooks; both tracks
agree on hook typing before changing shared host files. Its internal scaffold can land independently.
Public API shipment waits for their agreed hooks; Phases 1–2 continue while that dependency is built.

The first owner-boundary PR extracts concrete local native execution, narrow controller intents and
an explicit submitted-frame summary with the current main public API unchanged. The shared generic
contract and packaged worker follow separately. The local owner keeps borrowed runtimes and renderer
factories actor-bound; host DOM/input/link callbacks are never serialized. Common worker creation
uses finite clone-safe backend selection and explicit font sources. An importable execution
descriptor is added only if a real use case requires it.

## Phases

1. Worker entry with output, rendering, resize, focus and keyboard input; the main-thread host and
   message protocol; the existing unit and browser suites run against both entries.
2. Selection, copy, links, IME, accessibility and scrollback through the per-frame summary and
   on-demand requests.
3. Plan 286 extensions run in both entries; the extension API states which side each hook runs on.
4. Platform's terminal feature switches to the worker entry; the site offers both.

### Execution checklist

- [x] Real dedicated-worker feasibility: native session, Zig frames, WebGPU/WebGL, worker fonts,
      glyph ink, rAF and direct-port output. Chromium SwiftShader proves correctness only.
- [x] Main-sync/worker-async return convention and host-side extension/input ownership selected.
- [ ] Phase 1a: permanent native-worker renderer CI gate, with both GPU backends and clean teardown.
- [ ] Phase 1b prerequisite: concrete local native execution owner, narrow controller intents and
      atomic submitted-frame summary; unchanged main public API, native ordering and clipboard tests.
- [ ] Phase 1b: shared public interface generic over the return convention; await-style common
      suites and extension typing, with ordered worker settlement. Keep main-entry consumers intact.
- [ ] Phase 1c: packaged worker entry, real worker-owned execution/fonts/rendering, fitted layout,
      input/focus, structured capability errors and direct-port sequencing. Start the common
      dual-entry matrix with covered operations; preserve remaining main-entry coverage.
- [ ] Phase 2: finish selection/copy/links/IME/accessibility/scrollback, then require the complete
      common suite for both entries. Prove clipboard activation in each supported browser.
- [ ] Phase 3: integrate the landed Plan 286 hooks into both entries and run its cost gates.
- [ ] Phase 4: switch Platform, expose both site modes, read `look` screenshots and deploy.
- [ ] Acceptance: qualify worker compositor-presentation identity and per-actor clock joins before
      publishing input/write latency; distinguish page-main CPU from whole-renderer-process CPU.
- [ ] Acceptance: paired worker/main output and input/write measurements, plus independent-producer
      long-output responsiveness with a known main-thread stall positive control.

Only mark a product phase complete after its reviewed PRs land, its relevant checks pass and the
mesh runs it. A feasibility probe or partial matrix does not complete Phase 1.

## Done when

- Both entries pass the same suites, and Platform runs the worker entry.
- Paired `bench:compare` on omarchy, worker vs main-thread entry: input and write latency do not
  regress by more than one renderer frame at p95, and main-thread CPU during output drops to the
  host's own work.
- A long-output scenario shows the page's main thread free while a terminal streams.
