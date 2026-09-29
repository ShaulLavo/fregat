# Architecture Recovery Plan

Status: superseded as an execution source on 2026-08-22

The delivered phases remain useful architecture history, but unchecked or
forward-looking prose in this document no longer establishes work order. The
remaining concrete debt belongs in [`TODO.md`](../TODO.md) until promoted into a
bounded executable plan. Cross-project prerequisites and ownership are ordered
by [Platform's canonical roadmap](../../platform/PLAN.md). Do not recreate
deleted bridges or compatibility APIs merely to make this historical target
shape literal.

This document turns the architectural teardown into a phased recovery plan. It is deliberately large.
The current system did not accumulate its problems in one subsystem, so it cannot be repaired by one
cleanup pass.

The goal is not to make the codebase prettier. The goal is to make the editor honest:

- one canonical document truth
- explicit ownership of derived projections
- explicit worker lifetimes
- explicit scheduling and cancellation
- narrow public APIs
- narrow extension points
- rendering that consumes a view model instead of becoming the model
- tests and CI that match what the repository claims to support

## Diagnosis

The current architecture has several good ideas: a piece-table document model, anchor-backed durable
positions, CSS Highlight API rendering, display virtualization, and worker-backed syntax. The failure
is that these ideas are not owned by one coherent pipeline.

The main problems are:

- The architecture documentation describes a worker-authoritative document model, while the main
  thread still owns document session state, undo/redo helpers, rendered snapshots, syntax refresh
  decisions, plugin execution, and view reconciliation.
- Derived data is promoted into durable state in too many places: document sessions, syntax
  controllers, virtualized views, minimap workers, and diff views all retain their own versions of
  text-adjacent truth.
- The old plugin API was a broad service locator. Phase 8 has moved the public surface to typed
  domain registries, but a temporary internal feature-contribution bridge still exists for first-party
  migration.
- Rendering is split into files but not split into architecture. A large mutable internal view object
  is still the real boundary.
- Multiple local schedulers, timeouts, generation counters, and stale-result guards have replaced a
  single scheduling model.
- Worker clients use global state and best-effort disposal instead of explicit lifetimes.
- Public exports expose implementation details, which makes cleanup harder every time another package
  imports them.
- The build and test setup claims repo-wide discipline, but many packages do not define the scripts
  the root tooling expects.

## Target Architecture

The long-term shape should be:

```text
Input events
  -> transaction request
  -> document transaction engine
  -> snapshot-tagged projection scheduler
  -> syntax / folds / decorations / layout projections
  -> mounted view model
  -> DOM renderer
```

The editor should have these hard boundaries:

- Document engine owns text, snapshots, anchors, transactions, undo, and redo.
- Projection scheduler owns derived work ordering, cancellation, budget, and staleness.
- Syntax engine owns parse state and syntax-derived projections for a snapshot.
- View model owns visible rows, folded regions, current anchored/injected
  surfaces, and renderable ranges. Deleted block-surface APIs are not a target.
- Renderer owns DOM, browser geometry, CSS highlights, and mounted-element lifetimes.
- Extensions provide typed contributions into narrow registries.
- Minimap and diff consume projections; they do not reconstruct private editor pipelines.

## Non-Negotiable Rules

These rules are the refactor's guardrails.

1. A snapshot must be immutable by construction, not by convention.
2. A derived projection must name the snapshot, viewport, and configuration it was derived from.
3. A worker resource must have an owner, a cancellation path, and a disposal acknowledgement when
   correctness depends on disposal.
4. A command must report whether it handled the input before browser default behavior is suppressed.
5. A package boundary must mean something. Public exports are product API, not a dumping ground.
6. Timers may smooth work. Timers must not be correctness.
7. Full-document text materialization must be visible at the API boundary.
8. Extension APIs must make invalid states hard to express.
9. A duplicated subsystem is a bug unless it is intentionally forked and documented.
10. CI must run the checks the repository tells humans to run.

## Phase Map

| Phase | Name | Primary outcome |
|---|---|---|
| 0 | Baseline and guardrails | Make the current state measurable and stop adding new damage |
| 1 | Public API containment | Separate supported API from internals |
| 2 | Document truth | Repair snapshot, transaction, history, and text ownership |
| 3 | Scheduler and lifetimes | Replace scattered timing behavior with explicit work ownership |
| 4 | Syntax ownership | Make Tree-sitter/Shiki roles explicit and snapshot-tagged |
| 5 | Rendering architecture | Split view model, layout, and DOM renderer honestly |
| 6 | Input and selection | Replace implicit DOM/session timing coupling with a state machine |
| 7 | Folds, blocks, and decorations | Move display features into typed projection registries |
| 8 | Extension system | Replace service-locator plugin API with typed public extension points |
| 9 | Minimap and diff | Stop duplicating editor pipelines |
| 10 | LSP and language packages | Collapse cloned LSP code into one core plus adapters |
| 11 | Worker topology | Make worker ownership, caches, and disposal explicit |
| 12 | Test and CI hardening | Make regressions difficult to merge |
| 13 | Documentation reset | Replace aspirational docs with enforceable architecture docs |

## Phase 0: Baseline and Guardrails

Purpose: measure the existing system and prevent new architecture debt while the larger refactor is
underway.

### Work

- Add a repository health document that records current known cycles, duplicate modules, missing
  package scripts, and public API leaks.
- Configure code-health scanning so ignored local references are not treated as repository source.
- Add a dependency graph check for package-level cycles.
- Add a source-level import-cycle check for the editor, virtualization, and LSP packages.
- Add a public API inventory for `@singapore-editor/core`.
- Add a performance baseline for:
  - typing into a small file
  - typing into a large file
  - scrolling 100K lines
  - syntax refresh after edit
  - fold toggle in a large file
  - minimap update after edit
- Add a "no new public exports without review" rule.
- Add a "no new timers without scheduler justification" rule.

### Exit Criteria

- `references/` and other local source mirrors do not pollute health metrics.
- CI or a local check reports package cycles and source cycles.
- The repo has a checked-in baseline for correctness, package scripts, cycles, and performance.
- New code has an agreed place to land instead of expanding the existing knots.

## Phase 1: Public API Containment

Purpose: stop downstream packages from depending on internals before internals are moved.

### Work

- Replace broad exports in `packages/editor/src/index.ts` with intentional public entry points.
- Create explicit internal entry points for packages that still need temporary access during the
  migration.
- Split public API into:
  - editor construction
  - document model
  - extension contracts
  - syntax contracts
  - rendering contracts
  - test utilities
- Move virtualization internals behind internal exports.
- Move piece-table debug access behind an explicit internal/debug entry point.
- Audit every import of `@singapore-editor/core/*` across packages.
- Add compatibility shims only where migration would otherwise block multiple phases.
- Put deprecation comments on compatibility shims with removal phases.

### Must Delete

- Blanket `export *` from core internals.
- Any public export whose only consumer is a package implementation detail.

### Exit Criteria

- External packages cannot accidentally import editor internals through the main package entry.
- All temporary internal imports are named and tracked.
- The public API is small enough to review in one file.

## Phase 2: Document Truth

Purpose: make the document engine the actual source of text truth.

### Work

- Fix snapshot immutability:
  - remove mutation through `ReadonlyMap` casts
  - make buffer maps persistent or copy-on-write
  - make snapshot-visible state structurally immutable at type boundaries
- Replace random treap priorities with deterministic, seedable priorities.
- Define a single transaction type for:
  - text edits
  - selection before/after
  - anchor updates
  - undo grouping
  - metadata for source and intent
- Move undo/redo ownership into the document transaction layer.
- Remove separate edit stacks that can diverge from snapshot history.
- Replace lazy full-document `text` getters with explicit materialization methods.
- Add explicit APIs for:
  - read range
  - read lines
  - stream pieces
  - materialize full text
- Add a compaction policy for invisible pieces.
- Add benchmark coverage for repeated insert/delete cycles and long-lived sessions.
- Make selection IDs document/session scoped instead of module-global.

### Must Delete

- Mutable shared snapshot buffers.
- Module-global storage identity counters where session ownership is required.
- Undo/redo state that duplicates snapshot history without a hard invariant.
- Convenience APIs that silently materialize full text.

### Exit Criteria

- Old snapshots cannot observe mutation through shared buffer maps.
- A transaction is the only way normal editor edits change document state.
- Undo/redo is derived from transaction history, not parallel informal state.
- Full-document materialization is grep-visible and reviewed.

## Phase 3: Scheduler and Lifetimes

Purpose: replace scattered timeout logic with one explicit work model.

### Work

- Introduce a scheduler package or module with:
  - task identity
  - priority
  - snapshot/version tags
  - viewport/configuration tags
  - cancellation
  - budget
  - stale-result handling
  - observability hooks
- Define task classes:
  - input-critical
  - visible-render
  - viewport-derived
  - background-derived
  - idle-cache
- Migrate editor secondary work onto the scheduler.
- Migrate syntax range, prefetch, and warm work onto the scheduler.
- Migrate minimap quiet/max/idle timers onto the scheduler.
- Migrate diff scroll sync and syntax refresh guards onto the scheduler where appropriate.
- Replace "latest request wins" helpers with scheduler-owned cancellation and staleness.
- Add instrumentation for dropped, cancelled, completed, and timed-out work.

### Must Delete

- Local ad hoc secondary work queues.
- Unnamed timeout constants that encode architecture.
- Best-effort stale guards where explicit cancellation is possible.

### Exit Criteria

- There is one place to answer "why did this work run now?"
- Background work cannot starve input.
- Cancelling work releases owned resources or reports that it cannot.
- Timing improves responsiveness but does not define correctness.

## Phase 4: Syntax Ownership

Purpose: make syntax a projection pipeline, not a collection of competing caches.

### Work

- Define one syntax service contract:
  - input snapshot
  - edit summary
  - requested ranges
  - language configuration
  - output projections
- Make Tree-sitter the canonical structural syntax provider.
- Decide Shiki's long-term role:
  - delete it from core, or
  - make it a tokenizer backend behind the same syntax contract
- Remove syntax token ownership from document sessions.
- Make syntax outputs snapshot-tagged and projection-owned.
- Split Tree-sitter worker responsibilities:
  - protocol
  - document source cache
  - parser runtime
  - query execution
  - injections
  - projection formatting
- Replace optional-phase warning-and-fallback behavior with typed degraded states.
- Add query failure tests and injection-depth tests.
- Add memory policy tests for retained snapshots and source chunks.

### Must Delete

- Document-session token state.
- Silent syntax fallbacks that look like "no syntax data."
- Production dependence on debug piece-table APIs.
- Global syntax worker state with unclear document ownership.

### Exit Criteria

- A syntax result always names the snapshot and language configuration it belongs to.
- Shiki and Tree-sitter do not compete for the same authority.
- Syntax failure is observable by the editor and tests.
- Worker caches have documented ownership and retention policy.

## Phase 5: Rendering Architecture

Purpose: make virtualization understandable without reading the entire editor.

### Work

- Split rendering into four layers:
  - projection input: document snapshot, folds, blocks, decorations, viewport
  - view model: visible logical rows, injected rows, folded rows, chunks
  - layout model: measured row heights, scroll-space mapping, mounted ranges
  - DOM renderer: elements, highlights, geometry queries
- Replace the large mutable virtualized view internals object with owned state modules.
- Break virtualization import cycles.
- Make full-text materialization illegal in layout code unless explicitly marked and benchmarked.
- Move folding, block rows, injected rows, and wrapping into the view model.
- Keep browser layout as visual truth for mounted DOM.
- Add browser tests for:
  - mounted range correctness
  - caret hit testing
  - selection rects
  - folded rows
  - wrapped rows
  - long-line chunking
  - scroll height cap behavior
- Add an invariant test that view model output is deterministic for a snapshot and viewport.

### Must Delete

- Helper modules that mutate a shared view struct without ownership.
- Virtualization cycles.
- Rendering paths that rebuild full display rows by materializing the entire document as a default.

### Exit Criteria

- A developer can reason about view model generation without reading DOM code.
- A developer can reason about DOM updates without reading fold normalization.
- Full-document rendering work is explicit and covered by benchmarks.
- The view can be tested without a browser where browser geometry is not required.

## Phase 6: Input and Selection

Status: complete

Purpose: make input correctness independent of browser event timing accidents.

### Work

- Define an input state machine:
  - idle
  - composing
  - beforeinput pending
  - native input observed
  - fallback pending
  - transaction committed
  - selection reconciled
- Define which state owns:
  - DOM selection
  - session selection
  - hidden input value
  - pending text
  - fallback generation
- Make keyboard fallback behavior explicit and tested.
- Change command dispatch so browser default is prevented only when a command handles the input or
  explicitly requests prevention.
- Move multi-cursor edit construction closer to the transaction layer.
- Remove duplicated word/range helpers across editor and find packages.
- Add IME, paste, drop, copy, multi-cursor, and undo selection tests.

### Must Delete

- Implicit booleans that encode input lifecycle without a state model.
- Timer-only fallback correctness.
- Command handlers that fail while still suppressing browser behavior.
- Duplicated text range implementations.

### Exit Criteria

- Every input event transition is represented in one state machine.
- Selection reconciliation is deterministic and testable.
- Native browser behavior is not swallowed after unhandled commands.

## Phase 7: Folds, Blocks, and Decorations

Status: in progress

Purpose: consolidate display features as projections instead of special cases.

Initial slice:

- Added an internal typed display projection registry for folds, row decorations, range decorations,
  block rows, injected rows, and gutters.
- Routed syntax folds, editor row decorations, range decorations, block rows/lanes, injected rows,
  and gutters through the registry with owner, snapshot/version source, invalidation range,
  layer/priority, and disposal metadata.
- Rejected invalid, nested, and overlapping fold projections at registry ingestion, with syntax
  folds filtered before fold interaction state consumes the projection set.
- Added registry and editor conflict-order tests for deterministic decoration and multi-provider fold
  projection composition.

### Work

- Define typed projection registries for:
  - folds
  - row decorations
  - range decorations
  - block rows
  - block lanes
  - injected rows
  - gutters
- Make each projection name:
  - owner
  - source snapshot/version
  - invalidation range
  - priority/layer
  - disposal behavior
- Move fold state into one owner.
- Reject nested and overlapping fold projections explicitly instead of hiding them in normalization.
- Make block rows and injected rows part of the view model input.
- Add dense decoration tests that prove the system does not allocate anchors per token.
- Add conflict tests for overlapping non-fold projections from multiple providers.

### Must Delete

- Fold concepts split across unrelated modules without one owner.
- Hidden normalization that silently drops supported-looking states.
- Decoration APIs that let providers bypass projection ownership.

### Exit Criteria

- Display features enter the renderer through one projection path.
- Provider conflicts are deterministic.
- Invalid projection states are rejected near their source.

## Phase 8: Extension System

Purpose: replace the broad plugin service locator with typed extension points.

Status: in progress. The public extension surface now favors typed domain registries, and the broad
feature-contribution context has been moved behind internal/test-only entry points while remaining
first-party users are migrated.

### Work

- Define a small extension host with explicit lifecycle:
  - install
  - activate
  - update
  - deactivate
  - dispose
- Replace broad plugin context methods with typed contribution APIs:
  - command contribution
  - capability contribution
  - edit contribution
  - syntax contribution
  - decoration contribution
  - gutter contribution
  - block contribution
  - injected row contribution
  - view contribution for mounted DOM and viewport integration
- Keep input contribution out of the public API unless a concrete use case proves it belongs there.
- Remove generic string `getFeature<T>(id)` access.
- Replace stringly feature IDs with typed capability tokens.
- Make contribution disposal mandatory and idempotent.
- Split public and internal surfaces:
  - public: `@singapore-editor/core/extensions`, root `@singapore-editor/core`, and documented editor entry points
  - internal/test-only: `EditorPluginHost`, host events, `EditorInternalPluginContext`, and
    `EditorFeatureContribution*`
- Add extension isolation tests:
  - duplicate command handlers
  - duplicate gutter ids
  - block provider conflicts
  - decoration source ownership conflicts
  - disposal order
  - plugin activation failure
  - contribution factory failure
  - contribution `update()` failure
  - contribution disposal failure
  - editor destruction
- Contain failures after activation:
  - contribution factory failures are logged and skipped
  - contribution update failures are logged and the failed contribution is removed
  - contribution disposal failures are logged while remaining disposal continues

### Completed in Current Pass

- `EditorPlugin` now has `install`, `activate`, `update`, `deactivate`, and `dispose` lifecycle
  hooks.
- `EditorPluginContext` exposes typed public registries for commands, capabilities, edits,
  decorations, gutters, blocks, injected rows, syntax/highlighters, and view contributions.
- `registerEditorFeatureContribution` is no longer public; it is available only through
  `EditorInternalPluginContext`.
- Redundant view-overlay type aliases and registration APIs were removed in favor of
  `EditorViewContribution`.
- Conflict tests cover duplicate command handlers, duplicate gutter ids, duplicate block provider
  ownership, and duplicate decoration source ownership.
- Failure containment tests cover contribution factory, update, and disposal failures.
- Minimap and diff now use public domain/view contribution APIs where applicable.

### Remaining Work

- Migrate the remaining first-party users of `EditorInternalPluginContext` and
  `EditorFeatureContribution*` to domain registries or `EditorViewContribution`.
- Delete the internal feature-contribution bridge once no first-party feature depends on the broad
  context.
- Keep auditing public exports so `@singapore-editor/core/extensions` stays powerful but intentional.

### Must Delete

- Stringly typed service locator features.
- Public plugin APIs that expose editor internals for convenience.
- Manual/reference-counted plugin behavior that obscures ownership.
- Before Phase 8 exit: `EditorInternalPluginContext` and `EditorFeatureContribution*` usage in
  first-party packages.

### Exit Criteria

- A plugin cannot mutate unrelated editor subsystems by accident.
- Plugin failure is contained and observable.
- Extension APIs describe domain contributions, not implementation escape hatches.
- Public exports make the supported extension API clear; internal/test-only exports are named and
  temporary.

## Phase 9: Minimap and Diff

Status: in progress

Purpose: make secondary surfaces consume editor projections instead of cloning editor logic.

### Initial Slice

- Added `@singapore-editor/core/secondary-views` as the explicit entry point for secondary surfaces.
- Defined `EditorSecondaryViewProjection`, which carries snapshot identity, text snapshot access,
  visible line model, syntax tokens, selections, fold summaries, viewport, metrics, and optional
  secondary-view decorations.
- Moved diff's standalone virtualized panes and minimap's worker scheduling off the deprecated
  `@singapore-editor/core/internal` bridge and onto the secondary-view entry point.
- Routed minimap worker document payload creation through the shared secondary-view projection, with
  full-text materialization occurring through the projection's explicit text boundary.
- Added focused tests proving the projection does not read lazy `fullText` when a `TextSnapshot` is
  available, and proving minimap opens documents through that text snapshot path.
- Added `MinimapDocumentSummaryPayload` so minimap open/replace/edit requests carry exact document
  length, line starts, and clipped line summaries instead of serializing full document text.
- Reworked the minimap worker renderer to store summarized lines, render from those summaries, and
  keep section-header scanning on summarized line input.
- Optimized minimap content edits to send affected-line summary patches instead of whole-document
  line summaries, while still preserving exact text length and line starts for layout.
- Moved diff syntax highlighting onto per-source syntax service requests so both Tree-sitter and
  Shiki consume full old/new file snapshots and project syntax result tokens into diff rows.
- Added regression coverage for compact large-file diff projections and rapid minimap edit
  coalescing through summary and token patch payloads.

### Remaining Work

- Replace diff's private scroll/selection primitives with shared secondary-view helpers where the
  current text-surface wrapper is still too low-level.

### Work

- Define a shared projection stream for secondary views:
  - snapshot identity
  - visible or summarized line model
  - syntax colors
  - selections
  - decorations
  - fold summaries
- Rewrite minimap to consume projection summaries instead of sending full document text by default.
- Give minimap rendering scheduler-owned work identities and cancellation.
- Rewrite diff syntax handling to use the syntax service contract.
- Make diff selection and scroll sync use shared view-model primitives where possible.
- Remove direct dependence on virtualization internals from diff.
- Add tests for large diff files and minimap updates after rapid edits.

### Must Delete

- Minimap full-document truth duplication as the default path.
- Diff as a second private editor pipeline.
- Direct imports of rendering internals from feature packages.

### Exit Criteria

- Minimap and diff can be explained as consumers of editor projections.
- Neither package owns an independent syntax pipeline.
- Neither package depends on core internals through public leaks.

## Phase 10: LSP and Language Packages

Purpose: stop clone-and-modify language server architecture.

### Work

- Split LSP into:
  - protocol client
  - workspace/document synchronization
  - transport
  - feature adapters
  - editor integration
- Keep `@singapore-editor/lsp` headless: it must not export `EditorPlugin` factories or
  `createLspPlugin`.
- Break the `client` <-> `workspace` import cycle by depending on interfaces.
- Replace object-identity cancellation with request IDs or typed handles.
- Create one generic `@singapore-editor/lsp-plugin` editor-integration package.
- Make TypeScript support an adapter package over the shared integration.
- Name the shared specialization hook `createLanguageServerAdapterPlugin`; reserve
  `createLanguageServerPlugin` for custom servers.
- Keep `@singapore-editor/typescript-lsp` as the public TypeScript product package. It
  owns the TS worker/server, TS diagnostics, TS path/source filters, and a thin
  `createTypeScriptLspPlugin` wrapper that configures `@singapore-editor/lsp-plugin`.
- Move shared completion, hover, diagnostics, and workspace behavior into one implementation.
- Add conformance tests for LSP open/change/save/close ordering.
- Add timeout and cancellation tests.

### Must Delete

- Duplicated `lsp-plugin` and `typescript-lsp` implementations.
- Any `createLspPlugin` API or editor-plugin exports from `@singapore-editor/lsp`.
- Client/workspace circular imports.
- Cancellation APIs based on caller-retained params object identity.
- Console logging as default error handling.

### Exit Criteria

- TypeScript LSP support is a specialization, not a fork.
- The TypeScript package exposes a complete usable plugin without owning generic
  editor integration or cloned LSP feature controllers.
- The LSP dependency graph is acyclic.
- Request lifetime and cancellation are explicit.

## Phase 11: Worker Topology

Purpose: make workers resources with explicit ownership instead of global side effects.

Current worker owner cache limits and restart behavior are documented in
[Worker Topology](architecture/worker-topology.md).

### Work

- Define worker owner objects for:
  - document worker
  - syntax worker
  - minimap worker
  - optional tokenizer worker
- Give each owner:
  - lifecycle state
  - request handles
  - cancellation
  - disposal acknowledgement
  - cache accounting
  - error channel
- Replace module-global workers with owned worker pools or explicit singletons created by the editor
  runtime.
- Keep Tree-sitter and Shiki compatibility singleton helpers removed from first-party worker paths.
- Define source chunk ownership and retention outside the Tree-sitter client.
- Add worker crash and restart behavior.
- Add tests for editor disposal while work is in flight.

### Must Delete

- Hidden module-global worker state.
- Broad compatibility singleton worker exports after first-party callers have migrated to explicit
  owners.
- Fire-and-forget disposal where correctness depends on disposal.
- Cache retention policies buried in worker implementation files.

### Exit Criteria

- Worker state can be inspected and disposed through a typed owner.
- Disposing an editor cannot leave document-owned worker state alive silently.
- Cache limits are documented and tested.

## Phase 12: Test and CI Hardening

Purpose: make the repository enforce the architecture it claims.

### Work

- Ensure every package has intentional scripts:
  - `typecheck`
  - `lint`
  - `test`
  - `build`, where applicable
- Add CI jobs for:
  - install
  - typecheck
  - lint
  - tests
  - package cycle check
  - source cycle check
  - public API check
  - browser rendering tests
  - performance smoke tests
- Add focused regression suites for:
  - piece table immutability
  - anchor resolution
  - transaction undo/redo
  - scheduler cancellation
  - syntax stale-result dropping
  - worker disposal
  - virtualization view model
  - input state machine
  - plugin lifecycle
  - minimap projection consumption
  - LSP request lifetime
- Add fixtures for large files, long lines, dense decorations, folds, and multi-cursor edits.

### Must Delete

- Root scripts that imply coverage the packages do not provide.
- Packages without explicit test intent.
- CI that only deploys the demo app.

### Exit Criteria

- `bun run test` means repository tests, not a partial convention.
- CI blocks architectural regressions.
- Performance regressions have at least smoke-level visibility.

## Phase 13: Documentation Reset

Purpose: make documentation describe reality and decisions, not aspirations.

### Work

- Rewrite `ARCHITECTURE.md` around the target architecture after Phases 1-5 establish the new
  boundaries.
- Update storage docs to match the real piece-table deletion and snapshot behavior.
- Update syntax docs to describe the actual syntax ownership model.
- Update display docs to describe the implemented view-model/layout/renderer split.
- Add lifecycle diagrams for:
  - editor construction/disposal
  - transaction application
  - syntax request
  - viewport render
  - extension contribution
  - worker disposal
- Add "rejected designs" sections for major decisions so old mistakes are not rediscovered.

### Must Delete

- Claims that a subsystem is "locked" when the implementation violates the claim.
- Open-question sections that remain after implementation has chosen a path.
- Documentation that describes future architecture as current architecture.

### Exit Criteria

- Docs and implementation agree.
- New engineers can understand ownership without reading the whole codebase.
- Architecture docs have enough specificity to reject bad changes.

## Migration Strategy

The phases are ordered to reduce risk:

1. Contain public API before moving internals.
2. Fix document truth before rebuilding projections.
3. Install scheduler ownership before migrating syntax, minimap, and diff.
4. Rebuild rendering boundaries before rewriting display features.
5. Replace plugin APIs only after the new typed registries exist.
6. Rewrite secondary surfaces after the projection pipeline is stable.

Compatibility shims are allowed only when they are named, tested, and assigned a deletion phase.

## Stop Conditions

Pause the refactor if any of these happen:

- A phase requires changing public API that has not been inventoried.
- A rewritten subsystem cannot match existing correctness tests.
- A performance benchmark regresses without an explicit tradeoff decision.
- A compatibility shim grows new features.
- A worker lifecycle cannot be expressed with ownership and disposal semantics.

## Success Criteria

The recovery is complete when:

- A document edit has one authoritative transaction path.
- Derived projections are snapshot-tagged and owned by projection systems.
- Rendering consumes a view model and does not secretly become the document model.
- Workers have explicit owners and lifetimes.
- Extensions contribute through narrow typed APIs.
- Minimap and diff are consumers, not parallel editors.
- LSP support is shared core plus adapters, not cloned packages.
- Public API is small, intentional, and documented.
- CI enforces typecheck, lint, tests, cycles, public API, and browser rendering checks.
- The architecture docs describe the code that exists.
