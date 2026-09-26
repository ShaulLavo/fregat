# Composable plugins: Phase 0 comparison and controls (Plan 122 research, 2026-09-26)

Evidence behind [Plan 122](../../plans/122-composable-plugins.md). The plan carries the decisions,
the proposed phases and the owner questions; this file carries the teardown and the numbers.

## Pinned sources

| Source                         | Where                                         | Version or commit                                     |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------------- |
| Platform                       | origin/main                                   | `c130dd35a`                                           |
| Editor (`@singapore-editor/*`) | `/work/projects/Editor` main                  | `74e76bef` (dist rebuilt after its last `src` commit) |
| `codemirror/state`, `view`     | `references/codemirror-state`, `-view`        | `9c801279`, `fbff59ba` (read)                         |
| `codemirror/commands`          | `references/codemirror-commands`              | `5b9bac97` (read)                                     |
| CodeMirror, measured           | npm                                           | `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.13 |
| Monaco source                  | `references/vscode` (`src/vs/editor`)         | `90da9001` (read, pulled 2026-09-26)                  |
| Monaco, measured               | npm `monaco-editor`, `editor/editor.api.js`   | 0.57.0                                                |
| Editor hook inventory          | Editor `docs/architecture/extension-hooks.md` | E027 draft from `e2fd299`                             |

Monaco's editor lives in the VS Code repository; the `monaco-editor` repo only packages it, so no
separate clone was added. Paths below are relative to each clone root. Editor paths are relative to
`/work/projects/Editor/packages/`.

## Method

The probes are throwaway and live in `/work/tmp/research2/122/`: one entry per engine (`src/sg.ts`,
`src/cm.ts`, `src/monaco.ts`) bundled with Bun 1.4.0, driven by `run.mjs` (per-operation matrix),
`tight.mjs` (back-to-back dispatch) and `real.mjs` (first-party Editor contributions under timing).
Headless Chromium 153 through playwright-core 1.63.0, i7-14700K, a machine shared with about nine
other research agents. The server sets COOP/COEP so `performance.now()` resolves 5 µs.

- Fixture: 20,000 lines of about 60 characters, one editor, 1000×700 host.
- Each engine gets N inert pieces of one kind, N ∈ {0, 10, 100, 1000}. A piece increments a counter
  and returns.
  - **view**: the broadest per-update hook. Singapore view contribution, CM `ViewPlugin`, Monaco
    listeners on selection, content and scroll.
  - **selection**: the narrowest selection hook each engine has. Singapore has none, so it is a view
    contribution that filters on `kind`; CM `facet.compute(['selection'])`; Monaco
    `onDidChangeCursorSelection`.
  - **decoration**: Singapore decoration contribution, CM `StateField` providing decorations, Monaco
    `createDecorationsCollection`.
  - **command**: Singapore command contribution (capped at 2: IDs are a closed union and one handler per
    ID), CM `keymap.of`, Monaco `addAction`.
- Operations: `select` (move the caret one line), `type` (one character through the normal edit path),
  `scrollSmall` (60 px, inside mounted rows), `scrollPage` (20,000 px).
- 150 measured operations after 20 warm-ups, one animation frame between operations, two full runs
  (a and b). During run a the bundles were rebuilt once to add the back-to-back entry points; the
  measured operations' code did not change.

**Calibration.** The first Singapore run cost 19 ms per selection and 84 ms per keystroke. A profile
showed every row mounted: the host lacked `display:flex`, so the scroller never constrained height.
With the stress harness's host style the same probe costs 0.3 ms per selection and the profile is
idle-dominated. Counters were checked the same way: N inert view contributions produce exactly N
calls per broadcast.

## Comparison

| Concern                        | CodeMirror 6                                                                                                                                                                                             | Monaco                                                                                                                                                                           | Singapore today                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit of extension              | `Extension`: nested arrays of values (`state/src/facet.ts:373`). A bundle is an array.                                                                                                                   | No bundle. Global contribution registry (`editorExtensions.ts:552`), per-editor API calls, global language registries.                                                           | `EditorPlugin` object with five lifecycle hooks and a context of 13 `register*` methods (`editor/src/plugins.ts:995`).                                                       |
| Composition and dedup          | `flatten` dedupes by object identity; a repeat at higher precedence moves (`facet.ts:519-555`).                                                                                                          | None; each call registers again.                                                                                                                                                 | Plugin identity per editor (`installedPlugins` map). No nested plugins.                                                                                                      |
| Precedence                     | Five `Prec` buckets, then flatten order (`facet.ts:375`).                                                                                                                                                | Keybinding weight 0–400, last override wins (`keybindingsRegistry.ts:62-69`); provider score, then newest (`languageFeatureRegistry.ts:199-223`).                                | Language features: selector score, priority, registration. Capabilities: one owner, a second throws. Commands: one handler per ID.                                           |
| Library-defined channels       | `Facet.define({ combine, compare })`, inputs from `of`, `compute(deps)`, `from(field)`.                                                                                                                  | None for third parties; `LanguageFeatureRegistry` is core-only.                                                                                                                  | `createEditorCapabilityToken`, `createEditorLanguageFeatureToken`. No public change subscription, no combine.                                                                |
| Notification model             | Every `ViewPlugin.update` on every non-empty view update, including viewport and focus (`view/src/editorview.ts:396-398, 460-466`); every `StateField.update` on every transaction (`facet.ts:329-331`). | One `Emitter` per event (`codeEditorWidget.ts:84-200`); a listener hears only its event. Internal view parts get every batch and switch (`viewModelEventDispatcher.ts:149-152`). | Every view contribution gets every kind except intra-mount scroll (`editor/src/editor/viewContributions.ts:297-312`); decoration and feature contributions get every change. |
| Selective primitive            | `facet.compute(deps)`: getter runs only when a dependency reports changed (`facet.ts:164-172`).                                                                                                          | Separate emitters; `fire()` with no listener allocates nothing (`event.ts:1419`), though callers build payloads first.                                                           | Only `updateViewport`, a separate subscriber set (`viewContributions.ts:61`).                                                                                                |
| Per-view lifecycle             | `ViewPlugin` instance per view, created eagerly, `destroy` (`view/src/extension.ts:219-268`).                                                                                                            | Contributions per editor, five instantiation timings (`codeEditorContributions.ts`); disposed with the widget.                                                                   | Contribution per editor per provider; phase-scoped registrations (E027 inventory).                                                                                           |
| Cleanup                        | Plugin `destroy` must undo its own effects; no scoped store.                                                                                                                                             | `IDisposable` everywhere. `addAction` returns a store not tied to the editor; `addCommand` returns no disposable at all (`standaloneCodeEditor.ts:307-397`).                     | Late registrations leak until editor disposal; contribution registrations are only collected on a failed factory; `onDidType` never (E027 ambiguities 2 and 3).              |
| Errors                         | A throwing plugin is deactivated for that view (`extension.ts:236-252`).                                                                                                                                 | Each listener in its own try/catch (`event.ts:1384-1394`).                                                                                                                       | A throwing contribution is removed and logged.                                                                                                                               |
| Reconfiguration                | Compartment effect; whole config re-resolved, unchanged values reused (`state/src/state.ts:98-124`).                                                                                                     | Not a concept; add and dispose.                                                                                                                                                  | `setPlugins` diffs by object identity; stable definitions keep their state.                                                                                                  |
| Typing takeover                | `EditorView.inputHandler` facet, first `true` suppresses insertion, also during composition (`domchange.ts:216-221`).                                                                                    | Override the `type` command, call `default:type` to delegate; IME bypasses it (`coreCommands.ts:2130-2178`).                                                                     | None. E027 proposes a key participant and a text gate; E028 proves them.                                                                                                     |
| Decorations                    | `decorations` facet; every function source called per update, sets diffed by shared chunk (`docview.ts:489-512`).                                                                                        | Owner-scoped interval trees per model, O(log n + k) per edit (`intervalTree.ts:306-333`).                                                                                        | Six channels with separate position models; Plan 111 proposes one `registerDecorationSource`.                                                                                |
| Undo grouping for a batch edit | One transaction, one history event.                                                                                                                                                                      | `executeEdits` joins the open stack element until `pushUndoStop` (`editStack.ts:394-429`).                                                                                       | `applyEdits` is one batch and one undo entry, one result selection.                                                                                                          |

Two lessons carry into the API. CodeMirror's composition (identity dedup, precedence, typed channels
with `combine` and `compare`) is the right model for extensibility, but its per-update fan-out is not
selective: a plugin that cares about the selection still runs on every scroll that changes the
viewport. Monaco's per-event emitters are the right model for selectivity, but it has no bundles and
no third-party channels. Singapore already has CodeMirror-like channels (tokens) and one Monaco-like
selective lane (`updateViewport`); Plan 122 extends both rather than adopting either wholesale.

## Measurements

### 1. The notification itself costs nanoseconds per piece

Back-to-back synchronous dispatch, no frame between, 400 operations per batch, median of 10 batches.
Singapore is a direct `notify('selection')` (one snapshot plus every contribution's `update`); CM is a
selection transaction; Monaco is `setPosition`. Three independent runs (a, b, c), µs per dispatch:

| Engine, piece                      | N=0            | N=10           | N=100         | N=1,000          | N=2,000 | N=4,000 |
| ---------------------------------- | -------------- | -------------- | ------------- | ---------------- | ------- | ------- |
| Singapore, view                    | 0 (no pass)    | 6.4, 8.0, 6.4  | 7.6, 8.7, 7.7 | 38.1, 38.4, 39.4 | 110.5   | 372.4   |
| Singapore, snapshot alone          | 6.4, 6.1, 6.4  | —              | —             | —                | —       | —       |
| CM, `ViewPlugin`                   | 6.9, 13.4, 6.1 | 5.6, 12.0, 6.1 | 6.2, 8.6, 6.5 | 11.3, 11.6, 12.1 | 17.8    | 27.6    |
| CM, `facet.compute(['selection'])` | 5.9, 7.1, 7.9  | 5.7, 6.8, 10.9 | 7.6, 8.5, 8.5 | 22.9, 23.8, 28.0 | —       | —       |
| Monaco, selection listener         | 2.3, 3.6, 5.5  | 2.5, 3.9, 3.4  | 2.9, 3.0, 6.5 | 6.7, 7.0, 6.9    | —       | —       |

- Marginal cost per piece: CM `ViewPlugin` about 5 ns, Monaco listener about 4 ns, CM facet provider
  about 17 ns (it recomputes and recombines). Singapore is 13 ns per piece up to 100, then grows
  quadratically: 1,000 → 2,000 → 4,000 pieces cost 38 → 110 → 372 µs.
- The quadratic term is `this.contributions.includes(contribution)` inside the per-contribution loop
  (`editor/src/editor/viewContributions.ts:379`), plus `Array.from` on every pass (`:307`).
- A Singapore pass with one contribution costs about 6 µs, most of it the snapshot: `createViewSnapshot`
  maps every mounted row and chunk (`editor/src/editor/Editor.ts:3385`) whether or not anyone reads
  them. With no contribution at all there is no pass.
- Control spread between runs at small N is about ±2 µs, and up to 2× on single cells when another
  agent's job lands on the same cores (CM N=0 run b).

### 2. Who gets called, per operation, with 1,000 inert pieces

Counts are exact and identical across runs.

| Piece kind | Engine    | select | type  | scrollSmall | scrollPage |
| ---------- | --------- | ------ | ----- | ----------- | ---------- |
| view       | Singapore | 1,000  | 2,000 | 0           | 1,000      |
| view       | CM        | 1,000  | 1,587 | 0           | 1,000      |
| view       | Monaco    | 1,000  | 3,220 | 1,000       | 1,000      |
| selection  | Singapore | 1,000  | 2,000 | 0           | 1,000      |
| selection  | CM        | 1,000  | 1,000 | 0           | 0          |
| selection  | Monaco    | 1,000  | 1,000 | 0           | 0          |
| decoration | Singapore | 1,000  | 1,000 | 0           | 0          |
| decoration | CM        | 1,000  | 1,000 | 0           | 0          |
| command    | all       | 0      | 0     | 0           | 0          |

- Singapore has no way to ask for selection only. A selection piece is called twice per keystroke and
  once per page scroll; CM and Monaco call it once per keystroke and never on scroll.
- Singapore's page scroll is a full `viewport` broadcast (`Editor.ts:3782`, `handleViewportChange`)
  whenever the mounted range moves; only scrolls inside the mounted rows use the selective
  `updateViewport` lane.
- A Singapore decoration contribution hears selection-only changes (1,000 calls per `select`).
- CM's `view` count of 1,587 per keystroke is its transaction update plus a measure-cycle update on
  about 59% of keystrokes. Monaco's 3,220 is the piece's three listeners (selection, content, scroll)
  each firing, with scroll firing slightly more than once because the growing line changes the
  scroll width.

### 3. Per-operation timing cannot see per-piece cost

At the operation level (one frame between operations) the difference between 0 and 1,000 inert
pieces is inside the noise for every engine. Singapore `select`, mean of runs a and b: 289 and 378 µs
at N=0, 300 and 458 µs at N=1,000; keystroke 930 and 1,221 µs at N=0, 957 and 1,107 µs at N=1,000.
The clearest calibration is the Singapore `command` row: N=0 and N=1,000 are the same configuration
(the cap leaves 2 command plugins), yet the `select` mean was 189 and 362 µs in run a and 363 and 353
µs in run b. The same cell moves up to 1.9× between runs. All 192 call counts matched exactly between
the runs. Gates on op-level timing therefore need the E002 calibrated envelope; per-piece claims need
counters and the back-to-back dispatch bench.

Construction and reconfiguration are not a concern at these sizes: `new Editor` with the 20,000-line
fixture takes 27 ms with 0 plugins and 30 ms with 1,000 view-contribution plugins (median of 5), and
`setPlugins` adding one plugin to 1,000 costs 0.14 ms.

### 4. Singapore first-party contributions: where the real work is

`real.mjs` wraps each view contribution's `update` with a timer. Plugins: line gutter, fold gutter,
find, merge conflicts, bracket match, occurrence highlight, document links, scope lines (the Platform
critical set without syntax and minimap, which need workers). Built `dist`, plain text, 150
operations. µs per operation:

| Contribution          | select | type (selection + content + layout) | scrollPage | Acts on                      |
| --------------------- | ------ | ----------------------------------- | ---------- | ---------------------------- |
| occurrence highlight  | 65.3   | 59.0 (49.8 + 8.4 + 0.8)             | 49.0       | selection, content, viewport |
| scope lines           | 12.5   | 31.2 (19.9 + 3.6 + 7.7)             | 19.0       | selection, content, viewport |
| merge conflicts       | 5.4    | 14.5 (3.6 + 2.6 + 8.3)              | 6.5        | content, document            |
| document links        | 0.6    | 5.7 (0.7 + 4.0 + 1.0)               | 4.5        | content, viewport            |
| find (closed)         | 1.8    | 5.6 (1.9 + 0.5 + 3.2)               | 2.0        | nothing until opened         |
| bracket match         | 2.2    | 3.1 (1.6 + 0.5 + 1.0)               | 0.7        | selection, content, tokens   |
| **Sum**               | **88** | **119**                             | **82**     |                              |
| Whole operation, sync | 534    | 1,497                               | 3,023      |                              |

- Contribution `update` work is 6–16% of the operation. Work on kinds a contribution does not act on
  (the right column) is about 8 µs per selection and about 21 µs per keystroke on this fixture.
  Selective routing will not buy a visible latency win for today's first-party set; its value is the
  scaling guarantee and the fixes below.
- **One keystroke is two full passes, then a third.** `InputSelectionController.syncDomSelection`
  notifies `selection` (`inputSelectionController.ts:195`, reached from `Editor.flushViewOperation`),
  then the flush notifies `content` (`Editor.ts:4035`), each with a fresh snapshot. One frame later
  scope lines renders its deferred content and calls `requestViewUpdate()`
  (`scope-lines/src/index.ts:176-184`), which broadcasts `layout` to every contribution. Occurrence
  highlight does its 50 µs of work on the first pass, when the text has already changed but the kind
  says `selection`.
- **`requestViewUpdate` is global.** One contribution refreshing its own paint re-runs every other
  contribution with a new snapshot.

### 5. Other gaps found on the way

- The public `Editor` class cannot read multiple selections: `getState()` exposes one cursor
  (`editor/src/editor/types.ts:84`), and `getSelections` exists only on plugin edit contexts. "Full
  access to the actual editor" needs this read for the alignment proof.
- Custom command IDs are impossible (`EditorCommandId` is a closed union,
  `editor/src/editor/commands.ts:10`) and a second handler for an ID throws. 1,000 command-only
  plugins cannot be installed today; E026 fixes both.
- Platform's command table is a static const (`apps/web/src/keymap/command-registry.ts:13`,
  `PlatformCommandId` union). Plugin commands need a runtime segment in the palette, keybinding table
  and recorder.
- The Singapore hook inventory is complete and current in E027's
  [extension-hooks.md](../../../Editor/docs/architecture/extension-hooks.md); this research reuses it
  and does not repeat it. First-party consumers per contribution kind: Editor has 15 view, 4 command,
  2 capability, 2 edit, 1 decoration and 1 internal feature registration across 15 files; Platform adds 9
  view contributions (diff scroll bridge, diff language, diagnostic peek, diff presentation, unicode
  hover, scroll persistence, markdown scroll sync, visible snapshot, settings diagnostics).

## Candidate APIs

Both candidates were written as type stubs and the same four examples (alignment command, caret-word
decoration, bounded modal input, annotation channel with two contributors) were type-checked against
them with TypeScript 6 in strict mode (`/work/tmp/research2/122/api/`, both pass).

**A, composition-first.** Every capability is a piece value; a plugin is a named array of pieces.

```ts
const mode = viewState<Mode>(() => ({ kind: 'normal', count: 0 }))
export const modal = createPlugin({
  name: 'acme.modal',
  extensions: [
    mode,
    handler(enterInsert, (view) => mode.set(view, { kind: 'insert' })),
    keyParticipant((view, event, context) =>
      mode.get(view).kind === 'insert' ? 'delegate' : 'consume',
    ),
  ],
})
```

**B, scoped setup with static declarations.** Commands are data on the definition (E026 needs their
metadata before any editor exists); everything per view is registered on one scope.

```ts
export const modal = createPlugin({
  name: 'acme.modal',
  commands: [enterInsert],
  view(scope) {
    const mode = scope.state<Mode>({ kind: 'normal', count: 0 })
    scope.handle(enterInsert, () => mode.set({ kind: 'insert' }))
    scope.keyParticipant((event, context) =>
      mode.get().kind === 'insert' ? 'delegate' : 'consume',
    )
  },
})
```

| Measure                         | A                                                                                                                                                                | B                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Imports for the four examples   | 10 constructors (`createPlugin`, `command`, `handler`, `derive`, `decorations`, `provide`, `keyParticipant`, `viewState`, `effect`, `createChannel`) plus inputs | 4 (`createPlugin`, `command`, `derive`, `createChannel`) plus inputs; the rest is on the scope |
| Per-view state                  | A module-level piece keyed by view; every callback threads `view`                                                                                                | A closure in `view()`; two splits cannot share it by accident                                  |
| Where E027 ambiguity 1 goes     | Still possible: pieces are module values                                                                                                                         | Gone: there is no factory closure outside `view()`                                             |
| Dynamic subscriptions           | Impossible (static)                                                                                                                                              | Allowed; rules below                                                                           |
| When the routing index is built | At install, before any view                                                                                                                                      | At activation, per view; still outside the hot path                                            |
| Library-defined helpers         | Export pieces                                                                                                                                                    | Export `(scope) => void` functions or plugins in `uses`                                        |
| Lines for the four examples     | 62                                                                                                                                                               | 77                                                                                             |
| Runtime cost at dispatch        | Same: both lower onto per-input subscriber sets                                                                                                                  | Same                                                                                           |

**Selected: B.** It has fewer public concepts, per-view state has one obvious home, and it matches
E027's recommendation to make the combined per-view context public. A's one advantage, static
interests, does not change dispatch cost: both resolve subscriptions at activation.

Rejected alternatives:

- CodeMirror-style `ViewPlugin` broadcast as the default: measured above, a selection plugin runs on
  every viewport change.
- Monaco-style global contribution registry: every editor instantiates every contribution; Singapore's
  per-editor plugin list is already better.
- Replacing the input loop (VS Code's `type` override): rejected in the E027 inventory; the key
  participant and text gate cover the E028 grammar.
- A family of `createXPlugin` constructors: requirement 1 of the plan.

## Proposed contract

Names are proposals; plan phase 3 fixes them.

```ts
// @singapore-editor/core/extensions, experimental until E028 returns its verdict
createPlugin({
  name: 'acme.annotations',            // namespace for commands, channels and logs; identity for dedup
  uses: [otherPlugin],                 // bundles; deduped by identity, ref-counted, precedence by order
  commands: [alignDeclaration],        // E026 declarations: data, listed before any editor exists
  view(scope) { … },                   // once per matching editor view
  document(scope) { … },               // once per document incarnation, after Plan 099 unit 2
})

