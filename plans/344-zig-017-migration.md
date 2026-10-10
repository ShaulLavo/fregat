# Plan 344: Move our Zig code to Zig 0.17

## Status and ownership

- Status: Approved. Scheduled later, behind the upstream gate below.
- Owner request: 2026-10-09. Plan the migration and the 0.17 features worth adopting; keep working on 0.16.0 until Ghostty upgrades.
- Scope: Fregat's `ghostty-webgpu/` (wasm, native helpers, proofs, CI), Fregat's ZLS integration, and the tree-sitter-x repository. No other repository of ours contains Zig (mesh, tree-sitter-md, fast-ulid, place and game of life were checked).
- Research: two read-only Sol passes on 2026-10-09 against main `b02050a85`. Every compiler result below comes from real builds with the official 0.17.0 archive in scratch copies.

## Gate

Start when all of these hold:

1. Ghostty's 0.17 migration ([ghostty-org/ghostty#14519](https://github.com/ghostty-org/ghostty/pull/14519), branch `zig-0.17`, tracking issue [#14518](https://github.com/ghostty-org/ghostty/issues/14518)) is merged to Ghostty main with required CI green. A maintainer requires benchmark requalification before that merge.
2. ZLS has a release that works with 0.17. The release notes state the build-system split breaks ZLS; [zigtools/zls#3274](https://github.com/zigtools/zls/issues/3274) is open. If ZLS lags, Phases 1–4 may ship and Phase 5 waits.

On 2026-10-09 Ghostty main (`b115e4567`) still requires 0.16. Its `requireZig` guard accepts only the same major and minor version, so no Ghostty revision builds with both 0.16 and 0.17. The migration branch fails `test-macos` and `build-macos-freetype`; zig-objc, libxev and zig-wayland migration PRs are open. Estimate: mid-October to late November 2026, low confidence. Ghostty took 45 days to adopt 0.15 and 100 days for 0.16.

Until then we stay on exactly 0.16.x. Phase 0 tightens `scripts/build-wasm.ts` to reject other minor versions before invoking Ghostty's build.

## Outcome

Every Zig artifact we build or ship is produced by Zig 0.17.x from Ghostty revisions that support it. Provenance receipts, CI archive contracts and native recipes name 0.17. Shipped wasm passes the existing correctness suites. Mac, Linux and Pi benchmarks are re-measured, and no regression ships unexplained. Historical 0.16 evidence stays as recorded.

## What changes

### Three Ghostty pins move, not one

#### Pin target

We build only libghostty-vt from Ghostty's source, never the app, so we are already pinned to libghostty. On 2026-10-09 libghostty-vt has no releases of its own: the Ghostty repository's tags are app releases (latest `v1.3.1`, 2026-03-13), and its README and `include/ghostty/vt.h` say the C API is still changing. Pin to the first tagged libghostty-vt release that requires 0.17 if one exists when the gate opens. Otherwise pin to the first Ghostty main commit that requires 0.17 and passes Ghostty's required CI. Once tagged libghostty-vt releases exist, later pin moves use releases only. Record the chosen tag or commit and the reason in this plan.

| Purpose                                    | Current pin                                                                        | Where                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Shipped terminal wasm and positional proof | `7b11f3dca034d8d24369ad3856afe57946d7902a` (118 commits behind main on 2026-10-09) | `ghostty-webgpu/src/core/version.ts:2`                                                                |
| Native config resolver and its proof       | `c8554f28e0efe2f5595f32020371c34b25ec628f`                                         | `scripts/config-resolver-native/constants.ts:9`, `scripts/config-resolver-proof/proof-contract.ts:25` |
| Owned-VT native proof                      | `befcdfd2c3a1cb24d9ec886e93c95b2b5daa7028`                                         | `scripts/owned-vt-native/run.ts:16`                                                                   |

With 0.17.0, all three fail inside Ghostty or its dependencies (`b.build_root`, the version guard, `zig_lib_directory`, `Optimize.Debug`, `b.args`, `std.meta.fields`). Move each to a 0.17 revision. Paths below are relative to `ghostty-webgpu/` unless they name a repository.

### Our source

| File                                                                                                                                                        | Change                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/bridge.zig:61`                                                                                                                                     | `@cImport` was removed. Translate the C headers through the external `translate-c` package (`zig fetch --save git+https://codeberg.org/ziglang/translate-c`) and import the module. Add the package and translated output to the bridge's build-input and provenance closure. |
| `scripts/bridge.zig:217,233`                                                                                                                                | `[_]u32{0} ** 11` → `@splat(0)`.                                                                                                                                                                                                                                              |
| `scripts/snapshot.zig:1`, `scripts/unknown-osc.zig:2`, `scripts/positional-native/c-controls.zig:2`                                                         | Same `@cImport` replacement.                                                                                                                                                                                                                                                  |
| `scripts/config-resolver-native/build.zig:80–82`, `scripts/config-resolver-proof/build.zig:66–68`                                                           | `generated.file.step` no longer exists. Generated paths name their producer by index: `b.graph.generated_files.items[@backingInt(generated.index)]` compiled in isolation. Re-prove the resolver's producer-detachment and preverified-input graph.                           |
| `scripts/canvas-compose.zig:3`                                                                                                                              | `builtin.cpu` → `builtin.target.cpu` (removed in 0.18).                                                                                                                                                                                                                       |
| `scripts/config-resolver-{native,proof}/main.zig` (`builtin.os` at native 101,127 / proof 117,139; `std.fs.path` at native 112,115,116 / proof 131,134,135) | `builtin.target.os`; `std.Io.Dir.path`.                                                                                                                                                                                                                                       |
| tree-sitter-x `build.zig:133,140`                                                                                                                           | `b.build_root.handle.openDir` → `b.root.openDir`; path namespace move.                                                                                                                                                                                                        |
| tree-sitter-x `crates/cli/src/templates/build.zig:42,89`                                                                                                    | `.Debug` → `.debug` (`OptimizeMode` is now `Optimize`); `b.build_root.handle` → root path API.                                                                                                                                                                                |
| tree-sitter-x `crates/cli/src/templates/test.zig:15`                                                                                                        | `void{}` → `{}`.                                                                                                                                                                                                                                                              |

Audited and unaffected: `@bitCast` at `scripts/canvas-compose.zig:131,141` (vectors), `scripts/bridge.zig:299,301` and `scripts/glyph-index.zig:102` (scalars). The compositor's scalar and SIMD builds matched an independent JavaScript pixel reference in 16,384 comparisons under both compilers. No owned code uses extern-struct bitcasts, enum-destination bitcasts, `@hasDecl`, `errdefer |err|`, `i0`, `internal`/`link_once` linkage, `std.builtin`, `containsAtLeastScalar`, `allocPrint`, bit sets, ZON parsing or `StackFallbackAllocator`.

### Version contracts and receipts

Update archive names, URLs, byte counts, SHA-256 and extracted-version checks together. Regenerate receipts with the builders; never hand-edit version strings in generated JSON.

- CI: `.github/workflows/ghostty-config-resolver.yml:55–94,247–248,377–416,586`, `.github/workflows/ghostty-config-resolver-proof.yml:53–86,254–255`, and the mirrored copies in `ghostty-webgpu/.github/workflows/config-resolver{,-proof}.yml`. Requalify runner-image identities (`scripts/config-resolver-native/builder.ts:311`).
- Native resolver: `scripts/config-resolver-native/constants.ts:12–14,30–77`, `build-helper.ts:38–66,338,1581,1955,1966,1982`, `builder.ts:178`, `contract.ts:69,216,330,754`, `build-recipe.schema.json:31`, `provenance.schema.json:93`, regenerated `build-recipe.json`, `native-inputs.json`, `native/config-resolver/bootstrap.json`, plus `src/config-resolver/manifest.ts:111,423`, `src/config-resolver/tests/manifest.test.ts:84,97,100`, `scripts/release-candidate/tests/fixtures.ts:249`.
- Proof resolver: `scripts/config-resolver-proof/build-helper.ts:37–65,307,1524,1867,1878,1894`, `proof-contract.ts:28,64–116,231,281,1010,1021,1064`, `proof-recipe.schema.json`, regenerated `proof-recipe.json`, `proof-self-test.ts:129–156,1356,2132,2169`, `assemble-recipe.ts:64,230`, `verify-evidence.ts:175`. Move the rejected-version mutations to versions that are wrong for the new pin.
- Wasm: `scripts/build-wasm.ts` (version check, upstream and bridge invocations), `scripts/build-bridge.ts:62–90`, `scripts/build-canvas-compose.ts:11–45`, `scripts/wasm-provenance.ts`, `scripts/wasm-provenance.test.ts:23`, regenerated `ghostty-vt.provenance.json`, `ghostty-vt.wasm`, `bridge.wasm`, `canvas-compose.wasm`.
- Native experiments: `scripts/owned-vt-native/identity.ts:38`, `scripts/owned-vt-native/run.ts:37,116–129`, `scripts/positional-native/run.ts:47–52`.
- tree-sitter-x: `build.zig.zon:5`, `crates/cli/src/templates/build.zig.zon:4,8–10` (also the zig-tree-sitter binding pin), and `crates/xtask/src/upgrade_wasmtime.rs:52–63`, which parses `zig fetch` output that 0.17 moved into the build system.
- Active docs: `ghostty-webgpu/AGENTS.md:50`, `ghostty-webgpu/docs/api.md:200`, `docs/ghostty-webgpu-brief.md:36,240`, `docs/research/packages-as-products/ghostty-webgpu.md:40`, `plans/286-ghostty-extensions.md:163`. Keep the historical records (`docs/config-resolver-feasibility.*`, `docs/research/packages-as-products/performance-evidence.md:62`, sealed Mac benchmark assets) as they are.

0.17 archive identities (from the official download index):

| Platform      |      Bytes | SHA-256                                                            |
| ------------- | ---------: | ------------------------------------------------------------------ |
| aarch64-macos | 53,985,220 | `b607e9b9234790a008116ae5bdb71c6243b84b9fb42a53a9e70fde41c06c536a` |
| x86_64-macos  | 59,317,572 | `4f9a1c5269aa17ebda5e6d3c2b89d6cbf36f7d2b22a0306e9ab98f25f95529c6` |
| aarch64-linux | 52,877,280 | `9e8d11661d4ae3bd57702a3832781e23ad151dde5798e16a5ccd503f65234ff8` |
| x86_64-linux  | 57,332,648 | `1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026` |

Recheck them against the index when the work starts; a 0.17.1 may exist by then.

### ZLS

Fregat installs ZLS 0.16.0 for Zig files: `apps/server/src/lsp/installer-manifest.ts:113–153` (version and six platform downloads), `apps/server/src/lsp/installers.ts:398–406`, semantic-token evidence in `apps/web/src/features/editor/tests/semantic-token-conformance.test.ts:75`, `apps/web/src/lib/semantic-token-servers.ts:198`, `apps/web/test/factories/semantic-token-legends.ts:87,92`, and the setting docs (`packages/contracts/src/settings/documentation.ts:989`, `schema.json:1149`, `docs/settings-reference.md:244`). The installer accepts any installed ZLS when any Zig is present and never checks that their minor versions match. Add that check, then move to the first ZLS release that supports 0.17, re-measuring the token legend.

## Adopt during the migration

Ranked by value. Each was checked against our code; numbers come from scratch builds on the i7-14700K.

1. **Declared configuration inputs.** 0.17 caches `build.zig` configuration. tree-sitter-x enumerates `lib/src` while configuring (`build.zig:130–148`); add `b.dependOnDirectoryContents(b.path("lib/src"))` so adding, removing or renaming a C file invalidates the cache. Generated grammar builds check for an optional scanner and `queries/` (`crates/cli/src/templates/build.zig:32,51,88–91`, `test/fixtures/grammars/c/build.zig`); declare those too. Build with `--cache-poison=disallowed` in CI so new undeclared configuration reads fail. Use `findProgramLazy` where configuration only needs the path at build time, and `zig cache-cat` to explain misses.
2. **LLVM 22.1.8 code generation, measured per artifact.** On Ghostty's 0.17 branch its uucode (Unicode lookup) benchmarks ran 1.2–1.4× faster, but the PR author is unsure whether 0.17 or a uucode change caused it ([comment](https://github.com/ghostty-org/ghostty/pull/14519#issuecomment-5973842610)). Our compositor showed no SIMD change (alpha fill 214.4 → 213.6 µs, opaque fill 27.03 → 27.03 µs, move +0.3%, clear +1.8%), and sizes moved by one byte. Loop vectorization stays off until LLVM 23 (Zig 0.18). Measure the terminal and bridge with the benchmark protocol before claiming anything.
3. **SafeAllocator in native tests.** `std.testing.allocator` is now `SafeAllocator`: thread-safe, catches double frees, mismatched frees and some races, and reports every leak. `scripts/positional-native/paint-test.zig:6` gets it with no code change. Keep it out of shipped builds and benchmark comparisons.
4. **Incremental native builds on x86_64 Linux.** `zig build -fincremental --watch` now works with the new ELF linker. The native resolver and proof builds force LLVM (`scripts/config-resolver-{native,proof}/build.zig:28`); try the native positional tests first and measure edit-to-test time. Mac and Pi do not get this in 0.17.
5. **`@divCeil` for wasm page rounding** at `scripts/canvas-compose.zig:51`: `@divCeil(next - available, 65536)`. The guard above it already makes the numerator positive.

Not adopting now:

| Feature                                                                                             | Reason                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted wasm backend                                                                            | The compositor reads the linker-provided `extern var __heap_base` (`scripts/canvas-compose.zig:5`) to find where its heap starts. Under `-fno-llvm`, Zig's own wasm linker fails with `zig compilation unit: undefined data: __heap_base` and emits an empty file. It has no debug info yet either, and our shipped wasm is `ReleaseFast`, which uses LLVM anyway. Retry in 0.18. |
| `zig objdump`                                                                                       | Prints `TODO dump wasm file` for wasm. Keep `llvm-objdump`.                                                                                                                                                                                                                                                                                                                       |
| `BufferFirstAllocator`                                                                              | No stack-fallback allocator in our code; glyph scratch storage outlives the call.                                                                                                                                                                                                                                                                                                 |
| `@backingInt` beyond the generated-file index                                                       | No owned enum conversions.                                                                                                                                                                                                                                                                                                                                                        |
| Build Server Protocol                                                                               | Arrives with ZLS support; revisit for Fregat's Zig language features then.                                                                                                                                                                                                                                                                                                        |
| WASI zig libc, SPIR-V, `Io.Semaphore.waitTimeout`, ZON `updateFrom*`, bit-set and ArrayList renames | We target `wasm32-freestanding`, use WGSL/GLSL, and have no such call sites.                                                                                                                                                                                                                                                                                                      |

## Risks

- **memset regression.** Ghostty's `src/quirks_memset.zig` exists because 0.16's scalar memset cost 2.8× on ASCII streams (63% of executed instructions). 0.17 still disables loop vectorization and lists unreliable weak libc symbol overrides as a known regression. Confirm the override still links in every artifact by checking symbols, and measure ASCII throughput before and after.
- **Silent `@bitCast` changes.** The pixel differential covers the compositor on wasm only. Re-run it for every artifact the migration rebuilds, including native targets.
- **Build-run response files** are a listed 0.17 regression. The resolver's command-observation contract records exact commands, so prove it on all four platforms.
- **Minimum OS.** 0.17's standard library targets macOS 15+ and Linux 5.10+. Native recipes target macOS 13; older targets still compile, but run the resolver on the oldest macOS we support before declaring it supported.
- **Mixed variables.** Moving Ghostty pins and the compiler at once mixes source and compiler changes. Keep both artifact manifests and attribute benchmark changes by building the new Ghostty pin under each compiler where that pin allows it.
- **Cold builds are slower.** The compositor's cold build went from 1.40 to 1.85 s (+32%) and the tree-sitter archive from 2.16 to 2.22 s. Cached rebuilds are unchanged.

## Phases

- [ ] **0. Before the gate.** Make wasm builds reject Zig minor versions other than 0.16. Rebuild the pinned 0.16 artifacts and regenerate `ghostty-vt.provenance.json`, because its build inputs include `scripts/build-wasm.ts`; the previous guard change failed `scripts/wasm-provenance.test.ts` on that file's SHA-256. Add compiler provenance for `canvas-compose.wasm`, which is shipped but not covered by `ghostty-vt.provenance.json`. Its bytes reproduce exactly under 0.16.0, so the receipt can be recorded now.
- [ ] **1. Pins.** Move the three Ghostty pins to the target chosen under [Pin target](#pin-target): a tagged libghostty-vt release if one exists, otherwise the first main commit that requires 0.17 and passes CI. Rebuild `ghostty-vt.wasm` and confirm Ghostty's memset override is still linked.
- [ ] **2. Owned source.** Bridge, snapshot, unknown-OSC and C-controls translate C through `translate-c`. Apply the array, builtin and path changes and the generated-producer change. Add `@divCeil`.
- [ ] **3. Contracts and receipts.** Update the archive contracts, CI and schemas, then regenerate recipes, input manifests, bootstrap, native artifacts and wasm receipts with the builders.
- [ ] **4. tree-sitter-x.** Apply its source changes, declare configuration inputs and run CI with `--cache-poison=disallowed`. Ship it as its own PR in that repository.
- [ ] **5. ZLS.** Check that Zig and ZLS minor versions match, then update the manifest and token evidence once ZLS supports 0.17.
- [ ] **6. Requalify.** Run correctness on all artifacts and benchmarks on Mac, Linux and Pi, and update active docs. Ship a ghostty-webgpu patch changeset for the rebuilt artifacts.

## Acceptance checks

Run from the ghostty-webgpu folder of a fresh worktree, with 0.17 on `PATH`:

```sh
bunx vitest run scripts/wasm-provenance.test.ts src/core/tests/zig-frame.test.ts \
  src/render/canvas/kernel.test.ts src/render/canvas/pixel-frame.test.ts
bun scripts/browser-tests.ts src/dom/tests/zig-frame.browser.test.ts \
  src/render/webgl/zig-frame.browser.test.ts src/render/tests/zig-unicode.browser.test.ts \
  src/render/canvas/pixels.browser.test.ts
bun scripts/config-resolver-native/self-test.ts
bun scripts/config-resolver-proof/proof-self-test.ts
bun run verify:config-resolver-state --state bootstrap
```

tree-sitter-x, with `ZIG_GLOBAL_CACHE_DIR` set (0.17's build maker rejects `--global-cache-dir`):

```sh
zig build --summary all --cache-poison=disallowed
zig build -Damalgamated=true --summary all
zig build -Denable-wasm=true --summary all
```

Generate a grammar package and rebuild it after adding and removing a scanner and a query file. A clean build alone does not catch configuration-cache mistakes.

- Two independent builds of each shipped wasm are byte-identical, and the receipts name 0.17.
- The compositor pixel differential passes for every rebuilt artifact.
- The four-platform resolver build passes in CI with the new archive contracts.
- Benchmarks (energy, executed instructions, CPU seconds) on Mac, Linux and Pi show no unexplained regression against the last 0.16 results, using the [Plan 281](281-ghostty-benchmarks-and-positioning.md) protocol. A device-free first look: `scripts/renderer-benchmark.ts` with `BENCH_BASELINE_ROOT` pointing at a 0.16 build.

## Evidence

Host-specific research evidence, not committed: `/work/reports/zig-017-migration/` on the owner's machine. `inventory/` holds the compiler probes and logs, the version-site scan (187 candidate lines across 48 files, including history and fixtures), artifact identities and the pixel differential. `opportunities/` holds the build-time, size and compositor runtime measurements and the SIMD disassembly diff. The checked-in 0.16 artifacts reproduced byte for byte: `ghostty-vt.wasm` `de411c7a…`, `bridge.wasm` `59b016c9…`, `canvas-compose.wasm` `280db701…`.

Not yet verified: full qualified native and proof builds on 0.16, four-platform reproducibility, generated grammar binding tests, and wasmtime-enabled tree-sitter builds. A configuration-cache invalidation proof and paired debug-build timings were prepared but not run: `opportunities/measure-followup.py`.
