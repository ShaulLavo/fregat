# Plan 346: Keep tree-sitter-x heap views attached when Wasm memory grows

## Status and ownership

- Status: Approved. Owner request, 2026-10-15. Execution has not started.
- Kind: Cross-repo runtime change and Singapore consumer validation.
- Owner: tree-sitter-x runtime lane, with the Singapore owner reviewing the dependency update.
- Priority: Next runtime maintenance pass. Effort: medium.
- Dependencies: Exact-runtime support and encoding checks below. Coordinate with [Plan 339](339-singapore-full-parse-speed.md) before changing its parser baseline.
- Inspected baseline: tree-sitter-x `origin/master` at `b89f78edd799579e1d1f8be1cb4a402cc0addc4d`; generated `web-tree-sitter` branch at `121cf0d206a57a98e704dcee0c53e6804c619633`, package 0.28.2. Recheck both before execution.
- Planning home: Fregat `plans/`. Implementation belongs in the separate `ShaulLavo/tree-sitter-x` repository. Change Singapore consumers in Fregat, never its read-only mirror.

## Outcome

Keep one length-tracking set of JavaScript heap views attached to tree-sitter-x's Wasm memory throughout runtime growth. Remove buffer-identity checks from scalar heap access. Parsing, queries, callbacks, and same-memory extensions must retain their current results.

A caller that keeps the `Uint8Array` returned by `heap()` sees the enlarged heap after allocation. Tree-sitter Markdown continues to use that same runtime allocation space. This change promises simpler memory access and stable views. Any speed claim requires the comparison below.

## Current code

