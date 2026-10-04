# Plan 206: Platform owns one keymap

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner. Depends on
  [203](203-fregat-hotkeys.md), [204](204-editor-on-fregat-hotkeys.md) and
  [205](205-ghostty-on-fregat-hotkeys.md).
- Decisions: [Keymap architecture](../docs/keymap/architecture.md). Research:
  `/work/reports/keymap-architecture/` (`01-prior-art-vscode-zed-helix.md`,
  `04-current-state.md` §2).
- Greenfield: replace the preset and override settings without migration; delete obsolete tests,
  docs and persisted keybinding state.

## Terminal launch contract

Before the coordinated cutover, reconcile [205](205-ghostty-on-fregat-hotkeys.md)'s hotkeys
extension and hosted focus-node adapter against active [286](286-ghostty-extensions.md)/
[287](287-ghostty-worker-mode.md) work. Host claim/pass arbitration stays synchronous before
native input encoding in both terminal entries. Verify app-bound keys are claimed once,
unhandled and shell-bound keys reach the terminal once, text composition remains intact, and
native protocol replies bypass host key hooks. Match registration/disposal to the landed host
API; do not create a second dispatcher or make the whole terminal program a prerequisite.

## Why

Platform runs one matcher today but does not decide its editor keys: `default-bindings.ts:42`
copies every row of the Editor's default pack into its table, and `active-bindings.ts:107` never
compares bindings from different panes. So the Editor's Markdown Mod+B silently took Toggle
sidebar, and Mod+[ / Mod+] indent silently take navigate back/forward in every writable editor.
Embedded editors still build their own tables and listeners behind `enabled: false`, raw key
handlers bypass both keymaps, and the web terminal has no list of keys the shell keeps.

## Outcome

One `@fregat/hotkeys` dispatcher per window owns every key in the web app. Editors and terminals
are focus nodes in it and bind nothing. Contexts stack along the focus path, the focused layer
wins, and unhandled keys fall through (Zed). Presets are data: `ours` (starts as an exact copy of
Zed), `zed` (an exact copy that tracks Zed) and `vscode`. The Markdown pack is off; the terminal
layer is Zed's, with an opt-in shell-keys pack.

## Design

- **Contexts.** `Workspace` at the root; below it the areas in `FOCUS_AREAS`
  (`packages/client-core/src/commands/focus.ts:1`) as Zed-style contexts: `Sidebar` with
  `FileTree`, `Git`, `Search`; `Editor` (204's node); `Terminal` (205's node); `Chat`,
  `CommandPalette`, `Dialog`, `Settings`, `Logs`, `Problems`. The focus service sets the node path;
  the `pane` field and `activeBindings` pane sort go away. Platform's `CommandWhen` enum
  (`apps/web/src/keymap/utils/when.ts`) becomes context keys and predicates.
- **Presets as data.** Chords move out of `packages/client-core/src/commands/*` metadata into
  preset files under `apps/web/src/keymap/presets/`; commands keep a map to them through the
  preset, not inline `keys`.
  - `zed`: Zed's `assets/keymaps/default-linux.json` and `default-macos.json` from
    `references/zed`, pinned by commit, translated section by section (context → our context,
    action → our command id). Rows with no equivalent command are listed as unmapped in Settings,
    as today.
  - `ours`: starts byte-for-byte equal to `zed`'s translation, then diverges only by the owner's
    choices, each recorded in the file.
  - `vscode`: today's VS Code rows for app commands plus the Editor's exported VS Code packs,
    imported as named data from 204.
  - Editor packs enter a preset only by name (`vscodeEditingPack`, …); nothing follows "whatever
    the Editor's defaults are". The Markdown pack is in no preset.
- **Terminal.** The `Terminal` section of `ours`/`zed` sends Zed's listed keys to the shell
  through `terminal.sendKeystroke`. A setting (`terminal.shellKeys`, application scope) adds 205's
  shell-keys pack for heavy terminal users.
- **User bindings copy Zed:** `keybindings.overrides` becomes a list of
  `{ keys, command | null, context? }`, with `unbind`. A user binding in a context the user names
  beats defaults at that depth; a deeper default still wins, and Settings shows which binding
  hides which as information. Replace `keybindings.preset` values with `ours | zed | vscode`,
  default `ours`. Run `bun run settings:reference`.
