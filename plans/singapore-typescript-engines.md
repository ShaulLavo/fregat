# Singapore: Microsoft TypeScript and ts-rust browser engines

- Status: Approved, 2026-10-10 owner request.
- Kind: Implementation with an initial feasibility gate.
- Owner: Editor; Fregat owns application settings and connection pooling.
- Inspected baseline: `917e6da49cd610209ecb7d55508ed8275f76e5e6`.
- Upstream inspected: `pingdotgg/ts-rust` at
  `9f6ee6d147de1f8216c967e2a966cacbac295984`, 2026-10-10.
- Current progress: source inspection complete; implementation and runtime verification pending.

## Outcome

Singapore supports two explicitly selectable browser language engines: Microsoft's existing
TypeScript language service and ts-rust through WebAssembly. The intended default is Rust once
it passes the editor-feature acceptance gate. The Microsoft engine remains selectable.

Both choices provide the current TypeScript and JavaScript editing features, including completion,
hover, navigation, rename, diagnostics, code actions, formatting and semantic tokens. Opening a
plain editor with a URI option works without a document session or an application server.

A compiler-only integration is a separate, smaller scope. It does not satisfy this outcome.
Keep today's working default until the full Rust engine is verified.

## Current code

- [Package entry](../editor/packages/typescript-lsp/src/index.ts) exports
  `createTypeScriptLspPlugin` from `pluginWithWorker.ts`.
- [Worker owner](../editor/packages/typescript-lsp/src/workerOwner.ts) constructs a module worker;
  [session](../editor/packages/typescript-lsp/src/worker/session.ts) translates LSP messages into
  the `typescript-api` package, an alias of Microsoft TypeScript 6.0.3.
- [Workspace](../editor/packages/typescript-lsp/src/workspace.ts) distributes source-file
  replacement, upsert and deletion notifications to connected clients.
- [Project host](../editor/packages/typescript-lsp/src/worker/projectHost.ts) owns canonical
  source identity, live document overlays and versions.
- [Parity harness](../editor/packages/typescript-lsp/test/parity.test.ts) verifies capabilities
  and useful answers. [E054 reference](../editor/docs/architecture/e054-worker-language-server-parity.md)
  records the shipped feature set and preload decision.

Upstream's [WASM README](https://github.com/pingdotgg/ts-rust/blob/9f6ee6d147de1f8216c967e2a966cacbac295984/npm/wasm/README.md)
explicitly excludes `--lsp`, `--api` and `--watch`. Its `browser.js` exposes `tsc`, which returns
compiler diagnostics and emitted files. `crates/ts_wasm/src/lib.rs` exports a single compiler
invocation, creating a new WASM instance per run. This is not an incremental editor service.

The native language server exists in `crates/ts_goport/src/lsp/server.rs`, with reader, writer,
dispatch and progress threads. A browser worker cannot run those loops unchanged.
However, the crate publicly exports `project` and `ls`: `project::new_session`,
`Session::did_open_file`, `did_change_file`, `get_language_service`, and language-service methods
such as `provide_hover` are public. This supports trying an external wrapper without a fork;
source visibility alone does not prove that their runtime paths work in WASM.
At inspection, npm's `ts-rust-wasm/latest` endpoint returned HTTP 404 and the v0.2.0 release
assets contained native archives and npm packages, with no WASM artifact. Inspect distribution
again before implementation; do not assume that installing `tsc-rs` supplies browser WASM.

## Scope

Deliver a reusable Singapore engine choice, its reproducible WASM distribution, browser feature
proof and documentation. Then wire the choice into existing Fregat consumers where they use this
package. Inspect those consumers first; historical references to a worker do not prove adoption.

Use a patch Changeset for the package behavior/API change. Preserve upstream MIT, Apache-2.0
and BSD notices. Reuse existing editor UI and LSP transport, synchronization and navigation.

## Design

Proposed public option: `engine: 'typescript' | 'ts-rust'`. Select a worker before initialization.
An explicit `workerFactory`, external connection provider or WebSocket transport supplies its own
backend; define their interaction with this option without labelling an external server as Rust.

Keep each connection's engine fixed. Changing the choice disposes and replaces the connection,
then synchronizes workspace files and current unsaved buffers. Pool keys include engine identity
so documents requesting different engines cannot borrow the same worker. Preserve live URI identity
and multi-view synchronization. Reuse the worker owner's structured exit notification.

