# TypeScript language-service parity across workers and servers

- Status: Approved, 2026-10-14 owner request; implementation underway.
- Kind: Implementation with a shared acceptance contract.
- Owner: Cross-repo. Singapore owns reusable LSP integration; Fregat owns server routing,
  workspace/filesystem policy, commands and application UI.
- Priority: P1. Effort: L. The contract/baseline phase starts on the shipped LSP foundation.
  Qualification depends on merged action/declaration/inlay/refresh work from
  [227](227-lsp-command-completeness.md) and its split destination owner
  [237](237-directional-pane-commands.md). Coordinate their acceptance here; do not implement
  duplicate UI lanes. [088](088-native-code-intelligence.md) keeps agent-semantic ownership.
- Inspected baseline: `f03e65e7741646d6fe950b2b7405e4f5cd716aa1`.
- Successor: [Singapore TypeScript engines](singapore-typescript-engines.md). Its Rust
  integration follows this plan's feature, project and lifecycle acceptance gate.
- Current progress: the first implementation adds 25 shared core cases, real TS6/TS7 and
  module-worker adapters, and source-bound baseline capture. Full editor qualification and the
  external WebSocket reference are pending. See the execution record below.

## Outcome

A TypeScript editing feature has the same useful behavior through Singapore's browser worker,
classic tsserver through typescript-language-server, TypeScript 7's native LSP, and a capable
TypeScript server through the configured external-LSP route. Completion acceptance includes its imports and commands; rename updates the intended
files once; diagnostics and navigation refer to the current unsaved text. Changing transport
preserves these behaviors, document ownership, cancellation and project configuration.

Build the reference contract and close gaps in the existing TypeScript paths first. Then run
that same contract against ts-rust. A server advertising a method is insufficient: the client
must route it, the editor must expose it, and its edits or display must be useful.

Owned TypeScript backends must pass every required user-behavior row before qualification.
Equivalent wire variants may implement that outcome: diagnostics can arrive by push or pull,
semantic color can use full or range tokens. Negotiated variants such as delta, workspace pull,
related-document reports or lazy resolve must pass their protocol cases when advertised; their
absence alone does not fail the user-behavior row. Record unsupported variants separately.

For an arbitrary external server, unsupported features remain visible as unavailable. They never
count as passing required behavior, trigger a silent engine switch, or shrink the contract to a
common intersection. Test our full client/UI coverage with a capable reference external server;
an arbitrary server is not advertised as a fully qualified TypeScript engine.

## Current code

- [Worker session](../editor/packages/typescript-lsp/src/worker/session.ts) handles 21 feature
  requests, including completion/code-action resolution, prepare-rename, workspace symbols,
  on-type formatting and pull diagnostics. [ProjectHost](../editor/packages/typescript-lsp/src/worker/projectHost.ts)
  maintains versions and unsaved overlays over supplied workspace files.
- [Worker parity test](../editor/packages/typescript-lsp/test/parity.test.ts) constructs only
  `InProcessTypeScriptWorker`; its useful-answer rows are valuable, but it does not compare
  real server backends. Its completeness check covers top-level capability keys. Existing
  browser coverage concentrates on document symbols and synchronization.
- [Runtime selection](../apps/server/src/lsp/typescript/runtime.ts) starts classic tsserver
  through typescript-language-server or the native compiler with `--lsp --stdio`.
  At this baseline the worker/classic test engine is TypeScript 6.0.3, the adapter is 6.0.1,
  and the server-owned native package is TypeScript 7.0.2. Fixtures must record actual versions.
- [Real server tests](../apps/server/src/lsp/tests/typescript-server.test.ts) use real TS6/TS7
  processes with a recording socket. They cover project changes and selected hover,
  definition, completion and token results, rather than the full worker method matrix.
- [LspClient](../editor/packages/lsp/src/client.ts) already has generic requests, request handles
  and notifications. [ServerSet](../editor/packages/lsp-plugin/src/serverSet.ts) routes a
  narrower feature set. The proxy generally forwards client requests; transport reachability
  and editor feature coverage are separate facts.
- [Code-action application](../editor/packages/lsp-plugin/src/codeActions.ts) explicitly
  rejects commands before and after resolution; completion application omits item commands.
  The [proxy](../apps/server/src/lsp/proxy-session.ts) deliberately rejects unowned server
  requests, including `workspace/applyEdit`. Extend the transaction contract before enabling it.
- [Workspace preload](../editor/packages/typescript-lsp/src/workspace.ts) broadcasts custom
  file notifications to connected clients. Standard external servers need their own provisioning
  contract. The worker currently selects one tsconfig; config glob and multi-project behavior
  need fixtures before changing [project ownership](../editor/packages/typescript-lsp/src/worker/project.ts).

