# Plan 203: @fregat/hotkeys, our fork of TanStack Hotkeys

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner. First of the keymap plans: 203 builds the
  library, [204](204-editor-on-fregat-hotkeys.md) moves the Editor onto it,
  [205](205-ghostty-on-fregat-hotkeys.md) ghostty-webgpu, [206](206-platform-one-keymap.md)
  Platform (web, plus the TUI's matcher).
- Decisions: [Keymap architecture](../docs/keymap/architecture.md). Research:
  `/work/reports/keymap-architecture/` (`03-tanstack-hotkeys.md` for this plan).
- Authorized: add the library under `hotkeys/` in Fregat; change nothing in consumers. Consumers
  adopt it in 204–206. Independent of 207's move; the mirror follows when 207 lands.

## Why

TanStack Hotkeys gives us the parts we already use (parsing, `Mod`, layout fallback, IME and AltGr
handling, display formatting, recorders) but cannot dispatch an IDE keymap: chord prefixes leak
to the page, shared prefixes (`Mod+K` and `Mod+K Mod+C`) both fire, pending chords survive focus
changes, handlers cannot decline, and every key press scans every registration (83 µs against
0.04 µs for our trie over the Editor's 255 bindings, Bun microbenchmark). The dispatch pieces we
built instead live inside the Editor package (`packages/editor/src/keymap/runtime.ts`, `trie.ts`,
`types.ts`, `conditions.ts`), so Platform, the TUI and ghostty-webgpu import editor code for
key handling and there are five binding shapes and four condition systems across the repos.

The owner chose a fork over a rewrite: start from TanStack's code and API, delete what we do not
need, and iterate it into a purpose-fit library.

## Outcome

`@fregat/hotkeys`: TanStack Hotkeys for editors. A generic library with no keymaps inside that
the Editor, ghostty-webgpu, Platform's web app and the TUI all build on. It keeps TanStack's API
shape and pure key functions, and adds a fast chord trie, Zed's context resolution and
editor-grade chord handling. The core never touches the DOM.

## Repository and packaging

- The code lives in Fregat under `hotkeys/` (layout and mirroring in
  [207](207-one-repo-with-mirrors.md)): `hotkeys/packages/hotkeys` as `@fregat/hotkeys` (core) and
  `hotkeys/packages/react-hotkeys` as `@fregat/react-hotkeys` only if 206 still needs hooks.
  207 mirrors the folder to a public `hotkeys` repo and publishes both to npm.
- Bring TanStack's `packages/hotkeys` (and `react-hotkeys`) in from `TanStack/hotkeys` (MIT) with
  their licence and attribution. Keep a clone at `references/tanstack-hotkeys` to watch upstream;
  we do not merge upstream. Leave the Angular, Lit, Preact, Solid, Svelte and Vue adapters and the
  devtools packages behind.
- Drop the `@tanstack/store` dependency if the new dispatcher no longer needs it.
- Consumers inside Fregat use the workspace package. The standalone Editor and ghostty-webgpu
  mirrors depend on the published version.
- Tests on Vitest; formatting and build with Fregat's tooling.

## What the core provides

1. **Keys and chords, kept from TanStack:** `parseHotkey`, `normalizeRegisterableHotkey`,
   `validateHotkey`, `areHotkeysEqual`, `detectPlatform`, `Mod`, layout fallback to `event.code`,
   IME and AltGr handling, `formatForDisplay`/`formatHotkeySequence`, the recorders,
   `KeyStateTracker` (with external reset for paste and hidden tab, which Platform's held-modifier
   code needs today).
2. **A neutral key event.** `KeyInput { type, key, code, modifiers, repeat, composing }`.
   Adapters: `keyInputFromKeyboardEvent` for the browser and a terminal-input adapter shaped by the
   TUI's current parsing (`apps/tui/src/commands/state/keymap.ts`, `utils/bindings.ts`). The core
   imports no DOM types.
3. **Bindings as data.** `Binding { keys: KeyChord, command: string, args?, context?: string,
source: 'default' | 'pack' | 'user' }`. Removal copies Zed: `command: null` suppresses equal or
   weaker sources in that context; `unbind` removes one key→command pair.
4. **Zed's context predicates**, parser and evaluator: identifiers, `key == value`, `!=`, `!`,
   `&&`, `||`, parentheses, and `>` for descendant. Evaluated against a context stack.
5. **Zed's resolution.** Candidates for a key are sorted by the deepest stack depth their
   predicate matches, then by source, then by insertion order. They run in order; a handler that
   returns `false` passes the key to the next candidate. No candidate handled it: the key goes to
   the focused node's default input handling (text entry, the shell).
6. **Focus nodes.** A dispatcher holds a tree of nodes. A node publishes a context (identifiers
   and key/value pairs) and handles commands. The focus path from root to the focused node forms
   the context stack. The browser adapter derives the path from DOM containment of registered
   elements; other hosts set it explicitly. Standalone products create their own dispatcher;
   a host passes its dispatcher and the product registers as a node inside it.
7. **Chords, ported from the Editor runtime and corrected against Zed.** Our trie (`trie.ts`)
   for lookup; pending state tied to the focus it started under; cancel on focus change, blur,
   hidden tab and pointer down; a timeout only when the prefix itself is also bound; replay of the
   buffered keys on mismatch or timeout, so no key is silently eaten; a pending-label signal for
   UI; the `ChordOutcome` sequence event for telemetry; swallowing auto-repeat and key-up of a
   claimed key; `claimKeybinding(input)` for hosts that forward keys (terminals).
8. **Composition helpers.** Build a table from ordered layers with sources and report which
   binding hides which per context, as data. Nothing refuses a collision.
9. **TanStack's convenience API over the new dispatcher.** Keep the names where the meaning is the
   same so simple uses stay one call. Delete `HotkeyManager` and `SequenceManager` (global
   singletons, linear scan per press, O(n²) registration) once nothing uses them.

## Steps

- [x] Import TanStack's core and React packages under `hotkeys/`, renamed; CI green.
- [x] Add `KeyInput` and the browser adapter; move the pure functions onto it.
- [x] Port the Editor's trie and runtime tests into the library before porting the code
      (`packages/editor/src/keymap/trie.test.ts`, the runtime contract tests behind Plan 057's
      "20 runtime contract tests").
- [x] Port the trie and chord runtime; add focus-bound pending state and replay.
- [x] Add predicates, focus nodes and resolution; translate Zed's keymap tests as fixtures
      (`test_depth_precedence`, `test_disable_weaker_sources_only`, `test_fail_to_disable`,
      `test_disable_deeper`, pending/replay cases in `key_dispatch.rs`).
- [x] Add the terminal-input adapter with tests from the TUI's key cases.
- [x] Rebuild the convenience API on the dispatcher; delete the old managers.
- [x] Benchmark and document.

## Acceptance

- The library builds and its tests pass, including the ported Editor suites and Zed fixtures.
- A benchmark in the repo: plain-key lookup over a 255-binding table stays within 2× of the
  Editor trie today (0.04 µs in the Bun microbenchmark), and table construction is linear in the
  binding count. Record numbers in the README.
- `README.md` shows a standalone dispatcher with one layer, a focus-node example with nested
  contexts, a chord, a declining handler, and the terminal adapter. The package contains no
  keymap.
- No consumer changes; Editor, ghostty-webgpu and Platform still build against their current
  code.

## Out of scope

Keymap contents and presets (204–206), consumer adoption, the TUI's keymap design (its own
redesign plan), and any Settings UI.

## Progress

Branch `plan-203-hotkeys` (worktree `/work/worktrees/platform/plan-203-hotkeys`).

- Step 1 done. Upstream `TanStack/hotkeys@536da97` (hotkeys 0.10.1, react-hotkeys 0.12.1) under
  `hotkeys/packages/{hotkeys,react-hotkeys}`, renamed `@fregat/*`, 0.0.0, `publishConfig.access`
  public. Workspace `hotkeys/packages/*`; CI package tests run `--filter '@fregat/*'`. Tests:
  594 core + 44 React pass. Build is `bun build` (ESM, externals) plus `tsc` declarations.
  Decision: source exports point at `src/` for workspace consumers; `publishConfig.exports`
  points at `dist/`. The React hooks' render-time ref writes moved into `useLayoutEffect` and
  the recorders into lazy `useState`, so the repo's React Compiler lint passes.
- Step 2 done. `src/key-input.ts` (`KeyInput`, `KeyModifiers`, `createKeyInput`) and
  `src/adapters/browser.ts` (`KeyboardEventLike`, structural, so no DOM lib types;
  `keyInputFromKeyboardEvent`, `parseKeyboardEvent`, `normalizeHotkeyFromEvent`). Matching and
  parsing run on `KeyInput` (`matchesKeyInput`, `parseKeyInput`, `normalizeHotkeyFromKeyInput`);
  the KeyboardEvent functions convert then call them. `NormalizedKeyboardEvent` is gone. 606 tests.
- Step 3 done, step 4 half done. Editor `54e1e648`: `trie.test.ts` and every
  `keymap-runtime.test.ts` case ported to `tests/chords/`, except the Alt+Arrow column-selection
  case, which tests the Editor's preset contents (the library ships no keymap). The browser
  suite's held-prefix and replacement cases are ported as synthetic-event tests. Written first,
  seen red, then the code: `src/chords/{types,trie,runtime}.ts` (DOM-free
  `createChordRuntime` over `KeyInput`; the host applies `KeyEffects`) and
  `src/adapters/browser-keymap.ts` (`createKeymapRuntime`, the Editor's API: listeners,
  per-event idempotence, capture while pending). Trie on `KeyInput`; AltGr strokes match the
  produced glyph. 645 tests.
- Step 4 done. Corrections against Zed (`key_dispatch.rs` `dispatch_key`/`flush_dispatch`/
  `replay_prefix`, `window.rs` `dispatch_key_event`): a prefix with an available deeper binding
  always pends, even when the prefix is itself bound; only then a timeout (1 s, Zed's
  `PENDING_INPUT_TIMEOUT`; `timeoutMs` option) runs the prefix's bindings. An unbound prefix
  waits for the next key. Mismatch or an unavailable continuation ends the chord, runs the
  longest bound buffered prefix, hands the other buffered keys to the host's `replay` hook, and
  then matches the new key from the root (it is no longer swallowed). A declined final binding
  lets the key through. Pending records `currentFocus()` (browser: `document.activeElement`) and
  ends without replay when it changes. Ported tests changed to match: five Editor cases
  rewritten, four added. 650 tests.
  Decision: no Zed-style timeout for printable prefixes in text fields (`text_input_requires_timeout`);
  hosts forbid plain-letter chord starts today. Revisit if a keymap needs one.
- Step 5, first half. `src/context/` ports Zed's `KeyContext` (`parseKeyContext`) and predicate
  language (`parseContextPredicate`, `evaluatePredicate`, `predicateDepth`), identifiers without
  Zed's vim-operator characters. `src/dispatch/keymap.ts`: `Binding`/`Unbinding` entries,
  `compileKeymap` (trie of `CompiledBinding` payloads), `resolveKeymapNode` (Zed's
  `bindings_for_input`: rank by depth, then source, then later-first; `command: null` suppresses
  equal and weaker sources ranked after it; `unbind` removes one pair; pending chords defined
  before the winning exact binding are shadowed), `bindingsForInput` for settings and tests. The
  chord runtime takes a `select(node, context, source)` hook so the dispatcher plugs this in.
  Zed's context and keymap tests translated in `tests/context/` and `tests/dispatch/keymap.test.ts`.
- Step 5 done. `src/dispatch/dispatcher.ts`: `createDispatcher` (DOM-free focus tree:
  `createNode({ parent, context, commands })`, `focus`, `contextStack`, `setKeymap`,
  `handleKey`, `dispatchCommand`); commands run from the focused node up, a handler returning
  `false` passes to the ancestor and then to the next candidate binding; unhandled keys return
  false for default input. `src/adapters/browser-dispatcher.ts`: `createBrowserDispatcher` with
  `attachElement(node, element)`; each keydown focuses the deepest attached element on the
  event path. Listener code shared with `createKeymapRuntime` in
  `adapters/browser-listeners.ts`. Runtime additions from Zed: a running timeout restarts on
  each stroke and stays on; `acceptsTextInput(source)` gives printable prefixes a timeout
  (browser default: the target is a text field) and their replay. Zed pending fixtures in
  `tests/dispatch/dispatcher.test.ts`. 694 tests.
- Step 6 done. `src/adapters/terminal.ts`: `TerminalKeyLike` (OpenTUI `KeyEvent` shape, no
  OpenTUI dependency), `keyInputFromTerminalKey` (the TUI's name map and printed-symbol Shift
  rule from `apps/tui/src/commands/utils/keyboard.ts`; legacy Alt as Alt, Super as Meta; Kitty
  release and repeat), `terminalKeyEffects`. Tests from the TUI's key cases (Control+K,
  ESC s, Kitty `?`, releases) plus a dispatcher-hosted chord and a replayed prefix. 702 tests.