The Rust worker needs a persistent language-service session with a message-based WASM interface.
Determine whether public `ts_goport` session/language-service APIs can supply it through a small
Fregat-owned Rust wrapper before considering changes to dependency internals. Reuse the current
file preload and incremental updates; do not add synchronous network filesystem reads.
Rust compiler options and built-in declarations must come from its own supported contract.
Microsoft API enum values are not a Rust configuration format.

Prefer a separate wrapper depending on the pinned upstream Rust crate. A custom build of that
wrapper does not itself require a fork. Only choose a fork if the prototype demonstrates that
upstream internals must change, and record the smallest required patch and its maintenance cost.
If the project session reaches native timer/thread machinery, evaluate the lower-level public
`ls::new_language_service` with a browser-owned `ls::Host` and compiler program. That host supplies
files, position converters and preferences. Measure program replacement after edits before choosing
it over an incremental session; merely bypassing native threads is not the full acceptance gate.

Bundle the WASM asset with the built package and load it from a module-relative URL. A fresh
consumer install must not require a reference clone, a local compiler or an unpinned CDN download.
Choose a pinned upstream artifact or a reproducible build-and-package step with integrity checks.

## Steps

1. **Prove a persistent browser service.** Build the upstream compiler as a control, then make
   the smallest owned wrapper that opens a file, answers hover and completion, applies an edit
   and answers about the changed text in the same session. Test Chromium, Firefox and WebKit.
   Record required APIs, unsupported threading calls, retained memory and actual WASM size.
   If this needs substantial dependency changes, document that scope and the exact blocker before
   changing upstream code. Do not treat compiler diagnostics as proof of editor support.
2. **Package the runtime.** Pin the upstream revision and toolchain, preserve notices and build
   the wrapper in CI. Check an installed package in a fresh consumer with a non-root base path,
   successful worker/WASM responses and the CDN blocked. Keep payloads and caches configurable.
3. **Implement the two engines.** Add the option, Rust worker session and workspace synchronization.
   Preserve the Microsoft path. Support compiler options, TSX/JSX, canonical paths, dependency
   declarations and unsaved imports through the same public workspace API.
4. **Prove feature parity and lifecycle.** Parameterize the existing parity/method harnesses
   against real engines, plus the simple editor path, shared workspaces, cancellation, disposal,
   worker crash and engine replacement. Assert the currently advertised methods produce useful
   answers. Compare behavior, not TypeScript 6 and 7 diagnostic text byte-for-byte.
5. **Qualify the default and integrate.** Compare cold load, first diagnostics, completion and
   edits on the same projects, along with retained memory. Native CLI benchmark ratios are not
   browser measurements. Only after feature and browser checks pass, set Rust as the default,
   update demos/docs and register any Fregat knob with its consumer in the settings registry.

## Verification

- Run `bun run test` and `bun run typecheck` in `editor/packages/typescript-lsp`; extend the
  existing `test/parity.test.ts`, `test/methods.test.ts` and `test/worker.test.ts` suites.
- Extend the package's `test:browser` configuration to qualify all three browser engines with
  the real WASM worker. Test Unicode positions, incremental edits and multiple documents.
- Build affected workspaces with `bun run build:workspaces` before checking consumers. Verify
  the built package exports and emitted assets from an installed package, not source aliases.
- Drive completion acceptance, hover, cross-file rename, quick fixes, formatting, diagnostic
  updates, engine replacement with unsaved edits, and shared views in the real editor. Capture
  reviewed screenshots and console/network evidence through the current verification workflow.
- Run `bun run plans:check` when changing this plan/index. No runtime checks have run yet.

## Risks and decisions

The present blocker is the missing persistent WASM editor interface and its distribution.
The project being written in Rust does not establish browser speed or feature parity.
Safari workers have small stacks and no JSPI according to upstream; include deeply nested source
in qualification and report failures clearly. Upstream also records native long-session memory
growth; measure the actual wrapper over repeated edits rather than borrowing those numbers.

An explicit Rust selection stays Rust. A worker failure reports the failure through existing LSP
status handling. Automatic switching to Microsoft would change diagnostics and edits mid-session
and needs a separate product decision. The default change remains pending the acceptance gate.
