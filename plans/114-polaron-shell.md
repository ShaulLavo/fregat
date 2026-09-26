# Plan 114: Polaron, a desktop shell we own

> **Executor instructions**: Read this plan completely, then read `AGENTS.md` and root `PLAN.md`.
> Gate 0 is a measurement and decides the Linux renderer; do not skip it to start writing Rust.
> Do not commit, push, create a branch, publish, or open a PR without explicit operator approval.

## Status

- **State**: Proposed — Gate 0 researched 2026-09-25 (see Research findings); go/no-go is the
  owner's call
- **Gate 0 verdict**: WebKitGTK is viable on Linux with three conditions; Chrome-first must be
  retired for the desktop shell to take it
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

## Research findings (2026-09-25)

Gate 0 only, no Rust. Plan text read from `origin/main` at `9f343825`; every open lane branch
carries the same file. Probes, logs and screenshots are in `/work/tmp/research/114/` (disposable).
Host: Arch, Hyprland 0.56.2 on native Wayland, RTX 3060 Ti on `nvidia-open` 610.57.04,
`webkit2gtk-4.1` 2.52.6 (the library wry 0.57 binds), Playwright 1.63 (`webkit-2359`, WebKit 26.6).

### Gate 0 step 1 — the web browser suite in WebKit

How it was run. The unchanged `apps/web/vitest.browser.config.ts`, imported by a wrapper config
that swaps `instances` to `webkit`, with its own `VITEST_BROWSER_PORT` / `VITEST_BROWSER_FILE_SERVER_PORT`
(the port option the file-server fixture reads) so it could not collide with other runs. A Chromium
run through the same wrapper is the control. Playwright cannot drive system WebKitGTK and Arch's
`webkit2gtk-4.1` ships no `WebKitWebDriver`, so this suite ran on Playwright's WebKit build (WPE
port, headless, WebKit trunk as of 2026-09-01). The system engine is covered by step 2.

