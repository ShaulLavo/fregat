# Plan 286: ghostty-webgpu extensions, with a line editor first

## Status and authorization

- Status: APPROVED 2026-10-02 by the owner: "we started building features that shouldn't be in the
  base … all we need to do now is to write a plan for an extension model, similar to xterm, and a
  line editor is gonna be one of the first ones."
- Owns: `ghostty-webgpu/` (core and new extension packages), its site, and Platform's terminal
  feature (`apps/web/src/features/terminal/`), the package's only consumer.
- Versions: agents bump patch only (`~/.agents/AGENTS.md`). Phases 0 and 2 change the public API;
  the release that ships them is a minor or major bump and waits for the owner's approval.

## Outcome

ghostty-webgpu's core is the terminal: native VT semantics, input, selection, damage tracking,
scheduling and the WebGPU renderer. Everything a host can do without, ships as an extension that
the host loads by hand: `terminal.loadExtension(new LineEditor())`. The first extension is a
readline-style line editor that turns the site's Shell tab into a shell that edits like bash. The
features that are in core today but do not belong there move out one by one, and Platform loads
the ones it uses explicitly. A third party can write an extension against the public API alone.

## Research

Clones in `references/` (gitignored): `xterm.js` (c58ea36), `local-echo` (8d0b7f5),
`xterm-readline` (0268a50, the maintained repo is strtok/xterm-readline), `ghostty-web` (1858a59).

### xterm.js addons

- Contract: `interface ITerminalAddon extends IDisposable { activate(terminal): void }`;
  `terminal.loadAddon(addon)` activates synchronously; disposal is idempotent and the terminal
  unloads addons in reverse order (`typings/xterm.d.ts:1426–1440`,
  `src/common/public/AddonManager.ts:17–51`). No dependency resolver, no duplicate guard, no
  rollback when `activate` throws. Hosts pass addon instances to each other by hand. Keep that
  simplicity; add rollback.
- Addons see the public Terminal: buffers and cells, `write`, selection, scroll, resize, options,
  `onData`/`onKey`/`onRender`/`onWriteParsed`, parser hooks (CSI/OSC/DCS/ESC/APC), link
  providers, character joiners, markers and decorations, Unicode providers.
- Packaging: core `@xterm/xterm`, addons `@xterm/addon-*`, each versioned on its own. No addon
  declares a peer range on core, so compatibility is by convention.
- 13 official addons: attach, clipboard, fit, image, ligatures, progress, search, serialize,
  unicode11, unicode-graphemes, web-fonts, web-links, webgl. Canvas moved out of core in v5 to
  cut the bundle (379 → 265 KB) and was later dropped.
- The pain is private reach-ins: webgl swaps internal renderer services, image monkey-patches
  `open`, serialize reads private attributes, progress builds a private emitter. coder's
  `ghostty-web` copies the addon contract and its fit addon casts to `any` for renderer metrics
  (`lib/addons/fit.ts:140–155`). The rule this plan takes from that: every extension, ours
  included, builds on the public API only, and a hook an extension needs is added to core.

### Line editors

- local-echo: `onData` only, parses escapes itself, repaints prompt and whole line each edit,
  counts UTF-16 units as columns (breaks on colored prompts, CJK, combining marks, surrogate
  pairs), heuristic multi-line, bounded history with a cap bug, synchronous completion,
  `read()`/`abortRead()`, and `printAndRestartPrompt()` to coordinate output.
- xterm-readline: `onData` plus a custom key handler, separates line model, state, keymap and
  geometry, incremental redraw for appends, handles escapes, tabs and wide characters (code
  points, not grapheme clusters), programmable completeness callback, Alt/Shift+Enter newline,
  50-entry history under a shared `localStorage` key, no completion, one `read()` with no
  cancellation, and output printed during an edit corrupts the line.
- Take xterm-readline's separated model and incremental rendering and local-echo's completion and
  output coordination. Fix what both get wrong: grapheme clusters, cancellation, Ctrl+C, and
  output arriving while a line is being edited.

## What exists today

Production lines: core ~4,700, term ~2,500, DOM ~6,200, render ~5,300, config resolver ~2,000.
`src/dom/terminal.ts` (1,357 lines) owns every controller. Host events: appearance, bell, data,
error, frame, resize, scroll, selection, title.

