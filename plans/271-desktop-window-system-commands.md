# Plan 271: Desktop window, app-menu and system commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-52; size L. Depends on Plan 206, Plan 234, Plan 220.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Preserve action identity and every payload variant.

## Outcome

Create and close windows safely, control desktop application visibility/fullscreen, navigate app menus, and open files or character input through the host.

## Zed actions and behavior

- `workspace::NewWindow` creates a workspace window. `workspace::CloseWindow` prepares every
  workspace in that window and aborts when an unsaved-item prompt is cancelled. `zed::Quit`
  prepares all workspace windows before exiting. Sources: [`crates/zed/src/zed.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed/src/zed.rs)
  `quit`/NewWindow registration and [`crates/workspace/src/workspace.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/workspace/src/workspace.rs)
  `prepare_to_close`/`prepare_windows_to_quit`.
- `zed::Hide`, `zed::HideOthers`, `zed::Minimize`, `zed::ToggleFullScreen` invoke host application
  or window operations; HideOthers is macOS-specific. Fullscreen follows the host's configured
  standard/simple mode. Sources: [`crates/zed/src/zed.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed/src/zed.rs),
  [`crates/gpui/src/window.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/gpui/src/window.rs).
- `app_menu::OpenApplicationMenu` takes a menu-name string; `app_menu::ActivateMenuLeft` and
  `app_menu::ActivateMenuRight` move between client-side menus. Zed registers these for its
  non-macOS client menu bar. Sources: [`crates/title_bar/src/application_menu.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/title_bar/src/application_menu.rs),
  [`crates/title_bar/src/title_bar.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/title_bar/src/title_bar.rs).
- `workspace::OpenWithSystem` opens the selected tree entry's absolute path in the default app.
  Source: [`crates/project_panel/src/project_panel.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/project_panel/src/project_panel.rs) `open_system`.
  `editor::ShowCharacterPalette` and `terminal::ShowCharacterPalette` show the native character
  chooser for the focused input; terminal checks writability/input mode. Sources:
  [`crates/editor/src/editor.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs) `show_character_palette`,
  [`crates/terminal_view/src/terminal_view.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/terminal_view/src/terminal_view.rs) `show_character_palette`.

`app_menu::ActivateMenuLeft`, `app_menu::ActivateMenuRight`, `app_menu::OpenApplicationMenu`, `editor::ShowCharacterPalette`, `terminal::ShowCharacterPalette`, `workspace::CloseWindow`, `workspace::NewWindow`, `workspace::OpenWithSystem`, `zed::Hide`, `zed::HideOthers`, `zed::Minimize`, `zed::Quit`, `zed::ToggleFullScreen`.

## Existing Fregat and Editor work

`apps/desktop/src/shared/bridge.ts` and `apps/desktop/src/shared/rpc.ts` expose appearance and file picking, with preload
wiring in `apps/desktop/src/preload/index.ts`. `apps/desktop/src/bun/index.ts` creates the window;
`apps/desktop/src/bun/quit.ts` coalesces quit requests and awaits cleanup. That cleanup is not a dirty-buffer guard.
`apps/mac/Sources/MacApp/main.swift` is a minimal windowed shell. Shared menu rendering lives in
`apps/web/src/keymap/menus/`; workspace command handlers live in `apps/web/src/keymap/workspace-commands.ts`.
The bridge lacks the window/system command protocol required here.

## Design

Extend the typed desktop bridge with a capability snapshot and window/system operations.
Keep host APIs in the desktop owner. Register `workspace.newWindow`, `workspace.closeWindow`,
`workspace.openWithSystem`, `app.hide`, `app.hideOthers`, `app.minimize`, `app.quit`,
`app.toggleFullScreen`, `appMenu.open`, `appMenu.activateLeft`, `appMenu.activateRight`, and
input-specific character-palette commands in the command table. Bind Plan 206 preset data using
host capability keys plus `Workspace`, `AppMenu`, `FileTree`, `Editor` and `Terminal` contexts.
Preserve OpenApplicationMenu's string arguments. Menus call the same command bus.

Plan 234 owns the dirty-buffer save/discard/cancel contract. Route both command and native
window-manager close/quit requests through it before host cleanup. Scope close to one window
and quit to every window. Serialize requests with mutation scopes and recheck after a pending
request settles. System open validates a local filesystem target for the serving environment;
remote paths require the owning environment's capability. Browser fullscreen uses the browser
API where available, with command invocation retaining the user gesture. Unsupported host
operations stay unavailable and consume no browser shortcut. Follow mac-app/write-swift skills
if extending the Swift client.

## Steps

- [ ] Add failing bridge/command tests for capability absence, menu payloads and dirty-close cancellation.
- [ ] Define host capabilities and implement desktop window/system RPC with structured errors.
- [ ] Connect native close/quit and command close/quit to Plan 234 lifecycle, then existing cleanup.
- [ ] Add client app-menu navigation through shared menu primitives and character-palette dispatch to the focused writable input.
- [ ] Translate preset rows and expose capability-dependent commands; add fixture browser scenario and native smoke coverage.

## Acceptance

Run focused `apps/desktop/src/bun/tests/quit.test.ts`, bridge protocol tests and workspace
lifecycle tests. Verify repeated quit requests, cancelled dirty closes and failing saves with
an injected host adapter. Add `desktop-window-commands`: a fixture bridge records invocations,
client menus move left/right, cancellation keeps the window open, and browser capability
absence leaves native chords unclaimed. Run `agent:browser scenario desktop-window-commands`
and `look`, read screenshots and record evidence. Check fullscreen enter/exit in a browser
supporting it. Perform a desktop smoke test for OS window controls, system open and palette;
record any host/OS checks unavailable on the implementation machine. Run gates and applicable
native checks, commit, push and deploy.

## Out of scope

Implementing operating-system menu bars from browser DOM, emulating unsupported OS actions,
and the TUI's terminal UX. Work remains Approved when scheduled after the desktop prerequisites.
