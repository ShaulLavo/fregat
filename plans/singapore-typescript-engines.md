# Singapore: Microsoft TypeScript and ts-rust browser engines

- Status: Approved, 2026-10-10 owner request; reordered by the owner on 2026-10-14.
- Kind: Implementation after the shared TypeScript parity gate.
- Owner: Cross-repo. Editor owns the reusable engine; Fregat owns application settings and pooling.
- Depends on: [TypeScript language-service parity](typescript-language-service-parity.md).
- Inspected baseline: `f03e65e7741646d6fe950b2b7405e4f5cd716aa1`.
- Maintained Rust source: [ShaulLavo/ts-rust](https://github.com/ShaulLavo/ts-rust/tree/aa1ded92daa337fa387e296eaf438f99d0651e7f),
  `feat/wasm-lsp`, verified 2026-10-14; includes upstream `144d6e0f862089df2d2628e9eb0de26a26439c1d`.
- Current progress: persistent WASM service exists in the maintained fork. Singapore integration,
  distribution, full feature parity and browser/default qualification remain pending.

## Outcome

Singapore supports Microsoft's TypeScript service and ts-rust WebAssembly as explicit engine
choices, with the same editing contract across browser workers and process-server transports.
Complete and qualify the current TypeScript paths first using the prerequisite plan. Then apply
its unchanged contract to Rust. The intended Rust default follows feature and browser performance
qualification; Microsoft remains selectable and today's working default stays during the work.

Completion includes imported edits and commands; hover, navigation, rename, diagnostics, actions,
formatting, tokens and the accepted extension families all have real editor consumers. A plain
editor given text and a URI works; the host supplies project files through the same workspace API.

## Current code

- [Plugin entry](https://github.com/ShaulLavo/singapore/blob/d44f7ffa2112417fcc919e1ee4ac5e801f054432/packages/typescript-lsp/src/pluginWithWorker.ts),
  [worker owner](https://github.com/ShaulLavo/singapore/blob/d44f7ffa2112417fcc919e1ee4ac5e801f054432/packages/typescript-lsp/src/workerOwner.ts) and
  [LSP integration](https://github.com/ShaulLavo/singapore/blob/d44f7ffa2112417fcc919e1ee4ac5e801f054432/packages/typescript-lsp/src/plugin.ts) supply the reuse boundary.
  [ProjectHost](https://github.com/ShaulLavo/singapore/blob/d44f7ffa2112417fcc919e1ee4ac5e801f054432/packages/typescript-lsp/src/worker/projectHost.ts) currently uses
  Microsoft TypeScript 6.0.3; the server selects classic or native TypeScript separately.
- [Workspace](https://github.com/ShaulLavo/singapore/blob/d44f7ffa2112417fcc919e1ee4ac5e801f054432/packages/typescript-lsp/src/workspace.ts) owns file updates and
  [parity tests](https://github.com/ShaulLavo/singapore/blob/d44f7ffa2112417fcc919e1ee4ac5e801f054432/packages/typescript-lsp/test/parity.test.ts) provide useful scenario
  validators. The prerequisite strengthens these into a real backend/browser acceptance matrix.
- The fork's [WASM service](https://github.com/ShaulLavo/ts-rust/blob/aa1ded92daa337fa387e296eaf438f99d0651e7f/npm/wasm/README.md#editor-language-service)
  exposes `createLanguageService`, LSP-shaped `request`, `updateFiles`, `deleteFiles` and disposal.
  It is a callable service over supplied files, requiring a worker JSON-RPC/session adapter.
  Updates replace the program on the next request while reusing unchanged parsed files.
- Its current dispatch covers diagnostics, hover, completion, signatures, navigation, rename,
  symbols, code actions, formatting/range formatting and full/range tokens. Auto-imports,
  completion/action resolution, prepare-rename, workspace symbols, on-type formatting and
  further contract rows need implementation. Pin and inventory the actual artifact again on entry.
- Inherited verification from the 2026-10-14 fork update at the pinned commit: 48 WASM
  package tests passed on each of Node 22 and 26, with focused native and cyclic-config
  memory/recovery checks. These earlier checks were not repeated in this planning pass.
  They establish wrapper progress; Singapore/browser and full compiler qualification stay unrun.

## Scope

Deliver the Rust worker, the complete prerequisite feature contract, reproducible WASM
packaging and Singapore/Fregat integration. Preserve the existing shared LSP, editor UI,
project synchronization and transaction owners. Use patch Changesets for public behavior/API
changes; retain upstream MIT, Apache-2.0 and BSD notices.

The maintained fork is the chosen source. Keep its editor additions and necessary compiler
patches small; promote pinned upstream updates only after review and tests. A separate wrapper
can be extracted when it reduces maintenance. Building untested latest upstream is not a release.

## Design

Proposed public option: `engine: 'typescript' | 'ts-rust'`. Select the worker before initialization.
Define interaction with explicit worker factories, external connection providers and WebSocket
routes; an external server has its own declared identity. Each connection keeps one engine.
Changing selection replaces the connection and resynchronizes workspace files and unsaved text;
pool keys distinguish engines. Reuse worker exit reporting and the prerequisite lifecycle tests.

Wrap the callable WASM service in a module worker. Implement initialization/capabilities,
document open/change/close overlays, custom workspace notifications, request IDs/errors,
refresh and disposal. Bind cancellation and stale-result suppression to actual requests; qualify
what can be interrupted during a synchronous WASM call. Adopt the prerequisite's capability and
command-application contracts before advertising missing features.

Reuse file preload and dependency declarations. Translate supported compiler options/configuration
through Rust's contract; numeric Microsoft API enums are not a Rust configuration format. Preserve
canonical paths, TSX/JSX, package exports, config projects and unsaved imported files. Measure program
replacement after real edits and retained memory over long sessions.

Bundle the WASM asset, pinned revision/toolchain and integrity metadata with the installed package,
loading a module-relative URL only for the selected engine. A fresh consumer works with the CDN
blocked, a non-root base path and no reference clone or local Rust compiler. Inspect distribution
rather than assuming a compiler npm package already contains our language-service artifact.

## Steps

1. **Enter after current TypeScript qualification.** The prerequisite's complete feature/project/
   lifecycle matrix passes for the existing owned TypeScript paths. Record the exact baseline
   and compare the Rust artifact's capability inventory against every row; missing rows stay gaps.
2. **Qualify and package the persistent service.** Pin the fork and toolchain, build in CI,
   preserve notices and verify artifact integrity. Prove edited-text answers in one persistent
   session in Chromium, Firefox and WebKit. Record actual optimized/unoptimized size and memory.
3. **Close Rust feature gaps.** Extend the Rust host and ABI as needed for the unchanged contract,
   including auto-imports, lazy resolution and accepted extensions. Preserve compiler behavior
   and diagnostic order, and add focused native/WASM evidence for each core patch.
4. **Connect the selectable engine.** Implement the worker adapter, workspace synchronization,
   engine identity/pooling and host option. Run the same useful-result and UI/transaction cases
   as Microsoft, plus asset loading, crash/disposal and engine changes with dirty shared views.
5. **Qualify the default and deliver.** Compare cold load, first diagnostics, post-edit completion/
   hover/diagnostics p50/p95 and memory on the same representative projects. Native CLI ratios
   are not browser results. Change the default only after complete parity and browser qualification;
   integrate Fregat consumers, settings, demos/docs, then merge and verify applicable delivery.

## Verification

Use the prerequisite's executable backend matrix and concrete package/server/application checks.
Add the real Rust worker to the same runner; preserve all required assertions and the Microsoft
control. Build affected workspaces before consumer checks. Verify built exports and installed assets,
Unicode/CRLF positions, project/config changes, stale results, commands/edits and multiple documents.

Run the package's `test`, `test:browser` and `typecheck` scripts, the shared LSP/plugin suites,
and relevant server/app tests named by the prerequisite. Expand browser configuration to all
three engines. Use `verify-fregat` for reviewed interaction screenshots, network/console evidence
and cache settlement. Record exact source/artifact/runtime versions and check teardown on each host.
Run `bun run plans:check` after plan/index changes. Integration checks have not run yet.

## Risks and decisions

Browser speed and memory remain measurements. The current wrapper rebuilds a program after edits;
compare its actual user latency with the incremental Microsoft service. Small Safari worker stacks
and JSPI availability require deep-source cases in all three browser engines. Qualify the current
artifact rather than borrowing limits or timings from an older compiler build.

An explicit Rust choice retains that identity through failures. Keep missing capabilities visible;
automatic switching would change diagnostics and edits mid-session. The prerequisite contract
cannot be lowered to make Rust pass. Track unavailable upstream semantics explicitly and resolve
core-patch maintenance before shipping the default.
