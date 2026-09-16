# Plan 122: Composable, full-power plugins with selective execution

Status: proposed; research and API design first; implementation has not started.
Requested: 2026-09-16. Owners: Fregat and Singapore.

This is a cross-repository plan, not an implementation or a settled API signature.
[Root PLAN.md](../PLAN.md) remains the sole authority for execution order. This proposal
adds no priority over existing lanes. Its phases describe internal dependencies only.

Recorded baselines: Fregat `465760323da4feb260e923b6d502794b0518ca84` and Singapore
`16736ade269981a9d7566013f57ee1952bcffcdc`. Reconcile current source, HEADs, and dirty diffs
before implementation; do not treat either repository's older plan baselines as current.

## Outcome and settled requirements

Build a plugin system that is simple to author, open-ended to compose, and inexpensive when
installed functionality is irrelevant to the current operation. A plugin is a package of
behavior, not the unit that receives every editor update.

1. **One `createPlugin` authoring entrypoint.** No required family of `createXPlugin`
   constructors, nested contribution factories, or parallel host/editor definitions for the
   same editor feature. Library authors may export convenience functions, but those are
   compositions, not new core plugin categories. Renaming the current ceremony is insufficient.
2. **Composable building blocks, not a fixed feature menu.** Plugins can combine state,
   subscriptions, commands, rendering, and other plugins. A third-party library can define a
   typed extension point that another library contributes to without modifying Singapore.
   Built-in features should use these same building blocks.
3. **Full power is intentional.** Trusted client code can access the actual editor, DOM,
   React surfaces, and host services. Trusted backend code can use the filesystem, network,
   dependencies, and subprocesses with the application's OS permissions. Do not impose a
   sandbox, iframe-only UI, or mandatory separate extension host as the default architecture.
4. **Isomorphic packaging and services.** One installable package can contain shared logic
   and client/backend behavior. Common services should be usable from either side where their
   semantics support that. DOM operations remain client-local; backend work runs on the
   workspace machine. Isomorphic does not mean one shared heap or synchronous remote calls.
5. **Selective execution is fundamental.** Installed but uninterested pieces must not receive
   callbacks, run selectors, materialize plugin payloads, or send messages for that operation.
   A generic `update()` broadcast with early returns inside every plugin is not the default.
6. **Measure before choosing internals.** Compare CodeMirror and Monaco before fixing the API.
   Performance is the decisive runtime tradeoff; full access and composability are requirements,
   not features to remove for convenience. Preserve document, undo, input, and disposal correctness.

These are product decisions. The precise primitive names, object shape, dependency mechanism,
configuration syntax, and loading strategy remain design work.

## Current foundations and gaps

| Source | Existing seam and implication |
| --- | --- |
| [Fregat editor assembly](../apps/web/src/features/editor/components/editor.tsx) | Combines built-ins and `additionalPlugins` and passes them to `useEditor`. Extend this integration rather than create another embedded editor. |
| [Fregat built-ins](../apps/web/src/features/editor/utils/plugins.ts) | Assembles feature-specific factories. This is a migration target, not the desired public authoring contract. |
| [Singapore plugin contracts and host][sg-plugins] | Already provides lifecycle, disposables, contribution contexts, single-owner capabilities, and multi-provider language features. Reuse useful internals while simplifying the public layer. |
| [Singapore React adapter][sg-react] | Synchronizes plugin configuration through `editor.setPlugins`. Preserve stable definition identity and live attachment without recreating document state. |
| [Singapore view contributions][sg-views] | The viewport lane checks a dedicated subscriber set before constructing its payload. General updates construct a snapshot and visit all view contributions. This is an optimization candidate, not a measured latency diagnosis. |
| [Singapore command IDs][sg-commands] and [Fregat keymap adapter](../apps/web/src/keymap/editor-keymap.ts) | Editor IDs are a closed union; Fregat disables the standalone editor keymap. Custom commands need typed IDs and integration with Fregat's existing command/focus routing. |
| [Plan 099](099-document-contributions.md) | Owns canonical buffer publication and shared document synchronization. It remains proposed. Reuse its owner and progress contracts; do not add a second document bus or worker-sync layer. |

No rewrite of the text buffer, document identity, transaction model, rendering engine, or
application command bus is authorized by this plan. Preserve their contracts while making
customization easier. Full access does not imply that every internal property is a stable API.

## Research gate: CodeMirror and Monaco before API selection

