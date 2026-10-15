# Plan 345: Keep Ghostty's Wasm heap views through memory growth

## Status and outcome

Status: Approved. Implementation has not started.

Owner request: 2026-10-15. Adopt resizable Wasm memory in Ghostty WebGPU. Work in Fregat's `ghostty-webgpu/`; its standalone repository is a read-only mirror. Tree-sitter-x has a separate plan. Bun-Wasm and Brush are outside this plan.

Give each `GhosttyRuntime` one resizable native heap buffer and one length-tracking byte view and `DataView`. Keep those objects alive across `WebAssembly.Memory.grow()`. Preserve decoded text, terminal callbacks, retained snapshots, and all renderer outputs. Remove the native heap's buffer-identity refresh checks after the correctness gates pass.

This is a memory-lifetime simplification. Any performance claim needs measurements, including the cost of copies required by browser APIs.

## Current code and runtime decision

`src/core/memory.ts` constructs fixed views and refreshes them when `exports.memory.buffer` changes. `src/core/runtime.ts` creates a temporary `WasmMemory` for ABI discovery, another through `CallbackBridge`, and another for the runtime. `src/core/tests/render-state.test.ts` explicitly expects the old byte view to detach after growth.

`src/core/snapshot-reader.ts` returns bounded, borrowed `Uint32Array` views. `src/core/zig-frame.ts` returns bounded native frame views. Several owned results already copy data in `native-buffer.ts`, `input.ts`, `bridge.ts`, and `text-row-reader.ts`. Preserve these ownership boundaries.

Use `WebAssembly.Memory.toResizableBuffer()`. Ordinary `new ArrayBuffer(..., { maxByteLength })` does not expose Wasm's memory. Grow through `memory.grow()` or Wasm allocation, never `ArrayBuffer.resize()`.

The inventory's MDN compatibility data lists Chrome 144, Firefox 145, Safari 26.2, Node 26.0.0, and Bun 1.2.22 as the API's first supported versions. Recheck these entries at execution time. The package currently declares Node `>=20`, pins Bun 1.4.2, and has no browser minimum table. Root CI setup and standalone jobs select Node 24. Those Node declarations do not satisfy the new requirement.

Require a `toResizableBuffer()`-capable Wasm runtime. Update the package Node minimum to `>=26`, document the browser and Bun floors, and update affected CI jobs in the same implementation. Treat the minimum-runtime change as a breaking change delivered through a patch changeset, following the pre-launch version policy. Keep one runtime path. Do not retain the old refresh path or add browser-version detection.

## Browser API constraints

Resolve browser API acceptance before changing the heap representation:

- `WasmMemory.readCString`, `readString`, and `decode` pass heap-backed views to `TextDecoder`. `terminal.ts` decodes a native string directly. The runtime log callback also decodes native bytes.
- `ZigFrameBuilder.cellData` and `glyphData` reach `src/render/text-pass.ts`, whose `writeRange` passes `data.buffer` directly to `GPUQueue.writeBuffer`. The WebGL text pass passes the native typed array directly to `bufferSubData`.
- PNG callback input, clipboard payloads, native formatted buffers, and the ASCII text-row scratch buffer already use owned arrays. Trace the remaining font, image, texture, and DOM consumers to confirm their backing storage before adding copies.