- Step 7 done. `src/hotkeys.ts`: `createHotkeyRegistry` / `getHotkeyRegistry(document)` with
  TanStack's `register(keys, callback, options)` and handle (`callback`, `setOptions`,
  `unregister`, `isActive`) on one browser dispatcher per document; arrays register chords.
  The keymap rebuilds lazily before the next key (one trie build for any number of
  registrations). Newest registration runs first; a callback returning `false` passes the key on.
  `HotkeyManager`, `SequenceManager` and their three test files are deleted; their surviving
  tests (recording, parsed identity, review regressions) run against the registry;
  `findHotkeyConflicts` reads the registry. React hooks register with the registry;
  `useHotkeyRegistrations` splits views by stroke count. Semantics that changed on purpose:
  a single stroke that prefixes a registered chord waits (Zed) instead of both firing; element
  targets must be in the document. Trie fix: physical bindings (`[KeyQ]`) now match their code
  on any layout. Test setup stubs happy-dom's `getModifierState`, which reports AltGraph for
  any Alt. 576 core + 44 React tests.
- Step 8 done. `bench/lookup.ts` (`bun bench/lookup.ts`, knip entry): editor-shaped
  255-binding table; `trieStep` plain `q` 0.005–0.010 µs against the Editor trie's 0.007–0.018 µs
  on the same table (scratch comparison, same process; JIT noise about ±50%);
  `dispatcher.handleKey` plain `q` 0.046 µs, bound `Control+E` with context resolution 0.11 µs;
  `compileKeymap` 0.69 / 1.05 / 0.83 µs per binding at 255 / 2,550 / 25,500 bindings (linear).
  `packages/hotkeys/README.md` shows a standalone dispatcher, nested focus contexts, a chord, a
  declining handler, the terminal adapter, one-call hotkeys and the numbers.
  `KeyStateTracker` gained `reset()` and clears on a hidden tab (core item 1). 578 tests.
- All steps done. Left for later plans or review: `@tanstack/store` stays (registry views,
  recorders, `KeyStateTracker`); composition helpers beyond `bindingsForInput` (item 8's layer-by-layer shadow report) are not
  built; declaration output keeps extensionless imports, fine for bundler resolution (207 decides
  the publish build).
