# Plan 114: Polaron, a desktop shell we own

> **Executor instructions**: Read this plan completely, then read `AGENTS.md` and root `PLAN.md`.
> The gates are ordered so Electrobun keeps working until Gate 4; do not delete anything earlier.
> Probes from the research rounds live in `/work/tmp/research2/114/` (disposable; described below).

## Status

- **State**: RESEARCH DONE 2026-09-26 — reworked around the owner's order (installed Chromium in
  `--app` mode first, system webview second). Chromium path prototyped end to end on Linux; native
  webview hosts prototyped in C (Linux) and Objective-C (macOS). No Rust. Ready to execute Gate 1.
- **Priority**: P2 — the shell works today (plan 073), but every week on Electrobun is a week of
  someone else's toolchain
- **Effort**: M — about 500 lines of TypeScript in the launcher and ~150 lines of C or Objective-C
  per webview host, then a long tail that is mostly deletion
- **Risk**: LOW–MEDIUM — the common path is the engine `agent:browser` already drives; the risk
  moved to the fallback window, which few machines take
- **Baseline**: `c0566d48` (Electrobun 2.0.1, plan 073 landed 2026-09-13); researched on
  `6561ca5a`

## Why

Plan 073 kept Electrobun for one property: the shell's `process.execPath` is Bun, so
`apps/server` runs on the shell's own runtime. Platform ships one runtime. That property is
still worth keeping. Electrobun is no longer the cheapest way to keep it.

What the 2.x migration cost, measured on 2026-09-13 and 2026-09-25:

- The SDK lives in a Hutch devkit projected into `apps/desktop/.hutch`, not in `node_modules`.
  TypeScript, Vitest, knip and CI each had to be told about it. `/work/cache/hutch` is 737 MB; the
  Linux dev build is 687 MB, 409 MB of it `libcef.so`.
- `bun Helper` dumps a 2.5 MB SIGABRT core on every exit: 141 cores in `coredumpctl` between
  2026-09-05 and 2026-09-25, 4–28 a day. Upstream, unfixed.
- The wrapper forces GTK onto X11 (`setenv("GDK_BACKEND", "x11")`). That is the root of three
  workarounds in `dd18c2d6`: the `gdbus` colour-scheme read (`color-scheme.ts`), the libc
  `setenv('GTK_USE_PORTAL')` FFI call (`gtk-portal.ts`), and the `GDK_SCALE` note.
- Hutch builds only for the host, three runners and a 700 MB cache each.

What the shell does for Platform is small: spawn the server and, in dev, Vite; open one window at
a URL; install `window.platformBridge`; answer `pickEntry`; quit cleanly; and on macOS attach
vibrancy behind a transparent window. That is the surface Polaron reproduces.

## The shape

The owner's order (2026-09-26, Q1): use the user's installed Chromium-family browser in app mode;
when there is none, the system webview; when there is neither, the default browser in a tab.

```text
bun  apps/desktop/src/launcher/index.ts   (the process root, TypeScript)
 ├─ server  bun apps/server/src/index.ts  (dev) | server/index.js (packaged)     unchanged
 ├─ web     vite                          (dev only)                            unchanged
 └─ window, one of:
     1. chromium --app=<url> --user-data-dir=<home>/desktop/chromium --remote-debugging-pipe
          CDP over fds 3/4: bridge injection, pickEntry, lifecycle, permissions
     2. platform-webview <url> <preload>  (C + WebKitGTK 4.1 on Linux, Obj-C + WKWebView on macOS)
          JSON lines over stdio: page messages out; eval, pick, drag, close in
     3. xdg-open / open <url>             (a tab in whatever the system has; no bridge)
```

- **Bun stays the brain and the root.** The launcher is today's `src/bun/index.ts` without
  Electrobun: `spawnServer`, `spawnWeb`, the child lease, `requireFreePort`, the quit handler and
  the wide events carry over. The single-runtime property holds.
