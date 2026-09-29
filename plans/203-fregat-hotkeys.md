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

- [ ] Import TanStack's core and React packages under `hotkeys/`, renamed; CI green.
- [ ] Add `KeyInput` and the browser adapter; move the pure functions onto it.
- [ ] Port the Editor's trie and runtime tests into the library before porting the code
      (`packages/editor/src/keymap/trie.test.ts`, the runtime contract tests behind Plan 057's
      "20 runtime contract tests").
- [ ] Port the trie and chord runtime; add focus-bound pending state and replay.
- [ ] Add predicates, focus nodes and resolution; translate Zed's keymap tests as fixtures
      (`test_depth_precedence`, `test_disable_weaker_sources_only`, `test_fail_to_disable`,
      `test_disable_deeper`, pending/replay cases in `key_dispatch.rs`).
- [ ] Add the terminal-input adapter with tests from the TUI's key cases.
- [ ] Rebuild the convenience API on the dispatcher; delete the old managers.
- [ ] Benchmark and document.

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
