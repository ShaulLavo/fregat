# Plan 114: Polaron, a desktop shell we own

> **Executor instructions**: Read this plan completely, then read `AGENTS.md` and root `PLAN.md`.
> Gate 0 is a measurement and decides the Linux renderer; do not skip it to start writing Rust.
> Do not commit, push, create a branch, publish, or open a PR without explicit operator approval.

## Status

- **State**: Proposed — needs root scheduling
- **Priority**: P2 — the shell works today (plan 073), but every week on Electrobun is a week of
  someone else's toolchain
- **Effort**: M — a few hundred lines of Rust for the first platform, then a long tail that is
  mostly deletion
- **Risk**: MEDIUM — the risk is the web engine on Linux, not the window
- **Baseline**: `c0566d48` (Electrobun 2.0.1, plan 073 landed 2026-09-13)

## Why

Plan 073 kept Electrobun for one property: the shell's `process.execPath` is Bun, so
`apps/server` runs on the shell's own runtime. Platform ships one runtime. That property is
still worth keeping. Electrobun is no longer the cheapest way to keep it.

What the 2.x migration actually cost, all measured on 2026-09-13:

- The SDK lives in a Hutch devkit projected into `apps/desktop/.hutch`, not in `node_modules`.
  TypeScript, Vitest, knip and CI each had to be told about it, and the devkit's own tsconfig
  cannot be loaded by TypeScript 7.
- Hutch builds only for the host. Three platforms means three runners and a 700 MB cache each.
- `bun Helper` dumps a 2.5 MB SIGABRT core on every exit (stack canary rotated inside
  `CefExecuteProcess`). Five cores in one two-minute run. Upstream, unfixed.
- On Linux the wrapper ignores `defaultRenderer` and takes CEF whenever `libcef.so` is present
  (`initWebview` in `nativeWrapper.cpp`), so one build cannot offer both engines.
- The wrapper forces GTK onto X11 (`setenv("GDK_BACKEND", "x11")`). That is the root of three
  bugs we papered over in `dd18c2d6`: no dark theme (no XSettings manager on Hyprland), file
  dialogs at the screen origin (no parent window), and `GDK_SCALE` doubling everything.
- Bun is now the "bridge" main process in Electrobun's own migration guide. Cottontail is the
  default. The Bun path is where their attention is not.

What the shell actually does for Platform is small: spawn the server and, in dev, Vite; open one
window at a URL; inject a preload that installs `window.platformBridge`; answer one RPC
(`pickEntry`); quit cleanly; and on macOS attach vibrancy behind a transparent window. That is
the whole surface, and it is what Polaron has to reproduce.

## The shape

Two processes, one runtime for our code.

```text
polaron (Rust binary, the process root)        bun (child, spawned by polaron)
  tao      window, event loop, main thread       apps/server/src/index.ts   (dev)
  wry      system webview, preload, ipc          server/index.js            (packaged)
  rfd      native file dialogs                   vite (dev only)
  window-vibrancy (macOS)
        │  JSON lines over the child's stdio, or a local socket
        └──────────── control channel ───────────┘
```

- **Polaron owns the window and the main thread.** AppKit and GTK insist on the main thread, and
  tao's event loop is built for that. Nothing in JS fights it.
- **Bun stays the brain.** Polaron spawns Bun exactly the way `spawnServer` does today, just
  from the other side. The bundled Bun binary ships in the app's resources. The single-runtime
  property holds: `apps/server` runs on Bun, `bun:sqlite` and all.
- **The page contract does not change.** `PlatformBridge` (`backdrop`, `platform`,
  `colorScheme`, `pickEntry`) stays as is. wry's `with_initialization_script` installs the same
  handoff prelude, and its `with_ipc_handler` carries `pickEntry` to Rust, which answers with
  `rfd` and posts the result back with `evaluate_script`. `apps/desktop/src/shared` moves to
  Polaron unchanged.
- **No FFI.** The Bun-FFI-into-a-Rust-cdylib design was considered and rejected: it is a single
  process where Bun's event loop and the GUI loop share a main thread, which is the exact problem
  Electrobun's wrapper exists to manage. Two processes cost one JSON channel and buy crash
  isolation for free.
- **Not Tauri.** Tauri is tao plus wry plus a command system, a permission model, a bundler and
  an updater. We need the first two. Its bundler is a separate crate (`tauri-bundler`) that can
  be borrowed later without adopting the framework.

### Renderer per platform

| OS      | Engine    | Notes                                                                     |
| ------- | --------- | ------------------------------------------------------------------------- |
| macOS   | WKWebView | Same engine the native app already targets. Vibrancy via window-vibrancy. |
| Windows | WebView2  | Chromium. Runtime is preinstalled on Windows 11.                          |
| Linux   | WebKitGTK | Gate 0 decides. Fallback is the system Chromium in `--app` mode.          |

## Gate 0 — The Linux engine, measured

Plan 073 rejected WebKitGTK because the editor is engine-sensitive. Nobody tested it. On
2026-09-13 the app ran on WebKitGTK 2.52 for an afternoon: the workbench, the editor, the
terminal and the logs pane all worked. The one failure, tree-sitter grammars not loading, was a
Vite allow-list bug that failed identically in Chromium and is fixed in `c0566d48`.