- **No Rust.** Rust paid for itself when it had to own every window. With Chromium as the common
  path, only the fallback needs a native window, on two OSes (Windows ships Edge, a Chromium), and
  each host is ~150 lines against the platform's own C API: measured below. tao/wry would add a
  toolchain and archived gtk-rs 0.18 crates (RUSTSEC-2024-0411 and siblings) for that.
- **The page contract barely changes.** `PlatformBridge` keeps `backdrop`, `platform`,
  `colorScheme` and `pickEntry`, and gains `titlebar: 'overlay' | 'native'`: `isMacDesktop()`
  reserves traffic-light room only under `overlay`, because a Chromium app window on macOS has its
  own titlebar. `pickEntry` becomes optional; without it `use-pick-entry.tsx` already falls back
  to the web `FilePickerDialog`. `window.platformBridge` and `__platformShell` are installed by the
  launcher (Chromium) or the host's document-start script (webview).
- **Not Tauri, not `Bun.WebView`.** Bun 1.4's `Bun.WebView` is headless only (its Chrome backend
  always passes `--headless`; its WebKit backend owns an off-screen `WKWebView`). Its detection list
  and `--remote-debugging-pipe` transport are the reference for ours.

### Which browsers count, and how they are found

A candidate must accept `--app`, `--user-data-dir` and `--remote-debugging-pipe`, and report
`Chrome/<major>` ≥ 126 in `Browser.getVersion` (the app uses `URL.parse`, Chromium 126). Forks
report the Chromium version there: Helium 0.15.7 reported `Chrome/151.0.7922.173`.

| Family         | Linux executables / flatpak ids                                               | macOS bundle id         |
| -------------- | ----------------------------------------------------------------------------- | ----------------------- |
| Google Chrome  | `google-chrome-stable`, `google-chrome`; `com.google.Chrome`                  | `com.google.Chrome`     |
| Chromium       | `chromium`, `chromium-browser`, `/snap/bin/chromium`; `org.chromium.Chromium` | `org.chromium.Chromium` |
| Brave          | `brave-browser`, `brave`; `com.brave.Browser`                                 | `com.brave.Browser`     |
| Microsoft Edge | `microsoft-edge-stable`, `microsoft-edge`; `com.microsoft.Edge`               | `com.microsoft.edgemac` |
| Vivaldi        | `vivaldi-stable`, `vivaldi`; `com.vivaldi.Vivaldi`                            | `com.vivaldi.Vivaldi`   |
| Helium         | `helium-browser`                                                              | `net.imput.helium`      |
| Thorium        | `thorium-browser`                                                             | —                       |

Excluded: Opera and Arc (`--app` behaviour differs and neither is verified), Firefox family (no
app mode, no CDP pipe).

Order, per OS:

1. **The setting.** `window.browser` (machine scope, it selects a binary): `auto` (default),
   `webview`, or an absolute path to a Chromium-family executable.
2. **The default browser, if it is in the table.** Linux: `x-scheme-handler/https` from the XDG
   `mimeapps.list` search path (0 ms; `xdg-settings get default-web-browser` answers the same in
   106 ms), then the `.desktop` file's `Exec` token. macOS: `LSHandlerRoleAll` for `https` in
   `~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist` (read
   with `plutil -convert json`), then the app path by bundle id (`/Applications`, `~/Applications`,
   `mdfind kMDItemCFBundleIdentifier`), executable from `Info.plist` `CFBundleExecutable`. This
   machine resolves to Helium on both the PC and the Mac.
3. **The table, top to bottom**, on `PATH`, then the flatpak export dirs
   (`/var/lib/flatpak/exports/bin`, `~/.local/share/flatpak/exports/bin`), then the macOS bundles.
4. **The webview host**, if its library loads (`libwebkit2gtk-4.1.so.0` on Linux; always on macOS).
5. **The default browser in a tab** (`xdg-open` / `open`), with the reason in the log and a
   `desktop.window.degraded` event. The web picker and the web wallpaper cover what the bridge would.