Use primary documentation and source, pin the versions used in experiments, and record the
actual implementation behind each claimed behavior. The following are starting references,
not a completed comparative benchmark:

| Reference | What to study and what not to assume |
| --- | --- |
| [CodeMirror configuration][cm-config] | Composition, nested extension values, precedence, and partial reconfiguration. Learn how the consumer installs one bundle without wiring its internals. |
| [CodeMirror facets and state][cm-state] | Library-defined channels, combination rules, explicit computed dependencies, and equality. Distinguish avoided computation from graph traversal or bookkeeping that still runs. |
| [CodeMirror view plugins][cm-view] | Per-view instances, update/destruction, decoration integration, and DOM read/write phases. Its general view-update callback is not proof that notification fan-out is selective. |
| [Monaco editor API][monaco-editor] | Direct editor operations, distinct content/selection/scroll events, actions, widgets, and decoration ownership. Inspect editor, model, and global registration lifetimes separately. |
| [Monaco completion registration][monaco-completion] | Typed provider registration with disposal. Learn ergonomics and scope without copying a feature-specific registration API for every possible extension. |

Implement the same small experiments against candidate Singapore APIs: a named command,
a selection-driven decoration, and bounded modal input. Add the shared-channel and backend
proofs below before calling the chosen contract complete.

Compare a declarative composition-first shape with a scoped setup/subscription shape. Both
must use `createPlugin`, accept reusable pieces, expose the real editor when needed, and avoid
mandatory generic updates. Record required imports, distinct concepts, nesting, ownership code,
configuration behavior, inferred types, and measured runtime cost. Do not select by line count alone.

Produce one decision record with examples, rejected alternatives, migration implications, and
benchmark evidence. It must explain what a third-party library can extend without asking core
for a new top-level method. Do not add a speculative forest of APIs to satisfy an inventory.

## Candidate authoring model

The following shows composition only. `name` and `extensions` are illustrative fields, not
newly implemented exports or an approved final signature:

```ts
export const annotations = createPlugin({
  name: 'acme.annotations',
  extensions: [
    annotationState,
    annotationGutter,
    annotationCommands,
  ],
})
```

A primitive and a bundle should both be installable values. Definitions are reusable; mutable
instances have an explicit lifetime. Repeated React renders must not reinstall them. Shared
pieces need a defined identity, deduplication policy, configuration conflict policy, and
reference-counted ownership when more than one bundle requires them.

Keep the conceptual vocabulary small:

- **State and derivation:** local state and cached computed values with explicit dependencies.
- **Subscriptions and effects:** react only to declared inputs, or to an explicitly requested
  catch-all stream. Generic observation is opt-in and exposes its cost.
- **Typed contributions:** libraries define channels and specify whether inputs compose,
  choose by precedence, or require a single owner. Commands and rendering use these pieces
  plus the real editor operations; they are not a closed list of plugin classes.
- **Composition and lifetime:** bundles, configuration, activation, and owned disposal.

These are semantic responsibilities, not a demand for four new public constructor families.
A convenient scoped context may collect registrations, but it must not pretend to collect
arbitrary DOM listeners, timers, native processes, or other raw side effects automatically.
Provide explicit cleanup for resources created outside managed primitives.

## Selective runtime contract

### Resolve subscriptions outside the hot path

At installation or reconfiguration, resolve dependency edges, channel precedence, and routing
indexes by document/view/service ownership. Events should reach interested registrations through
those indexes, not by scanning all plugins, all predicates, or a global selector list.

A single operation can change text and mapped selections together. Publish its actual changed
inputs coherently, schedule each affected dependent once per phase, and distinguish initial
activation from incremental updates. A selection subscriber may legitimately run after an edit
that changes selection; it must not run for a pure scroll.

Dynamic subscriptions must update routing and tear down obsolete edges. Specify ordering,
registration/removal during dispatch, error handling, reentrancy, dependency cycles, and
invalidation propagation. No dispatch may observe a half-applied configuration.

### Avoid work before deciding who needs it

Do not flatten full text, rebuild a rich snapshot, enumerate every decoration, or serialize an
RPC payload before checking demand. Reuse immutable revision readers, edit deltas, changed ranges,
and one shared lazily computed value per compatible input revision. Core-required rendering work
is separate from additional plugin payload work; the zero-subscriber claim applies to the latter.

Computed pieces declare dependencies and equality. Recompute only affected values and stop
propagation when their relevant output is unchanged. An arbitrary selector over the entire editor
must not silently become a cheap-looking subscription evaluated on every event.