The old E054 completion record remains historical evidence. This plan adds a stronger acceptance
contract. Older Plan 088 references to the removed in-process server must be reconciled against
current runtime/proxy owners; preserve its semantic-tool scope without restoring that server.

## Scope

Deliver one executable feature matrix, real backend fixtures, shared capability/routing fixes,
TypeScript worker/server gap closure, editor actions and browser proof. The matrix covers TS,
TSX, JS and JSX, standalone editors given text and a URI, and hosted shared workspaces.

Use existing LSP, editor integration, pane/navigation and workspace-edit owners. Plan 227 carries
its declaration, typed navigation destinations, action menus, organize-imports, inlay and refresh
work. Plan 237 owns split creation and focus. Each plan's executor owns its changes; this coordinator supplies matrix fixtures and acceptance cases and waits for those
merged receipts before qualification. Completion commands reuse that merged command owner. New
families outside Plan 227, such as workspace symbols and hierarchy UI, belong to this plan's
implementation lanes. Plan 088 retains agent semantics and its narrower diagnostic budget.

Runtime implementations remain unchanged by this planning PR. Public package changes made during
execution need patch Changesets. Source imports, tests and package assets must remain portable.
Reuse existing folding/selection and Tree-sitter owners for structural results. App settings use
the registry; application reads/effects and edit settlement follow the existing query/mutation owners.

## Design

Proposed contract files live under `editor/packages/typescript-lsp/test/parity/`: `contract.ts`
owns typed feature rows, capability paths, wire variants and validators; `cases/` owns source
fixtures and scenarios; `worker.ts` owns in-process and module-worker adapters. Proposed
`test/parity-contract.test.ts` validates row completeness and runs worker cases. Proposed
`apps/server/src/lsp/tests/typescript-feature-parity.test.ts` owns process/WebSocket fixtures
and runs the same scenarios. Reuse current useful-answer validators, `LspClient`, real-runtime
fixtures and connected-editor fixtures. Keep Node setup outside browser modules and test helpers
outside published package exports. The test suites own this evidence contract, not runtime routing.

Each feature row records its public action, request/resolve/execute/apply sequence, capability
paths including nested fields, registration/refresh behavior, fixture inputs and useful-result
validator. Capture backend/compiler version, transport, source identity and case identity with
one of `pass`, `unavailable`, `fail` or `unrun`; include reason, source and evidence. Split each
feature's mandatory useful outcome from its conditional negotiated protocol cases. A proposed
portable `scripts/typescript-parity.mjs` validates the evidence manifest with commands `baseline`
and `qualify`: baseline requires every cell to have a result/owner but permits known gaps;
qualify requires pass for each owned backend's mandatory outcome and every advertised variant,
with no unexpected skip or unrun. The configured external-reference path is also required.
An empty result cannot pass a fixture deliberately constructed to require an answer.

Start with the union of the shipped useful TypeScript features, then complete these approved
extension families. Pin and inspect the reference servers before recording backend availability.

| Family                    | Required user behavior and acceptance cases                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion and signatures | Member/global/auto-import completion; resolve detail/docs; snippets, replacement ranges, additional edits and completion commands; active parameters and overloads.                |
| Navigation and symbols    | Definition, declaration, type definition, implementations, references, document highlights, outline and workspace symbols; selection ranges and same-pane/peek/split destinations. |
| Rename and refactoring    | Prepare-rename, cross-file rename, quick-fix and refactor menus, lazy resolution, command-only/edit-plus-command actions, organize/sort/remove-unused imports and fix-all.         |
| Diagnostics               | Push and pull, result IDs/unchanged reports, project/config errors, refresh, related information and related-document/workspace reports where negotiated.                          |
| Formatting and structure  | Document/range/on-type formatting, CRLF and indentation options; selection/folding ranges and linked editing through shared editor actions.                                        |
| Semantic presentation     | Full/range/delta tokens with the negotiated legend; inlay hints and resolve; code lenses and resolve; applicable document links and resolve.                                       |
| Hierarchies               | Call and type hierarchy preparation and navigation, with useful target ranges and explicit backend availability.                                                                   |
| File/project operations   | File-rename import edits and will/did file notifications; workspace folders, settings and watched-file changes; dependencies and config repairs.                                   |
| Lifetime and ownership    | Open/change/close ordering, unsaved overlays, Unicode positions, stale responses, cancellation, pooling, disposal, worker/server crash and reconnect.                              |

Compare user-visible semantics and resulting text, not byte-identical TS6/TS7 diagnostic prose,
completion ordering or raw semantic-token IDs. Record legitimate language-version differences
without writing runtime version-skew recovery branches.

Capability routing uses the actual method, including declaration, symbols and range formatting.
An unsupported method declines cleanly. Dynamic registration/unregistration and each adopted
refresh request update the same capability owner; acknowledging an unused registration is not
feature support. Extend editor feature metadata and Fregat's protocol/ranks together.

