# Plan 346: Keep tree-sitter-x heap views attached when Wasm memory grows

## Status and ownership

- Status: Approved, final consumer adoption in progress. Runtime and Markdown source changes are merged; installed consumer checks, final measurements, and consumer delivery remain pending.
- Kind: Cross-repo runtime change and Singapore consumer validation.
- Owner: tree-sitter-x runtime lane, with the Singapore owner reviewing the dependency update.
- Priority: Next runtime maintenance pass. Effort: medium.
- Dependencies: Exact-runtime support and encoding checks below. Coordinate with [Plan 339](339-singapore-full-parse-speed.md) before changing its parser baseline.
- Inspected baseline: tree-sitter-x `origin/master` at `b89f78edd799579e1d1f8be1cb4a402cc0addc4d`; generated `web-tree-sitter` branch at `121cf0d206a57a98e704dcee0c53e6804c619633`, package 0.28.2. Recheck both before execution.
- Planning home: Fregat `plans/`. Implementation belongs in the separate `ShaulLavo/tree-sitter-x` repository. Change Singapore consumers in Fregat, never its read-only mirror.

## Outcome

Keep one length-tracking set of JavaScript heap views attached to tree-sitter-x's Wasm memory throughout runtime growth. Remove buffer-identity checks from scalar heap access. Parsing, queries, callbacks, and same-memory extensions must retain their current results.

A caller that keeps the `Uint8Array` returned by `heap()` sees the enlarged heap after allocation. Tree-sitter Markdown continues to use that same runtime allocation space. This change promises simpler memory access and stable views. Any speed claim requires the comparison below.

## Inspected baseline

