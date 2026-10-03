# Plan 205: ghostty-webgpu on @fregat/hotkeys

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner. Depends on
  [203](203-fregat-hotkeys.md). Runs in parallel with [204](204-editor-on-fregat-hotkeys.md);
  [206](206-platform-one-keymap.md) consumes it.
- Decisions: [Keymap architecture](../docs/keymap/architecture.md). Research:
  `/work/reports/keymap-architecture/` (`04-current-state.md` §3, `01-prior-art-vscode-zed-helix.md`
  on Zed's terminal context and VS Code's `commandsToSkipShell`).
- Work happens in Fregat's `ghostty-webgpu/` after [207](207-one-repo-with-mirrors.md) moves it
  there. Prepare with 204 and coordinate hosted-consumer adoption with 206; migrate callers
  and delete replaced APIs in the same completed cutover.

## Outcome

ghostty-webgpu is standalone on `@fregat/hotkeys` with its own small, overridable default
bindings. Inside a host it registers as a `Terminal` focus node in the host's dispatcher and binds
nothing; the host's terminal layer decides which keys go to the shell, following Zed.

## Design

- **Replace `src/dom/hotkeys.ts`** (135 lines; `compileHotkey`, `compileTerminalHotkeyBindings`,
  per-binding `matchesKeyboardEvent` checks) with a library dispatcher and node.
- **Standalone defaults as an exported pack:** copy and paste (Cmd+C/V on macOS, Ctrl+Shift+C/V
  elsewhere), select all, clear, font size, and today's custom key handler cases. Users override
  with a bindings object, as in the Editor.
- **Commands:** terminal actions become named commands (`terminal.copy`, `terminal.paste`, …) and
  `terminal.sendKeystroke` with the keystroke as its argument, which a layer uses to hand a key to
  the shell (Zed's `terminal::SendKeystroke`).
- **Input rule:** a key no candidate handles goes to the shell. A key the host binds in a
  shallower context reaches the host unless the `Terminal` layer binds it to
  `terminal.sendKeystroke`.
- **Shell-keys pack:** export an opt-in pack that binds every Ctrl+letter (and the readline
  Alt keys) to `terminal.sendKeystroke`, for heavy terminal users. 206 exposes it as a setting.
- **Context:** the node publishes `Terminal`, plus `mode` for alternate screen and mouse
  reporting so layers can differ for full-screen programs.
- **Host path:** `claimKeybinding` moves to the library; Platform's capture listener on the
  terminal host (`apps/web/src/features/terminal`) is replaced in 206 by node registration.

## Integration with terminal extensions and worker mode

[286](286-ghostty-extensions.md) moves matching/default bindings into a hotkeys extension;
core retains a claim/pass input hook. [287](287-ghostty-worker-mode.md) keeps setup, focus-node
registration and input claims synchronous on the host in both entries, before native encoding
is queued. Native protocol replies bypass these hooks.

Retarget the matcher/default packs below to that extension. A standalone terminal attaches its
own dispatcher through the extension; a hosted terminal registers a focus node in the window
owner through a host adapter and binds no second matcher. `terminal.sendKeystroke` hands the
key to native encoding only after synchronous claim/pass arbitration. Registration disposal
removes bindings and the focus node without replacing the native execution owner.

At launch, reconcile the exact landed 286/287 host hook and extension APIs with their active
owners. Coordinate shared host files and include both main/worker entries in input acceptance.
This needs their relevant contract, not completion of every extension or worker phase.

## Steps

Execution started 2026-10-03 in the command-foundation wave. The terminal producer owns the
adapter, packs and minimum host connection needed by this plan, preserving active 286/287
scaffold contracts. Plan 206 owns final caller integration, review and shipping. Local development
uses the hotkeys workspace; exact standalone installation is qualified under Plan 207 while npm
remains deferred.

- [ ] Link `@fregat/hotkeys`; port the current bindings to a pack and the dispatcher, with the
      existing hotkey tests passing.
- [ ] Add the node API and `terminal.sendKeystroke`; test that unbound keys reach the PTY and a
      host-bound key does not unless the terminal layer sends it.
- [ ] Export the default pack and the shell-keys pack; document both in the README.
- [ ] Delete `src/dom/hotkeys.ts` and the custom key handler path the pack replaces.
- [ ] Run the repo's browser tests, including WebKit/Firefox via
      `scripts/playwright-webkit-arch.sh` where the repo requires it.

## Acceptance

- Standalone: copy/paste and the other defaults work on all three platforms; a user bindings
  object overrides one.
- Hosted: with a host binding Ctrl+B in `Workspace` and no terminal binding, Ctrl+B reaches the
  host; with the shell-keys pack, Ctrl+B reaches the shell.
- Tests and build pass; Platform's current terminal still works against the pinned build until
  206 switches it.

## Out of scope

Platform's terminal layer contents and the setting (206).