`window.transparency: 'window'` needs a see-through window, which only the webview host can make,
so under `auto` it selects the webview (Decided below).

Flatpak and snap run confined. Flatpak needs `flatpak run --filesystem=<profile dir>`; snap cannot
write hidden directories in `$HOME`, so its profile goes under `~/snap/<name>/common/platform`.
Whether fds 3/4 survive `flatpak run` is unverified (no flatpak here). If CDP does not answer within
5 s, the launcher kills that candidate and moves down the list.

### What each window can do

Chromium measured on this machine (Chromium 151 and Helium 0.15.7, Hyprland 0.56 native Wayland,
RTX 3060 Ti); macOS rows measured on `shaul-mac` (macOS 26.4, Chrome 153, Helium 0.16.3) where
noted; Electrobun rows from today's code.

| Capability                         | Electrobun today                                 | Chromium `--app` (path 1)                                                                                                                                          | Webview host (path 2)                                                                                                         |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Engine                             | CEF, 409 MB bundled                              | the user's Chromium, nothing bundled; WebGPU and EditContext present                                                                                               | WebKitGTK 2.52 / WKWebView; no EditContext                                                                                    |
| Profile                            | CEF's own                                        | `--user-data-dir=<PLATFORM_HOME>/desktop/chromium`, `--profile-directory=Platform`; 12–28 MB fresh                                                                 | WebKit default data dir                                                                                                       |
| Isolation from user's browsing     | yes                                              | yes: separate process, no shared cookies; `--disable-extensions` needed (below)                                                                                    | yes                                                                                                                           |
| Bridge injection                   | preload string                                   | `Page.addScriptToEvaluateOnNewDocument` plus an immediate `Runtime.evaluate`                                                                                       | `WKUserScript` / `webkit_user_script` at document start                                                                       |
| `pickEntry`                        | Electrobun GTK dialog, X11                       | `Runtime.addBinding` → launcher → `platform-webview pick` (portal / `NSOpenPanel`)                                                                                 | host's own dialog: portal on Linux, sheet on macOS                                                                            |
| Titlebar                           | macOS `hiddenInset`, traffic lights over our bar | native frame; none on Hyprland; macOS draws Chrome's titlebar above ours                                                                                           | macOS `hiddenInset`; Linux native frame                                                                                       |
| Window drag                        | `electrobun-webkit-app-region-drag`              | native frame does it                                                                                                                                               | macOS: `performWindowDragWithEvent` on a `drag` message                                                                       |
| Dark mode                          | `gdbus` portal read (X11 workaround)             | native: `prefers-color-scheme: dark` true before first load                                                                                                        | native on Wayland (Gate 0) and macOS                                                                                          |
| Transparent / vibrancy             | macOS vibrancy (CEF OSR, 5.5 MB/paint)           | no                                                                                                                                                                 | macOS `NSVisualEffectView`                                                                                                    |
| Keyboard                           | CEF passes everything                            | every chord probed reaches the page first and is preventable: Ctrl+W, Ctrl+Shift+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+L, Ctrl+Shift+I/J/C, F5, F11, F12, Ctrl+Shift+Q | as the engine                                                                                                                 |
| Clipboard, notifications           | CEF defaults                                     | `Browser.grantPermissions` pre-grants `clipboardReadWrite` and `notifications` for our origin (measured `prompt` → `granted`)                                      | WKWebView: `clipboard.readText` and `Notification` exist on `http://127.0.0.1`                                                |
| Screen capture (Plan 163)          | `getDisplayMedia` in CEF                         | `getDisplayMedia` with the portal picker, as in a tab                                                                                                              | WKWebView: `getDisplayMedia` absent (feature reports unsupported). WebKitGTK: `captureStream` aborts the web process; hide it |
| Devtools                           | CEF devtools                                     | Chrome DevTools (Ctrl+Shift+I when the page does not claim it)                                                                                                     | Web Inspector                                                                                                                 |
| Close window                       | quits                                            | Linux: browser exits in 407 ms, code 0. macOS: Chrome keeps running (measured), so the launcher sends `Browser.close` on the last page's `Target.targetDestroyed`  | host exits, launcher quits                                                                                                    |
| Second launch                      | port check fails                                 | Chromium's singleton hands off in 44 ms and opens a second window, which the first launcher's CDP session attaches to and bridges                                  | launcher lease decides                                                                                                        |
| Launcher crash                     | —                                                | the pipe closes and the browser exits within 300 ms: no orphan window                                                                                              | stdin EOF ends the host                                                                                                       |
| Tray, global shortcuts, deep links | available, unused                                | none                                                                                                                                                               | none                                                                                                                          |
| Window identity                    | —                                                | Wayland `app_id` `chrome-127.0.0.1__platform_-Platform` (host + path + profile dir); `--class` is ignored on Wayland                                               | `app_id` of the host binary                                                                                                   |
| Dock icon                          | ours                                             | Linux: ours through a `.desktop` with that `StartupWMClass`. macOS: the browser's icon                                                                             | ours once bundled                                                                                                             |