The current [Encoding IDL](https://encoding.spec.whatwg.org/#interface-textdecoder) uses `AllowSharedBufferSource` for `TextDecoder.decode`. The current [WebGPU IDL](https://gpuweb.github.io/gpuweb/#gpuqueue) uses the same type for `writeBuffer`. [WebIDL buffer conversion](https://webidl.spec.whatwg.org/#js-buffer-source-types) distinguishes `[AllowShared]` from `[AllowResizable]`; shared support alone does not permit resizable backing. Node and Bun acceptance does not prove browser acceptance.

At a boundary that rejects resizable backing, pass fixed owned bytes. Copy only the requested range. Reuse a fixed staging array for synchronous GPU uploads when that preserves the API's copy and lifetime contract. Keep already-owned arrays on their existing path. Choose one portable boundary implementation from the supported browser matrix, without per-version branches or catch-and-retry paths. Never switch the native heap back with `toFixedLengthBuffer()`, which would invalidate the stable resizable views.

The Canvas compositor and its `ImageData` handoff own a separate Wasm memory. Leave renderer-owned heaps outside this plan. Their output, offset, shape, and generation checks remain necessary.

## Phase 1: Establish executable constraints and a bounded baseline

- [ ] Record the current commit, runtime versions, native and bridge Wasm hashes, existing processes, and any existing benchmark resources. Install teardown before starting browsers or servers. Use isolated profiles and explicit task-owned paths.
- [ ] Add a small portable capability case beside the core tests. Exercise the real shipped native memory and the supported browser engines, including a Web Worker. Record `toResizableBuffer`, `memory.grow(0)`, positive growth, byte-view length, `DataView.byteLength`, UTF-8 decoding, and actual upload-boundary behavior.
- [ ] Probe `TextDecoder.decode` with a bounded resizable-backed view in Chromium, Firefox, and WebKit. Check empty strings, ASCII, multibyte UTF-8, combining text, emoji, malformed UTF-8, and replacement-character behavior. Probe the actual `GPUQueue.writeBuffer` and WebGL `bufferSubData` calls with native frame arrays where the engine supports the renderer.
- [ ] Record which boundaries need fixed storage. Check the API contract as well as runtime behavior. Decide the narrow decode and upload adapters before removing any refresh code.
- [ ] Capture a small baseline for repeated byte and scalar reads, forced heap growth, and Unicode decoding. Bound memory growth to a few pages and a fixed iteration count. Capture view reconstruction counts, elapsed time, heap capacity, and bytes copied at API boundaries.
- [ ] Capture a paired renderer baseline using the existing renderer benchmark for `burst-output` and `sustained-scroll`, with WebGPU and WebGL on a hardware adapter. Keep identical workloads, warm-up, repetitions, assets, browser, and hardware for the treatment.

Gate: supported runtime versions are explicit, every direct native-to-browser API boundary has a tested storage contract, and the baseline is reproducible. Record unavailable engine or hardware checks as pending evidence.

## Phase 2: Establish one heap owner before dependent views

- [ ] Convert the exported native memory after native instantiation and export validation, before ABI discovery, bridge instantiation, or cached native views. Conversion can detach views of the former fixed buffer. Keep the native-instantiation log callback safe before the shared wrapper exists.
- [ ] Create one `WasmMemory` for ABI parsing, `CallbackBridge`, and `GhosttyRuntime`. Pass that owner through the constructors rather than creating independent wrappers. Audit direct constructor callers and update them together.
- [ ] Construct the root `Uint8Array(buffer)` and `DataView(buffer)` without an explicit length. Keep their identities stable and remove buffer-change branches from their accessors. Preserve little-endian scalar reads and writes.
- [ ] Use the shared buffer in `SnapshotReader` and direct native views. Keep explicit pointer and element lengths for rows, cells, graphemes, frame arrays, and callback ranges. A packet must stay bounded when the heap grows.
- [ ] Preserve borrowed-view lifetimes through the next native call. Heap growth no longer detaches a borrowed view, but native free, reallocation, overwrite, resize, or disposal still invalidates the contents.
- [ ] Preserve all copies that let callbacks, strings, displayed frames, and snapshots outlive native storage. Keep native allocation pointers and capacities authoritative. Stable backing-buffer identity does not prove that a native allocation stayed at the same address.
- [ ] Implement the decode and upload boundary decisions from Phase 1. Keep copied range accounting in the measurement. Audit callback reentrancy before reusing scratch storage.
- [ ] Use the pinned TypeScript library's authoritative declaration for `toResizableBuffer`. If the current `ES2023` library selection lacks it, select the narrow official library definition. Do not add casts or handwritten API declarations to silence type errors.

Gate: all native heap consumers share the established buffer, browser API boundaries receive accepted input, and native pointer and ownership contracts remain intact.

## Phase 3: Prove growth and retained-data behavior

- [ ] Replace the detachment assertions in `render-state.test.ts` with stable root-view identity and updated length assertions. Write and read sentinels beyond the old heap end through the original byte view and `DataView`.
- [ ] Cover `grow(0)`, repeated positive growth, growth caused by real native allocation, and growth during callback or bridge operations. Assert content parity, stable root views, bounded packet lengths, and a usable runtime afterwards.
- [ ] Extend existing growth and ownership cases in `text-rows.test.ts`, `bulk-snapshot.test.ts`, `displayed-frame.test.ts`, and `zig-frame.test.ts`. Exercise snapshot reserve and grapheme reallocation separately from heap growth.
- [ ] Verify retained results across later writes, resize, reader reuse, native allocation movement, and disposal. Check callback payloads in `custom-osc.test.ts`, `unknown-osc.test.ts`, and `runtime.test.ts` remain owned.
- [ ] Run the growth cases in real browsers with the shipped Wasm. Include Unicode text, title and log decoding, selection text, clipboard output, PNG callbacks, and worker runtime construction. Add the narrow browser tests to the existing browser project.
- [ ] Verify actual WebGPU and WebGL rendering before and after native growth. Check uploaded bytes and output pixels, including partial frame updates. Run Canvas and DOM correctness checks because they consume the same terminal API.

Gate: growth coverage passes with the same cached root views and unchanged visible content. No test relies on a mock `WebAssembly.Memory`.

## Phase 4: Check performance and deliver

- [ ] Repeat the bounded Phase 1 cases against the same baseline. Report decoding and GPU staging copies alongside the removed view checks. Investigate any reproducible regression before merging. A neutral performance result is acceptable if correctness and lifetime simplification hold.
- [ ] Run the focused commands below, then the package verification required by CI. Build workspace packages before checking consumers, which execute `dist`.
- [ ] Update runtime documentation, package engines, and affected CI Node selections together. Keep native config-resolver proof requirements separate where they do not instantiate the terminal Wasm runtime.
- [ ] Add a patch changeset for `ghostty-webgpu`. Start its release note with `Breaking:` and state the required Node and browser versions and the preserved memory-growth behavior.
- [ ] Request independent review, fix findings, and merge through the normal Fregat PR path. Verify the host reports the merged commit and complete the repository's post-merge checks. Let the existing package and mirror release workflow deliver the change.
- [ ] Stop task-owned browsers and servers, remove profiles and baseline worktrees, and verify cleanup on the execution host. Retain the small reproducer, runtime matrix, command output, and before-and-after results in the delivery evidence.

## Commands for execution

Run these from `ghostty-webgpu/` unless a command changes directory. Start with focused tests, then use the existing verification entry point once the implementation is ready:

```sh
bunx vitest run src/core/tests/render-state.test.ts src/core/tests/text-rows.test.ts src/core/tests/bulk-snapshot.test.ts src/core/tests/displayed-frame.test.ts src/core/tests/zig-frame.test.ts
bun run typecheck
bun run build
bun run test:browser src/core/tests/
GHOSTTY_BROWSER_ENGINE=firefox bun run test:browser src/core/tests/
GHOSTTY_BROWSER_ENGINE=webkit bun run test:browser src/core/tests/
bun run test:renderer-fallbacks
bun run verify
cd ..
bun run build:workspaces
bun run plans:check
```

After a new Playwright WebKit download on Arch, run `scripts/playwright-webkit-arch.sh` from the repository root before Firefox or WebKit checks. Use the execution host's documented scheduler for heavy jobs.

The bounded paired renderer command uses existing benchmark options. Set `BENCH_BASELINE_ROOT` to the baseline package checkout and `BENCH_OUTPUT` to the evidence file:

```sh
BENCH_BASELINE_ROOT="$baseline_package" BENCH_OUTPUT="$evidence_file" BENCH_BACKENDS=webgpu,webgl2 BENCH_SCENARIOS=burst-output,sustained-scroll BENCH_REPETITIONS=3 BENCH_STEPS=120 BENCH_WARMUP_STEPS=20 bun run bench:renderer
```

Run that benchmark on headed Chromium with a hardware adapter. Headless SwiftShader results establish correctness only. Keep the existing Wasm artifacts and upstream pin unchanged unless an independently reproduced constraint requires a rebuild through `bun run build:wasm`.
