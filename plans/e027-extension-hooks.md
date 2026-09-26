# E027: Define and verify the extension hook contract

- Status: Proposed
- Kind: Design
- Owner: Editor
- Priority: P2
- Effort: M
- Dependencies: None
- Inspected baseline: Editor `9abb944f3a2b8d6516953fdec75e8df5e1a94811`.
- Research: design pass done 2026-09-25 against Editor `e2fd299`; findings and a draft inventory below. Implementation steps 5–6 and the E028 hand-off remain.

Decided 2026-09-25: owner — unparked. Rebase the plan on the [E050 host contracts](../docs/architecture/e050-host-obligations.md) first, then execute. Platform Plan 122 Phase 0 needs this design pass.

## Outcome

Publish an accurate extension inventory that tells a plugin author which behavior they can
change, which context they receive, and when their resources disappear. Propose only the
missing hooks needed to exercise modal input in [E028](../docs/architecture/modal-input-findings.md).

A developer implementing a custom paste handler or view decoration should find its existing
public hook. A developer intercepting input should find an explicit ownership contract,
including how to delegate ordinary typing and composition to the default implementation.

## Current code

[EditorPluginContext](../packages/editor/src/plugins.ts) already registers syntax, highlighter,
view, command, capability, edit, decoration, gutter, injected-row, inline-replacement, and
selection-range contributions. Its public types are exported through
[extensions.ts](../packages/editor/src/public/extensions.ts).

The same plugin file defines single-owner capabilities, multi-provider language features,
paste handlers, contribution disposal, and per-view update callbacks. The wishlist's request
for a hook taxonomy must inventory this existing model before adding another registration API.

[InputSelectionController](../packages/editor/src/editor/inputSelectionController.ts) owns
browser keydown, beforeinput, composition, paste, and selection handling.
[inputState.ts](../packages/editor/src/editor/inputState.ts) tracks browser and session ownership.
[EditorKeymapController](../packages/editor/src/editor/keymap.ts) already uses the
[public shared chord runtime](../packages/editor/src/public/keymap.ts).

[DisplayProjectionRegistry](../packages/editor/src/editor/displayProjectionRegistry.ts) is an
internal composition point. Public [rendering exports](../packages/editor/src/public/rendering.ts)
and registered view contributions expose selected display operations, not the entire registry.
Open, save, and workspace policy also cross host boundaries and are not all plugin callbacks.

## Scope

Deliver a proposed `docs/architecture/extension-hooks.md`, an explicit input interception
proposal, and public-export checks tied to that inventory. Keep the initial design finite.
The implementation proof for a missing input hook belongs to E028.

Inventory hooks in these categories: document edits, selections, commands, input, syntax,
display projection, decorations, frame work, scrolling, document lifecycle, and view lifecycle.
Mark each row public, internal, host-owned, proposed, or intentionally unsupported.

Do not expose an internal timer or controller merely to fill a row borrowed from another
editor. Notifications, filesystem permissions, open destinations, and save policy stay host-owned.

## Design

Each inventory row names its current symbol and export, owner, registration scope, callback
phase, mutation rights, ordering, cancellation, and disposal. Identify the production consumer
that proves a public hook works. Use "no current public hook" where the implementation lacks one.

Distinguish per-document data from per-view input and paint. A plugin installed in two views
must not share cursor mode accidentally. Document whether providers survive document swaps
and whether an asynchronous result is rejected after a version or generation change.

For input, sketch a typed consume-or-delegate contract. The default handler remains the owner
of composition and native text reconciliation unless a replacement explicitly implements
that contract. A wrapper cannot let the same beforeinput event commit through two paths.

Compare an ordered key-intent interceptor with a whole input-loop replacement. Evaluate which
can implement normal-mode suppression, insert-mode delegation, and operator-pending state
without DOM listener races. Prefer the narrower design if E028 proves it sufficient.

Reuse the shared keymap runtime for chord recognition, timeout, and cancellation. Interceptor
ordering must explain its relation to local widget inputs, app shortcuts, and readonly checks.
Frame callbacks need invalidation ownership and cleanup, not an unrestricted permanent timer.