The design target is dispatch work proportional to interested registrations and affected dependency
edges, not total installed plugin count. Measure the indexing cost too; do not claim constant time
for a dependency graph merely because unrelated callbacks stopped running.

### Preserve scheduling semantics

Input interception and edits that must affect the current transaction remain synchronous and
client-local. Do not send keystrokes through RPC. Keep IME, composition, paste, readonly handling,
undo grouping, and command precedence coherent when a plugin consumes or delegates input.

Visual work may coalesce to a frame and use explicit DOM measurement/write phases. It must still
render the latest state and preserve Singapore's paint/snapshot restoration contract. Skipping a
paint is different from dropping a document revision or a state transition.

Expensive analysis can use an existing worker or backend with cancellation, latest-result policy,
and revision/generation validation. Independent services must not share one blocking queue.
Reuse the existing scheduler and Plan 099's synchronization owner instead of inventing plugin-local
journals. Workers and subprocesses are available tools, not compulsory plugin boundaries.

A trusted same-thread plugin can still block the app or mutate state directly. Performance guarantees
cover the platform's dispatch and managed primitives, not arbitrary third-party code. Instrument and
attribute actual work rather than describing full-power execution as preemptible or sandboxed.

## Ownership across Singapore and Fregat

| Lifetime | Owner and required behavior |
| --- | --- |
| Package definition | Immutable reusable description; loader owns module/version identity. |
| Workspace backend | Fregat owns activation per confirmed environment/workspace, shared services, and managed child processes. Opening another editor must not spawn another backend service unnecessarily. |
| Document | Existing buffer owner retains canonical text/history/revisions and shared analysis. Retained documents do not disappear merely because a view closes. Coordinate with Plan 099. |
| Editor view | Singapore owns per-view state, cursor/input mode, DOM, viewport, and decorations. Two splits must not accidentally share view state. |
| Client application | Fregat owns menus, panels, settings integration, focused-target command routing, and supported client surfaces. |

The editor-facing definition must work in standalone Singapore and through Fregat without a
second author-written wrapper. Fregat supplies loading, service bindings, and attachment to
existing/future eligible editor views. It does not introduce another Singapore plugin lifecycle.
Expose the actual editor through its live owner, not a new global active-editor singleton.

Document swaps, language changes, temporary unmounts, split views, diff/search/settings surfaces,
and A-to-B-to-A environment switches must have explicit selection and disposal rules. Install
once per matching view, not once per filename, and retain or release document services separately.
Default matching can exclude incidental editors; authors can explicitly opt into supported surfaces.

Namespaced custom commands must travel through Singapore's typed command path and Fregat's current
command bus, palette, keybindings, enablement, and focus targets. Do not restore Singapore's standalone
keymap inside Fregat or create a second application keyboard dispatcher. Resolve conflicts explicitly.

Move replaceable first-party defaults into the same composition/configuration model. Adding external
pieces only at the end of a hard-coded factory array is insufficient for replacing an existing
provider, keybinding, or visual feature. Preserve explicit precedence and cleanup when defaults change.

## Full-stack loading and trust

Package shared code and optional client/backend entries together. The build must separate server-only
imports from browser assets and preserve host-owned singleton dependencies such as React and the
Singapore runtime. Validate module identity, CSS/assets, worker URLs, and compatibility with the host's
actual module resolver. Do not bundle another editor runtime into every plugin.

Start by evaluating in-process browser ESM and in-process Bun backend modules, consistent with the
requested trust model. Compare prebuilt ESM with development-time TypeScript compilation using E025's
loading experiments. Select and document supported runtime/dependency versions from those results;
this plan does not add a new runtime or mandate a compiler.

The shared service API routes locally where possible and uses a typed, asynchronous bridge where
necessary. Specify message validation, errors, cancellation, backpressure, and captured environment,
workspace, document, view, and plugin-generation identity. Do not serialize editor instances or expose
browser APIs on the backend. A result must not land in whichever tab or machine happens to be active
when it arrives. No automatic full-buffer synchronization for a plugin that has no demand.

Reload replaces owned registrations without closing documents or resetting selection/undo history.
Invalidate pending work before disposing a generation, release shared dependencies only after their
last owner, and report partial activation failures. Distinguish rollback of managed registrations
from irreversible file writes, arbitrary module side effects, and retained ESM cache entries. Bound
or document reload retention; use a recoverable failure state when honest rollback is impossible.