- **Editors and terminals** register as nodes: delete `HOSTED_EDITOR_KEYMAP`
  (`apps/web/src/keymap/editor-keymap.ts`) and its three call sites (`editor.tsx:244`,
  `diff-pane.tsx:122`, `result-file-editor.tsx:115`), and the terminal capture listener that calls
  `claimKeybinding`.
- **Raw handlers.** Audit the 48 `onKeyDown` props and 11 raw `keydown` listeners in
  `apps/web/src`: a handler that implements a shortcut becomes a command in a context (notably the
  chat Mod+S stash, commit Mod+Enter, file-tree Mod+A / Mod+Space); widget-internal navigation
  (listbox arrows, text-field keys) stays. Replace the `useHotkeys` digits in
  `use-question-digits.ts` with a `Question` context.
- **Command ids:** fix the doubled `editor.editor.action.*` ids and the duplicate go-to-definition
  id while touching the table.
- **TUI, infrastructure only.** Replace `apps/tui/src/commands/state/keymap.ts` with the library
  core and its terminal-input adapter. Keep the TUI's current bindings and rules
  (`apps/tui/src/commands/utils/bindings.ts`); if the new overrides shape breaks TUI overrides,
  that is accepted until the TUI redesign. Take OpenTUI key events through
  [202](202-tui-ui.md)'s integration. Its app-local controls use this dispatcher; the former
  standalone toolkit and renderer-fork workstream is superseded.
- **Delete** `keymap-session.ts`, the trie/runtime imports from `@singapore-editor/core/keymap`,
  `presetConflict`/`lostChords` machinery replaced by Platform's shadow report,
  built from the library's `bindingsForInput`,
  `docs/keymap/matcher-baseline.json` and `verification.json`; retire `delivery.md` and
  `modes.md` into [architecture.md](../docs/keymap/architecture.md). Adjust
  [166](166-bare-function-keys.md) to contexts if it has not landed.

## Coordinated cutover

After 207 establishes the canonical source, prepare 204 and 205, migrate all current web/TUI
imports and hosted options here, then delete obsolete runtimes and exports in that same
verified release. Keep command IDs, titles, typed arguments and mutation policy in the catalog;
binding packs and host presets own chords. Reconcile Editor E026's historical inline-binding
requirements with this ownership before implementing its remaining catalog work.

## Steps

- [ ] Translate Zed's default keymaps into `zed` and `ours`; list unmapped actions.
- [ ] Wire the dispatcher and contexts from the focus service; port the command bus to handle
      node commands; keep `bun run gates` green.
- [ ] Register editors and terminals as nodes (204, 205); delete the hosted keymap and capture
      listener.
- [ ] New overrides and preset settings; build the binding-shadow report in Platform from
      `bindingsForInput` and show it in Settings. The library deliberately exposes no report API.
- [ ] Raw handler audit and conversions; `use-question-digits` onto a context.
- [ ] TUI matcher onto the library.
- [ ] Scenarios in `scripts/agent/scenarios/` with selectors in `scripts/agent/selectors.ts`:
      Mod+B toggles the sidebar with a Markdown file focused; Mod+[ navigates back from an editor
      under `ours`; Ctrl+B reaches the shell in a Linux terminal under the default layer and with
      `terminal.shellKeys`; a Mod+K chord started in the editor cancels on focus change.
- [ ] Measure: keystroke `trace --compare` before and after, typing in a large file inside the
      8.3 ms budget.
- [ ] Deploy with `bun run install-release`, or `--server --restart` if server code changed.

## Acceptance

- Every key in the web app resolves through one dispatcher; no Editor or terminal instance
  installs its own binding listener.
- The scenarios above pass with evidence read back; `bun run gates` and the keymap, settings and
  terminal test suites pass.
- Settings lists presets `ours`, `zed`, `vscode`, shows unmapped Zed actions and shadowing
  information, and records user bindings with contexts.
- Keystroke latency is no worse than before (`trace --compare`).

## Out of scope

The TUI's keymap design (its own redesign plan), Markdown formatting UI, a Vim pack.