- [`wasi-module.ts` at the inspected revision](https://github.com/ShaulLavo/tree-sitter-x/blob/b89f78edd799579e1d1f8be1cb4a402cc0addc4d/lib/binding_web/src/wasi-module.ts) owns the Wasm instance, five cached views, `refresh()`, and `bytes()`. `getValue()`, `setValue()`, and `HEAPU8` check `memory.buffer` before access.
- `createModule()` instantiates the runtime and calls `_initialize()`. `link()` imports the same `exports.memory` into grammars and C extensions. Allocations and side-module constructors can grow memory.
- `UTF8ToString()` passes a heap subarray to `TextDecoder.decode()`. `stringToUTF8()` passes one to `TextEncoder.encodeInto()`. These exact operations need a runtime matrix check.
- `src/text_buffer.ts` rebuilds bounded `Uint16Array` views around its current C allocation. Its `reserve()` can move that allocation through `_realloc()`. Stable backing memory does not make the old address valid.
- `src/extension.ts` exports `heap()` and `loadExtension()`. Here, extensions share one ordinary Wasm memory. This is distinct from `SharedArrayBuffer` or Wasm threads.
- [Fregat's memory test](../editor/packages/tree-sitter/test/wasm-memory.test.ts) deliberately forces growth. It currently asserts replacement of the buffer and detachment of the old view. Replace those expectations as part of adoption.
- Fregat pins the generated runtime commit in its root manifest, overrides, Editor manifests, release fixture, and `bun.lock`. [`update-tree-sitter-x.ts`](../editor/scripts/update-tree-sitter-x.ts) updates these but also advances tree-sitter-md to remote HEAD.
- The consumed Markdown revision is `e2ae3f735f614b3b618b5de71fc41644a180b9e7`, package 0.1.3. Its peer range is `web-tree-sitter ^0.28.1`. Inspected Markdown `origin/main` is `aca967752732f8eefcbb6ccba94d70f3ec96e65e`, package 0.1.4. Neither revision owns a separate parser heap.

## Scope and design

Adopt `WebAssembly.Memory.prototype.toResizableBuffer()` for the ordinary runtime memory. Ordinary resizable `ArrayBuffer` support, Baseline 2024, does not establish support for this newer Wasm API. Do not resize a Wasm-owned buffer with `ArrayBuffer.resize()` or replace Wasm memory with an unrelated buffer.

Require capable runtimes. The browser floors to verify are Chromium 144, Firefox 145, and Safari 26.2. Target Node 26 and Bun 1.2.22 or later, then prove the exact versions used by CI and consumers. Record versions and probe results. Do not infer API support from ordinary RAB support or add a legacy fixed-buffer branch. Update runtime documentation, package declarations, and CI where their current floors conflict. Package generation currently selects Node 24 in `.github/workflows/package.yml`.

Create the resizable buffer once after assigning the instance exports, before `_initialize()` or any callback can access the heap. Construct `DataView`, `Int8Array`, `Uint8Array`, `Int16Array`, and `Int32Array` without explicit lengths so they track growth. Retain each view's identity. Remove `refresh()` and its hot-path calls once every access path uses these views.

Preserve unsigned Wasm32 pointer conversion, little-endian reads, string bounds, zero termination, and public value semantics. Keep bounded pointer views when their length describes one C allocation. Rebuild such views after `_realloc()` changes the pointer. Keep owned copies for results that outlive an allocation, a parser call, or a worker transfer. Resizable buffers do not extend C object lifetimes.

Audit the ordinary runtime and the separate Rust shared-memory host independently. The Rust web tests use shared Wasm memory. Determine whether that host reaches this JavaScript adapter before changing it. If a reachable path uses shared memory, verify `toResizableBuffer()` produces a growable shared buffer and test its growth and encoding operations. Do not add thread support or alter host memory ownership merely to share this implementation.

## Steps

1. [ ] Refresh source, consumer pins, and instructions in exclusive worktrees. Record the old artifact, source SHA, toolchain, and grammar hashes. List processes, fixtures, caches, downloads, and scratch directories that verification will create. Install teardown before setup and preserve pre-existing resources.
2. [ ] Add a rerunnable capability probe and use the exact support matrix above. Exercise `grow(0)`, positive growth, stable buffer and view identities, automatic view lengths, and old/new-address reads. Probe `TextDecoder.decode(heap.subarray(...))` and `TextEncoder.encodeInto(text, heap.subarray(...))` on resizable backing storage. Repeat for growable shared storage only where that host is supported. The inventory probes passed these encoding calls on Node 26 and Bun 1.4.2. Browser results remain unverified.
3. [ ] Establish the encoding implementation before deleting refresh logic. The current Encoding API uses Web IDL buffer inputs without `AllowResizable`, so Node and Bun acceptance does not establish browser acceptance. Check both the specifications and actual targets. If a supported runtime rejects a resizable-backed input, choose an explicit encoding boundary accepted by every target, such as a fixed owned copy for decode. Measure its cost. Do not silently retain the old heap design or use exceptions as feature detection on every call.
4. [ ] Convert the runtime to one resizable buffer and stable length-tracking views. Exercise initialization callbacks and same-memory grammar loading before removing the getter's refresh machinery. Keep the public `heap()` contract precise about live memory and allocation lifetime.
5. [ ] Add forced-growth tests to `test/wasi-module.test.ts` and the relevant extension, text-buffer, parser, and query suites. Use a small Wasm fixture or a private test fixture for deterministic growth through Wasm code, without adding a public growth API. Cover the correctness cases below before producing a package.
6. [ ] Compare the old and changed artifacts with a bounded benchmark. Use the same source, toolchain, grammar, document, queries, and engine for each pair. Record ordinary steady-state work separately from growth-heavy work. Report regression and noise before making a speed claim.
7. [ ] Merge the reviewed tree-sitter-x change with a patch version increment under that repository's release workflow. Wait for CI and `.github/workflows/package.yml` to produce `web-tree-sitter` from the merged source. Verify the generated artifact's source correspondence and test ESM, CJS, debug builds, declarations, and Wasm together. Never hand-edit the generated package branch.
8. [ ] Pin the verified generated commit across Fregat's consuming manifests, overrides, release fixture, and lockfile. Keep Markdown at its existing revision unless a proven downstream failure requires a coordinated change. Use the existing updater only when its Markdown update is intentional and reviewed. Update the invalidated memory test and run the consumer checks below against installed artifacts.
9. [ ] Merge the reviewed consumer PR after required checks. Verify both merge commits and post-merge checks. Retain the small capability and performance evidence, remove task-created fixtures and processes, and check cleanup on the execution host.

## Verification

Use these existing commands in a tree-sitter-x worktree after prerequisites are available. Keep downloads and build caches on the execution host's configured data drive.

```bash
	npm --prefix lib/binding_web ci
	cargo xtask generate-fixtures --wasm
	npm --prefix lib/binding_web run build
	npm --prefix lib/binding_web test -- test/wasi-module.test.ts test/extension.test.ts test/text_buffer.test.ts test/parser.test.ts test/query.test.ts
	npm --prefix lib/binding_web run lint
	cargo xtask test-wasm
	cargo xtask test-rust-wasm-web
```

`test/extension.test.ts` currently skips when its WASI SDK clang is absent and creates temporary extension builds. Configure its SDK prerequisite, require the extension assertions to execute, and add teardown for its generated directories. A skipped extension test cannot satisfy this plan. Confirm command details again at execution time.

The new tests must catch these failures:

- Views detach or retain their old length after host `grow(0)`, positive host growth, growth inside Wasm, and allocator-driven growth. Retain the original view and verify data on both sides of the old heap boundary.
- `getValue()` and `setValue()` lose signed integer, unsigned pointer, floating-point, or little-endian semantics. Preserve `test/capture-address.test.ts`, the existing high-address Wasm32 regression coverage. Schedule its multi-gigabyte case under the execution host's heavy-job rules, separate from the small growth tests.
- Parse, log, or progress callbacks read stale memory. Force growth between callback-visible operations and verify parsing, cancellation, and log strings.
- Grammar or extension allocation, relocation, or constructors invalidate the views. Load an extension into the existing memory after growth and verify access to an existing tree and new allocations.
- Unicode handling changes across growth. Cover ASCII, multibyte UTF-8, surrogate pairs, embedded NUL with explicit bounds, and UTF-16 callback input. Retain outputs across later allocation and verify owned results stay unchanged.
- `TextBuffer` edits retain a moved `_realloc()` address. Force both capacity growth and heap growth, then compare incremental parsing, queries, node text, and deletion with a fresh parse.

The existing benchmark is `node script/bench.mjs <grammar.wasm> <document> [highlights.scm] --rounds 5`, from `lib/binding_web`. It compares this runtime with upstream Emscripten. Extend its artifact selection or add a small companion so the actual control is the old tree-sitter-x artifact. Use five alternating pairs with a small corpus and a 10 MiB document. Measure full parse, query unmarshalling, edits, growth count, heap size, and allocation/view creation counts. Verify equal results. Compare at least Chromium and Node, then investigate any regression beyond observed run variation.

In the Fregat worktree, run these existing consumer entry points after installing the new pin:

```bash
	bun install
	bun run build:workspaces
	bun run --cwd editor/packages/tree-sitter test:runtime
	bun run --cwd editor/packages/tree-sitter test
	bun run --cwd editor/packages/tree-sitter-languages test
```

The tree-sitter `test` script runs its non-browser tests and then its browser script. Extend the real shared-heap test to assert that the old `heap()` view remains attached and increases in length. Verify `tree-sitter-md` `memoryBytes()`, highlighting, Unicode Markdown edits, extension calls, disposal, and worker results after actual growth. Run the browser growth scenario in Chromium, Firefox, and WebKit with explicit provider instances. Record any real Safari 26.2 verification separately from Playwright WebKit. Follow the host's WebKit prerequisite instructions after browser downloads.

Accept only when the generated package and Fregat's installed pin pass growth correctness, encoding checks, and consumer behavior on the declared targets. Keep the performance report even when the result is neutral. No speedup is a prerequisite for adopting stable heap views, but an unexplained performance regression blocks delivery.

## Risks and decisions

- Browser encoding acceptance and the exact shared-host route remain open checks. Resolve them before removing the old view refresh implementation.
- Stable buffer identity changes the public behavior of retained `heap()` views. Document the new live-view contract and update tests that intentionally asserted detachment.
- The Markdown package's own development pin is older than Fregat's runtime pin. Prove the installed single-runtime consumer rather than adopting that development pin or upgrading Markdown incidentally.
- Do not broaden this work into Shiki, Oniguruma, Bun Wasm, Brush, or a new Markdown memory implementation. Markdown belongs here as a downstream consumer proof.