Nothing on the page needs the bridge at document start in the Chromium path: `backdrop` falls out
of the user agent (`compositesOverDesktop`), `colorScheme` is `null` because Chromium reads the
portal, and every `getPlatformBridge()` call runs at use time. So the race below costs nothing as
long as the launcher also evaluates the bridge into the current document.

### Supervision and quit

The launcher is the root and owns both halves. Chromium is a child on a pipe; the server and Vite
are children in their own process groups under today's lease (`child-lease.ts`). Quit is one
path whichever side starts it: the browser exits (window closed, Cmd-Q, Ctrl+Shift+Q, or the
launcher's `Browser.close`), the launcher sends Plan 149's `shutdown` to the terminal host, SIGTERMs
the groups, waits, clears the lease and exits. A server that exits on its own still quits the app,
as today, but the launcher first navigates the window to a `data:` page naming the exit code, so
the failure is on screen instead of a vanished window. Start failures before a window exists keep
`showStartFailure`: `platform-webview message` on Linux and macOS, stderr and a log event elsewhere.

## Gates

Electrobun keeps working until Gate 4. The new launcher runs beside it as
`bun run desktop:dev -- --shell=polaron` until then.

### Gate 1 — Chromium launcher on Linux (M)

Owner: `apps/desktop/src/launcher/*` (new), `scripts/desktop-dev.ts`,
`packages/contracts/src/settings/keys.ts`, `apps/desktop/src/shared/bridge.ts`,
`apps/web/src/lib/platform/bridge.ts`, `apps/web/src/components/use-pick-entry.tsx`.

1. `launcher/browser.ts`: detection per the order above, Linux half. A pure resolver over
   injected `readFile`/`exists` so each step has a unit test (default from `mimeapps.list`, table
   order, flatpak export, setting path, setting `webview`). Wide event `desktop.browser.detect`
   with `candidates`, `chosen`, `source` (`setting` | `default` | `scan`), `path`.
2. `launcher/cdp.ts`: the pipe client. `Bun.spawn` with `stdio: ['ignore', 'ignore', 'pipe', 'pipe',
'pipe']` hands back fds 3 and 4 as numbers. Write with `fs.writeSync(fd3, json + '\0')`; read
   with `Bun.file(fd4).stream()`. `node:net` `Socket({ fd })` received nothing and
   `fs.createReadStream({ fd })` threw `EAGAIN` on Bun 1.4.0. Requests by id, events by method,
   `sessionId` for flat sessions.
3. `launcher/chromium.ts`: flags `--app=<url> --user-data-dir=<PLATFORM_HOME>/desktop/chromium
--profile-directory=Platform --remote-debugging-pipe --no-first-run --no-default-browser-check
--disable-sync --disable-background-networking --disable-component-update --disable-default-apps
--disable-extensions --window-size=1440,960`. `--disable-extensions` is required: Arch's
   `/usr/bin/chromium` wrapper appends `~/.config/chromium-flags.conf`, which on this machine
   carries `--load-extension=` for three Omarchy extensions, and they ran in our profile until the
   flag was added. The wrapper's other flags (Wayland, password store) are the user's and stay.
   On attach (`Target.setDiscoverTargets` then `setAutoAttach { flatten, waitForDebuggerOnStart }`,
   handlers registered first): `addScriptToEvaluateOnNewDocument(bridge)`, `Runtime.addBinding
('platformShellCall')`, `Runtime.evaluate(bridge)` for a document that already committed,
   `Browser.grantPermissions` for the origin, then `runIfWaitingForDebugger`. Check
   `Browser.getVersion` ≥ 126 or close and fall through.
4. Bridge in the Chromium path: `{ backdrop, platform, colorScheme: null, titlebar: 'native' }`
   and no `pickEntry` yet, so the web picker is used. `isMacDesktop()` becomes
   `titlebar === 'overlay'`.
5. Lifecycle: browser exit → quit path. A second `desktop:dev` while one runs finds the live lease
   and execs the browser with the same `--user-data-dir`, which opens a second window in the
   running instance, then exits 0.
6. Settings: register `window.browser` (machine scope, `requiresRestart`) with its consumer here.
   Regenerate `docs/settings-reference.md`.
7. Frame counter: 2 s after `Page.loadEventFired`, count rAF for one second and put
   `rafPerSecond`, `product` and `engine: 'chromium'` on `desktop.window.open`. A zero is the NVIDIA
   signature from Gate 0 in any engine.
8. Lease path: `childLeaseFile` uses `homedir()/.platform`; move it under `PLATFORM_HOME` so dev,
   prod and agent homes stop sharing one lease directory (Plan 146).

**Exit**: `bun run desktop:dev -- --shell=polaron` opens Platform in the default Chromium-family
browser as an app window, picks a folder through the web picker, and quits on window close with
no leftover process. Idle numbers in this plan (the prototype measured 2 CPU ticks in 12 s, 0.17%
of one core, and 514 MB PSS for the whole Chromium group plus launcher, app on the welcome screen).

### Gate 2 — Native host on Linux: webview fallback and the native picker (M)

Owner: `apps/desktop/native/linux/platform-webview.c` (new), `apps/desktop/scripts/build-native.ts`,
`apps/desktop/src/launcher/*`, `packages/contracts/src/settings/keys.ts`.

1. Port the prototype `/work/tmp/research2/114/host/host.c` (150 lines): GTK3 window, WebKitGTK 4.1
   view with a document-start user script, a `platformShell` script message handler, developer
   extras, and the stdio protocol (`eval`, `pick`, `close` in; `ready`, `message`, `picked`,
   `closed` out). Build with `cc $(pkg-config --cflags --libs webkit2gtk-4.1)`: 0.66 s, 24 KB.
2. Keep the GL-context fix: realize a `GdkGLContext` on the window before `show_all`. Re-measured
   2026-09-26 in the C host (3 runs each): with it, 61 rAF/s and a painted app; without it, GTK logs
   `Error 71 (Protocol error) dispatching to Wayland display` and the host exits 1. Gate 0 saw a
   silent 0 rAF/s instead; either way the window is unusable without it.
3. `pick` subcommand (no webview): `GtkFileChooserNative` with `GTK_USE_PORTAL=1` set by the host
   itself. Measured: the xdg-desktop-portal-gtk "Choose folder" dialog opened and a cancel returned
   `{"event":"picked","paths":[]}`. The Chromium path's bridge now gets `pickEntry` through it.
4. Wire the host into detection step 4 and the tab into step 5. No second setting: `window.browser:
'webview'` already selects the host.
5. Hide the screenshot attachment in the WebKitGTK window: the bridge reports
   `capabilities.displayCapture: false`, and `screenshot-capture.ts` reads it with its existing
   unsupported branch.

**Exit**: with `window.browser: webview` the app opens in the C host with 60 rAF/s logged, picks a
folder through the portal, and quits; with `auto` on this machine the Chromium window picks a folder
through the same portal dialog.

### Gate 3 — macOS (M)

Owner: `apps/desktop/native/macos/platform-webview.m` (new, absorbs `vibrancy.m`),
`apps/desktop/src/launcher/*`.

1. Detection, macOS half: LaunchServices default, bundle table, `Info.plist` executable.
2. Chromium lifecycle: on `Target.targetDestroyed` of the last page, `Browser.close` (measured on
   Chrome 153: closing the last app window leaves the browser running).
3. Port `/work/tmp/research2/114/host/host.m` (112 lines): `NSWindow` with full-size content,
   transparent titlebar and hidden title (`hiddenInset`), `WKWebView` with a document-start
   `WKUserScript` and a script message handler, `NSOpenPanel` sheet for `pick`, and
   `performWindowDragWithEvent:` for `drag`. Measured on `shaul-mac`: builds with
   `clang -fobjc-arc -framework Cocoa -framework WebKit` to 76 KB; bridge present at document
   start, 61–62 rAF/s, `prefers-color-scheme: dark` native, WebGPU present on `http://127.0.0.1`,
   `getDisplayMedia` absent; the `--vibrancy` variant (the `vibrancy.m` recipe) runs. Vibrancy
   pixels were not captured.
4. The page's titlebar drag: replace the Electrobun class names in `lib/platform/window-drag.ts`
   with a `mousedown` listener on `[data-native-window-drag-region]` that the preload installs when
   `titlebar === 'overlay'`, posting `drag`.
5. Verify on `shaul-mac`: Chromium path (Helium, the default there, and Chrome), webview path with
   `window.transparency: 'window'`, Cmd-Q, and that Bun from the app is the one running the server.

**Exit**: the Gate 1 and 2 checklists pass on the Mac in both paths.

### Gate 4 — Delete Electrobun (S–M)

1. Remove `src/bun/index.ts`, `src/preload` (its Electroview transport), `src/shared/rpc.ts`,
   `electrobun.config.ts`, the package, the tsconfig paths, vitest scoping, the `.hutch` ignores
   in git, oxlint and oxfmt, and the CI cache and prepare steps from `15df2033`. Add the host
   builds to CI (`pkg-config` + `cc` on the Linux runner, `clang` on macOS).
2. Delete `color-scheme.ts` and `gtk-portal.ts`: both exist only because of the X11 forcing.
3. Delete `/work/cache/hutch` and the `~/.hutch` symlink on the developer machine.
4. `desktop:dev` runs the launcher without the flag. Update `AGENTS.md`: the desktop shell
   section, the dev-server note, and the mesh section's claim that the shell is a convenience.
5. Update the `window.transparency` description: it no longer mentions CEF's copy per paint, and
   says the see-through window uses the system webview.

**Exit**: `rg -i electrobun` across the repo returns only this plan and the git history.

## Later, deliberately

- **Packaging and signing.** A Bun binary, the launcher bundle, the server bundle, the web build
  and one host binary per OS. No CEF. DMG, AppImage, notarization when there is a release to make.
- **Windows.** Edge is preinstalled, so the Chromium path covers it. EEA users can uninstall Edge
  since 2024; a WebView2 host would be the third host if that ever matters.
- **Updater.** None exists today and none is planned by this plan.
- **The app window on macOS without Chrome's titlebar.** Chromium's Window Controls Overlay is
  only for installed PWAs (`navigator.windowControlsOverlay` exists in the `--app` window but is
  inert). Revisit if Chromium exposes it to `--app`.

## Risks

- **The user's browser is not ours.** Its version moves weekly and its wrapper can add flags. The
  version floor, `--disable-extensions` and a separate profile contain it; the rAF counter and
  `product` on `desktop.window.open` make a regression visible.
- **The bridge race.** A warm profile commits the first navigation at 205–222 ms, the same moment
  the launcher's script lands (205–228 ms in three runs). The evaluate-now step covers the lost
  race; `--app=about:blank` is not an escape hatch (Chromium ignores it and opens a normal window
  on `chrome://newtab`).
- **Confined browsers.** Flatpak and snap are unverified; the 5 s CDP timeout keeps them from
  blocking launch.
- **Two C/Objective-C files.** Small and on the platforms' own APIs, but a crash there is a native
  crash. The host has no state; the launcher logs its exit code and falls through to the tab.

## Research findings

### 2026-09-26 — the Chromium-first rework

Prototypes in `/work/tmp/research2/114/`: `launch.ts` (the Chromium launcher with a CDP pipe, a
bridge, a binding and a control port for probing), `host/host.c` + `host/drive.ts` (Linux host and
its driver), `host/host.m` + `host/drive-mac*.sh` (macOS host). The app under test was the
production web build from `/work/platform-production/current` on a throwaway server (temp
`PLATFORM_HOME`, port 33114) behind a `/platform` base-path proxy (`proxy.ts`). Both are stopped.

- **Browsers here.** PC: Chromium 151.0.7922.173 (`/usr/bin/chromium`, a launcher that execs
  `/usr/lib/chromium/chromium` with `~/.config/chromium-flags.conf`) and Helium 0.15.7.1, the
  default browser. Mac: Google Chrome 153 and Helium 0.16.3.1, Helium the default.
- **Chromium app window.** CDP ready 155–250 ms after spawn; page `display-mode: standalone`,
  viewport equal to the window (no browser UI on Hyprland), native Wayland GPU process, 62 rAF/s,
  WebGPU adapter `nvidia ampere`, EditContext present, `SharedArrayBuffer` absent (not
  cross-origin isolated, same as the tab today). `pickEntry` through `Runtime.addBinding` opened
  the fixture folder in the workbench. Helium behaves identically.
- **Keyboard.** In an `--app` window every chord probed through Hyprland's `send_shortcut` reached
  the page and `preventDefault` stopped the browser action. Browser-reserved chords are a non-issue
  in app mode (in a tab they are not).
- **Lifecycle.** Linux close → exit 0 in 407 ms. macOS close → Chrome keeps running. Launcher
  SIGKILL → browser gone within 300 ms. Second launch on the same profile → hand-off in 44 ms and
  a bridged second window.
- **Identity.** `--class` is ignored on Wayland; `--profile-directory=Platform` makes the app id
  `chrome-127.0.0.1__platform_-Platform` (dev: `chrome-127.0.0.1__-Platform`, port not included).
- **Hosts.** Linux C host 150 lines, 24 KB, builds in 0.66 s; macOS Objective-C host 112 lines,
  76 KB. Both carry the bridge from document start and hit 61–62 rAF/s. The Linux GL-context fix is
  still required (above).
- **Not measured.** Electrobun's footprint side by side (the shell was not running), the vibrancy
  pixels, flatpak/snap, Brave/Edge/Vivaldi (same switches, not installed), GTK4 with WebKitGTK 6.0
  (not installed; GTK4 always paints with GL and might not need the fix).

### 2026-09-25 — Gate 0: WebKitGTK, which is now the Linux fallback

Host: Arch, Hyprland 0.56.2 on native Wayland, RTX 3060 Ti on `nvidia-open` 610.57.04,
`webkit2gtk-4.1` 2.52.6, Playwright 1.63 (`webkit-2359`).

The web browser suite on Playwright's WebKit (WPE, headless), through a wrapper config that swaps
`instances` to `webkit` with its own ports; Chromium through the same wrapper as the control:

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

- command-focus fails only under Playwright's Macintosh user agent; with the Linux UA WebKitGTK
  sends, all 11 pass. The message-bubble failure is a test that asserts a hover-only button
  without hovering.
- screenshot-capture is a real engine failure: `canvas.captureStream()` into a playing `<video>`
  kills `WebKitWebProcess` 2.52.6 with SIGABRT (`GStreamer element autoaudiosink not found`;
  `gst-plugins-good` is not installed).
- Playwright's WebKit needs `libicu74`, `libxml2.so.2` and `libflite1` from Ubuntu noble copied
  into a private copy of its `sys/lib` on Arch; the `verify-fregat` note that it cannot start is
  out of date.

The system engine on native Wayland (GTK3 + WebKit2 4.1 from Python GObject, the library the C host
now uses):

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

- The fix is what `tauri-plugin-wayland-nvidia-quirk` does: GTK picks GL or SHM per frame by
  whether the window already has a paint GL context, and WebKit creates one too late.
- Dark mode works natively on Wayland and not on X11 in the same build: the `gdbus` read in
  `color-scheme.ts` exists only because of the X11 forcing.
- Idle with the fix: 0.2% of one core across UI, web and network processes over 12 s.
- Engine surface, WebKitGTK 2.52.6: no WebGPU (terminal takes WebGL2), no EditContext (textarea
  route), no `requestIdleCallback`/`scheduler.yield` (the prefetch scheduler falls back), no
  `SharedArrayBuffer`. CSS highlights, anchor positioning, `field-sizing`, `:has`, container
  queries, view transitions, popover, `Intl.Segmenter`, `OffscreenCanvas` all present.

## Owner questions

1. **Chrome-first or not?** Decided 2026-09-26: owner — the shell uses the user's installed
   Chromium (`--app`) when there is one and falls back to the system webview when there is none.
   This plan is built around that order.
2. **The Chromium `--app` fallback as a flag.** Superseded 2026-09-26 by question 1: Chromium is
   the first choice, not a flag.
3. **Screenshot attachment on WebKitGTK.** Decided 2026-09-26: research recommendation — hide it in
   the WebKitGTK window (`displayCapture: false`). That window is now the fallback, so a system
   dependency on `gst-plugins-good` for a few machines is not worth it; WKWebView lacks
   `getDisplayMedia` anyway.
4. **Rust in the repo.** Decided 2026-09-26: research recommendation — no Rust. The only native
   window left is the fallback on Linux and macOS, and a C or Objective-C host against the
   platform's own API is ~150 lines with the compiler the machine already has (macOS already builds
   `vibrancy.m`).
