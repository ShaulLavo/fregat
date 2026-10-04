# Plan 204: The Editor on @fregat/hotkeys

## Status and authorization

- Status: DELIVERED 2026-10-04 in [PR #603](https://github.com/ShaulLavo/fregat/pull/603).
  Installed release and live verification passed. Approved by the owner on 2026-09-29. Depends on
  [203](203-fregat-hotkeys.md). Runs in parallel with [205](205-ghostty-on-fregat-hotkeys.md);
  [206](206-platform-one-keymap.md) consumes both.
- Decisions: [Keymap architecture](../docs/keymap/architecture.md). Research:
  `/work/reports/keymap-architecture/` (`02-codemirror-and-hosts.md`, `04-current-state.md` §1).
- Work happens in Fregat's `editor/` after [207](207-one-repo-with-mirrors.md) moves it there.
  Coordinate the consumer cutover with [206](206-platform-one-keymap.md): migrate every web
  and TUI caller before deleting the old options, runtime and exports in that same completed
  change. Prepare and test 204/205 in parallel; ship their integration with 206 without
  compatibility shims or an intermediate release that breaks current callers.

## Delivery evidence

The [command foundation delivery record](../docs/keymap/command-foundation-delivery.md)
records the integrated source, independent review, green CI, exact standalone family proof,
and qualified large-file comparison. Installed release
`20261004T102110Z-fa40610d-main-c24b3184` passed its live check on 2026-10-04.
npm setup remains deferred.

## Outcome

The Editor works like CodeMirror. It ships a minimal built-in keymap, exports its packs as data,
and layers the user's object on top. It owns no key runtime of its own: standalone, it creates a
`@fregat/hotkeys` dispatcher; inside a host, it registers as a focus node in the host's
dispatcher and binds nothing. `enabled` is gone. The Markdown pack exists but is off by default.

## Design

- **Base keymap:** what every editor needs and CodeMirror's `standardKeymap` covers: caret
  movement, selection extension, deletion, Enter, Tab indent (respecting tab focus mode),
  undo/redo, select all, copy/cut/paste. Everything else is a pack.
- **Packs as data:** today's packs become exported, named values (`vscodeNavigationPack`,
  `vscodeEditingPack`, …, `suggestPack`, `markdownPack`, the diff view's read-only selection) in
  the library's `Binding` shape with Zed context predicates. Hosts import, modify and pass them
  back, the pattern of the spellcheck and highlighting services.
- **Options:** `keymap?: { packs?: Pack[]; bindings?: Binding[] }` for a standalone editor, where
  the default `packs` is the VS Code set without Markdown, and `hotkeys?: Dispatcher` for a hosted
  one. With `hotkeys`, the Editor registers its node and adds no bindings; the host's keymap
  decides everything. `setKeymap()` stays for live changes.
- **Context:** the node publishes Zed-style context: `Editor`, `mode` (`full`, `single_line`,
  `diff`), `extension`, `writable`, `hasSelection`, `tabFocusMode`, and the plugin keys
  (`findVisible`, `suggestWidgetVisible`, `parameterHintsVisible`,
  `parameterHintsMultipleSignatures`, `markdown`). Plugins register context keys the same way they
  do today. Command-name condition injection (`withEditorConditions`) becomes explicit predicates
  in the packs. The read-only mutation gate stays in the command handler, not in predicates.
- **Raw key paths become commands.** Each site in `04-current-state.md` §1.5 that implements a
  shortcut turns into a command with a context predicate: Markdown list Tab/Shift+Tab, find widget
  keys (and it stops calling `stopPropagation` on every key), rename Enter/Escape, hover/tooltip
  keys, link Enter, pane-handle F6/arrows. Genuine text-input handling (composition, completion
  commit characters, the Mod-held definition-link hover) stays where it is. `keyParticipant` is
  deleted if nothing needs it afterwards.
- **Handled keys** call `preventDefault` and never `stopPropagation` by default.
- **Delete** `packages/editor/src/keymap/runtime.ts`, `trie.ts`, `types.ts`, `conditions.ts`,
  `editor/keymap.ts`'s controller and the three re-export routes once the library covers them;
  keep `presets.ts` content as the packs.

## Steps

Execution started 2026-10-03 in the command-foundation wave. The Editor producer owns the
family source and pack snapshots; Plan 206 owns final caller integration, review and shipping.
Local development uses the hotkeys workspace. Exact standalone family installation is qualified
under Plan 207 while npm remains deferred.

- [x] Link `@fregat/hotkeys`; add the node registration and standalone dispatcher with the existing chord browser tests
      (`packages/editor/test/chords.browser.test.ts`) passing on it.
- [x] Convert packs to data with predicates; replace the `keymap-bindings.baseline.json` test with
      one snapshot per exported pack.
- [x] Split the base keymap from the packs; default standalone packs exclude Markdown.
- [x] Convert the raw key sites to commands one at a time, each with its existing tests passing.
- [x] Remove `enabled`, `defaultBindings`, the old runtime, trie, conditions and re-export routes;
      update `packages/editor/README.md` "Chords and host keymaps", the Markdown README and the
      lsp-plugin note about hosts binding suggest commands.
- [x] Diff package: pass its read-only pack set through the new options.

## Acceptance

- Standalone editor with no `keymap` option: base keys plus the default packs work; Mod+B in a
  Markdown file does nothing; adding `markdownPack` makes it bold.
- Hosted editor (`hotkeys` passed): the Editor installs no keydown listener for bindings; a host
  binding in `Editor && extension == md` context runs the Editor command.
- The Editor's full test suite, typecheck and health checks pass; the chord browser tests run
  against the library.
- No `stopPropagation` on keys the Editor handles, except where a test documents why.

## Out of scope

Platform's keymap and presets (206), Markdown toolbar or rich-view formatting, a Vim pack.