Define one command owner before exposing command actions. Bind execution and any server edit
request to the originating connection, action and current document/project revisions. Use the
existing preview/commit/undo transaction path; apply each edit once, then execute commands in
protocol order. Advertise `workspace.applyEdit` only when the complete ownership/handler contract
exists. Pooled server requests must have one proven recipient; retain rejection when none exists.
Test failed commands, cancelled previews, stale edits, annotations and partial failure recovery.
Interactive command requests need a uniquely owned host choice handler; route message/selection
requests and progress through that action, and keep unsupported server requests explicit.

Files have backend-specific provisioning under one project contract. Browser workers use supplied
files and overlays; process servers use the host's workspace and standard open/change notifications.
Capability-gate custom preload notifications. Prove canonical package aliases, overlay close/restore,
config include/exclude/extends/references, per-file project selection and nested workspaces. Add a
failing fixture for the current directory-reader membership concern before choosing its fix.

## Steps

Before editing, run `git diff --stat f03e65e7741646d6fe950b2b7405e4f5cd716aa1..HEAD --
editor/packages/{lsp,lsp-plugin,typescript-lsp} apps/server/src/lsp apps/web/src/features/editor`.
Refresh the cited code and fixtures wherever that diff shows drift.

1. **Freeze the contract and inventory.** Create the proposed contract/test/manifest validator
   above; extract existing rows and pin backend fixtures. Inspect nested and dynamic capabilities. Run a source-bound baseline against in-process worker,
   real module worker, real TS6 adapter and TS7 native server. Also route a known TypeScript server
   through the configured external-server/WebSocket path. Record unsupported and unrun separately.
   Gate: `bun scripts/typescript-parity.mjs baseline <evidence.json>` exits 0, names every cell
   and owner, and reports real gaps separately from unavailable variants. The new contract tests
   fail when a nested advertised method, useful-result validator or backend cell is removed.
2. **Complete shared routing and action application.** In `lsp-plugin/src/serverSet.ts`, feature
   metadata and Fregat document-symbol queries, route by actual capability. Add range formatting,
   workspace-symbol and extension-family adapters beside existing feature owners. Plan 227's
   executor closes commands/action/inlay/declaration work and typed navigation destinations.
   Plan 237's executor owns split creation and focus; this coordinator integrates their receipts and adds completion-command cases.
   Extend `lsp/src/capabilities.ts` and `apps/server/src/lsp/proxy-session.ts` together for owned
   server requests, registrations/refresh and provenance. Gate: shared LSP/plugin suites and
   proxy tests below exit 0, including two pooled clients, unsupported methods and server edits.
3. **Close TypeScript backend and project gaps.** Implement worker methods through real TypeScript
   APIs; retain project/file versions and configure semantic behavior consistently. Extend the
   process adapter/host where needed. Repair confirmed config/dependency provisioning gaps and
   qualify multi-project behavior. Worker edits belong in `src/worker/session.ts`, `project.ts`,
   `projectHost.ts` and existing/new method modules. Process adaptation belongs in the current
   runtime/proxy owners. Gate: worker contract/method tests and new real-server feature-parity
   suite exit 0; `bun scripts/typescript-parity.mjs qualify <evidence.json>` passes mandatory
   behavior and advertised variants for every owned backend. A missing reference semantic API
   follows the STOP path below, rather than inventing a success.
4. **Prove the complete product.** Run the same fixtures through real browser workers and live
   server WebSocket routes in Chromium, Firefox and WebKit. Exercise all feature actions, completion
   acceptance, refactors/rename/file moves with undo, shared views and unsaved imports. Cover asset
   loading from an installed package, offline worker operation and the simple editor path. Gate:
   reviewed UI evidence, correct subsequent diagnostics, no leaks or stale paint/edit application.
   Gate commands: `bun run --cwd editor/packages/typescript-lsp test:browser` and the proposed
   `bun run agent:browser scenario typescript-feature-parity` exit 0 for all target
   browsers/backends; the qualified manifest
   validates again. Put scenario/selectors in the existing `scripts/agent/` owners.
5. **Publish the contract and hand it to Rust.** Preserve the executable matrix in CI, feature maps
   and lasting evidence; reconcile Plan 227/088 acceptance references and older E054 claims. Measure
   cold startup, post-edit p50/p95 and memory on representative projects as controls for the Rust
   successor. Gate: baseline/qualification manifests and cleanup receipts are committed under
   `editor/docs/architecture/` with a green CI matrix; plan checks pass, required implementation
   PRs are merged, and the current TypeScript qualification is complete before Rust feature work.

## Execution record

