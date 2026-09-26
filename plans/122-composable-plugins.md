# Plan 122: Composable, full-power plugins with selective execution

Status: RESEARCH DONE 2026-09-26 — Phase 0 comparison, measured controls and the selected
`createPlugin` shape are below; the evidence is in [Phase 0 research](../docs/composable-plugins/phase-0-research.md).
Both owner questions are decided (below). Phases 1 and 2 done 2026-09-26 in wave 2, lane E1:
[singapore#50](https://github.com/ShaulLavo/singapore/pull/50) (lifecycle ownership, D7) and
[singapore#51](https://github.com/ShaulLavo/singapore/pull/51) (per-input dispatch: D1–D4 counters in
`viewContributionDispatch.browser.test.ts`; `bench:dispatch` T1 34–38 → 1.0–1.5 µs, T2 71–149 → 18–21 ns
per piece). Five Editor and four Platform view contributions declare inputs; the rest stay on every
kind until their owners classify them (T4's "undeclared 0" is not met yet).
Phases 3 and 4 done 2026-09-26 (lane E1): [singapore#53](https://github.com/ShaulLavo/singapore/pull/53) and
[#54](https://github.com/ShaulLavo/singapore/pull/54) (`createPlugin`, the view scope, inputs, `derive`,
state, channels, `uses`; occurrence highlight, bracket match and document links migrated), and
[#55](https://github.com/ShaulLavo/singapore/pull/55) (E026 catalog, contributed commands under the plugin's
name; client-core builds its editor table from the catalog). Phase 4 leaves Platform's runtime command
segment for contributed commands (palette, keybinding table, recorder) to phase 6, when Platform first
attaches a `createPlugin` plugin.
Requested: 2026-09-16. Owners: Fregat and Singapore.

This is a cross-repository plan, not an implementation or a settled API signature.
[Root PLAN.md](../PLAN.md) remains the sole authority for execution order. This proposal
adds no priority over existing lanes. Its phases describe internal dependencies only.

Research baselines: Fregat `c130dd35a` and Singapore (Editor) `74e76bef`. Reconcile current
source, HEADs, and dirty diffs before implementation.

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

| Source                                                                                                    | Existing seam and implication                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Fregat editor assembly](../apps/web/src/features/editor/components/editor.tsx)                           | Combines built-ins and `additionalPlugins` and passes them to `useEditor`. Extend this integration rather than create another embedded editor.                                                                  |
| [Fregat built-ins](../apps/web/src/features/editor/utils/plugins.ts)                                      | Assembles feature-specific factories. This is a migration target, not the desired public authoring contract.                                                                                                    |
| [Singapore plugin contracts and host][sg-plugins]                                                         | Already provides lifecycle, disposables, contribution contexts, single-owner capabilities, and multi-provider language features. Reuse useful internals while simplifying the public layer.                     |
| [Singapore React adapter][sg-react]                                                                       | Synchronizes plugin configuration through `editor.setPlugins`. Preserve stable definition identity and live attachment without recreating document state.                                                       |
| [Singapore view contributions][sg-views]                                                                  | The viewport lane checks a dedicated subscriber set before constructing its payload. Every other update builds a snapshot and visits all view contributions; measured costs are in the research findings below. |
| [Singapore command IDs][sg-commands] and [Fregat keymap adapter](../apps/web/src/keymap/editor-keymap.ts) | Editor IDs are a closed union; Fregat disables the standalone editor keymap. Custom commands need typed IDs and integration with Fregat's existing command/focus routing.                                       |
| [Plan 099](099-document-contributions.md)                                                                 | Owns canonical buffer publication and shared document synchronization. It remains proposed. Reuse its owner and progress contracts; do not add a second document bus or worker-sync layer.                      |

No rewrite of the text buffer, document identity, transaction model, rendering engine, or
application command bus is authorized by this plan. Preserve their contracts while making
customization easier. Full access does not imply that every internal property is a stable API.

## Research gate: CodeMirror and Monaco before API selection

Done 2026-09-26: versions pinned, implementation cited and the dispatch model measured in all three
editors ([Phase 0 research](../docs/composable-plugins/phase-0-research.md)). The references were:

| Reference                                           | What to study and what not to assume                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [CodeMirror configuration][cm-config]               | Composition, nested extension values, precedence, and partial reconfiguration. Learn how the consumer installs one bundle without wiring its internals.                              |
| [CodeMirror facets and state][cm-state]             | Library-defined channels, combination rules, explicit computed dependencies, and equality. Distinguish avoided computation from graph traversal or bookkeeping that still runs.      |
| [CodeMirror view plugins][cm-view]                  | Per-view instances, update/destruction, decoration integration, and DOM read/write phases. Its general view-update callback is not proof that notification fan-out is selective.     |
| [Monaco editor API][monaco-editor]                  | Direct editor operations, distinct content/selection/scroll events, actions, widgets, and decoration ownership. Inspect editor, model, and global registration lifetimes separately. |
| [Monaco completion registration][monaco-completion] | Typed provider registration with disposal. Learn ergonomics and scope without copying a feature-specific registration API for every possible extension.                              |

The named command, the selection-driven decoration and bounded modal input, plus the annotation
channel, were written against both candidate shapes and type-checked; running them on Singapore is
phases 3–5 below, and the backend proof is phase 8. The decision record, examples, rejected
alternatives and what a third-party library can extend without a new core method are in the
research doc.

## Selected authoring model

Selected in Phase 0 (decision record in the research doc): one `createPlugin` with static
declarations plus a scoped per-view setup. A composition-first shape (every capability a piece in
an `extensions` array) was written for the same four examples and type-checked; it needed 10
constructors against 4, threaded `view` through every callback, and kept per-view state in module
values, which is how E027's factory-state bug happens. Dispatch cost is the same for both.

```ts
export const modal = createPlugin({
  name: 'acme.modal', // namespace and dedup identity
  uses: [wordMotions], // bundles: identity dedup, ref-counted ownership, order is precedence
  commands: [enterInsert], // E026 declarations: data, known before any editor exists
  view(scope) {
    // once per matching editor view; everything registered here is owned by the scope
    const mode = scope.state<Mode>({ kind: 'normal', count: 0 })
    scope.handle(enterInsert, () => mode.set({ kind: 'insert' }))
    scope.keyParticipant((event, context) =>
      mode.get().kind === 'insert' ? 'delegate' : 'consume',
    )
  },
  // document(scope) arrives with Plan 099 unit 2; backend with the loader phase
})
```

The scope carries `editor` (the live editor, labelled unstable), `read` and `watch` over typed
inputs (`selection`, `text`, `viewport`, `tokens`, `theme`, `document`) and over inputs built with
`derive` (recompute on change, stop on equality), `provide` to a library-defined channel, `handle`, `decorations`, `keyParticipant`, `textGate`,
`applyEdits`, `state`, `onDispose` and `own`. Channels are the existing tokens with a public change
subscription and a `one`, `many` or `combine` policy, so a third-party library defines an extension
point, others contribute, and core adds no method. `onDispose` is explicit cleanup for raw DOM
listeners, timers and processes; the scope does not claim to collect them. `createPlugin` lowers to
the existing `EditorPlugin` host, so there is no second lifecycle. The full contract, the rules for
dynamic subscriptions and the rejected alternatives are in the research doc.

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

| Lifetime           | Owner and required behavior                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package definition | Immutable reusable description; loader owns module/version identity.                                                                                                                   |
| Workspace backend  | Fregat owns activation per confirmed environment/workspace, shared services, and managed child processes. Opening another editor must not spawn another backend service unnecessarily. |
| Document           | Existing buffer owner retains canonical text/history/revisions and shared analysis. Retained documents do not disappear merely because a view closes. Coordinate with Plan 099.        |
| Editor view        | Singapore owns per-view state, cursor/input mode, DOM, viewport, and decorations. Two splits must not accidentally share view state.                                                   |
| Client application | Fregat owns menus, panels, settings integration, focused-target command routing, and supported client surfaces.                                                                        |

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

| Proof                 | What must be demonstrated                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alignment command     | Namespaced command, keybinding/palette routing, multicursor batch edit, and one undo. No subscriptions or payload generation while unused.                                                                                             |
| Annotation ecosystem  | One package defines a typed annotation channel; two independent plugins contribute. Shared analysis feeds a gutter and view decoration without new core annotation APIs or duplicate analysis.                                         |
| Modal input           | Normal/insert/operator-pending behavior, native insert-mode delegation, composition, focus changes, readonly views, and teardown in two splits. No competing global DOM listeners.                                                     |
| Backend formatter     | One package uses a native subprocess on the owning workspace machine, formats the current dirty buffer, and applies version-checked edits through normal transactions. Prove delayed results, cancellation, and environment switching. |
| First-party migration | Migrate a representative command, view feature, and shared analysis consumer through the selected contract. Remove their superseded registration path in the same migration unit.                                                      |

The small examples must not grow into five bespoke plugin architectures. Record every additional
primitive each example requires; add one only for a demonstrated missing composition capability.

## Delivery phases and existing-plan reconciliation

Phase 0 is done (research findings below). The rest is ordered; each phase ships on its own and
carries its own evidence. Sizes: S about a day, M a lane of a few days, L a week or more.

1. **Done (singapore#50).** **Editor: lifecycle ownership (S).** E027's proposed phase 1, unchanged: a context object per
   plugin so late registrations belong to it, a disposable store per contribution released with it
   (including `onDidType` and keymap context keys), bracket-match and merge-conflict state moved into
   `activate`, and E027 checks 1–3. Files: `packages/editor/src/plugins.ts`, `editor/Editor.ts`
   (`createContributionSafely`), `bracketMatchPlugin.ts`, `mergeConflictPlugin.ts`,
   `pluginLifecycle.test.ts`. Owner: Editor.
2. **Done (singapore#51).** **Editor: per-input dispatch (M).** Contributions declare the inputs they act on; each input keeps
   its own subscriber set, as `updateViewport` already does; undeclared means today's catch-all,
   kept explicit. One operation publishes its changed inputs in one pass (fold the `selection`
   notify from `syncDomSelection` into the flush). `requestViewUpdate` re-runs the requester and paint
   capture only. Membership becomes a `Set` (removes the quadratic `includes`). The snapshot is built
   only when a pass has a subscriber. Migrate the 15 Editor and 9 Platform view contributions to
   declare inputs using the table in the research doc. Move the counter matrix into an Editor browser
   test and the back-to-back bench into `examples/stress` as its own suite. Files:
   `editor/viewContributions.ts`, `editor/Editor.ts`, `editor/inputSelectionController.ts`, the
   contribution files, Platform `apps/web/src/features/{editor,workbench,settings}` contributions.
   Owner: Editor, with Platform for its nine. Gates D1–D4, T1, T2, T4.
3. **Done (singapore#53, #54).** **Editor: `createPlugin` and the view scope, experimental (M).** E027 phase 2 built in the selected
   shape: the combined per-view context becomes `ViewScope`; inputs, `derive`, channels with a change
   subscription and `one`/`many`/`combine` policy, `state`, `onDispose`/`own`, `uses` with identity
   dedup and ref-counted ownership, `editor` labelled unstable, a multi-selection read. Lowers onto
   phases 1–2. Proofs: caret-word decoration and the annotation channel (two contributors, one
   consumer). Migrate occurrence highlight, bracket match and document links and delete their
   provider plumbing in the same pass. Marks use `setRangeHighlight` until Plan 111 phase 1 lands
   `registerDecorationSource`, which `scope.decorations` then wraps with an input trigger. Export from
   `@singapore-editor/core/extensions`; `public-api.test.ts` gains the symbols. Owner: Editor. Gates D5–D7.
4. **Done, except the runtime segment (singapore#55).** **Commands (M, cross-repo).** E026 as planned, plus the namespace rule: a contributed ID starts with
   its plugin's `name` and a dot. Then the alignment proof (multicursor batch, one undo) on
   `createPlugin`. Platform gains a runtime command segment: palette, keybinding table, recorder,
   enablement and focus target read plugin declarations
   (`packages/client-core/src/commands/`, `apps/web/src/keymap/`). Owner: Editor then Platform.
5. **Modal input (M).** E028 on `createPlugin`: key participant, text gate, cursor style and the
   `applyEdits` selection list as scope methods, proved in a real browser on both input routes, two
   splits, readonly and IME. Applies owner question 2's key precedence. Owner: Editor.
6. **Fregat attachment (M).** `editor.tsx` takes plugin values; the first-party set becomes one list of
   `createPlugin` values that configuration can replace by name; surfaces are opt-in beyond code tabs
   (diff, search, settings, composer); an application-scoped enable setting and a startup mode with
   third-party plugins off. Scenarios under `scripts/agent/scenarios/` for two splits, document swap
   and A-to-B-to-A environment switch. Owner: Platform. Gate T5.
7. **Document scope (M).** `document(scope)` is Plan 099's document contribution, once per document
   incarnation, with shared analysis once per demanded revision across views; the annotation proof's
   shared analysis moves here. Starts after Plan 099 units 1–2. Owner: Editor and Platform.
8. **Loading and backend (L).** E025's loader (states, generations, reload with owned rollback) with its
   measured comparison of prebuilt ESM and host-compiled TypeScript, an in-process Bun backend entry,
   the typed service bridge with captured environment, document, view and generation identity, and the
   backend formatter proof. The loader is a lazy chunk. Owner: Platform with Editor. Gates T6, T8.
9. **Migration and documentation (M–L).** The remaining first-party plugins move to `createPlugin`
   (about 20 across Editor and Platform), the public `EditorPlugin` and provider kinds go per owner
   question 1, author docs and the measured costs are published, and the counter and dispatch gates
   run in CI. Owner: Editor and Platform.

Paired-plan changes for the Editor repository, to land with phase 1: E027's phase 2 is phase 3 here
and uses its shape; E026 adds the namespace rule; E028 targets `createPlugin`; E025 keeps its loader
and reload work and records the single entry point and full-access decision. Plan 099 stays
authoritative for publication: the `text` input carries its unit-1 transition frame, and phase 7
waits for its unit 2. Plan 111's decoration source gains an input-driven trigger for `selection`.
Root PLAN.md schedules these.

## Verification and acceptance

### Deterministic routing and correctness gates

| Scenario                                         | Required result                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Pure scroll with selection-only pieces installed | Zero selection callbacks/selectors and zero selection-specific payload creation.                                               |
| No subscribers for a custom channel              | No channel-specific snapshot, full-text materialization, serialization, worker message, or polling task.                       |
| Unused command-only plugin                       | Handler is called only on invocation; no per-edit update callback is installed on its behalf.                                  |
| Shared derived input is unchanged                | Downstream recomputation/notifications stop according to the declared equality contract.                                       |
| One operation changes several inputs             | Observers see coherent committed state; duplicate dependencies do not schedule duplicate work in a phase.                      |
| Same document in two views                       | Shared compatible analysis runs once per demanded revision; view state remains independent.                                    |
| Disable/reload or dependency removal             | No orphaned managed commands, listeners, decorations, tasks, or child processes; shared dependencies survive remaining owners. |
| Stale backend/worker result                      | Rejected after a document revision, environment, or plugin-generation mismatch; cancellation is not the only guard.            |
| Activation failure and disposal races            | Explicit error/recovery state; no partial replacement disguised as success or mutation of another owner's state.               |

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

Proposed numbers, from the Phase 0 controls. Counter gates are exact and hardware-independent;
timing gates compare against controls run on the same machine and build, never against a fixed
millisecond figure. Today's values are from the 20,000-line fixture in the research doc.

| Gate | Measure                                                                                                                  | Today                              | Required                                                                       | Harness                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| D1   | Calls to 1,000 selection-only pieces per page scroll / per scroll inside mounted rows                                    | 1,000 / 0                          | 0 / 0                                                                          | counter test (phase 2)                                    |
| D2   | Calls to 1,000 selection-only pieces per keystroke                                                                       | 2,000                              | 1,000                                                                          | counter test                                              |
| D3   | Snapshots or input payloads built per operation for an input with no subscriber                                          | 1 per pass, 2 per keystroke plus 1 | 0                                                                              | counter test                                              |
| D4   | Other contributions re-run when one calls `requestViewUpdate`                                                            | all                                | 0                                                                              | counter test                                              |
| D5   | Calls to 1,000 command-only plugins per edit, selection or scroll                                                        | not installable                    | 0                                                                              | counter test (phase 3)                                    |
| D6   | Downstream calls when a derived input's value is equal                                                                   | no derive                          | 0                                                                              | counter test                                              |
| D7   | Registrations surviving plugin removal, including late ones, `onDidType` and key readers                                 | survive (E027 probes 1–2)          | 0                                                                              | lifecycle test (phase 1)                                  |
| T1   | Back-to-back pass, 1 interested piece plus 1,000 irrelevant, against 0 irrelevant                                        | 38–42 µs against 6–8 µs            | inside the control envelope (±2 µs in Phase 0)                                 | dispatch suite (phase 2)                                  |
| T2   | Marginal cost per interested no-op subscriber between 1,000 and 4,000                                                    | 111 ns and rising (quadratic)      | ≤ 20 ns and flat (CM 5 ns; Monaco 4 ns to 1,000)                               | dispatch suite                                            |
| T3   | E002 input suite, 108 blocking groups, for two new workloads: first-party set, and the same plus 1,000 irrelevant pieces | no plugin workloads exist          | every group inside its calibrated limit, 20 ms negative control fails          | `bench:input` with the Plan 099 unit 1 workload extension |
| T4   | Sum of first-party contribution `update` time per keystroke; work on undeclared inputs                                   | 119 µs; about 21 µs undeclared     | ≤ control envelope of 119 µs; undeclared 0                                     | attribution counters in diagnostics                       |
| T5   | Platform open, typing and scroll                                                                                         | passing                            | existing limits                                                                | `bench:editor-*:gate`                                     |
| T6   | Weight: `plugins.js` + `viewContributions.js` gzip; loader in no-plugin startup                                          | 7.7 KB; no loader                  | plugin runtime ≤ 12 KB gzip; loader 0 bytes until used                         | build output                                              |
| T7   | `new Editor` with 1,000 inert plugins against none (median of 5)                                                         | +3 ms (27 against 30 ms), in noise | inside the control envelope                                                    | dispatch suite                                            |
| T8   | 100 reload cycles                                                                                                        | no loader                          | 0 extra registrations; retained module generations within the documented bound | loader suite (phase 8)                                    |

Allocation and GC counts have no harness today; D3's payload counter stands in for them until a
heap-sampling mode is added to the stress runner.

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

## Research findings (2026-09-26)

Full evidence, citations and method: [Phase 0 research](../docs/composable-plugins/phase-0-research.md).
Probes are throwaway, in `/work/tmp/research2/122/` (real Chromium 153, three engines, same ops).

- **The notification itself is not where time goes.** A no-op piece costs about 5 ns in CodeMirror,
  4 ns in Monaco and 13 ns in Singapore up to 100 pieces. Op-level timing cannot see 1,000 inert
  pieces in any of the three; page-to-page noise on this machine is up to 2×.
- **Singapore's loop is quadratic.** `includes` inside the per-contribution loop makes 1,000, 2,000 and
  4,000 pieces cost 38, 110 and 372 µs per pass; CodeMirror stays linear (12, 18, 28 µs).
- **One keystroke is two full passes, then a third.** `selection` from `syncDomSelection`, then
  `content` from the flush, each with a fresh snapshot; one frame later scope lines calls
  `requestViewUpdate`, which re-runs every contribution as `layout`.
- **Page scrolls broadcast to everyone.** Only scrolls inside the mounted rows use the selective
  viewport lane; a scroll that moves the mounted range calls every view contribution.
- **First-party contribution work is 6–16% of an operation**: 88 µs of 534 per selection, 119 of 1,497
  per keystroke, 82 of 3,023 per page scroll. About 8–21 µs of that is on inputs the contribution
  does not act on. Selective routing is a scaling guarantee and a fix for the double pass; it will
  not produce a visible latency win for today's plugins.
- **CodeMirror is not selective either.** Every `ViewPlugin.update` runs on every viewport change and
  every `StateField.update` on every transaction; only `facet.compute(deps)` is. Monaco is selective
  per event but builds payloads before checking listeners and instantiates every registered
  contribution in every editor.
- **Gaps for full access:** the public `Editor` cannot read multiple selections (`getState()` has one
  cursor), command IDs are a closed union with one handler each, and Platform's command table is a
  static const with no runtime segment.

### Decisions

- Decided 2026-09-26: research recommendation — scoped setup with static declarations (candidate B)
  over composition-first. Fewer concepts (4 imports against 10), per-view state has one home, and
  dispatch cost is identical.
- Decided 2026-09-26: research recommendation — E027 owner question 1 (full editor access) is (a): the
  scope carries the public `Editor`, labelled unstable. Requirement 3 of this plan already settles
  full access; only the stability label was open.
- Decided 2026-09-26: research recommendation — per-input dispatch (phase 2) lands before
  `createPlugin` (phase 3). `watch` lowers onto it, and it fixes the double pass on its own.
- Decided 2026-09-26: research recommendation — contributed command IDs start with the owning
  plugin's `name` and a dot; built-in IDs stay a closed union, as E026 requires.
- Decided 2026-09-26: research recommendation — default surfaces are code-editor tabs; diff, search,
  settings and composer editors attach only when a plugin names them, as this plan already allows.
- Decided 2026-09-26: research recommendation — loading mechanism stays with E025's measured
  comparison in phase 8; Phase 0 did not run loader experiments and the trust model is already decided.

### Owner questions

1. **One public authoring model.** Once `createPlugin` exists, what happens to `EditorPlugin` and the
   six `register*Contribution` kinds? (a) They become internal lowering targets and every first-party
   plugin (about 20 more after phase 3) migrates within this plan. (b) Both stay public: `createPlugin`
   for authors, `EditorPlugin` as the low-level layer. **Recommendation: (a).** The greenfield rule and
   requirement 1 rule out two public models; phase 9 is sized for it.
   Decided 2026-09-26: owner — (a).
2. **Who gets a key first in a plugin-owned view** (E027 owner question 2, still open)? (a) The key
   participant sees every key first, so a Vim plugin can take Ctrl+R or Ctrl+W and the app binding
   stops working in that view. (b) Platform's keymap first; the participant sees only unbound keys, as
   terminals pre-claim chords today. (c) The participant sees unmodified and Shift keys first;
   Ctrl, Cmd and Alt chords go to Platform's keymap unless the plugin declares the chord on a command
   (E026 default keys), which then appears as an ordinary binding with its conflicts shown in the
   shortcut recorder. **Recommendation: (c).** Modal editing needs every printable key, and app
   shortcuts keep working unless a plugin claims one where the user can see it.
   Decided 2026-09-26: owner — (c). This also answers Editor E027 owner question 2.

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
