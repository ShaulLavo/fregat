# Plan 222: Expose editor text input, clipboard and snippet commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: M. Triage item: ZT-03.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Use Enter, copy/cut/paste, Escape and snippet tab stops through the command catalog in every hosted editor.

## Covered Zed actions and behavior

`editor::Cancel`; `editor::Copy`; `editor::Cut`; `editor::Newline`; `editor::NextSnippetTabstop`; `editor::OpenContextMenu`; `editor::Paste`; `editor::PreviousSnippetTabstop`.

- `editor::Newline` inserts an indented newline through the editor transaction.
  Single-line fields propagate to their host. See
  [crates/editor/src/input.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/input.rs#L543).
- `Copy`, `Cut`, and `Paste` preserve multiple-selection metadata and whole-line
  behavior for empty selections. See [crates/editor/src/clipboard.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/clipboard.rs#L542).
- `NextSnippetTabstop` and `PreviousSnippetTabstop` navigate active snippet fields;
  preset predicates include `in_snippet`, the available direction, and
  `!showing_completions`. See [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L5335) and
  `assets/keymaps/default-linux.json` at the pinned commit.
- `Cancel` dismisses the active popup before cancelling other editor interactions
  or secondary selections. `OpenContextMenu` opens actions at the selection.
  See [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L3518) and `open_context_menu` in that file.

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/editor/src/editor/Editor.ts](/work/projects/Editor/packages/editor/src/editor/Editor.ts) wires native input through `acceptsText`
and the text gate. [packages/editor/src/editor/inputSelectionController.ts](/work/projects/Editor/packages/editor/src/editor/inputSelectionController.ts) and
[packages/editor/src/editor/clipboardMetadata.ts](/work/projects/Editor/packages/editor/src/editor/clipboardMetadata.ts) own text and clipboard handling.
[packages/editor/src/editor/snippetSession.ts](/work/projects/Editor/packages/editor/src/editor/snippetSession.ts) tracks stops and mirrors with
anchors and invalidates a stale session. Fregat's
[use-editor-commands.ts](../apps/web/src/features/editor/hooks/use-editor-commands.ts)
connects hosted command execution. Plan 204 already includes Enter and clipboard
base commands; this plan extends coverage and contexts.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Expose the eight commands through the Editor catalog/router in `editor/packages/editor/`.
Reuse Plan 204's base handlers. Publish snippet and popup context keys from the
session/widget owners. Keep clipboard events, browser clipboard permission, IME,
input types, and text gates in the native input owner. A handled shortcut must
apply one edit once; its corresponding browser event cannot apply it again.

The focused plugin/widget gets Escape before the buffer handler. A single-line or
read-only editor declines unsupported mutations. Fregat supplies the selection
context-menu UI through its existing command owner; reusable selection operations
stay in Editor. Composer, settings, file, diff, and result hosts each publish their
mode so Enter reaches the intended host action.

## Steps

- [ ] Add a failing hosted input/clipboard or snippet scenario for the missing catalog entry.
- [ ] Complete Editor declarations, typed handlers, readonly gates, and snippet availability contexts after Plan 204.
- [ ] Wire all hosted editor modes to the shared dispatcher and preserve native clipboard/IME event ownership.
- [ ] Implement Escape priority and keyboard context-menu opening through the existing interaction owners.
- [ ] Translate supported preset rows, including snippet/completion precedence and multiline composer Enter.
- [ ] Add `editor-input-commands`, read screenshots back, and ship the web and Editor package change.

## Acceptance

Run affected Editor clipboard/input/snippet tests and hosted command tests. Cover
empty-selection line copy/cut, multiple selections, one paste/undo transaction,
read-only views, IME composition, mirrored snippet fields, and stale stops after
undo or edits from another view. In `agent:browser scenario editor-input-commands`,
exercise file, composer, settings, diff, and search-result hosts using fixtures.
Enter, Escape, Shift+Tab, and clipboard commands must follow the focused mode;
opening a context menu keeps the selection. Read screenshots and name the evidence.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-03" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run install-release`, or
`bun run install-release --server --restart` when server code changes. Confirm the served release.

## Out of scope

A second native input engine, Vim/Helix modes, untitled document lifecycle, and
completion acceptance extensions from Plan 223.

## Follow-up verification finding, 2026-10-10

- [ ] Resolve the demo's newline event assertion on Chromium on the Raspberry Pi.
      Run `bun run --cwd editor/examples/app test:e2e -- --workers=1 --grep 'routes native line break'`.
      `editor/examples/app/test/editor-input.spec.ts:208` expects
      `beforeinput:insertLineBreak:` in the captured input events but receives an empty
      array after 5 seconds. The preceding assertion confirms that Enter inserts
      `abc\ndef` at the intended caret. This occurred twice, including with the original
      demo source at `917e6da49` restored, ruling out lazy GitHub loading. The test creates
      a standalone editor from source and replaces the demo shell. Inspect
      `installInputEventProbe` at line 17 and the textarea/EditContext input dispatch in
      `editor/packages/editor/src/editor/inputSelectionController.ts` before changing
      the event expectation. Typing, Space, Tab, focus, history and live diff checks passed.
      Evidence is retained locally in
      `/work/tmp/fregat-evidence/20261010t110053-heavy-4cb273e69898-cc26f1-pi/playwright/`.
