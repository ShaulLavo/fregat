# Plan 246: Complete terminal input, selection, scrollback and search commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 205, Plan 206. Size: L. Triage: ZT-27.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`.
- Zed source paths below are relative to `references/zed/`, pinned at `933d8d93`.
  Read sparse files with `git -C /work/projects/platform/references/zed show HEAD:<path>`.

## Outcome

Send typed keys/text, paste raw text, select all and navigate or search terminal scrollback.

## Zed behavior

- `terminal::SendKeystroke` parses its keystroke payload and passes it through terminal mode
  encoding. `terminal::SendText` writes its literal text bytes. `terminal::PasteText` reads
  clipboard text and calls normal terminal paste. Zed honors bracketed paste, strips embedded
  escapes in that mode, and normalizes newlines otherwise. See
  `crates/terminal_view/src/terminal_view.rs:1004`, `:1041`, `:1052`, and
  `crates/terminal/src/terminal.rs:2412`.
- `terminal::ScrollLineUp`, `terminal::ScrollLineDown`, `terminal::ScrollPageUp`,
  `terminal::ScrollPageDown`, `terminal::ScrollToTop`, and `terminal::ScrollToBottom` move the
  retained viewport. Normal scrollback actions decline in the alternate screen. See
  `crates/terminal_view/src/terminal_view.rs:765` through `:885`.
- `editor::SelectAll` selects terminal text in the Terminal context. `buffer_search::Deploy`
  opens terminal search through its searchable-item implementation. See
  `crates/terminal_view/src/terminal_view.rs:702` and its `SearchableItem` implementation.

## Existing implementation

[Terminal commands](../apps/web/src/features/terminal/utils/commands.ts) already call
`selectAll`, `paste`, and `sendInput`. [Terminal socket](../apps/web/src/features/terminal/utils/socket.ts)
owns PTY transport. [Terminal panel](../apps/web/src/features/terminal/components/panel.tsx)
retains the emulator through keep-alive. ghostty's
`/work/projects/ghostty-webgpu/src/xterm/terminal.ts` exposes `scrollLines`, `scrollPages`,
`scrollToTop`, `scrollToBottom`, selection, and bracketed paste. Search requires an emulator
owner. After Plan 207, extend `ghostty-webgpu/src/`; Editor find APIs remain separate.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Command metadata belongs in
`packages/client-core/src/commands/`; web handlers and focus registration belong in
`apps/web/src/keymap/`. Plan 206 owns the preset files under `apps/web/src/keymap/presets/`.

- Finish Plan 205's typed `terminal.sendKeystroke` contract there and reuse it here. Register
  the remaining terminal commands in the catalog/table. Plan 206 `Terminal` preset rows retain
  every payload, platform, and screen/mode predicate, plus the optional shell-keys pack.
- Resolve the attached terminal instance from the focused node. Declining app commands leave
  unbound text with the shell. Ensure one PTY write per command and mode-aware key encoding.
- Correct the triage's raw-paste description: `PasteText` uses bracketed paste when requested.
  Literal raw injection is `SendText`. Keep clipboard reads within a browser user gesture and
  use the existing TanStack effect owner. PTY streaming retains its documented exception.
- Implement search over retained terminal cells with stable match coordinates, next/previous
  navigation, highlights, and clear state. ghostty owns search/viewport mechanics; Fregat owns
  the shared search UI, contexts, and command integration. Preserve Terminal SelectAll behavior.
- Keep search and viewport state per retained terminal, including detach/reattach and history
  eviction. Expose read-only and alternate-screen capabilities as focus context keys.

## Steps

- [ ] Add failing fixture-PTY command tests for encoding, literal text, paste, and target isolation.
- [ ] Complete/reuse Plan 205 input handlers and existing ghostty scroll/selection methods.
- [ ] Add retained-cell search primitives in `ghostty-webgpu/` and the Fregat search widget.
- [ ] Register commands, mode contexts, and exact translated preset rows.
- [ ] Add `terminal-command-scrollback` scenario and selectors with fixture PTY output.

## Acceptance

Run focused terminal keybinding tests and ghostty input/search fixtures. Verify literal escape
payloads, DECCKM-aware keys, both paste modes, clipboard failure, alternate-screen fallthrough,
retained-history eviction, and exactly-once writes. `terminal-command-scrollback` scrolls lines,
pages, and boundaries, selects all, searches offscreen output, then detaches and reattaches the
pane. Its commands never affect a concurrently mounted Editor or a real shell/account.

### Execution checks

Use fixture/mock providers only. Run heavy checks through
`bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Register the named scenario in `scripts/agent/scenarios/index.ts`. Run it with `bun run agent:browser scenario <name>` and capture
`bun run agent:browser look`; read screenshots back and report the evidence directory.
Any private dev server takes an explicit free `--port` and stops afterward. Run `bun run gates`
and typecheck changed packages. Commit by path, push, and ship through the mesh using
`bun run install-release` or `bun run install-release --server --restart` for server changes. Performance claims
require `trace --compare` and render counts before and after.

## Out of scope

Terminal vi mode, shell readline configuration, a second keyboard listener, and upstream
mirror publication by this worker.