Installation means trusting executable code with application access. Do not silently execute a plugin
merely because a cloned repository names it. Reuse application/machine-scoped execution settings and
provide startup with third-party plugins disabled. No permission manifest is presented as confinement.
The trust model is decided; this is execution consent and recovery, not a new sandbox design project.

Editor primitives remain runtime-neutral where possible. Browser-only UI can declare that target;
portable command/service pieces can be shared by other clients. This plan does not promise that React
or DOM plugins automatically render in Swift or the TUI. Agent-native plugins and MCP remain separate
integration adapters; [Plan 087](087-stateless-mcp.md) retains MCP ownership.

## Required proof plugins

| Proof | What must be demonstrated |
| --- | --- |
| Alignment command | Namespaced command, keybinding/palette routing, multicursor batch edit, and one undo. No subscriptions or payload generation while unused. |
| Annotation ecosystem | One package defines a typed annotation channel; two independent plugins contribute. Shared analysis feeds a gutter and view decoration without new core annotation APIs or duplicate analysis. |
| Modal input | Normal/insert/operator-pending behavior, native insert-mode delegation, composition, focus changes, readonly views, and teardown in two splits. No competing global DOM listeners. |
| Backend formatter | One package uses a native subprocess on the owning workspace machine, formats the current dirty buffer, and applies version-checked edits through normal transactions. Prove delayed results, cancellation, and environment switching. |
| First-party migration | Migrate a representative command, view feature, and shared analysis consumer through the selected contract. Remove their superseded registration path in the same migration unit. |

The small examples must not grow into five bespoke plugin architectures. Record every additional
primitive each example requires; add one only for a demonstrated missing composition capability.

## Delivery phases and existing-plan reconciliation

### Phase 0: Inventory, comparison, and calibrated controls

Refresh both repository baselines and source links. Inventory public/internal hooks, first-party
consumers, subscription fan-out, payload creation, and current timing/allocation evidence. Run the
CodeMirror/Monaco experiments and candidate API comparisons before selecting a signature.

Reconcile E025 through E028 in a paired Singapore planning change before their implementation:

- [E025][e025] gains the single-entrypoint, composition, selective-execution, isomorphic packaging,
  and full-power requirements. Its current loader-focused text does not record those decisions.
- [E026][e026] owns command metadata and extensible IDs, coordinated with Fregat's command bus.
- [E027][e027] owns the simple primitive/hook contract, typed library-defined extension points,
  direct editor access, notification ownership, and supported versus unstable API documentation.
- [E028][e028] supplies the modal-input proof before broader loader/API stability claims.

Keep E025's lifecycle/reload work, but do not preserve a narrow authoring API simply because it exists.
Plan 099's document-publication semantics remain authoritative; its factory-shaped sketches are not a
reason to retain author ceremony. Coordinate actual overlapping changes, not two incompatible runtimes.
Coordinate decoration semantics with [Plan 111](111-editor-decorations.md) rather than start a second
rendering redesign. Baseline research and view-local prototypes need not wait for all of Plan 099;
production shared-document integration must use its agreed publication contract.

Deliverables: one source-backed decision record, chosen candidate examples, benchmark controls, and
updated paired-plan dependencies. Root PLAN.md must record production scheduling when that work starts.

### Phase 1: Singapore composition and selective primitives

Implement only the primitives justified by the proofs. Define identity, scoped state, typed custom
channels, precedence, dependency routing, managed cleanup, and synchronous input contracts. Build and
test package exports. Establish deterministic fan-out/payload counters before optimizing timings.

### Phase 2: Fregat editor and command integration

Bind the definitions to current and future editor owners using the existing integration. Pass actual
editor access and host services without introducing a second lifecycle. Integrate custom commands,
settings, and replaceable defaults through existing registries. Prove standalone/hosted parity,
multiple views, document swaps, and environment ownership.

### Phase 3: Runtime package loading and full-stack proof

Implement the loading strategy selected in Phase 0. Add enable/disable/reload and generation handling,
module/dependency resolution, and the service bridge. Complete the backend formatter proof and recovery
from failed activation, disconnected clients, and disposed owners. Keep no-plugin startup lightweight.

### Phase 4: Migration, performance gates, and documentation

Migrate representative built-ins, remove obsolete paths in those migration units, and run the proof
matrix against the real app. Publish author examples, lifecycle/scope rules, measured costs, known
limitations, and the remaining migration inventory. Do not call the migration complete while first-party
features still maintain an alternate public authoring model without an explicit follow-up owner.

## Verification and acceptance

### Deterministic routing and correctness gates