1. Run the web browser suite against WebKit through the endpoint option that federated
   environments added. Record pass/fail per file in this plan.
2. Run it on Wayland, not XWayland. Polaron will not force X11, so the DMA-BUF failure seen today
   on NVIDIA under XWayland (`Failed to create GBM buffer`, blank white window, worked around
   with `WEBKIT_DISABLE_DMABUF_RENDERER=1`) needs a fresh reading on the native backend.
3. Decide. Green: WebKitGTK is the Linux engine and Chrome-first is retired as a product
   requirement. Red: Polaron launches the system Chromium with `--app=<url>` on Linux and owns
   nothing but the process, and WebKitGTK is revisited when the failing tests are fixed.

**Exit**: a table of results in this plan and one sentence naming the Linux engine.

## Gate 1 — A window that loads Platform

New crate at `apps/polaron`, host build only for now.

1. `cargo run` opens a tao window titled Platform, sized like today's shell, with a wry webview at
   the dev URL. `titleBarStyle: hiddenInset` and the traffic-light offset on macOS; plain window
   elsewhere; no decorations on Linux beyond what the compositor draws.
2. The initialization script installs `__platformShell` and the preload bundle, built by Vite
   from `apps/desktop/src/preload` as it is today. The page reads `backdrop`, `platform` and
   `colorScheme` and paints correctly in light and dark. On Linux `colorScheme` comes from the
   portal as it does now; on macOS and Windows it is `null` and the webview is trusted.
3. `pickEntry` round-trips through `with_ipc_handler` and `rfd`. On Linux `rfd` uses the desktop
   portal, so the dialog is a centred Wayland window in the desktop theme with no env var.
4. Closing the window quits the process. Ctrl-C in the terminal quits the process.

**Exit**: the app opens, paints, picks a folder, and quits, on the developer's machine.

## Gate 2 — Bun as a child

1. Polaron spawns Bun with the same arguments, cwd and env `spawnServer` and `spawnWeb` use
   today, waits for `/health` and the web URL, then opens the window. The dev entry stays
   `bun run desktop:dev`; it now runs `cargo run` under the hood.
2. Quit order: window closes, Bun children get SIGTERM, Polaron waits for them with a bounded
   timeout, then exits. Today's `createQuitHandler` semantics, in Rust.
3. Structured logs: Polaron writes the same wide events (`desktop.process.spawn`,
   `desktop.window.backdrop`, `desktop.picker.*`) as JSON lines on stderr, and the server ingests
   them the way it ingests the client's. Debugging the shell must not require a debugger.
4. Idle measurement, the same three numbers as plan 073 Gate 2: main-process CPU over 12 s,
   voluntary context switches rising, state `S`. Record them here.

**Exit**: `bun run desktop:dev` is Polaron end to end and the numbers are in this plan.

## Gate 3 — macOS parity

1. Port `apps/desktop/native/vibrancy.m` to Rust with `window-vibrancy`, or keep the dylib and
   load it from Rust. The transparent-window path is the macOS setting `window.transparency:
'window'`; the opaque path needs nothing.
2. Verify on a real Mac: traffic lights over our titlebar, vibrancy behind a transparent window,
   Cmd-Q, dock icon, and that the bundled Bun is the one running the server.

**Exit**: the same checklist as Gate 1 and 2, passed on macOS.

## Gate 4 — Delete Electrobun

1. Remove `apps/desktop`'s Electrobun config, package, tsconfig paths, vitest scoping, the
   `.hutch` ignores in git, oxlint and oxfmt, and the CI cache and prepare steps from `15df2033`.
   `apps/desktop/src/shared` and `src/preload` move to `apps/polaron`.
2. Delete `/work/cache/hutch` and the `~/.hutch` symlink on the developer machine.
3. Update `AGENTS.md`: the desktop shell section, the dev server note, and the mesh section's
   claim that the shell is a convenience.

**Exit**: `rg -i electrobun` across the repo returns only this plan and the git history.

## Later, deliberately

- **Packaging and signing.** DMG, MSI, AppImage, notarization. `tauri-bundler` or
  `cargo-bundle` when there is a release to make. Not before.
- **Windows.** WebView2 is expected to work with no engine-specific code. Verify on a runner
  when CI gets a desktop matrix.
- **Updater.** None exists today and none is planned by this plan.

## Risks

- **WebKitGTK is the wrong engine after all.** Gate 0 exists for this, and the Chromium
  `--app` fallback costs a day, not a rewrite.
- **wry's initialization script runs per navigation, not per page load like Electrobun's
  preload.** Verify the handoff survives the workbench's client-side routing on Gate 1; it should,
  since the router never reloads the document.
- **Two-process debugging.** A crash in either side must show up in the logs with the other
  side's state. Gate 2 step 3 is not optional.
- **The Rust toolchain is new to the repo.** One crate, pinned toolchain file, no workspace
  gymnastics. If it grows a second crate, stop and ask why.

## Open questions for the operator

1. Gate 0's answer, before any Rust is written.
2. Does the Linux `--app` Chromium fallback need to exist at all, or is WebKitGTK-or-nothing
   acceptable on the one platform the operator uses daily?
3. Keep the name Polaron, or name the crate after the app? The directory is `apps/polaron`
   either way; the binary is what the user sees.