5. **Transparency picks the engine.** Decided 2026-09-26: research recommendation — under
   `window.browser: auto`, `window.transparency: 'window'` selects the webview, because a Chromium
   app window cannot be see-through and the user asked for see-through.
6. **The browser profile.** Decided 2026-09-26: research recommendation — a separate
   `--user-data-dir` under `PLATFORM_HOME`. Chrome refuses remote debugging on the default profile,
   and a separate profile keeps the app's storage and permissions out of the user's browsing.
7. **When nothing is installed.** Decided 2026-09-26: research recommendation — open the default
   browser in a tab. It is "whatever the system has", and the web layer already works in a tab.
8. **Name.** Decided 2026-09-26: research recommendation — the code stays in `apps/desktop`; the
   host binary is `platform-webview`. "Polaron" stays the plan's name and appears nowhere a user
   looks.
9. **macOS default path.** The Chromium window on macOS draws the browser's titlebar above ours,
   shows the browser's dock icon, and has no vibrancy; the webview window keeps `hiddenInset`,
   vibrancy and our own icon once bundled, but loses EditContext and Chrome DevTools.
   (a) Chromium first on macOS too, as on Linux. (b) Webview first on macOS, Chromium first on
   Linux and Windows. **Recommendation: (a)**: one engine on every desktop keeps the editor's
   EditContext route and `agent:browser trace` on the engine users run, and question 5 already
   gives the native look to anyone who turns on see-through windows.
   Decided 2026-09-26: owner — (a).