Publish the inventory as the contract map while marking any new input contract experimental.
Do not make E027 depend on a finished runtime loader or modal plugin. E028 evaluates this
proposal and returns evidence before E025 makes a broader stability promise.

## Steps

1. Enumerate exports and registration methods from the current package entry points. Follow
   each callback to its caller and one production contribution to establish actual semantics.
2. Trace two documents in separate views through install, focus, edit, document swap, deactivate,
   and dispose. Record lifetimes in the inventory and identify ownership ambiguities.
3. Walk the input event order, including hidden input and composition. Write the proposed
   interceptor contract with explicit consume, delegate, cancellation, and error behavior.
4. Compare the two input designs against the bounded E028 command set. Record which requirements
   they express and which require an internal import. End with a selected experimental contract.
5. Publish the inventory and link it from the architecture documentation. Keep unsupported hooks
   explicit, with a reason based on current ownership rather than an open-ended promise.
6. Add only useful export or lifecycle contract checks for claims that existing checks miss.
   Hand E028 a precise implementation scope and its acceptance scenarios.

## Verification

Read [public API tests](../packages/editor/test/public-api.test.ts),
[plugin tests](../packages/editor/test/plugins.test.ts), and
[lifecycle tests](../packages/editor/src/editor/pluginLifecycle.test.ts) before adding coverage.
An export check must catch a documented hook that cannot be imported from the built package.
A lifecycle check must catch a surviving registration after its owning contribution disappears.

If those checks change, first run `bun run build` from `packages/editor`. Then run only the
affected files with `bun run test --project dom test/public-api.test.ts test/plugins.test.ts`
or `bun run test --project node src/editor/pluginLifecycle.test.ts`.
Documentation alone needs link and symbol verification, not a new behavior test suite.

Acceptance requires a source-backed row for every inventoried hook category, a disposition
for each gap, and an input design E028 can implement without inventing lifecycle semantics.
Do not claim native keyboard or composition behavior is proven until E028 tests a real browser.

## Risks and decisions

Overexposing the whole Editor instance would make every private detail a plugin dependency.
Keep contribution contexts narrow and identify the precise additional operation before exposing it.
Optional methods already exist in plugin contexts. Record current behavior accurately, then
remove unnecessary compatibility patterns only as part of a separately scheduled API change.
The design is incomplete if host save callbacks are mislabeled as editor document events.

## Research findings (2026-09-25)