- [`wasi-module.ts` at the inspected revision](https://github.com/ShaulLavo/tree-sitter-x/blob/b89f78edd799579e1d1f8be1cb4a402cc0addc4d/lib/binding_web/src/wasi-module.ts) owns the Wasm instance, five cached views, `refresh()`, and `bytes()`. `getValue()`, `setValue()`, and `HEAPU8` check `memory.buffer` before access.
- `createModule()` instantiates the runtime and calls `_initialize()`. `link()` imports the same `exports.memory` into grammars and C extensions. Allocations and side-module constructors can grow memory.
- `UTF8ToString()` passes a heap subarray to `TextDecoder.decode()`. `stringToUTF8()` passes one to `TextEncoder.encodeInto()`. These exact operations need a runtime matrix check.
- `src/text_buffer.ts` rebuilds bounded `Uint16Array` views around its current C allocation. Its `reserve()` can move that allocation through `_realloc()`. Stable backing memory does not make the old address valid.
- `src/extension.ts` exports `heap()` and `loadExtension()`. Here, extensions share one ordinary Wasm memory. This is distinct from `SharedArrayBuffer` or Wasm threads.
- [Fregat's memory test](../editor/packages/tree-sitter/test/wasm-memory.test.ts) deliberately forces growth. It asserted replacement of the buffer and detachment of the old view. Adoption replaces those expectations with stable length-tracking views.
- Fregat pins the generated runtime commit in its root manifest, overrides, Editor manifests, release fixture, and `bun.lock`. [`update-tree-sitter-x.ts`](../editor/scripts/update-tree-sitter-x.ts) updates these but also advances tree-sitter-md to remote HEAD.
- The consumed Markdown revision is `e2ae3f735f614b3b618b5de71fc41644a180b9e7`, package 0.1.3. Its peer range is `web-tree-sitter ^0.28.1`. Inspected Markdown `origin/main` is `aca967752732f8eefcbb6ccba94d70f3ec96e65e`, package 0.1.4. Neither revision owns a separate parser heap.

## Scope and design

Adopt `WebAssembly.Memory.prototype.toResizableBuffer()` for the ordinary runtime memory. Ordinary resizable `ArrayBuffer` support, Baseline 2024, does not establish support for this newer Wasm API. Do not resize a Wasm-owned buffer with `ArrayBuffer.resize()` or replace Wasm memory with an unrelated buffer.

Require capable runtimes. The browser floors to verify are Chromium 144, Firefox 145, and Safari 26.2. Target Node 26 and Bun 1.2.22 or later, then prove the exact versions used by CI and consumers. Record versions and probe results. Do not infer API support from ordinary RAB support or add a legacy fixed-buffer branch. Update runtime documentation, package declarations, and CI where their current floors conflict. Runtime publication and consumer parser checks select Node 26.

Create the resizable buffer once after assigning the instance exports, before `_initialize()` or any callback can access the heap. Construct `DataView`, `Int8Array`, `Uint8Array`, `Int16Array`, and `Int32Array` without explicit lengths so they track growth. Retain each view's identity. Remove `refresh()` and its hot-path calls once every access path uses these views.

Preserve unsigned Wasm32 pointer conversion, little-endian reads, string bounds, zero termination, and public value semantics. Keep bounded pointer views when their length describes one C allocation. Rebuild such views after `_realloc()` changes the pointer. Keep owned copies for results that outlive an allocation, a parser call, or a worker transfer. Resizable buffers do not extend C object lifetimes.

Audit the ordinary runtime and the separate Rust shared-memory host independently. The Rust web tests use shared Wasm memory. Determine whether that host reaches this JavaScript adapter before changing it. If a reachable path uses shared memory, verify `toResizableBuffer()` produces a growable shared buffer and test its growth and encoding operations. Do not add thread support or alter host memory ownership merely to share this implementation.

## Steps

1. [x] Refresh source, consumer pins, and instructions in exclusive worktrees. Record the old artifact, source SHA, toolchain, and grammar hashes. List processes, fixtures, caches, downloads, and scratch directories that verification will create. Install teardown before setup and preserve pre-existing resources.
2. [x] Add a rerunnable capability probe and use the exact support matrix above. Exercise `grow(0)`, positive growth, stable buffer and view identities, automatic view lengths, and old/new-address reads. Probe `TextDecoder.decode(heap.subarray(...))` and `TextEncoder.encodeInto(text, heap.subarray(...))` on resizable backing storage. Repeat for growable shared storage only where that host is supported. Current Node and Bun accept the encoding calls; all three tested browser engines reject raw resizable-backed inputs. Fixed encoding boundaries pass the target-family checks. Exact versions and historical minimum limits are recorded below.
3. [x] Establish the encoding implementation before deleting refresh logic. The current Encoding API uses Web IDL buffer inputs without `AllowResizable`, so Node and Bun acceptance does not establish browser acceptance. Check both the specifications and actual targets. If a supported runtime rejects a resizable-backed input, choose an explicit encoding boundary accepted by every target, such as a fixed owned copy for decode. Measure its cost. Do not silently retain the old heap design or use exceptions as feature detection on every call.
4. [x] Convert the runtime to one resizable buffer and stable length-tracking views. Exercise initialization callbacks and same-memory grammar loading before removing the getter's refresh machinery. Keep the public `heap()` contract precise about live memory and allocation lifetime.
5. [x] Add forced-growth tests to `test/wasi-module.test.ts` and the relevant extension, text-buffer, parser, and query suites. Use a small Wasm fixture or a private test fixture for deterministic growth through Wasm code, without adding a public growth API. Cover the correctness cases below before producing a package.
6. [x] Compare the old and changed artifacts with a bounded benchmark. Use the same source, toolchain, grammar, document, queries, and engine for each pair. Record ordinary steady-state work separately from growth-heavy work. Report regression and noise before making a speed claim.
7. [x] Merge the reviewed tree-sitter-x change with a patch version increment under that repository's release workflow. Wait for CI and `.github/workflows/package.yml` to produce `web-tree-sitter` from the merged source. Verify the generated artifact's source correspondence and test ESM, CJS, debug builds, declarations, and Wasm together. Never hand-edit the generated package branch.
8. [ ] Pin the verified generated commit across Fregat's consuming manifests, overrides, release fixture, and lockfile. Use `web-tree-sitter` 0.28.4 at `aab7db1518c19f61c1b13ec3f832b881cf5f1385` and Markdown 0.1.6 at merge `347a798ac598fbb4523ee83287a99df6ada42487` for unsigned pointers and resizable-memory semantic decoding. Validate its required `web-tree-sitter` peer range against the generated package version. Use the existing updater only when its Markdown update is intentional and reviewed. Update the invalidated memory test and run the consumer checks below against installed artifacts.
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
	bun run --cwd editor/packages/markdown test
	bun run --cwd editor/packages/tree-sitter test:memory:browser
```

The tree-sitter `test` script runs its non-browser tests and then its browser script. Extend the real shared-heap test to assert that the old `heap()` view remains attached and increases in length. Verify `tree-sitter-md` `memoryBytes()`, highlighting, Unicode Markdown edits, extension calls, disposal, and worker results after actual growth. Run the browser growth scenario in Chromium, Firefox, and WebKit with explicit provider instances. Record actual Safari versions separately from Playwright WebKit. Follow the host's WebKit prerequisite instructions after browser downloads.

Accept only when the generated package and Fregat's installed pin pass growth correctness, encoding checks, and consumer behavior on the declared targets. Keep the performance report even when the result is neutral. No speedup is a prerequisite for adopting stable heap views, but an unexplained performance regression blocks delivery.

## Risks and decisions

- Browser Encoding API calls require fixed owned decode input and fixed encode scratch. The Rust shared-memory host bypasses this JavaScript adapter.
- Stable buffer identity changes the public behavior of retained `heap()` views. Document the new live-view contract and update tests that intentionally asserted detachment.
- Markdown declares a required runtime peer. Verify the installed extension and host resolve one runtime module after every coordinated pin update.
- Do not broaden this work into Shiki, Oniguruma, Bun Wasm, Brush, or a new Markdown memory implementation. Markdown belongs here as a downstream consumer proof.

## Execution evidence, 2026-10-16

The bounded evaluation authorized implementation with conditions. Its final decision is `/work/reports/tree-sitter-x/plan-346-eval/decision.json`; the completed browser and store-attribution followups supersede earlier incomplete evaluation notes. No application speedup follows from that evaluation alone.

The merged runtime source is `1718aff0c5e115d4785d17b3b1fdf83264038c0d`. The immutable generated package is `aab7db1518c19f61c1b13ec3f832b881cf5f1385`, version 0.28.4. Source PRs 27 and 28 passed independent review, exact-head CI, and post-merge CI. Publisher run `38878461550` passed. Markdown PR 15 merged as `347a798ac598fbb4523ee83287a99df6ada42487`, version 0.1.6, after exact-head CI and review; its writer remains unchanged.

Implementation evidence lives under `/work/reports/tree-sitter-x/plan-346-impl/`:

- `runtime/source.json` identifies the generated package and checksums. `generated/final-mac-gate.json` passes all four release/debug ESM/CJS runtime, source-map, 4 GiB maximum, growth, query, and strict mixed-module declaration checks. Release JavaScript and Wasm bytes equal the tested candidate. Final debug Wasm starts with hash `6de92332` and differs from the candidate; final validation refreezes this payload. Version 0.28.3 is superseded because its declaration packaging failed the strict gate.
- `validation/runtime-floors.txt` records MDN floors of Chromium 144, Firefox 145, Safari 26.2, Node 26.0.0, and Bun 1.2.22. Historical minimum binaries were not executed. Current Node 26.7.0, Bun 1.4.2, Chromium 153, Firefox 155, and Playwright WebKit 26.6 capability checks pass conversion, zero/positive growth, stable identities, content, and compilation. All three browser engines reject raw resizable-backed Encoding API input; fixed copies pass.
- Actual Safari 26.4 release-byte correctness, same-memory extension, growth, and Unicode checks pass. `validation/safari-artifact-correctness.json`, `safari-production-parity.json`, and `safari-actual-host-cleanup.json` record the proof and actual-host cleanup. This is distinct from Playwright WebKit. Qualified Mac timing is nonblocking and pending load guards; owner processes remain untouched. Physical mobile coverage is pending, and the optional emulator attempt establishes no pass.
- The explicit Wasm32 maximum stays 4 GiB. The Rust shared-memory host bypasses this JavaScript adapter. Eight small memories reserved 64 GiB of virtual address space on the evaluated Linux Node host; practical mobile and multiple-runtime capacity remains pending-target evidence.
- Final generated-package Node/Bun correctness passes all four release/debug ESM/CJS formats. The final Chromium/Firefox/WebKit artifact gate passes all 42 production-comparison rows, including release and final-debug growth checks. Both wall-time passes contain 308 rows and all 126 measured baseline/final pairs with equal fingerprints; see the final comparison below. Browser/server/profile cleanup is verified on the execution host.

Consumer assertions cover stable retained heap and buffer identity, length tracking, bounded views, new-boundary data, shared memory accounting, Unicode Markdown edits, owned output records, semantic decoding, and disposal. The worker scenario measures actual heap growth and compares nonempty retained and freshly parsed results. `test:memory:browser` uses explicit Chromium, Firefox, and WebKit providers. Installed-artifact checks and built-worker correspondence are in progress; their evidence belongs in `consumer/`.

The existing bounded Markdown UTF-16 writer was compared with fresh and reusable fixed staging at 0, 1, 32, 4,096, 123,676, and 5,242,880 code units. Every code unit matched after growth in Node, Bun, Chromium, Firefox, and WebKit. Two warmups preceded nine alternating measured rounds. Fresh staging slowed the large Firefox case; reusable staging helps some larger cases but needs a retained-buffer policy. The writer stays direct. `consumer/utf16-summary.txt` and the three `utf16-*.json` files retain these nonquiet diagnostics, with no application latency claim.

The root and standalone Editor workspace require Node 26. Parser, Markdown, and language packages and release fixtures declare Node 26.0.0 and Bun 1.2.22. Relevant parser CI selects Node 26; isolated textbuffer, storage stress, macOS native bundle, and standalone Ghostty/Hotkeys-only runtime choices remain unchanged. Vitest's Node shebang and explicit grammar-generation commands select Node from `PATH`; a parent `bun run` does not force the child onto Bun. Core's public runtime floor remains its own contract. The separate existing Node 24 closed-document retention failure belongs to the assigned retention lane; no assertions, retries, timeouts, or skips are changed here to hide it.

The focused floor/fixture gate passed 107 tests across workspace-root, release-version, workflow-dispatch, workspace-verification, and setup-action tests. Copied-script fixtures now supply their actual `typescript-api` dependency through a portable directory link. Release engine metadata and the standalone Node selection are checked. See `consumer/resume-focused.log` and `resume-heavy-receipt.json`.

Current-main integration follows a normal hook-checked staged-work checkpoint. It must include `9039030b` for the Vite catalog and TS-LSP cache repair and `9aca83e7` for standalone Chromium preinstallation before final correctness and the PR. No hook bypass, stash, or source discard is permitted.

The server workspace dependency audit finds no tree-sitter runtime import or dependency. Its only Singapore runtime dependency is LSP, which adds `vscode-languageserver-protocol`. Delivery still refreshes the full owner instance under the standing deployment workflow: install and restart the server release, stop the retained terminal host together with the server restart, then verify matching web/server/terminal-host commits, fresh terminal health, and the live check. The coordinator owns independent review, required CI, merge, and deployment.

### Final generated-package comparison

The final package is compared with 0.28.2 using the same frozen grammar, input, query and piece-table artifacts. Each of 14 size/API cases has two warmup pairs and nine alternating AB/BA measured pairs. Equality checks are outside timing. The medium document has 247,351 UTF-16 code units; the large document has 10,485,760. Both Node and Chromium have all 126 measured pairs and 308 total rows, with equal full-tree and result fingerprints and final-package identities.

These are **nonquiet Linux diagnostics**, with headless Chromium. They establish no qualified latency or application speedup claim. Each cell reports baseline → final median milliseconds and the median paired percentage change. Negative means less time. The complete per-pair values, percentage ranges, setup/edit phases and growth events remain in `validation/final-summary.json`, `final-results.txt`, `benchmark-node.json` and `benchmark-browser.json` under the evidence root above.

| Corpus | Callback operation       | Node ms; paired change       | Chromium ms; paired change   |
| ------ | ------------------------ | ---------------------------- | ---------------------------- |
| medium | full parse               | 21.371 → 21.275; -0.45%      | 21.700 → 21.700; +0.00%      |
| medium | full captureRanges       | 48.456 → 44.727; -8.46%      | 34.800 → 32.000; -9.20%      |
| medium | ranged captures          | 17.386 → 16.084; -7.85%      | 13.400 → 11.600; -10.45%     |
| medium | fold matches             | 6.537 → 6.457; -0.62%        | 6.400 → 6.400; +0.00%        |
| medium | injection matches        | 8.471 → 8.247; -1.99%        | 7.600 → 7.600; -1.30%        |
| medium | full captures, secondary | 60.834 → 53.704; -11.61%     | 43.800 → 39.000; -11.58%     |
| 10MiB  | full parse               | 885.704 → 905.010; +2.66%    | 923.600 → 924.000; +0.38%    |
| 10MiB  | full captureRanges       | 1839.089 → 1657.575; -10.23% | 1572.100 → 1444.100; -7.91%  |
| 10MiB  | ranged captures          | 16.817 → 15.306; -8.87%      | 13.100 → 11.800; -9.92%      |
| 10MiB  | fold matches             | 267.291 → 271.232; +0.98%    | 272.700 → 269.300; -1.22%    |
| 10MiB  | injection matches        | 313.362 → 312.073; -0.67%    | 314.300 → 306.600; -2.11%    |
| 10MiB  | full captures, secondary | 2471.335 → 2179.363; -9.94%  | 1872.200 → 1596.600; -11.98% |

Node's 10 MiB callback full parse is consistently slower across query variants, despite the evaluation's predicted staging gains: captureRanges +2.66% (paired range +0.70% to +5.70%), ranged captures +2.16% (+0.48% to +3.50%), and folds +1.99% (+0.10% to +6.62%). The corresponding Chromium captureRanges parse is neutral at +0.38% (−5.83% to +2.50%). Medium callback incremental-edit medians also rise about 1–5% in Node (0.59% to 4.77% across the five variants). These are disclosed diagnostic regressions, not gains; nonquiet Linux execution prevents a qualified latency verdict. The separate direct TextBuffer and string parse paths stay near their controls.

Staging is present in the exact measured final artifact: release ESM hash `af2a783e1bad12ae5503535d0623ec50def2657457cff6b05234073ed791c97b` matches the verified generated package. `UTF16_CHUNK_SIZE = 4096` creates one reusable 8 KiB `Uint16Array`; the parse callback calls `stringToUTF16()`, which fills it and bulk-copies with `heap16.set(utf16Scratch.subarray(0, count), ...)`. Likely cause: the added scratch-to-resizable-heap copy and bounds work at 4,096-unit callback granularity outweigh removed view-refresh costs on this V8 path; avoiding raw resizable indexed writes does not guarantee a gain over the old fixed-memory baseline. This is a mechanism-based hypothesis, not an isolated attribution measurement. No new measurement round is required, and no parser-speedup claim is made.

TextBuffer construction is a real, separate setup tradeoff of resizable-backed indexed UTF-16 writes, previously isolated in the approved evaluation's store-attribution experiment. No TextBuffer writer was changed. Its medium Node setup is 1.192 → 1.953 ms (+61.94% paired), and 10 MiB setup is 18.513 → 23.514 ms (+25.84%). Chromium setup is 1.200 → 1.500 ms (+36.36%) and 13.400 → 20.200 ms (+51.88%). These costs are outside parse/query spans and must not be hidden by the faster capture results. Blanket fixed staging remains excluded because its earlier cross-engine experiment was not uniformly beneficial. The stable-view contract, not a speedup, motivates adoption.

The separate current-JavaScript-thread retired-instruction pass is **unqualified**: contention leaves some hardware-counter intervals unscheduled (`timeRunningNS=0`) and others multiplexed. Raw counts and enabled/running times are retained, including invalid rows; no instruction improvement or regression is inferred, and no rerun delays delivery. The counter covers synchronous user-space JS/Wasm/native/JIT/GC on this thread, excludes kernel/hypervisor and background JIT/GC threads, and includes the measured constant NAPI start/end overhead without subtraction. It supplies no Chromium instruction attribution. The summary rejects invalid/multiplexed counter comparisons instead of treating execution coverage as qualified measurement.

Qualified Mac timing remains pending and nonblocking. The latest guard (`validation/mac-qualification-during-final-jobs.json`) reports AC power, load 3.09 and aggregate external activity about 248%; the CPU guard rejects starting timing. Owner processes and settings remain untouched. Actual Safari correctness already passes separately.

### Runtime floors and pending targets

Historical minimum binaries were not executed. Declared floors come from API support data; current-family execution is the evidence, not proof that every historical binary was tested.

| Runtime family                   | Declared minimum | Executed evidence                                                                                                         |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Node                             | 26.0.0           | Linux 26.7.0; final release/debug ESM/CJS correctness                                                                     |
| Bun                              | 1.2.22           | Linux 1.4.2; final release/debug ESM/CJS correctness                                                                      |
| Chromium / Edge                  | 144              | Chromium 153; final artifact correctness and diagnostic comparison; Edge not separately executed                          |
| Firefox                          | 145              | Firefox 155; final artifact correctness                                                                                   |
| Safari                           | 26.2             | Actual Safari 26.4 on macOS 26.4, release-byte correctness; Playwright WebKit 26.6 final artifact correctness is separate |
| Chrome Android / Android WebView | 144              | Physical mobile pending; isolated emulator attempts establish no pass                                                     |
| Firefox Android                  | 145              | Physical mobile pending                                                                                                   |
| iOS Safari                       | 26.2             | Physical iOS pending; desktop Safari does not establish a device pass                                                     |

Practical multiple-runtime/mobile virtual-address capacity and qualified Mac timing remain pending. The eight-small-memory Linux experiment reserved 64 GiB of virtual address space; that is an observation, not a mobile-capacity guarantee. These disclosed pending targets are not silently counted as passes.