The initial delivery extracts all 21 useful worker method cases and adds four mandatory
outcomes for post-edit diagnostics, semantic color, completion detail and extraction. Every
matrix includes the in-process worker, Chromium, Firefox, WebKit, classic TS6, native TS7 and
external WebSocket roles. Missing execution stays `unrun`; unavailable methods stay
`unavailable`. `baseline` accepts recorded gaps; `qualify` rejects missing mandatory behavior,
unrun cases and advertised methods without acceptance cases.

- [x] Shared core contract and useful-result validators; nested capability completeness tests.
- [x] Real TS6/TS7 process fixtures through the production pool, with pinned observed outcomes.
- [x] Real module workers support all 25 core cells in Chromium, Firefox and WebKit; cleanup verified.
- [x] Artifact capture, source fingerprints, artifact hashes and metadata consistency checks.
- [ ] Complete the configured external-server/WebSocket reference adapter.
- [ ] Extend the contract to the remaining feature families and editor actions.
- [ ] Complete routing, action execution, project/lifetime coverage and full qualification.

The classic fixture runs TS6 6.0.3 through typescript-language-server 6.0.1. Of 25 core cells,
21 are supported, two fail and two are unavailable. Refactor resolution and extraction return
command actions without usable edits. On-type formatting and pull diagnostics are unavailable;
standard push diagnostics satisfy the mandatory post-edit outcome. Prepare rename succeeds
when the client declares prepare support.

Native TS7 7.0.2 supports 22 core cells, fails two and leaves one unavailable. Quick fixes and
extraction return empty arrays, including a control with the full original diagnostic and
literal-action negotiation. Code-action resolution is unavailable. Preserve these fixtures as
upstream/adapter evidence while completing the action owner; do not lower the useful-edit gate.

Commands, source/artifact rules and browser results belong in
[the baseline guide](../editor/docs/architecture/typescript-parity-baseline.md). These core
checks do not complete feature, project or editor qualification. Rust integration still waits
for the current TypeScript qualification gate.

## Verification

Run narrow rows while implementing, then the complete acceptance matrix before qualification.
These are execution commands, not checks performed during this planning pass:

```sh
bun run build:workspaces
bun run --cwd editor/packages/typescript-lsp test test/parity.test.ts test/methods.test.ts
# Add these tests during step 1; they are proposed paths, not existing checks.
bun run --cwd editor/packages/typescript-lsp test test/parity-contract.test.ts
bun run --cwd apps/server test src/lsp/tests/typescript-feature-parity.test.ts
bun run --cwd editor/packages/typescript-lsp test:browser
bun run --cwd editor/packages/lsp test
bun run --cwd editor/packages/lsp-plugin test
bun run --cwd apps/server test src/lsp/tests/typescript-server.test.ts src/lsp/tests/typescript-runtime.test.ts
bun run --cwd apps/server test src/lsp/tests/proxy-session.test.ts src/lsp/tests/routes.test.ts src/lsp/tests/watched-files.test.ts
bun run --cwd apps/web test src/features/editor/tests/language-server-plugin.test.ts src/features/editor/tests/semantic-token-controller.test.tsx
bun run --cwd editor/packages/typescript-lsp typecheck
bun run --cwd editor/packages/lsp-plugin typecheck
bun run --cwd apps/server typecheck
bun run --cwd apps/web typecheck
bun run plans:check
bun run gates
```

Expand the existing browser configuration and scenario catalog to cover the full contract and all
three browsers; the current Chromium document-source scenario is insufficient. Use `verify-fregat`
for real application interactions, console/network issues, screenshots and cache settlement.
Each test owns disposable projects, processes, workers, servers, routes and profiles; install
teardown before setup, check actual cleanup, and retain only small results/reproducers.

Completion requires the matrix to detect a removed handler, false nested capability, dropped
command/import edit, wrong config membership, stale edit, misowned server request and missing UI
consumer. Performance claims require the same workloads and conditions; timings alone cannot
replace feature acceptance. Each implementation PR owns review, CI, merge and applicable delivery.

## Risks and decisions

Arbitrary external servers can lack features. Complete the common client/UI paths and expose
actual availability; qualify advertised engines against the fixed required contract. A missing
upstream semantic API blocks that owned backend's qualification. Stop that affected row and
record a reproducible fixture, capability/version evidence, proposed dependency/adapter/core
change and its acceptance cases in this plan; keep independent contract/client work moving.
Obtain an explicit owner scope decision if meeting the outcome needs a new dependency fork or
external project changes. Otherwise implement the selected API/adapter path and rerun the row.
Write upstream blockers ready to file locally. Never invent approximate semantic results, mark
unavailable as pass, or silently remove the feature to clear the gate.

Command-backed mutations and multi-project routing carry the greatest risk. Reassess ownership
when a pooled request has no unique origin; keep the application boundary intact. If baseline
source has drifted, refresh the inventory before changing behavior. No automatic compiler switch,
second workspace-edit pipeline, restored obsolete TS service or lowering of the acceptance gate.
