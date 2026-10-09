# Plan 206: Platform owns one keymap

## Status and authorization

- Status: DELIVERED 2026-10-04 in [PR #603](https://github.com/ShaulLavo/fregat/pull/603).
  Installed release and live verification passed. Approved by the owner on 2026-09-29. Depends on
  [203](203-fregat-hotkeys.md), [204](204-editor-on-fregat-hotkeys.md) and
  [205](205-ghostty-on-fregat-hotkeys.md).
- Decisions: [Keymap architecture](../docs/keymap/architecture.md). Research:
  `/work/reports/keymap-architecture/` (`01-prior-art-vscode-zed-helix.md`,
  `04-current-state.md` §2).
- Greenfield: replace the preset and override settings without migration; delete obsolete tests,
  docs and persisted keybinding state.

## Terminal launch contract

The hosted terminal uses [205](205-ghostty-on-fregat-hotkeys.md)'s
`attachTerminalHotkeys` connection and the existing window dispatcher. Its finite owner claims
original input synchronously before native encoding. A finite pass reaches explicitly installed
peer general input contributions, then native once. Generated commands and protocol replies
bypass original-input owners. Hotkeys attachment never constructs a general extension manager.

Verify app-bound keys are claimed once, unhandled and shell-bound keys reach the terminal once,
and physical events and text composition retain their ownership. Registration disposal removes
only the terminal node/observer and its finite lease; the window dispatcher and native owner stay
live. The main entry supplies immediate native modes. Worker finite connections reject through
their Promise convention, while landed [286](286-ghostty-extensions.md)/
[287](287-ghostty-worker-mode.md) public APIs and worker behavior remain peer-owned.
The valid failed general-manager X6 window remains failed and authorizes no performance claim
for this connection. Final candidate functional, artifact and latency evidence binds its own source.

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

### Execution 2026-10-03

Status: Delivered 2026-10-04, with inspected installation and live release.
The owner requested the wave through completion and renewed npm deferral.
The integrated 204/205/206 release has all callers migrated,
the replaced APIs removed, independent review, green CI and inspected deployment. Document
runtime work, native clients, icon work and the TUI redesign stay in their separately scheduled
programs.

The Editor and terminal producers prepared isolated source branches. A single integration owner
combined them with the window/TUI dispatcher, preset translation, settings and raw shortcut
lanes. The coordinator completed plan reconciliation, reviewed package artifacts, merges and shipping.
The terminal lane preserved the landed 286/287 host contracts needed here; their whole programs
remain independent. Exact standalone family installation passed its gate under Plan 207.

- [x] Pin the source inventory and old host binding tables.
- [x] Capture the 20,000-line typing baseline and read its screenshot.
- [x] Reproduce Markdown Mod+B formatting while the sidebar remains visible; read the screenshot.
- [x] Prove root workspace versus isolated-family catalog resolution with no npm publication.
- [x] Integrate final Editor, terminal, settings and raw-handler source, and remove obsolete APIs.
- [x] Qualify actual isolated family installation from the final reviewed dependency artifact.
- [x] Run the required scenario, input ownership and typing comparison checks; inspect evidence.
- [x] Complete independent review, fix findings, pass all 21 PR checks and merge PR #603.
- [x] Inspect the served release after installation and restart.

Execution receipts: `/work/reports/command-foundation-2026-10-03/`. The baseline Markdown
scenario completed at `/work/tmp/fregat-evidence/20261003T163951Z-scenario-markdown-authoring/`;
its unrelated temporary-file read warnings are tracked in Fregat issue 568.

### Delivery checklist

- [x] Translate Zed's default keymaps into `zed` and `ours`; list unmapped actions.
- [x] Wire the dispatcher and contexts from the focus service; port the command bus to handle
      node commands; keep `bun run gates` green.
- [x] Register editors and terminals as nodes (204, 205); delete the hosted keymap and capture
      listener.
- [x] New overrides and preset settings; build the binding-shadow report in Platform from
      `bindingsForInput` and show it in Settings. The library deliberately exposes no report API.
- [x] Raw handler audit and conversions; `use-question-digits` onto a context.
- [x] TUI matcher onto the library.
- [x] Scenarios in `scripts/agent/scenarios/` with selectors in `scripts/agent/selectors.ts`:
      Mod+B toggles the sidebar with a Markdown file focused; Mod+[ navigates back from an editor
      under `ours`; Ctrl+B reaches the shell in a Linux terminal under the default layer and with
      `terminal.shellKeys`; a Mod+K chord started in the editor cancels on focus change.
- [x] Measure: keystroke `trace --compare` before and after, typing in a large file inside the
      8.3 ms budget.
- [x] Inspect the completed `bun run install-release --server --restart` live release.

### Delivery evidence

The [delivery record](../docs/keymap/command-foundation-delivery.md) pins final source
`6da512054154358ed6e9e0681884bf38ddd91f85`, merged main
`8d4694a20e79fada7acc2b0e97e0fe80762480c5`, exact family qualification and registered
large-file pair 03. All 280 inputs, including five newlines, meet the processing criteria.
Candidate processing p95 is 4.567 ms and maximum is 6.565 ms; reported-browser presentation
p95 is 64.629 ms. Pair 02 remains a valid failed maximum result. The reviewed minimap
publication fix precedes pair 03; no failed result was filtered or replayed.

## Acceptance

- Every key in the web app resolves through one dispatcher; no Editor or terminal instance
  installs its own binding listener.
- The scenarios above pass with evidence read back; `bun run gates` and the keymap, settings and
  terminal test suites pass.
- Settings lists presets `ours`, `zed`, `vscode`, shows unmapped Zed actions and shadowing
  information, and records user bindings with contexts.
- The preregistered processing p95 comparison passes across all 280 inputs, with every owning
  task retained, and candidate processing maximum is ≤8.3 ms.
- Qualified reported-browser presentation p95 is no worse than baseline. Retain presentation
  p50 and maximum separately; this criterion makes no 8.3 ms display-latency claim.

## Out of scope

The TUI's keymap design (its own redesign plan), Markdown formatting UI, a Vim pack.

The initial `ours` deviation keeps the approved document-navigation keys: Mod+[ and Mod+] dispatch `workspace.navigateBack` and `workspace.navigateForward` at Workspace depth. The four source rows record this choice; `zed` retains the pinned Editor indent/outdent bindings.

Chord cancellation retains Plan 203: an unbound nonprintable prefix waits for its next key; a bound prefix expires and executes after the continuation timeout. Focus, blur and pointer changes cancel the pending owner.

## Fregat's own commands in `ours`

Found 2026-10-09: since #603, the application rows in `apps/web/src/keymap/presets/vscode-app.json` loaded only under `vscode`, so under the default `ours` preset commands with no Zed action had no key. Fix problem with AI (Mod+. on a problem) was one of them, and its row button sits outside the Tab order, so the keyboard could not reach it. Reproduce on the old build: default settings, focus a diagnostic in Problems, press Ctrl+.; no draft opens.

Owner decision 2026-10-09: `ours` gives every Fregat command a key, reusing the `vscode` key where Zed leaves it free and never shadowing a Zed default.

- [x] `ours` loads every `vscode-app.json` row whose command no Zed row binds on that platform (`fregatBindings` in `apps/web/src/keymap/default-bindings.ts`); 24 rows per platform.
- [x] Two Zed actions with exact Fregat equivalents are now translated in `zed.json`, so both Zed presets bind them: `pane::ActivateLastItem` is `workspace.selectItem9` (Alt+0 on Linux, Ctrl+0 on macOS) and `multi_workspace::ToggleWorkspaceSidebar` ("Toggle Threads Sidebar") is `workspace.toggleSessionRail` (Mod+Alt+J).
- [x] Keys Zed uses in an overlapping context move, recorded with reasons in `apps/web/src/keymap/presets/ours-fregat.json`:

| Command                                             | `vscode` key           | `ours` key                            | Zed binding it avoids                                                    |
| --------------------------------------------------- | ---------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `workspace.toggleCheckpointChange` (Git)            | Mod+Backspace          | Mod+Shift+Backspace                   | Git changes list: Restore File                                           |
| `workspace.historyBack` (Editor)                    | Mod+Alt+Z              | Mod+Alt+U                             | Editor: git Restore (macOS), Reject; Workspace: Rate Predictions (Linux) |
| `workspace.historyForward` (Editor)                 | Mod+Alt+Shift+Z        | Mod+Alt+Shift+U                       | pairs with History: back, as Zed pairs Mod+U and Mod+Shift+U             |
| `workspace.focusNextTerminal` (Terminal, Linux)     | Ctrl+PageDown          | Ctrl+Alt+PageDown                     | Pane: Activate Next Item                                                 |
| `workspace.focusPreviousTerminal` (Terminal, Linux) | Ctrl+PageUp            | Ctrl+Alt+PageUp                       | Pane: Activate Previous Item                                             |
| `workspace.toggleDiffViewMode`                      | Mod+Shift+D            | Mod+Alt+Shift+D                       | Workspace: debug panel                                                   |
| `workspace.toggleUiMode`                            | Mod+Shift+M            | Mod+Alt+Shift+M                       | Workspace: Problems                                                      |
| `workspace.newSession`                              | Mod+Alt+N in Workspace | Mod+Alt+N in `Workspace && !FileTree` | file tree: New Folder                                                    |
| `workspace.toggleSessionRail`                       | Mod+Alt+B              | Mod+Alt+J (Zed's own row)             | Workspace: Toggle Right Dock                                             |
| `workspace.selectItem9`                             | Alt+9 / Ctrl+9         | Alt+0 / Ctrl+0 (Zed's own row)        | Pane: Activate Item 9                                                    |

- [x] `apps/web/src/keymap/tests/ours-fregat.test.ts` fails when an application command has no `ours` key on Linux, macOS or Windows, or when an added key matches a Zed key (mapped, unmapped or reserved) in an overlapping context.
- [x] Fix with AI on a problem answers Mod+. under the default preset, the row's keyboard action; the button stays out of the Tab order so the Problems tree keeps one stop.