| Feature                                                                                     | Where                                                                     | Verdict                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| WASM runtime, ABI, bridge, terminal ops, input encoding, damage, packed rows, history reads | `src/core/`, `src/term/session.ts`                                        | Core                                                                                   |
| Native selection, pointer and mouse arbitration, keyboard/IME/paste                         | `core/selection.ts`, `dom/pointer.ts`, `dom/selection.ts`, `dom/input.ts` | Core: one owner arbitrates gestures and keys                                           |
| Scheduler, row renderer, atlas, WebGPU backend                                              | `src/render/`                                                             | Core                                                                                   |
| Renderer fallback coordinator                                                               | `render/selector.ts`, `render/fallback.ts`                                | Core, loading backends lazily                                                          |
| WebGL, Canvas2D, DOM backends                                                               | `render/webgl`, `render/canvas`, `render/dom`                             | Lazy backend modules (Phase 3)                                                         |
| Links (URL, OSC 8, providers)                                                               | `dom/links.ts` (546), `term/links.ts` (469)                               | Extension                                                                              |
| Automatic fit                                                                               | `dom/fit.ts` (563)                                                        | Split: measurement and atomic geometry commit stay; observers and auto-sizing move out |
| Scrollbar                                                                                   | `dom/scrollbar.ts` (540)                                                  | Extension                                                                              |
| Accessibility mirror and announcements                                                      | `dom/accessibility.ts` (466)                                              | Extension, in the default preset                                                       |
| Clipboard policy and copy commands                                                          | `dom/clipboard.ts` (87)                                                   | Extension; core keeps paste encoding and the OSC 52 request contract                   |
| Hotkey matching (TanStack)                                                                  | `dom/hotkeys.ts` (135)                                                    | Extension; core keeps a claim/pass key hook (Plan 205 retargets it)                    |
| Saved viewport painting                                                                     | `dom/viewport.ts` (341)                                                   | Extension                                                                              |
| HTML frame export                                                                           | `render/dom/html.ts`                                                      | Extension entry point (the site's first-frame build uses it)                           |
| Native config resolver                                                                      | `src/config-resolver/`                                                    | Already a separate entry point                                                         |
| Line editor                                                                                 | `site/src/demos/shell.ts` (~250, site only)                               | First extension                                                                        |

Platform (`apps/web/src/features/terminal/`) is the only consumer. It relies by default on fit,
pointer selection, the scrollbar and the fallback chain, and explicitly on links
(`hooks/use-links.ts`), saved viewport (`components/saved-viewport.tsx`), selection commands and
appearance updates.

House style to match: the Editor's plugins attach through a small typed context and return
disposables (`editor/packages/editor/src/plugins.ts`, `createPlugin.ts`); capabilities are either
single-owner or multi-provider (`editor/src/editor/Editor.ts`). The terminal takes that shape
without the Editor's composition machinery.

## Phase 0: the extension contract and core hooks

```ts
interface TerminalExtension {
  activate(context: TerminalExtensionContext): void
  dispose(): void
}
terminal.loadExtension(extension): TerminalExtensionHandle   // handle.dispose() unloads it
```

- The context hands out the public `Terminal` plus registration helpers whose disposables the
  terminal owns, so an extension cannot leak a listener past its own disposal.
- Load order is call order; disposal is reverse order and idempotent. If `activate` throws, every
  registration it made so far is disposed and the error reaches the host's `error` event.
- One instance attaches to one terminal. Extensions that depend on each other receive each
  other's instances from the host; there is no registry or resolver.
- Core hooks this phase adds, each with a test that an extension uses it without private access:
  - **Input claim.** `context.claimInput(handler)` sees each user key, paste and IME commit
    before it is encoded for the PTY and returns `claim` or `pass`; handlers run newest first.
    `onData` today mixes user input with protocol replies (`term/session.ts:1562–1617`); split
    them so replies never reach an input handler.
  - **Live geometry.** Synchronous grid size, cursor position and cell metrics from the session,
    not the last painted frame.
  - **Cell width.** `terminal.measure(text)` returns the cell width libghostty-vt gives a string,
    by grapheme cluster, honoring mode 2027, so no extension re-derives Unicode width.
  - **Write.** `terminal.write` stays the only output path; extensions coordinate output through
    their own API (Phase 1's `printAbove`), never by wrapping `write`.
- Done when: a test extension claims input, reads geometry, measures `👩‍💻` and CJK text, and
  disposes cleanly on terminal dispose and on its own; activation failure rolls back.

## Phase 1: the line editor

A separate package beside the core (name decided with the owner; working name
`ghostty-webgpu-line-editor`) that turns a terminal into a local prompt for a host that has no PTY,
like the site's just-bash Shell.

```ts
const editor = new LineEditor({ history, complete, isComplete })
terminal.loadExtension(editor)
const line = await editor.read({ prompt: 'ghost:~$ ', signal }) // resolves on Enter
editor.printAbove('output that arrived while the user typed\n')
```

- Model, keymap and rendering are separate modules. The model is the line as grapheme clusters;
  rendering computes cells with `terminal.measure`, handles prompts with escape sequences, wraps
  across rows and redraws only from the first changed cell.
- Editing: printable input and paste, Backspace/Delete, Left/Right, Home/End, Ctrl+A/E/B/F,
  Alt+B/F and Ctrl+Left/Right by word, Ctrl+W/U/K/Y (kill and yank), Ctrl+L clear, Ctrl+D on an
  empty line ends input, Up/Down history, Ctrl+R reverse search.
- Ctrl+C prints `^C`, clears the line and resolves `read()` with an interrupt result, so the shell
  decides what it means. `read({ signal })` aborts cleanly; a second `read()` while one is
  pending rejects.
- History: bounded, in memory by default; persistence is the host's choice through a small store
  interface, never a shared `localStorage` key.
- Completion: `complete(line, cursor) → Promise<candidates>`; one candidate inserts it, several
  insert their common prefix, a second Tab lists them below the line. Stale results from an
  earlier keystroke are dropped.
- Multi-line: `isComplete(text)` decides whether Enter submits or continues on a secondary prompt.
- Output: `printAbove(text)` clears the edit line, writes the text, and repaints prompt and line
  where they were; while no `read()` is pending it just writes.
- The site's Shell tab replaces its hand-written editor (`site/src/demos/shell.ts`) with this
  extension, completion from just-bash's command list and the in-memory filesystem, and `bench`
  output through `printAbove`.
- Done when: unit tests cover the model and keymap; browser tests type, edit mid-line, complete,
  search history, paste multi-line text, press Ctrl+C and resize while editing, with CJK, emoji
  ZWJ sequences and a colored prompt; the site's Shell does all of it on a phone and a desktop.

## Phase 2: move the misplaced features out

One extension per step, each its own PR. Each step updates Platform's terminal mount to load the
extension and deletes the core code and options it replaces (no shims; greenfield rule).

1. Links: web links, OSC 8 and host link providers.
2. Fit: automatic sizing to the host element. Core keeps font measurement and the atomic geometry
   commit (font, grid, padding, insets, DPR); the extension owns observers and policy.
3. Scrollbar, contributing its width to geometry through a core inset hook.
4. Accessibility: frame mirror, cursor status and announcements.
5. Clipboard and hotkeys: browser copy policy and the TanStack matcher leave core; core keeps the
   claim/pass key hook and the OSC 52 request contract.
6. Saved viewport and HTML export become extension entry points; the site's first-frame build
   imports HTML export from there.

For each step: the extension uses only public hooks (a hook it needs lands in core first), the
package's browser tests and Platform's terminal scenarios pass, and `bun run bench:renderer`
shows no regression on the hardware adapter for anything near the frame path.

Ship a `defaultExtensions()` preset (fit, scrollbar, links, accessibility, clipboard) for hosts
that want today's behavior in one call; Platform and the site load what they use explicitly.

## Phase 3: lazy renderer backends

WebGL, Canvas2D and DOM backends become modules the core fallback coordinator imports only when
the chain reaches them. Core keeps the coordinator, abort handling, state replay and canvas
replacement; WebGPU stays in core. Done when a WebGPU visitor downloads none of the fallback
code (measured bundle size before and after in this plan) and the fallback, context-loss and
no-Canvas tests still pass.

## Phase 4: an ecosystem others can join

- `docs/extensions.md`: the contract, the hooks, lifecycle rules, and a minimal example.
- An extension template folder with its own tests.
- The site lists the extensions with one line each.
- Candidate next extensions, not scheduled: search (needs cell-range mapping and decorations in
  core), serialize, image protocols, OSC 9 progress, attach (WebSocket PTY), a damage recorder.

## Order and gates

0 → 1 → 2 (steps in order, each its own PR) → 3 → 4. Phase 1 can merge before Phase 2 starts.
Every PR gets an independent review before merge. The release carrying Phases 0–2 waits for the
owner's minor or major version approval; until then extension packages are workspace-only and the
site and Platform consume them from the monorepo.

## Owner questions

- Package names: scoped (`@ghostty-webgpu/line-editor`, needs the npm scope) or flat
  (`ghostty-webgpu-line-editor`).
- The version for the release that ships the new contract (minor or major).

## Done when

- `loadExtension` and the Phase 0 hooks are public and documented.
- The site's Shell runs on the line editor extension and edits like bash on phone and desktop.
- Links, fit, scrollbar, accessibility, clipboard, hotkeys, saved viewport and HTML export live
  outside core, Platform loads them explicitly, and core no longer contains them.
- Fallback renderers load only when needed.