type ViewScope = {
  readonly editor: Editor              // the live editor, labelled unstable
  read<T>(input: Input<T>): T          // pull, no subscription
  watch<T>(input: Input<T>, listener: (value: T) => void): void
  handle(declaration, run): void       // E026 command handler for this view
  decorations(id, input): void         // Plan 111 decoration source, driven by an input
  provide<T>(channel: Channel<T>, value: Input<T> | T): void
  keyParticipant(participant): void    // E027/E028, experimental
  textGate(gate): void                 // E027/E028, experimental
  applyEdits(edits, selections?): boolean // one batch, one undo entry, E027's selection list
  state<T>(initial: T): { get(): T; set(value: T): void; readonly input: Input<T> }
  onDispose(cleanup: () => void): void // explicit cleanup for raw DOM listeners, timers
  own(disposable: EditorDisposable): void
}
```

- **Inputs** are the editor's published values: `selection`, `text` (the edit transition from Plan
  099 unit 1, with revision and sync point on the frame), `viewport`, `tokens`, `theme`, `document`.
  Each input keeps its own subscriber set in the editor. No subscriber means the payload is never
  built. The existing `update(snapshot, kind)` survives only as an explicit `watch(anyChange, …)` whose
  cost is the whole pass.
- **`derive(inputs, compute, equals)`** recomputes when an input changes and stops propagation when
  `equals` holds, as `facet.compute` does. One operation publishes all its changed inputs together and
  each dependent runs once per phase, which removes today's selection-then-content double pass.
- **Channels** are the existing tokens plus two things E027 already recommends: a public change
  subscription per token, and a policy of `one` (today's capability), `many` (today's language
  feature, ordered by selector, priority, registration) or `combine`. A library defines a channel;
  other libraries `provide` to it and `watch` it; core adds nothing.
- **Commands** are E026 declarations. A contributed ID must start with its plugin's `name` and a dot,
  so `acme.align` belongs to `acme`; built-in IDs stay a closed union.
- **Dynamic subscriptions**: a `watch` registered during dispatch starts with the next operation; one
  disposed during dispatch receives nothing after the current listener returns. A `derive` cycle
  throws at registration. A throwing listener is logged, removed and its scope disposed, as a
  throwing contribution is today.
- **Lowering**: `createPlugin` produces the existing `EditorPlugin`; `view(scope)` becomes one combined
  contribution per editor whose registrations belong to its scope (E027 phase 1). No second lifecycle.

What a third-party library can extend without asking core for a method: define a channel and its
merge policy, contribute to another library's channel, derive values from any inputs and channels,
add commands with metadata, add decoration sources, and read or drive the live editor.

## Harnesses, and what each can measure today

| Gate family                                        | Harness                                                                                     | Today                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact call and payload counters                    | This probe (`run.mjs`, `tight.mjs`, `real.mjs`)                                             | Yes, throwaway. Plan phase 2 moves the counter matrix into an Editor browser test.                                                          |
| Back-to-back dispatch cost per piece               | `tight.mjs`                                                                                 | Yes, throwaway. Plan phase 2 adds it to `examples/stress` as its own suite.                                                                 |
| Native input latency (108 blocking groups)         | Editor E002, `bun run bench:input` + `input-compare.mjs`                                    | Yes, but only with no plugins. Needs plugin configurations in the workload identity: the same extension Plan 099 unit 1 adds for consumers. |
| Contribution attribution in the running app        | `__EDITOR_PERFORMANCE_DIAGNOSTICS__` (`editor.notifyViewContributions` is already measured) | Yes; per-contribution attribution needs the opt-in counter added in plan phase 2.                                                           |
| Platform open, typing, scroll                      | `bench:editor-open:gate`, `bench:editor-typing:gate`, `bench:editor-scroll:gate`            | Yes, with the real plugin set.                                                                                                              |
| Platform UI proofs (commands, palette, two splits) | `agent:browser` scenarios                                                                   | Yes once plugins attach; scenarios added with plan phase 6.                                                                                 |
| Allocations and GC                                 | none                                                                                        | Unavailable. Snapshot and payload construction counters stand in until a heap-sampling mode exists.                                         |
| Reload retention                                   | none                                                                                        | Unavailable until the loader exists (plan phase 8).                                                                                         |