Playwright's WebKit does start on this host, contrary to the `verify-fregat` skill note: it needs
`libicu74`, `libxml2.so.2` and `libflite1` from Ubuntu noble copied into a private copy of
`webkit-2359/minibrowser-*/sys/lib` (the bundle's wrapper overwrites `LD_LIBRARY_PATH`), then
`PLAYWRIGHT_BROWSERS_PATH` pointed at that copy.

| File (`apps/web/src/…`)                       | Chromium | WebKit | WebKit, Linux UA |
| --------------------------------------------- | -------- | ------ | ---------------- |
| features/chat/tests/mermaid-fence             | 2/2      | 2/2    | 2/2              |
| features/chat/tests/message-bubble            | 7/7      | 6/7    | 6/7              |
| features/chat/utils/tests/screenshot-capture  | 4/4      | crash  | crash            |
| features/editor/tests/diagnostic-peek         | 1/1      | 1/1    | 1/1              |
| features/editor/tests/diff-split-scroll       | 3/3      | 3/3    | 3/3              |
| features/editor/tests/prepared-open           | 7/7      | 7/7    | 7/7              |
| features/editor/tests/syntax-worker           | 2/2      | 2/2    | 2/2              |
| features/git/tests/unchanged-diff             | 1/1      | 1/1    | 1/1              |
| features/settings/tests/appearance-optimistic | 1/1      | 1/1    | 1/1              |
| features/settings/tests/density-contract      | 5/5      | 5/5    | 5/5              |
| features/terminal/tests/keybindings           | 5/5      | 5/5    | 5/5              |
| features/workbench/.../bar-height             | 3/3      | 3/3    | 3/3              |
| features/workbench/.../surface-pass           | 2/2      | 2/2    | 2/2              |
| features/workspace/tests/tree-pane            | 5/5      | 5/5    | 5/5              |
| keymap/tests/command-focus                    | 11/11    | 5/11   | 11/11            |
| **Total**                                     | 59/59    | 48/59  | 55/59            |

- **command-focus is a harness artifact.** Playwright's Linux WebKit sends a Macintosh user agent;
  `@tanstack/hotkeys` `detectPlatform()` reads the UA, resolves `Mod` to Meta, and Playwright's
  `ControlOrMeta` presses Control. With the UA system WebKitGTK actually sends
  (`X11; Linux x86_64`), all 11 pass.
- **message-bubble "dispatches user-row checkpoint revert actions"**: the revert button is
  `opacity-0` under `@media (hover: hover)` until the row is hovered or focused
  (`message-bubble.tsx:195`). Both headless engines report `hover: hover`, so Chromium passing is
  the surprise; likely a leftover pointer position from an earlier test. Not investigated further;
  it is a test that does not hover before asserting visibility.
- **screenshot-capture is a real engine failure.** The page dies (`Browser connection was closed`).
  Reproduced on the system engine: `canvas.captureStream()` into a playing `<video>` kills
  `WebKitWebProcess` 2.52.6 with SIGABRT (`web-process-terminated: crashed`, core in
  `coredumpctl`), logging `GStreamer element autoaudiosink not found`. `gst-plugins-good` is not
  installed here; with it the crash may become a working capture, but that is unverified.
  `getDisplayMedia` itself is present with default settings.
- Not run: `packages/tree` and `packages/ui` each carry one `*.browser.tsx` outside the web suite.

### Gate 0 step 2 — the system engine on native Wayland

The production build (`ed96e9f1`) on a throwaway server (temp `PLATFORM_HOME`, fixture workspace),
behind a base-path proxy, opened in a GTK3 window with `WebKit2 4.1` from Python GObject: the same
library and toolkit wry and tao use. Each run records `webkit://gpu`, a feature matrix, app state,
and a WebKit snapshot.

| Run (all `GDK_BACKEND=wayland` unless noted)                   | Renderer            | rAF / s | Terminal | Highlighting |
| -------------------------------------------------------------- | ------------------- | ------- | -------- | ------------ |
| defaults (accelerated, DMA-BUF)                                | DMABuf, GL          | **0**   | stuck    | not painted  |
| `__NV_DISABLE_EXPLICIT_SYNC=1`                                 | DMABuf, GL          | 0       | stuck    | not painted  |
| `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`                           | DMABuf, GL          | 0       | stuck    | not painted  |
| `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`, `GBM_BACKEND=nvidia-drm` | DMABuf              | 0       | —        | —            |
| hardware acceleration `NEVER`                                  | none                | 63      | works    | works        |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1`                             | none (policy never) | 63      | works    | works        |
| **GL context realized before first frame**                     | DMABuf, GL          | **63**  | works    | works        |
| `GDK_BACKEND=x11` (control)                                    | GL unavailable      | —       | stuck    | —            |

- **The failure on native Wayland is not the GBM one.** DMA-BUF initialises with NVIDIA
  block-linear modifiers and no errors, but `requestAnimationFrame` never fires, on a blank
  `data:` page too. Everything frame-driven stalls: the ghostty terminal sits on its spinner
  (its WebGL2 context exists and a WebGL readback works) and the editor's CSS highlights are
  registered (`CSS.highlights.size === 9`) but never painted.
- **The fix is known and small.** Realizing a `GdkGLContext` on the window before `show_all()`
  gives 63 rAF/s with full hardware acceleration, and the app then matches Chromium: editor,
  syntax colours, terminal prompt, workbench (`wk-app-quirk/app-snapshot.png` against
  `chromium.png`). This is what `tauri-plugin-wayland-nvidia-quirk` does
  (<https://github.com/arsalan-anwari/tauri-plugin-wayland-nvidia-quirk>): GTK picks GL or SHM per
  frame by whether the window already has a paint GL context, and WebKit creates one too late.
  Tauri documents the env-var workarounds (<https://v2.tauri.app/develop/debug/linux-graphics/>),
  which here cost acceleration. Polaron must do this in its tao window setup, about ten lines.
- **The X11 control reproduces today's bug**: `Failed to create GBM buffer of size 942x508:
Invalid argument`, GL unavailable. Polaron not forcing X11 is what removes it.
- **Dark mode works natively.** `prefers-color-scheme: dark` is true on Wayland and false on X11
  in the same build, so the `gdbus` portal read in `color-scheme.ts` exists only because of the
  X11 forcing.
- **Idle is quiet.** Workbench open, file and terminal showing, 12 s window after settling: 0.2%
  of one core across the UI, web and network processes with the GL fix (0.3% unaccelerated),
  from `/proc/<pid>/stat` utime+stime deltas.
- **Engine surface, system WebKitGTK 2.52.6**: WebGPU absent (terminal takes WebGL2), EditContext
  absent (the editor keeps its textarea route, `keys.ts:496`), `requestIdleCallback` and
  `scheduler.yield` absent (the prefetch scheduler already falls back,
  `intent-prefetch-scheduler.ts:22`), `SharedArrayBuffer` absent (not cross-origin isolated).
  Present: CSS highlights, anchor positioning, `field-sizing`, `:has`, container queries, view
  transitions, popover, `Intl.Segmenter`, `OffscreenCanvas`, compression streams, iterator helpers,
  `Set` methods, `URL.parse`. The Editor already tracks WebKit quirks
  (`Editor/docs/display/browser-quirks.md`); the ghostty renderer ships a WebKit test config.
- **Unresolved**: the machine-events stream logged `Load failed` in WebKit sessions and not in
  Chromium, but it ran through my proxy, so it is confounded. Re-check without a proxy in Gate 1.
  On-screen pixels were not captured: `grim` hangs on this compositor (two Hyprland "not
  responding" dialogs it caused were closed). The WebKit snapshots are the web process's own paint.

### Gate 0 step 3 — decision

WebKitGTK can be the Linux engine, on three conditions:

1. Polaron realizes a GL context on its window before the first frame. Without it, the app is
   broken on NVIDIA in a way the error log does not show.
2. The screenshot attachment path either gains a system dependency on `gst-plugins-good` (verified
   first) or is disabled where `captureStream` cannot play, because today it aborts the renderer.
3. Chrome-first is retired as a desktop product requirement (plan 073 made it one). The editor
   gives up EditContext on the desktop, and the desktop window is no longer the engine
   `agent:browser trace` measures.

The one sentence: **the Linux engine is WebKitGTK 2.52 on native Wayland with a pre-realized GL
context, and the system Chromium in `--app` mode stays as a flag for any machine where it fails.**

### What Polaron would give, cost and replace

What it replaces, measured in this checkout:

- `apps/desktop`: 1,511 lines of TypeScript and Objective-C, 466 of them in `src/bun/index.ts`,
  plus `electrobun.config.ts`, the Hutch devkit projection, and the Electrobun touches in
  `knip.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `README.md` and the two Hutch
  steps in `.github/workflows/ci.yml` (lines 108–118 and 178–182).
- `/work/cache/hutch`: 737 MB. The Linux dev build under `apps/desktop/build`: 687 MB, 409 MB of
  it `libcef.so`.
- `bun Helper` SIGABRT cores: 141 in `coredumpctl` since 2026-09-05, 4–28 a day, 2.5 MB each. The
  shell is in daily use, so this is daily noise.
- Three X11 workarounds: the `gdbus` colour-scheme read, the libc `setenv('GTK_USE_PORTAL')` FFI
  call in `gtk-portal.ts`, and the `GDK_SCALE` note in `dd18c2d6`.

What it gives:

- A shell whose main loop is ours and whose failure modes can be read in our logs.
- Native Wayland on Linux: dark mode, centred portal dialogs (`rfd` uses the portal) and correct
  scaling without workarounds.
- One engine family for desktop and phone: WKWebView on macOS matches the native Mac app and every
  iPhone reaching the mesh; WebKitGTK on Linux is the same WebCore and JavaScriptCore.
- No bundled browser: the system webview ships with the OS, where CEF is a 409 MB library per
  platform.

What it costs:

- **A Rust toolchain.** None is installed on this machine; CI needs Rust plus `webkit2gtk-4.1`
  development headers, and a per-OS runner exactly as Hutch does (Rust does not cross-compile
  AppKit or WebView2 either, so the three-runner cost stays).
- **Unmaintained GTK3 bindings.** tao 0.37 and wry 0.57 sit on gtk-rs 0.18 and `webkit2gtk`
  2.0.2, whose GTK3 crates were archived in March 2024 (RUSTSEC-2024-0411, -0415, -0420 and siblings;
  <https://github.com/tauri-apps/tauri/issues/11928>). Tauri carries the same exposure, so it is
  shared and visible, and it is still a dependency on crates nobody patches.
- **Engine drift we do not control.** The Linux engine version is whatever Arch ships this week.
  CEF is pinned.
- **An engine change on macOS too.** Today every platform runs CEF (`electrobun.config.ts`).
  Polaron moves macOS to WKWebView, a second switch on a machine that is a verification rig.
- **Tooling.** The desktop window gets Web Inspector (`enable-developer-extras`) instead of Chrome
  DevTools, and the verification CLI's `trace` stays Chromium-only.
- **Surface the plan does not list.** Window dragging: the page uses Electrobun's
  `electrobun-webkit-app-region-drag` class names (`apps/web/src/lib/platform/window-drag.ts`);
  under tao that becomes an IPC call to `drag_window()` on mousedown. Also the start-failure
  message box (`showStartFailure`), which `rfd` covers.

The case for staying on Electrobun: it works today, idle is fixed (plan 073), upstream is active
(`2.0.2-beta.31` published 2026-09-25), and the cost is friction and a core file per exit. None of
it breaks the product. Polaron trades that for a toolchain and an engine change, and the engine
change is the larger half.

### Recommendation

Go, staged, with WebKitGTK on Linux. Gate 1 is small and Electrobun keeps working until Gate 4,
so the decision stays reversible until the deletion. Make Gate 1's first exit item the GL-context
fix and a rAF counter in the `desktop.window` wide event, so an NVIDIA regression shows up as a
number in the logs. Build the Chromium `--app` path as a flag in Gate 2: it is a day, and it is the
escape hatch for any machine where condition 1 is not enough. If the owner holds Chrome-first as a
requirement, the honest answer is to stay on Electrobun, because Polaron with Chromium on Linux is
a Bun process launcher and does not need Rust there.

### Owner questions

1. **Retire Chrome-first for the desktop shell?** (a) Yes: WebKitGTK on Linux, WKWebView on
   macOS. (b) No: stay on Electrobun and CEF. (c) Linux keeps Chromium `--app`, Polaron only on
   macOS and Windows. Recommendation: (a). The suite and the live app say the engine holds, and
   the phone already runs WebKit.
2. **The Chromium `--app` fallback** (the plan's question 2): (a) build it as a flag in Gate 2;
   (b) WebKitGTK or nothing. Recommendation: (a), because the NVIDIA stall shows a Linux webview
   can fail silently on one driver.
   Decided 2026-09-26: owner — (a): build the Chromium `--app` fallback as a flag in Gate 2.
3. **The screenshot attachment on WebKitGTK**: (a) require `gst-plugins-good` and verify capture
   works with it; (b) hide the feature where the engine cannot play a capture stream.
   Recommendation: (a), verified before Gate 1 ends, with (b) as the fallback.
4. **Rust in the repo and on this machine**: a pinned `rust-toolchain.toml`, rustup under
   `/work/cache`. Recommendation: yes, one crate, as the plan says.