| Scenario | Required result |
| --- | --- |
| Pure scroll with selection-only pieces installed | Zero selection callbacks/selectors and zero selection-specific payload creation. |
| No subscribers for a custom channel | No channel-specific snapshot, full-text materialization, serialization, worker message, or polling task. |
| Unused command-only plugin | Handler is called only on invocation; no per-edit update callback is installed on its behalf. |
| Shared derived input is unchanged | Downstream recomputation/notifications stop according to the declared equality contract. |
| One operation changes several inputs | Observers see coherent committed state; duplicate dependencies do not schedule duplicate work in a phase. |
| Same document in two views | Shared compatible analysis runs once per demanded revision; view state remains independent. |
| Disable/reload or dependency removal | No orphaned managed commands, listeners, decorations, tasks, or child processes; shared dependencies survive remaining owners. |
| Stale backend/worker result | Rejected after a document revision, environment, or plugin-generation mismatch; cancellation is not the only guard. |
| Activation failure and disposal races | Explicit error/recovery state; no partial replacement disguised as success or mutation of another owner's state. |

### Measured performance gates

Measure both fan-out and actual latency. Use identical existing small/large/long-line fixtures with
0, 10, 100, and 1,000 inert or irrelevant pieces while holding interested subscribers constant.
Separately scale interested subscribers to expose real work. Measure cold activation, reconfiguration,
steady typing, selection, scroll, bulk edits, multiple views, hidden retained documents, and repeated
reloads. Include a deliberately broad observer as a control, not as the default API.

Record p50/p95/p99 dispatch and input-to-paint latency, allocations/GC, snapshot/text materialization,
serialization/message counts, cold bundle weight, and retained managed resources. Track per-piece work
with opt-in profiling so production instrumentation does not create another update tax.

Calibrate unchanged controls before setting numeric regression limits. Preserve the existing input
latency and paint gates; do not invent hardware-independent millisecond promises or claim measured
speedups from source inspection. At fixed interested work, unrelated plugin count must not increase
callback/payload counters, and runtime overhead must stay inside the calibrated control envelope.
If indexing or derivation bookkeeping scales with all installed pieces, revise the design.

### Test and evidence workflow

Build Singapore's affected public packages and run focused export, lifecycle, routing, dependency,
command, and input tests. Reuse existing lifecycle/public-API coverage referenced by E025. Typecheck
Fregat against those built exports and add focused host tests for routing, owner changes, and loading.
Use real-browser tests for keyboard/IME, layout, and reload; unit tests alone cannot prove them.

For actual Fregat UI/performance changes, use the existing `agent:browser` scenarios and structured
logs, including before/after traces with comparison, and inspect the screenshots. Reuse the running
dev server and existing verification skill. Record exact commits, commands, environment, and evidence
paths. Report baseline failures and unavailable checks rather than treating them as passes.

This planning PR changes Markdown only. Its checks are source/reference review and diff inspection;
it does not claim that the experiments, implementation tests, or performance gates have already run.

## Scope boundaries

No marketplace, signing infrastructure, VS Code compatibility layer, editor replacement, automatic
portability of arbitrary UI, new agent plugin engine, or OS sandbox is part of the first delivery.
Do not expand API surface merely to imitate another editor. Further primitives follow demonstrated
needs and measured costs, while keeping extension points open to third-party composition.

Completion means the chosen `createPlugin` contract, selective runtime, Fregat attachment, full-stack
proof, and required verification all work together. Landing a convenience wrapper or loader alone
is not completion of this plan.

[sg-plugins]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/packages/editor/src/plugins.ts
[sg-react]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/packages/react/src/index.ts
[sg-views]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/packages/editor/src/editor/viewContributions.ts
[sg-commands]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/packages/editor/src/editor/commands.ts
[e025]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/plans/e025-runtime-plugins.md
[e026]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/plans/e026-command-metadata.md
[e027]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/plans/e027-extension-hooks.md
[e028]: https://github.com/ShaulLavo/singapore/blob/16736ade269981a9d7566013f57ee1952bcffcdc/plans/e028-modal-input-prototype.md
[cm-config]: https://codemirror.net/examples/config/
[cm-state]: https://github.com/codemirror/state/blob/main/src/facet.ts
[cm-view]: https://github.com/codemirror/view/blob/main/src/extension.ts
[monaco-editor]: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html
[monaco-completion]: https://microsoft.github.io/monaco-editor/typedoc/functions/editor_editor_api.languages.registerCompletionItemProvider.html