Read from Editor `origin/main` at `e2fd299` and Platform `origin/main` at `ed96e9f16`. No open PR
changes this plan (Editor PRs #20, #34, #35 do not touch it). The draft inventory is
[extension-hooks.md](../docs/architecture/extension-hooks.md): every category in Scope has rows, each
with its symbol, scope, ordering, disposal, a production consumer, and a status.

All eleven E050 rows are on main, not only rows 2, 5, 7, 8, 9 and 11: rows 1, 3, 4, 6 and 10 came
back through PRs #30–#33 after the rollback. The hooks E050 added are rows in the inventory:
`registerPressParticipant`, `registerNonCaretRows`, `registerKeymapContextKey`,
`onDidChangeReservedOverlayWidth`, `setScrollPosition`, gutter `interactive`, `getRowPresentation`
and `initialHighlightStatus`. E055 changes no hook. It does fix the reading rule the hooks follow:
contexts hand out `TextReadSnapshot`, and `check:full-text` rejects a new whole-text read.

Lifecycle claims were checked with four happy-dom probes against the worktree source
(`/work/tmp/research/e027/probe.test.ts`, run through the wave-heavy wrapper, 4 of 4 as predicted).

### Step 1: what exists

`EditorPluginContext` has 13 registration methods and `log`
([plugins.ts](../packages/editor/src/plugins.ts)). The view context has 33 members. Six contribution
kinds exist: view, command, capability, edit, decoration, and the internal feature kind, whose
combined context has DOM, edits, selections, decorations and commands on one object. Only
`mergeConflictPlugin` reaches it, by casting its plugin context to `EditorInternalPluginContext`.

Library-defined typed extension points already exist. Any package can call
`createEditorLanguageFeatureToken` (many providers, ordered by selector, priority, then registration)
or `createEditorCapabilityToken` (one owner). What is missing next to CodeMirror facets is a public
change subscription per token (`EditorLanguageFeatureRegistry.subscribe` exists but is internal) and
any combine or derive step.

Notification fan-out: every view contribution is visited for every update kind except `viewport`,
which has its own subscriber set ([viewContributions.ts](../packages/editor/src/editor/viewContributions.ts)).
Decoration and feature contributions get every `handleEditorChange`. Plan 122 Phase 0 measures this;
E027 only records who owns it.

### Step 2: two views, two documents

- The plugin host is per editor, so the same plugin object activates once per editor (probe 4).
  Contributions, language features, decorations, commands and keymap context keys are all per editor.
  Two views of one document share its text buffer (text and undo) through separate view sessions. No document scope exists;
  Platform Plan 099 owns adding one.
- Contributions survive a document swap and hear `document` or `clear` afterwards. There is no
  will-change phase. Row handles abort before replacement. `textVersion` rises on every rendered change
  and every swap in one editor ([documentController.ts](../packages/editor/src/editor/documentController.ts)),
  so it rejects stale results across A-to-B-to-A.
- **Ambiguity 1, factory state.** `createBracketMatchPlugin` (line 44) and `createMergeConflictPlugin`
  (line 118) keep `controller` in the factory closure. With one object in two editors, the second
  activation reassigns it: `jumpToBracket` and the merge-conflict lens rows then read the other
  editor's controller. Found by reading the source, not reproduced: bracket pairs need a parse.
  Platform builds its plugin array per editor, so today it does not hit this. The ambient hover plugin
  is shared by design.
- **Ambiguity 2, late registrations.** A registration made after `activate` returns, from a promise
  or a timer, is host-owned. After `setPlugins([])` it still answers (probe 2). Platform's decode
  loader disposes its own late registration, which is why it has no leak.
- **Ambiguity 3, contribution registrations.** The editor collects what a contribution registers
  only to undo a failed factory. After a successful create, a key reader whose `dispose` forgets it
  reads true after the plugin is gone (probe 1). `onDidType` listeners are never collected.
- **Ambiguity 4, split contexts.** A view contribution cannot apply edits or register commands. find
  passes one controller through four providers, lsp-plugin through three, bracket match through two
  with a comment that their creation order is not guaranteed.
- Save, dirty state and open destinations are host-owned. The editor has no save event.

### Step 3: input order

The keydown order, the five text sources and the two proposed hooks are written out in the
inventory's input section. Two facts decide the design. First, composition is already held at `el`
capture before any keymap sees the key. Second, Platform disables the editor keymap
(`HOSTED_EDITOR_KEYMAP`) and runs its own at `document` bubble. That makes a hook at the editor's
own keydown the only point that comes before both keymaps.

A registered command handler runs before the built-in, and a `false` does not fall through to it,
except for `closeFind` (probe 3 for `selectAll`; `closeFind` from the router source). A command
therefore cannot delegate to the default the way input must.

### Step 4: the two designs against E028

| E028 requirement                           | Key participant + text gate                                | Replace the input loop         | Today, no new hook                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Normal mode inserts no letters             | Consume the keydown                                        | Owns all input                 | Only by a host layer binding every printable key; plugins cannot add bindings, Platform disables the keymap |
| IME commit, dictation, drop in normal mode | Gate rejects                                               | Owns all input                 | Nothing                                                                                                     |
| Insert mode and composition                | Delegate; the default path runs once                       | Reimplements both input routes | Default path                                                                                                |
| Counts and operator-pending (`d3w`)        | Plugin state; cancel on `document`, `clear`, blur, dispose | Same                           | The chord trie matches exact chords with a 5 s timeout; counts are unbounded                                |
| Escape while completion is open            | `context.suggestWidgetVisible` says delegate               | Reimplements widget ordering   | —                                                                                                           |
| One undo entry per command                 | `applyEdits` in the same operation                         | Same                           | `applyEdits` exists, but not in the view context                                                            |
| Two views, readonly                        | Per-view registration; edits rejected by `applyEdits`      | Per view                       | —                                                                                                           |
| Block cursor                               | Needs a per-view cursor style                              | Same                           | The caret is editor-drawn, 2px wide in `style.css`                                                          |
| Multi-cursor `dw`                          | Needs `applyEdits` to take a selection list                | Same                           | `applyEdits` takes one selection                                                                            |

Word motions need no internal import: `nextWordOffset`, `previousWordOffset` and `wordRangeAtOffset`
are root exports, and a plugin reads rows through `TextReadSnapshot.lineRange` and `readRange`.

**Recommendation:** the key participant and the text gate, both experimental. Reject replacing the
input loop (reasons in the inventory). The participant needs nothing from E026. Vim actions become
palette-visible commands only once E026's namespaced IDs exist.

### Decisions

- **Recommendation, lifecycle ownership.** Give every contribution context its own disposable store,
  released when the contribution goes (fixes ambiguity 3). Give every plugin its own context object in
  place of the one shared context `pluginLifecycle.test.ts` pins, so a late registration belongs to
  its plugin (fixes ambiguity 2; E025 reload needs this). Move bracket match and merge-conflict state
  into `activate` (fixes ambiguity 1).
- **Recommendation, one view context.** Make the combined feature context the public per-view
  context: edits, selections, commands, decorations and DOM on one object. It already exists, and the
  bridging in four first-party plugins is the evidence. Expose it as experimental for E028. Plan 122
  Phase 1 picks the final `createPlugin` shape, so do not also rename the provider kinds here.
- **Recommendation, extension points.** Keep tokens as the typed channel. Add a public per-token
  provider-change subscription for Plan 122's annotation proof. Add no facet-style combine until Plan
  122's comparison asks for one.
- **Recommendation, frame work.** Add no frame hook. `update`, `requestViewUpdate` and row-presentation
  signals cover every current consumer.
- **Recommendation, E028 additions.** Add a per-view cursor style (line, block, underline) on the view
  context, and a selection list on `applyEdits`.
- **Recommendation, stability labels.** When published, the inventory gains a supported, experimental
  or internal column. The participant, the gate and the combined context stay experimental until
  E028 returns a verdict.
- **E026 split.** E026 owns IDs, metadata, typed arguments, mutation classification and preset
  bindings. E027 owns scope, ordering and disposal. Plugins still cannot contribute bindings: Platform
  runs its own keymap and reads Editor bindings as data (`default-bindings.ts`), so a contributed
  command's default bindings belong in its E026 declaration. `editorCommandMutates` feeds both the
  editor keymap's `writable` check and Platform's `command-table.test.ts`, so deriving it from
  declarations covers custom commands in both places.

### Checks for step 6

Checks 1 and 2 fail on today's code, as probes 1 and 2 show. Check 3 is predicted from the source:

1. Removing a plugin releases every registration its contributions made through their contexts,
   including `onDidType`.
2. Removing a plugin releases a registration it made after `activate`.
3. One bracket-match plugin object in two editors jumps within the invoking editor.

The export check needs no new file. `public-api.test.ts` already imports
`@singapore-editor/core/extensions` from the build. Add a symbol there when a proposed hook ships.

### Owner questions

1. **Full editor access.** Plan 122 settles that trusted plugins can reach the actual editor. This
   plan's Risks say not to expose the whole instance. (a) The view context carries `editor`, typed as
   the public `Editor` class and labelled unstable. Calling `setPlugins`, `dispose` or
   `openDocument` from inside `update` is unsupported. (b) Keep contexts narrow; a host hands its
   editor to its own plugins. Recommendation: (a). It exposes only what hosts can already call.
2. **Who wins a key: a participant or an app shortcut.** (a) The participant is asked first, so Vim
   can take Ctrl+R or Ctrl+W in that view and the app binding stops working there. (b) The host
   keymap is asked first, the way terminals pre-claim through `claimKeybinding`
   (`features/terminal/hooks/use-keybindings.ts`), and the participant sees only unbound keys.
   Recommendation: (a), with Platform showing claimed chords in its shortcut UI later.

### Proposed phases

1. Editor, S: the lifecycle-ownership fixes and checks 1–3. Add stability labels to the inventory
   and link it from `ARCHITECTURE.md`.
2. Editor, S: expose the combined per-view context and the token change subscription as
   experimental.
3. Handed to E028 step 2: the key participant, the text gate, cursor style and the `applyEdits`
   selection list, each proved in a real browser on both input routes.
