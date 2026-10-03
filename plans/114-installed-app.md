# Plan 114: Installed app

> **Executor instructions**: Read this plan completely, then read `AGENTS.md` and root `PLAN.md`.
> Gates 1–4 are complete. The owner accepted the Mac desktop paths and approved Gate 4 removal on 2026-10-03. Earlier shell/protocol research below is retained as dated evidence, not the current launch contract.
> Probes from the research rounds live in `/work/tmp/research2/114/` (disposable; described below).

## Status

- **State**: DONE — Gates 1–4, 2026-10-03. Approved owner acceptance of the Mac desktop
  paths closes the previous real-keychain/visual acceptance gate and authorizes removal of the
  old shell. `desktop:dev` now selects the launcher directly; installed Chromium and the native
  system-webview host are the delivered window paths. Mesh-owned servers and terminals remain
  shared. The installed-app and `Fregat.app` contracts below remain authoritative; earlier
  measurements and partial-status reports are historical evidence.
- **Priority**: P2 closeout delivered. Signing, public distribution and own-engine work remain
  explicitly deferred below.
- **Effort**: M — about 500 lines of TypeScript in the launcher and ~150 lines of C or Objective-C
  per webview host, then a long tail that is mostly deletion
- **Risk**: LOW–MEDIUM — the common path is the engine `agent:browser` already drives; the risk
  moved to the fallback window, which few machines take
- **Baseline**: `c0566d48` (Electrobun 2.0.1, plan 073 landed 2026-09-13); researched on
  `6561ca5a`

## Installed Fregat application

**Status: Delivered; approved owner acceptance and Gate 4 closeout, 2026-10-03.**
The native macOS host, Chrome-first Linux selection and installed-app delivery replace the old shell. The browser-installed
app must provide the same functionality when opened by the desktop launcher, the Dock, Cmd-Tab/taskbar,
the OS application launcher, or its browser-created shortcut. A direct OS launch has no
launcher process, CDP connection, injected script, or `window.platformBridge`.

The owner rejected a launcher-only bridge with reduced functionality on Dock launch. The
installed-browser path therefore moves desktop behavior into the web client, browser manifest,
and the selected machine's server. The native webview keeps its own host transport; the old shell
and toolchain are removed. The sections below this design document the replacement and earlier proofs;
this section supersedes their CDP-injected bridge as the installed-browser target architecture.

### Approved outcomes

- Automatic macOS selection uses Fregat’s native WKWebView host, with integrated traffic lights
  and its own app identity. A native startup failure stays an app error. Linux automatic selection tries Chrome, supported OS-default Chromium,
  the remaining Chromium scan, native webview, then a default-browser tab. Explicit browser
  settings stay first. Automatic window transparency selects the native webview on either OS.
- Fregat installs automatically with its own name, icon, and OS application identity. The owner
  performs no installation step. The browser owns its installed registration and OS shortcuts.
- The launcher selects the browser, ensures installation, and requests launch. Runtime app
  features work with zero injected globals and no running launcher. Do not intercept or replace
  the browser-created Dock/OS shortcut.
- One existing installed client is focused on repeat launch, preserving its editor, terminal,
  draft, and ongoing work. New address URLs are delivered to the app's normal router.
- Closing the app preserves mesh services, terminals, other browser profiles, and other apps.
  A launcher exiting after successful launch has no authority to terminate those services or a
  browser started by the Dock.

### Installed identity and manifest

Use `apps/web/public/manifest.webmanifest` with stable relative `id: "./"`, `name: "Fregat"`,
`short_name: "Fregat"`, existing relative start URL/scope, and `display: "standalone"`. Relative
identity resolves against the manifest/start URL and preserves the `/platform/` production base.
Query strings, workspace selection, and navigation do not change the manifest identity.
Dev and production origins remain distinct registrations and profiles; choose their visible
naming deliberately before installing both on the same machine.

Add `display_override: ["window-controls-overlay", "standalone"]` and
`launch_handler: { "client_mode": "focus-existing" }`. Keep the existing 192/512 PNG icons.
Produce a genuine 1024 PNG from the app's source artwork if the Mac icon proof needs it;
upscaling the 512 icon does not add detail. Verify the browser-generated Mac app icon, Linux
desktop icon, Dock/Cmd-Tab/taskbar name, and window title rather than assuming that a successful
protocol command establishes OS identity. App identity is separate from the ordinary document
title and favicon.

`focus-existing` is a browser policy for launches of this installed app identity in this profile.
It is not a machine-wide lock across other browsers or profiles. Register a `launchQueue`
consumer in the web client, validate same-origin/in-scope launch URLs, then dispatch through
the existing route/navigation owner. Existing clients are focused without automatic navigation;
the consumer must apply an incoming address intentionally. Do not create a competing module
singleton or a BroadcastChannel window-election system.

### Complete desktop bridge inventory and replacements

The contract in `apps/desktop/src/shared/bridge.ts` has one callable operation, `pickEntry`, and
five metadata fields. The preload transport also carries `drag` and frame telemetry. None of
these may be required from CDP in an installed browser app.

| Current contract                                                       | Consumers                                                                                                                                                            | Installed-app replacement                                                                                                                                                                                                     | Capability and loss                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pickEntry({ mode, accept, startingPath, multiple }) -> paths`         | `apps/web/src/components/use-pick-entry.tsx`; path hydration in `components/utils/picked-path.ts` and `lib/file-server.ts`                                           | An authenticated selected-machine server mutation runs that host's existing native picker helper and returns its backend paths. Consume capability/query state through TanStack and hydrate with the existing filesystem API. | Preserves absolute backend path identity on a local desktop server. A remote server's dialog appears on that remote host, so it cannot substitute for the viewing machine's native chooser. Use the approved in-app server-filesystem picker when the browser and server are on different machines. |
| `backdrop`                                                             | `apps/web/src/lib/platform/backdrop.ts`, `boot-appearance.ts`, `main.tsx`                                                                                            | Browser/platform detection plus the existing opaque app/compositor backdrop policy. WCO only changes titlebar geometry.                                                                                                       | Browser PWAs have no per-pixel transparent window or macOS vibrancy API. Native transparency remains a capability of the explicit native host. This loss applies equally to every installed-app launch.                                                                                             |
| `platform`                                                             | `apps/web/src/lib/platform/bridge.ts` (`isMacDesktop`); indirectly `components/app-titlebar.tsx`, backdrop resolution                                                | Use browser client-platform information for OS conventions and actual WCO geometry for control placement. Never infer the viewing OS from a remote server.                                                                    | Preserves OS conventions without a launch-time handoff. Client hints may be absent; retain the existing safe browser platform fallback.                                                                                                                                                             |
| `colorScheme`                                                          | `apps/web/src/features/settings/state/system-color-mode.ts`                                                                                                          | `matchMedia('(prefers-color-scheme: dark)')` and its change event, on every launch path.                                                                                                                                      | Chromium already reads the OS preference. The WebKitGTK/X11 override remains local to the retained native-webview path.                                                                                                                                                                             |
| `titlebar: native/overlay`                                             | `apps/web/src/lib/platform/bridge.ts`, `components/app-titlebar.tsx`                                                                                                 | `navigator.windowControlsOverlay.visible`, `getTitlebarAreaRect()`, `geometrychange`, and CSS `titlebar-area-*` environment variables.                                                                                        | Reserve the reported free titlebar rectangle, on either side as the browser/OS requires. Overlay availability and the user's titlebar toggle are browser-owned; standalone browser chrome remains movable when overlay is off.                                                                      |
| `capabilities.displayCapture`                                          | `apps/web/src/features/chat/utils/screenshot-capture.ts`                                                                                                             | Feature-detect browser `getDisplayMedia` and handle user cancellation/refusal.                                                                                                                                                | Captures through the browser chooser, with its secure-context/gesture restrictions. No capture-permission bypass or shell override. Native hosts may retain their explicit unsupported capability.                                                                                                  |
| `getPlatformBridge()`, `isDesktop()`, `isMacDesktop()`                 | `apps/web/src/lib/platform/bridge.ts`; titlebar; `features/settings/utils/form-categories.ts`, `features/settings/utils/availability.ts`; desktop flag in `main.tsx` | Separate installed display mode, WCO geometry, browser capabilities, and server-native-picker capability. Installed-app settings and observability use those actual capabilities.                                             | An installed app is still a desktop app without an injected global. Do not hide applicable settings because bridge lookup returns null; describe unsupported native transparency as a capability constraint.                                                                                        |
| Injected `drag` transport and Electrobun drag classes                  | `apps/desktop/src/launcher/shell-bridge.ts`; `apps/web/src/lib/platform/window-drag.ts`; `components/app-titlebar.tsx` and other drag-region controls                | Shared UI WCO drag/no-drag utilities using `app-region: drag` and Chromium's supported `-webkit-app-region` spelling. Interactive controls opt out.                                                                           | Removes the injected `mousedown` handler from the installed-browser path. Browser/OS chrome handles dragging with WCO off. There is no web API for arbitrary window movement.                                                                                                                       |
| `__platformShellReply`, request token/document id, `platformShellCall` | `shell-bridge.ts`, `chromium.ts`; replies to `use-pick-entry.tsx`                                                                                                    | Ordinary authenticated server mutation/result, with native-helper cancellation and timeout owned by that server operation.                                                                                                    | No runtime binding, preload promise map, or document token in the browser path. Retained native hosts keep their own transport until their gates complete.                                                                                                                                          |
| Injected `rafPerSecond` / `platformHostRaf`                            | `shell-bridge.ts`, `chromium.ts`, `desktop.window.open` logging                                                                                                      | Measure in the web application's normal startup observability, tagging installed display mode and actual browser capabilities.                                                                                                | Direct Dock launch produces the same startup measurement. Sampling must remain bounded and avoid duplicate events.                                                                                                                                                                                  |

There is no close, resize, maximize, tray, notification, or deep-link method in `PlatformBridge`.
Browser notifications (`features/chat-mode/state/notification-host.ts`), focus, audio, and
screenshot capture already use web APIs. Keep their permission/error handling. The retained
native host's own close/drag messages are not additional browser bridge methods.

### Native picker and filesystem identity

**Chosen local-desktop design.** Move native helper ownership from the Chromium launcher to the
machine server. Publish its capability only when the helper exists and a usable desktop session
is available. Requests validate options at the API boundary, serialize one chooser per desktop
host, and use the registered native-dialog timeout/stop-grace settings. The response carries
paths on that machine and settles the mutation/query state before resolving. User cancellation
returns an empty selection; helper failure returns structured public guidance. A disconnected
requester must cancel its owned chooser without stopping any shared service.

The endpoint needs the same authenticated client/session authorization as filesystem operations,
origin/CSRF protection, and a bounded request lifecycle. An arbitrary website must never be able
to open a native chooser through the local server. A generic remote URL is insufficient evidence
that the server's desktop is the browser's desktop. Select the machine explicitly and distinguish
local-desktop capability from remote filesystem access.

**Why File System Access is not a drop-in replacement.** `showDirectoryPicker` and
`showOpenFilePicker` return opaque browser handles, not absolute host paths. Fregat's workspace,
git, terminal, LSP, and filesystem APIs consume backend paths. A directory handle's name or
relative `resolve()` result cannot identify such a path. File System Access also needs a secure
context and a live user gesture; a deferred effect loses that gesture. Supporting browser-local
handles as first-class workspaces would be a separate filesystem/provider redesign, outside this
bounded shell change. Do not invent a path from a handle or upload a folder as a substitute.

**Approved owner decision (2026-10-02): picker machine policy.** When the browser is on a
different machine from its selected server, use the existing in-app server-filesystem picker.
Run the native picker only when app and selected server are on the same machine and that
server advertises an available local-desktop capability. Dock and launcher launches use the
same selection rule. Remote mode needs no viewing-host native-picker service. Authenticate
the selected machine identity and establish locality; a hostname or claimed platform alone
cannot authorize opening a native chooser. If locality cannot be established, use the in-app
server-filesystem picker. The authenticated server mutation still owns native chooser security,
cancellation, timeouts and backend path hydration on local connections.

### PWA installation and launch control

**Approved launch-control adjustment (2026-10-02).** The private pipe belongs to a temporary
installation controller. Both headless and headed Helium exit when that pipe closes. The user
app therefore launches through the browser's installed-app command after the controller exits.
No runtime bridge, debugging connection, chooser binding or permission grant reaches that app.

1. Resolve the effective browser profile and stable absolute manifest identity for the app URL.
   An explicit browser setting keeps precedence; Linux automatic selection uses Chrome-first ordering.
   macOS automatic selection uses the native host.
   Hold a launcher-owned `flock` file beside that profile through installation, controller exit and
   app handoff. A second launcher waits within the same startup cap, then rechecks the singleton;
   it never forwards its URL to another launcher's installation controller. The kernel releases
   ownership when a launcher exits or dies, and the lock file's inode remains for other waiters.
   A live profile routes directly through the browser singleton and never starts a controller.
   Probe `SingletonSocket` with Chromium's matching cookie links before and after connecting;
   send no launch data on the probe. If the socket cannot be checked, a `SingletonLock` naming a
   live local hostname-pid owner suffices. Ownership never depends on argv or executable paths,
   so a Dock app-shim owner or a confined browser can use the same dedicated profile.
2. An idle profile goes straight to the registered app when its verified receipt matches the
   current served manifest id, resolved start URL and SHA256 of the manifest bytes, and Chrome's
   per-app resource directory exists. The directory is
   `<user-data-dir>/Platform/Web Applications/Manifest Resources/<appId>`: Chromium 154's
   `GetManifestResourcesDirectoryForApp` and `kWebAppDirname` define it, and
   `WebAppIconManager::DeleteData` recursively removes it on uninstall. This read-only directory
   check detects uninstall without opening a controller or reading a browser database. A missing
   receipt, changed manifest or missing directory runs setup. A failed direct app launch invalidates
   its receipt and retries setup while idle within the remaining startup cap; an exhausted cap
   leaves setup for the next idle launch. Singleton presence proves ownership, never an app window.
   Setup starts a headless temporary browser with the existing CDP pipe and calls
   `PWA.getOsAppState({ manifestId })`. Success identifies an existing installation. An unknown
   app returns `InvalidParams` (`-32602`) with the unknown-app reason. Other parameter failures
   remain operational errors; there is no `installed: false` field.
3. For an uninstalled identity, call
   `PWA.install({ manifestId, installUrlOrBundleUrl: installPageUrl })` and check OS state again.
   `installPageUrl` resolves `install.html` under the app base. This static document links the
   manifest without starting the app or restoring a saved address during Chrome's metadata fetch.
   Set `PWA.changeAppUserSettings({ manifestId, displayMode: "standalone" })` before recording a
   verified receipt, including for an existing installation. Chrome's installation API defaults
   the user launch mode to browser. Receipts include the configured standalone display mode.
   A failed installation is a failed launch with structured guidance. Repeat idle setup converges
   after a partial install or uninstall. Installation repair runs only while the profile is idle.
4. Before closing the controller, query `Target.getTargets` and collect its HTTP(S) page URLs;
   the dedicated controller's bootstrap is `about:blank`, and workers are excluded. De-duplicate
   those app-window URLs with the launcher's URL. Close the pipe, await exit, then replay every
   collected URL through the same installed `--app-id`, computed once from the original install
   URL. Target navigation changes only the launch URL, including nested paths. This preserves OS
   shortcut launches that bypass the launcher lock during setup. If an OS app wins the singleton after the idle check, the controller exits
   through singleton handoff or EOF; recheck ownership and forward the launcher's URL to that
   live browser. Skip installation this run and leave repair to the next idle launch.
   Compute Chromium's app id from the canonical manifest URL using two SHA256 hashes of raw bytes,
   then encode the first 128 bits as letters a–p. This uses Chromium's public identity algorithm;
   no browser database is read or changed.
5. Launch `--app-id=<id>` on the same profile, with the incoming address carried by
   `--app-launch-url-for-shortcuts-menu-item`. Use no CDP flag. The browser's installed manifest
   owns client focus and the web `launchQueue` consumer owns URL delivery. Repeated launcher and
   Dock launches use the same browser singleton, including a Dock-first launch with no receipt.
   Launcher exit or cancellation after handoff leaves the user app and shared server running.

`PWA.launch` and `PWA.openCurrentPageInApp` remain protocol experiments. Neither ships as the
user-window launch route because releasing their controller pipe terminates that browser.
Reparenting a bootstrap `--app` page also retained a spare New Tab and unnecessary promotion code.

**Linux proof and limits.** Disposable Helium 154 and Chromium 152 profiles proved registration,
repeat state queries and uninstall/reinstall through the pipe. A private Hyprland session proved
that the Helium controller exits before a browser-owned app launches, that a second `--app-id`
focuses the existing sole window, and that its last-window close works. The nested display's known
gray render leaves app title/icon and launchQueue URL delivery unconfirmed. Evidence is retained
at `/work/tmp/fregat-evidence/u1-installed-client-20261002/`; private compositor and DBus teardown
records are linked there. Chrome and macOS remain coordinator acceptance work.

**Mac startup regression proof — 2026-10-03.** Chrome 154 rejected installation from the app
root after a disposable profile had saved its workbench address. The same profile installed
successfully from the static metadata page. Headless setup produced no bootstrap window.
The installed window was inspected through macOS accessibility and a screenshot: Fregat owned
the menu and window, with no browser tabs or address bar. Protocol tests cover the static install
URL, standalone mode, preserved installation reasons and receipt invalidation. A deliberate
real-browser failure produced `install-info-unavailable` in the launcher's JSONL with browser
major, setup phase, elapsed time and pipe counters. Earlier successful protocol-only installation
checks did not establish these visible launch properties.

A Dock-started browser cannot acquire a retroactive private pipe. Do not scan browser databases,
intercept Dock launch, require runtime debugging, or kill that browser to regain installation
control. Uninstall during a live session requires closing that profile before repair.

**Approved owner decision (2026-10-02): native-host fallback.** When the selected browser
cannot install apps because the PWA domain or install support is absent, or no Chromium-family
browser exists, fall back to the native webview host with Fregat's own window and icon.
A plain `--app=` browser window is no longer a fallback in the implemented installed-app path.
`-32601` identifies an unavailable PWA method/domain; log the capability result once at info
and select the native host. An installation failure from a supported browser remains a structured
operational failure, distinct from missing install capability. Preserve explicit Browser
executable selection while applying this capability fallback to that selected browser.

The native host connects to the same shared machine server and uses the same approved picker
machine policy. Its window is owned by Fregat; installed-browser `focus-existing` and launchQueue
behavior are browser-specific, so prove native single-window and URL delivery through the host's
lifecycle. A browser that ignores `launch_handler` cannot claim installed single-client parity;
capability acceptance must establish the required launch behavior before delivering that path.

### Server availability without user steps

A Dock shortcut opens the manifest's stable start URL directly. The page cannot start a local
process, so the installer/first launcher setup must register or reuse the machine server before
installing the PWA. This is one-time setup, performed automatically. Subsequent browser launches
need only a connection to the stable endpoint; they do not run the launcher or an installation
script. Setup itself is idempotent and verifies the service, origin and served release before
creating the browser registration.

#### One server per machine and state home

**Approved owner decision (2026-10-02).** Each machine has one Fregat server for each state home.
Installed apps, ordinary browser tabs and phones over mesh all share it. The OS-managed service
is that machine's server at a fixed address; the installed app never starts a second server
against the same state. Opening any client connects to the running server or activates that
same service. A remote target is another machine's server, not an additional client-owned server.
Development remains separate, with its own ports and resolved dev state home.

#### Stable endpoint and origin

Choose the install target once and persist that choice as installation intent.

| Install mode               | Stable installed start URL                                                                   | Server ownership                                             |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Local packaged desktop     | `http://127.0.0.1:3301/` by default, a single origin serving the packaged web client and API | Per-user launchd/systemd socket-activated installation       |
| Existing remote production | Configured remote production URL                                                             | The remote host's existing production service and mesh route |
| Development                | The existing registered Vite/API mesh routes, with a separate browser profile                | Existing `scripts/dev-serve.ts` registration                 |

The local desktop port becomes a machine-scoped registry entry, with 3301 as the initial default.
Honor an already configured endpoint. Reserve the chosen port through the OS socket unit before
PWA installation when free; when occupied, run the identity probe below and reuse only a match.
Do not pick a different port on every run, silently share another app's origin, or bind publicly.
Use one explicit IPv4 loopback address, not an ambiguous `localhost` resolution. HTTP loopback is
a potentially trustworthy browser context; prove required web APIs on that exact origin.

A new packaged local release uses web base `/`. Today's shared production release uses
`/platform/` through mesh. Reusing an existing same-state server also reuses its configured web
base, release and service; for example the loopback client uses `/platform/` if that is what the
shared server serves. No second root-base server is started to suit the app. Reuse the release
builder with an explicit server-installation target when creating a new machine service. Server-generated URLs, CORS,
WebSocket/MCP URLs, cookies, and route helpers use the stable public origin, not the activator's
private upstream endpoint. Install manifest identity `./` against the chosen start URL.

Changing scheme, host, port, or base path changes browser origin, storage, permissions, and app
identity. Such a change is a new installation with explicit owner review, not an automatic release
update. Browser registrations for loopback and mesh origins have separate browser storage even
when they reach the same server; that does not create separate backend state or services. Dev
keeps its separate state home and ports. No account/state migration
or browser-database editing is part of this work.

#### Identity probe, reuse and conflict handling

Add an authenticated machine-server identity endpoint returning the product/protocol identity,
persistent server/state identity, canonical resolved state-home path, machine identity, configured
stable address/web base and service registration owner. A health response or matching HTML title
is insufficient. Resolve symlinks before comparing the expected state home; the persisted state
identity distinguishes a replaced directory at the same path. Use the existing machine/server
authentication and secret store for local setup; do not expose state-home paths to unauthenticated
mesh clients or log credentials and state paths. Verify the response against local installation
intent and credentials, not an untrusted server's self-declared product name alone.

Setup serializes service registration and performs this decision before PWA installation.

| Probe outcome                                                                     | Required action                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed address free                                                                | Register one OS listener/service, activate it, verify the authenticated identity, then install the client                                                                       |
| Existing Fregat, same canonical state home and state identity                     | Reuse its service, address, web base, release and state; register the browser app only                                                                                          |
| Existing Fregat, different state home/identity                                    | Fail with a structured address conflict identifying Fregat and the mismatch; require choosing the intended existing server or explicitly configuring another state-home service |
| Another program owns the address                                                  | Fail with a structured address conflict naming the known program/process holder; leave it untouched                                                                             |
| Listener exists but is starting, unreachable to the probe, or cannot authenticate | Await a bounded activation/readiness probe; if identity cannot be established, fail with a structured verification conflict and leave the listener untouched                    |

Use OS listener/process inspection when permitted to identify the holder; if its identity is
unavailable, state that fact instead of guessing. Public error guidance explains the address
conflict and how to select the intended server; runtime facts carry product/holder and mismatch
category without leaking credentials or setting values into logs. Do not kill a port owner,
silently select an ephemeral port, launch a second state-home server, or adopt an unauthenticated
listener. After registration, probe again to close the setup race. Two simultaneous installers
must converge or fail cleanly without overwriting each other's unit configuration.

Service ownership is persisted installation intent. An existing continuously running production
service is reused as it stands. Converting it to socket activation is a coordinated server update
through its current supervisor, preserving its port, state, release and mesh route, not a second
`fregat-server` service alongside it. A same-state server found on a different address is resolved
through its recorded service registration and fixed address, not restarted at a new default.
Enforce a process-lifetime state-home ownership lock in the shared server boot path as well as
setup serialization. All entry points respect it, so even an accidental invocation on a second
port cannot start another server against the same state. Lock ownership ends with the process;
do not rely on deleting stale PID files or forcibly evict a live owner.

#### macOS registration and socket activation

Install a user-owned `~/Library/LaunchAgents/dev.fregat.server.plist` into the logged-in user's
launchd GUI domain. The LaunchAgent names the installed activator by absolute path and declares
a named `Sockets` TCP stream listener with `SockNodeName: 127.0.0.1`, the configured stable port
as `SockServiceName`, and `SockType: stream`. launchd owns the listener while the server is absent
and starts the agent on the first connection. Socket demand provides activation; do not make
`RunAtLoad` or unconditional `KeepAlive` an always-running-server substitute.

The activator obtains the named listener with `launch_activate_socket`, validates the returned
descriptors and address, then starts the current server release. It runs in the user's GUI
session so native chooser helpers can use that desktop and real keychain. Keep the socket in
launchd across server exit/restart. Setup bootstraps the agent in `gui/<uid>`, verifies activation
with an HTTP request, then installs the PWA. The owner performs no `launchctl` step.

#### Linux registration and socket activation

Install a user-owned `fregat-server.socket` and `fregat-server.service` in
`~/.config/systemd/user/`. The socket unit uses `ListenStream=127.0.0.1:<configured port>`,
`Accept=no`, an explicit matching service, and `WantedBy=sockets.target`. Enable/start the socket
through the user manager during setup. The service starts the activator once for the shared
listening socket and receives it through `LISTEN_PID`, `LISTEN_FDS`, and the named activation
descriptor at fd 3. Validate one expected stream listener rather than accepting arbitrary fd 3.

The socket unit stays active while the service is stopped. The first browser TCP connection starts
the service and remains queued during startup. The service's owned process group includes the
activator and current server, not mesh, another installed app, or the shared terminal host. Use
the existing registered process budgets and OS supervision rather than an unbounded launcher
retry loop. The user session environment must allow a local native chooser; absence of a usable
desktop is a capability/availability result, not a silent dialog on another host. Do not enable
machine-wide services or user lingering as a side effect of a desktop install.

#### Taking the activated socket

The current server in `apps/server/src/index.ts` calls Elysia `app.listen({ hostname, port })`.
Checked-in Bun 1.4.2 `Bun.serve` types provide TCP/unix listeners but no public inherited-listener
option. An `fd` type elsewhere in Bun's low-level networking declarations does not establish
that its HTTP server can adopt a listening fd. A tiny helper that merely `exec`s Bun leaves the
same issue; it cannot make Bun bind a port launchd/systemd already owns.

**Execution choice unless a direct-adoption prototype proves otherwise.** A small native activator
takes the OS-owned listener and relays accepted byte streams to a private Unix-domain listener
of the unmodified HTTP/WebSocket application. It forks/execs the Bun server from `current`,
passes an internal activation descriptor identifying its runtime socket/public origin, and
waits for the health/release and authenticated identity endpoints before forwarding queued
clients. One activation starts one server; concurrent first connections share that startup. The activator
remains the transport relay. It preserves bytes and backpressure, so browser WebSocket upgrades,
SSE, uploads, HTTP keep-alive and half-close do not require a second HTTP implementation.

The server adds a Unix-listen boot path to its existing Elysia/Bun setup. The runtime socket lives
under a per-user, permission-restricted runtime directory and is freshly allocated for each
owned activation. It is not the PWA's address. Do not expose the private listener over the network,
close inherited descriptors accidentally during exec, spin while awaiting readiness, or drop
the first browser request and require the user to reload. Startup timeout/failure ends the owned
activation and reaches structured logs; OS socket supervision bounds retry behavior. Configurable
limits belong in the settings registry, not new environment variables or embedded tunables.

First prototype direct listener adoption on the supported Bun build. If it handles real HTTP,
WebSocket, SSE, queued first connection, restart and disconnect correctly on both OSes, adopt the
descriptor directly and delete the relay. Otherwise implement the bounded activator path above.
Reuse existing mesh transport behavior or code where applicable; do not introduce a second
general reverse-proxy framework. The minimum acceptable implementation is a socket activation
adapter plus the existing server, not another application runtime.

#### State, logs, idle and ownership

- Production app state remains the resolved production `PLATFORM_HOME`, default `~/.platform`,
  through `scripts/state-home.ts`. Dev uses its existing writable `/work/platform-dev/home` or
  home fallback. Never seed a packaged local production server from a disposable test profile.
- Releases, runtime and large logs use the existing production layout on a verified writable
  data drive. Prefer `/work` where available; choose a user-owned data location on macOS through
  install configuration. Unit/plist files are small OS-required configuration. Do not embed a
  developer checkout path, host name, or `/work` dependency into portable installation code.
- Reuse structured JSONL logging and `OBSERVABILITY_DIR`. The service records release, commit,
  activation/startup outcome and one wide event per operation. launchd stdout/stderr and the
  systemd user journal retain early activator failures; application logs remain in the release
  installation's configured logs directory. Record rotation follows the existing logger.
- A closed app does not remove the socket or state. Idle shutdown is allowed only when there are
  no active sessions, terminals, streams or work keeping the server busy. Use a registered idle
  policy and existing lifecycle owners; app-window count alone cannot decide server shutdown.
  The socket remains ready and the next app launch wakes the service. Do not terminate the shared
  terminal host to achieve an idle server.
- Two setup invocations converge on one installed unit/plist and one listener. A second browser
  client reaches the same state home and server. Read/validate a served environment identity
  before trusting an already occupied endpoint as this installation.

#### Updates and uninstall

Reuse `scripts/deploy/release.ts`, staged `releases/`, `current`/`pending` links, explicit restart
approval, promotion and post-promotion live checks. Stage complete web/server/activator artifacts;
never replace files inside a running release. Swap the `current` link atomically only through
the approved restart path. Adapt the existing promotion host actions for launchd and local
systemd supervision; do not duplicate release validation or let a crash promote an unapproved
pending release. The stable socket/origin stays registered while the server drains and restarts.
Existing connections may reconnect through the app's normal recovery behavior. A queued cold
launch reads the approved `current` release and wakes into it.

A replaced activator binary needs its own supervised restart after draining. The OS continues to
own the stable socket across that transition. Release rollback retains the same app identity,
state and socket; reuse the existing previous-release/live-check mechanism. Test the combined
failure boundary, including a bad candidate server and an activator that fails before readiness.
The current release's `server/node_modules` relationship means dependency updates must follow
the existing deployment contract; a link rollback does not undo a dependency install.

Removing an installed browser app removes only its browser registration, through a browser-supported
uninstall route. It keeps the shared machine server, socket and mesh route: ordinary browser tabs,
phones and other app registrations still use them. A separate explicit machine-server uninstall
unregisters the recorded service owner (LaunchAgent or systemd socket/service pair), stops only
its owned processes after handling busy-work approval, and removes installer-owned registration
files. Reusing an existing service does not transfer uninstall ownership to the browser client.

Neither operation deletes `~/.platform`, workspaces, secrets, logs, or shared terminals by default.
Data deletion is a separate explicit action. A remote-target client uninstall never disables or
deletes the remote server or mesh route. Do not manually delete browser databases or app bundles
as a substitute for browser uninstall. Test app uninstall with another browser/phone still using
the shared server, then explicit server unregister/reinstall with state retained.

#### Existing mesh infrastructure and remote mode

`scripts/deploy/systemd/platform-prod.service`, rendered through `scripts/deploy/mesh.ts`, already
runs the production server on 3301 with restart/backoff, `WEB_ROOT`, structured log configuration,
`ExecStartPre` promotion and `current` releases. It is a user service enabled under `default.target`,
not currently a socket-activated service. The mesh `/platform` route provides the stable HTTPS
origin and proxies to that server. Reuse this deployment/release arrangement for today's remote
production app; a Mac client needs no local server merely to load that remote app.

`scripts/dev-serve.ts` already registers mesh `--run` routes for Vite/API, starts their upstreams
on demand, and keeps its route bound while they idle. Keep that development path. It is not an
automatic replacement for a standalone macOS LaunchAgent or Linux socket installer on a machine
without mesh. Similarly, today's fixed production mesh proxy cannot wake a manually stopped
upstream unless upstream socket activation or a mesh command route is registered.

If remote production itself becomes idle/on-demand, add socket activation to the existing remote
production upstream or register its command with the existing mesh demand mechanism. Choose one
supervisor for that upstream and retain its release/update semantics; never register a competing
listener for the same 3301 port. A remote user's browser connection reaches the mesh listener,
then wakes the upstream. No local page starts or installs remote OS services. TLS/network/auth
failures stay real connection errors with recovery; a local activator cannot repair a remote outage.

Remote mode uses the approved in-app server-filesystem picker. No native chooser is launched
on the remote desktop or through a new viewing-host capability service. Local native chooser
availability requires an authenticated same-machine connection; both launcher and Dock launch
follow that policy.

### Execution gates after design approval

- [x] Ship Chrome-first discovery separately with failing-before/passing-after selection tests,
      Browser setting copy, and generated settings artifacts.
- [x] Inventory every bridge member, transport message, and web consumer. Name replacements,
      unsupported capabilities, and remote/native-picker constraints here.
- [x] Owner approves the installed-app design, shared machine/state-home server, remote in-app
      picker and native-webview fallback (2026-10-02). Implementation starts after this plan PR merges.

#### Parallel build units and ownership

Start U1, U2 and U3 in parallel after this plan merges. Each owns its listed files and tests.
U3 publishes the contract-only schemas first so U1/U2 can compile against the exact interface
while service implementation continues. Those units may use outside-world fixtures for browser/
OS protocols, but final integration tests use the real server. Shared-file edits go through the
named owning unit; no two units independently modify the same manifest, registry or API route.
The coordinator owns integration order and ticks acceptance after reviewing each unit's evidence.
Native picker **endpoint implementation belongs only to U3**; U2 owns its web consumer.

##### U1 — installed client

**Scope.** Manifest identity/OS registration, Chrome-first/explicit selection integration, PWA
install/launch/repair, CDP release and native-webview capability fallback. Consume U3's setup/
identity API before registration; connect to its matching shared service. Implement no server,
socket activator, picker endpoint or web capability policy here.

**Owner files/directories.** All paths are repository-relative.

- Existing `apps/web/public/manifest.webmanifest` and its existing icon assets: U1 alone changes
  manifest `id`, names, display policy and `launch_handler` declaration. U2 owns the JS consumer.
- Existing `apps/desktop/src/launcher/` and its `tests/`, including `index.ts`, `chromium.ts`,
  `cdp.ts`, `profile.ts`, `singleton.ts`, `webview-host.ts`, `native-window.ts`, `shell-bridge.ts`
  and existing browser-selection files. New `installed-app.ts` and its fake-browser tests live
  here. Remove installed-browser injection while retaining native-host transport where required.
- Existing `apps/desktop/src/shared/bridge.ts`, `apps/desktop/src/bun/` and desktop launch scripts
  for native-host integration if needed. Native source/build changes belong to U3 below; request
  that owner for an existing host protocol change rather than editing its files independently.
- New launcher installation-client adapter under `apps/desktop/src/launcher/`, consuming U3's
  public service-setup entry point and shared contract exports; it does not implement setup.

**Acceptance.**

- [ ] Failing-before/passing-after fake-browser tests cover unknown/installed identity,
      install/launch repair, unavailable PWA domain/install support, explicit browser choice,
      no-Chromium and native-webview fallback. A plain `--app=` fallback is absent.
- [ ] Real disposable-profile Linux browser evidence proves registration, repeat launch,
      uninstall/repair, URL delivery and CDP release. Separate Chrome/Helium capability proofs;
      report unavailable browsers. Do not claim headless proof establishes OS icon/window identity.
- [ ] Dock-first then launcher and launcher-first then Dock use one app client and U3's shared
      server. An already-running browser is preserved. No owner accounts/default profiles are used.
- [ ] Native fallback owns its Fregat window/icon, uses the shared server and preserves other
      browser profiles/terminals. Read `look` evidence for the delivered window/UI where available.

##### U2 — web bridge removal

**Scope.** Installed-browser runtime capabilities with no injected globals: WCO geometry and
drag/no-drag, client-platform conventions, launchQueue URL delivery/focus and picker routing.
Authenticated same-machine capability uses U3's native endpoint; remote or unproven locality
uses the existing in-app server-filesystem picker. Native-host compatibility is an explicit
capability seam, never the installed-browser runtime requirement.

**Owner files/directories.**

- Existing `apps/web/src/lib/platform/` (`bridge.ts`, `platform.d.ts`, `backdrop.ts`,
  `window-drag.ts`) and new `capabilities.ts`; shared browser capabilities stay here only while
  their consumers satisfy the repository's multi-consumer rule.
- Existing `apps/web/src/components/app-titlebar.tsx`, `use-pick-entry.tsx`, their `tests/`,
  `components/utils/picked-path.ts` and `apps/web/src/lib/file-server.ts` for query/mutation
  consumption and backend path hydration. Add feature-owned query/mutation keys with the
  owning consumer; no endpoint or helper implementation in these files.
- Existing `apps/web/src/features/settings/state/system-color-mode.ts`, settings desktop
  availability consumers, `features/chat/utils/screenshot-capture.ts` and browser notification
  consumers identified in the bridge inventory, changing only the capability seam.
- New WCO/launchQueue hooks and pure URL validation beside their consuming component/domain,
  `packages/ui/src/styles/globals.css` for reusable app-region utilities, and any required
  design-census exceptions. No per-call-site raw CSS or custom motion policy.
- Existing `scripts/agent/selectors.ts` and new installed-app/picker/WCO scenarios in
  `scripts/agent/scenarios/` for web evidence. U1/U3 request shared selector changes from U2.

**Acceptance.**

- [ ] Real-server tests open the app with zero `platformBridge`/shell globals. Capabilities,
      theme, capture, backdrop, titlebar and picker behave on both direct and launcher launches.
- [ ] WCO on/off, geometry changes, drag/no-drag controls and launchQueue incoming URL validation
      preserve drafts/terminals. Existing clients focus without surprise navigation.
- [ ] Verified same-machine native selection/cancellation hydrates U3 backend paths; remote,
      unavailable-desktop and unverified-locality cases open the in-app picker. No remote desktop
      chooser is invoked. Query/mutation state settles before completion, including failures.
- [ ] Portable tests, compiler/design gates and `look` screenshots read back prove the changed
      web surfaces. Dock/OS drag acceptance remains in the coordinator's Mac gate below.

##### U3 — server service and native picker endpoint

**Scope.** Sole owner of the server-side native-picker endpoint and helper lifecycle, shared
service installation/activation, identity probe, state-home lock, authenticated capabilities,
release/service integration, and shared contract schemas. No manifest/launcher/web consumer edits.

**Owner files/directories.**

- Existing `apps/server/src/index.ts`, `app.ts`, `home.ts`, `db/environment-identity.ts`,
  `installation/`, `machines/authentication.ts` and existing server authentication/mount seams.
  New `apps/server/src/system/` owns identity/capability routes, state-home ownership and tests.
- Existing `apps/server/src/fs/routes.ts` plus new `fs/native-picker.ts` and its tests own
  **the only native-picker endpoint**, authorization, request cancellation, serialization,
  timeout/stop grace and backend-path validation. New server native-helper adapter belongs here.
- New `apps/server/native/` for picker-only helpers and new `scripts/service/` for the native
  activator, launchd/systemd registration, service-setup entry point and portable tests. Existing
  `apps/desktop/native/` and `apps/desktop/scripts/build-native.ts` are U3-owned only where helper
  extraction/build integration is needed; preserve the native window ABI consumed by U1. Do not
  import desktop feature modules into the server or duplicate native picker business logic.
- Existing `scripts/state-home.ts`, `scripts/deploy/` (including systemd promotion/release/live
  check), server packaging/build integration and release assets needed for the shared service.
  New launchd/socket templates live in `scripts/service/`. Reuse existing production ownership.
- New `packages/contracts/src/server-identity.ts` and `native-picker.ts`, package entry exports,
  `settings/keys.ts`, generated schema/reference and relevant contract tests. U3 owns registry
  entries for service limits/ports and existing native-dialog budgets, updating scopes if needed.

**Acceptance.**

- [ ] Prove inherited-listener adoption or the bounded native relay on both OSes, with queued
      first request, simultaneous connections, WebSocket/SSE/backpressure, disconnect and restart.
      Cold app/browser/mesh access activates the same service with no launcher running.
- [ ] Authenticated identity reuse succeeds for the same state home; another program,
      different state identity/home and unverifiable listener fail with structured conflicts.
      Concurrent setup and a second-port start cannot create duplicate state-home servers.
- [ ] Real server/native-helper fixture tests cover picker option validation, unavailable
      desktop, same-machine authorization, CSRF/origin rejection, cancellation/disconnect,
      serialized requests, timeout and owned-child cleanup. Remote/unproven-local requests are
      rejected even if a caller bypasses U2's routing.
- [ ] Stable base/origin, state/log paths, updates, approved promotion, live-check failure,
      rollback, shared-client app uninstall and retained-state server reinstall are verified.
      Existing production/dev mesh services are reused without competing listeners.

#### Interfaces between units

U3 owns portable Valibot schemas/types and their package exports; U1/U2 consume them. New routes
are authenticated selected-machine APIs, using the existing client/proxy routing. Paths below
are relative to the configured server API base (including `/platform/` where applicable).

- `GET /system/identity` returns `{ product: "fregat", protocolVersion, machineId,
environmentId, stateHome, address, webBase, service: { kind, registrationId } }`.
  `environmentId` reuses the durable environment identity; `stateHome` is canonical. `address`
  is the stable public listener, never the private Unix upstream. `kind` identifies launchd,
  systemd or an existing supported supervisor. U1 setup compares identity/state against local
  installation intent; U2 uses machine identity, never the state path, for target capabilities.
  State-home disclosure is restricted to authenticated installation/owner scope. Authentication
  failure is distinct from another program or mismatched state. Do not invent a second UUID
  when the existing durable environment identity provides the state identity.
- `GET /system/capabilities` returns `{ machineId, environmentId, nativePicker }`, evaluated
  for the request that asked. `nativePicker` is `true` only when that request is local and a
  native helper with a usable desktop session exists. A request is local only when it arrived
  on a loopback socket (judged by the socket's remote address, never by a header), its Origin is
  the local install origin, and it carries no proxy hop: any `Forwarded`, `X-Forwarded-*`,
  `X-Real-IP` or `Via` header makes it remote. mesh serve always sets `X-Forwarded-For`, and
  Fregat's own machine proxy stamps `Via: 1.1 fregat` after stripping forwarding headers, so
  a request relayed from another device or machine through a loopback tunnel is remote. The
  browser carries no locality proof; U2 reads the boolean, and U3 re-checks the same rule on
  the mutation. Hostname, platform or capability claims alone never establish locality.
- `POST /fs/native-picker` takes `{ mode: "folder" | "file", accept?: readonly string[],
startingPath?: string, multiple?: boolean }` and returns `{ outcome: "selected" | "cancelled",
paths: string[] }`. Paths are selected-server absolute paths; cancellation returns an empty
  array. Authenticated same-machine authorization travels through the established auth layer,
  not a caller-supplied `isLocal` boolean. Unsupported desktop, invalid options, forbidden origin,
  timeout and helper failures use existing structured error envelopes. Closing/aborting the
  request cancels its owned chooser. U2 serializes through mutation scope, then hydrates using
  the existing filesystem API; U3 also enforces one active chooser per desktop host.
- U3 exposes `ensureMachineService` from `scripts/service/` with installation intent containing
  canonical state home, fixed address, web base and expected machine/environment identity.
  It resolves with verified identity and `reused`/`registered` disposition after readiness,
  or rejects with a structured conflict. U1 calls it during one-time setup before PWA registration;
  ordinary Dock launch calls no setup code. Remote target setup verifies the selected remote
  service without installing a second local state-home server. Locality is decided by the
  server per request (above), so setup issues no locality credential.

U1 owns manifest `launch_handler`; U2 owns its `launchQueue` consumer. U1 owns installed/native
host choice; U2 owns runtime web capability/picker choice; U3 owns server capability truth and
authorization. Interface changes are published by U3 with all three units agreeing on consumer
updates before integration. The coordinator runs combined real-server acceptance after the
parallel unit checks. After implementation merges, the coordinator performs the Mac check below;
The owner completed the separate acceptance and approved Gate 4 on 2026-10-03.

### Protocol evidence and limits

The 2026-10-02 Linux experiment used Helium 0.18.1.1, reporting `Chrome/154.0.8037.57` over the
production CDP pipe. In a disposable profile it observed unknown app state, installed Fregat,
queried its OS state, opened the current page in the app, and launched it. A subsequent production
launcher experiment observed installed state after browser restart and standalone display mode.
It also exposed the spare New Tab and duplicate page-session promotion failure of the rejected
injection/reparenting approach. Those experiments are evidence for the protocol, not delivery of
this bridge-independent design.

Evidence is retained at `/work/tmp/fregat-evidence/*installed-app-20261002/` (the dated installed-app proof directory).
Google Chrome 154 is not installed on this Linux host; Chromium here is 152. Chrome 154 runtime
behavior and Mac OS registration remain unconfirmed. Headless proof cannot establish Dock,
Cmd-Tab/taskbar identity, WCO drag, chooser visibility, or real-keychain behavior.

Protocol parameters and unknown-app semantics were checked against the
[DevTools protocol](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json)
and [Chromium PWA handler](https://github.com/chromium/chromium/blob/main/chrome/browser/devtools/protocol/pwa_handler.cc).
The [WCO reference](https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API),
[launch-handler reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/launch_handler),
and [File System Access reference](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
document the platform constraints above. The protocol is experimental; pin observed versions in
each implementation proof.

### Coordinator's Mac acceptance after implementation merges

Use the logged-in desktop and real keychain, a disposable Fregat profile, and no real accounts.
The worker does not run on the owner's Mac. Check Chrome-first auto with Helium as OS default,
explicit Helium selection, and no-Chrome selection independently.

Install once and inspect the generated Fregat app name/icon in Dock, Cmd-Tab and Finder/Launchpad.
Close the launcher completely; open Fregat through the browser-created Dock entry and native app
launcher. Confirm normal boot, editor/terminal/draft retention on repeat launch, launchQueue URL
handling, native chooser selection/cancellation, and zero dependency on injected globals.
Repeat with Dock first and then the desktop launcher, and the desktop launcher first and then Dock. Each path must focus one
installed client. Test WCO enabled and disabled, system theme changes, opaque backdrop, titlebar
geometry, drag/no-drag hit areas, browser notification permission, and browser screen capture.
Close the final Fregat window and prove mesh services, existing terminals, and another browser
profile survive. Restart from the Dock with mesh routes idle. Test remote-machine selection with the in-app server-filesystem picker and local-machine
native selection separately; a dialog opening on an unseen remote desktop is a failure.

## Fregat.app on macOS

**Status: Approved 2026-10-02.** One double-clickable `Fregat.app` that carries everything it
needs: no Bun, Git checkout or terminal step on the user's machine.

### Window choice

- `window.browser=auto`: Fregat’s native WKWebView window. Compositor mode keeps the window
  opaque; transparent-window mode enables native Frosted and Glass materials. The transparency
  control remains available in either native Mac mode.
- `window.browser=auto` with `window.transparency=window`: the native WKWebView host with
  vibrancy. The owner accepts WebKit's rendering here; no
  WebKit performance study is needed.
- `window.browser=webview` selects the native host explicitly; an explicit browser executable takes
  precedence over automatic selection.
- No supported Chromium browser: the native host, with vibrancy set by `window.transparency`.
- An explicit browser executable retains the installed Chromium app path. Chrome owns that
  window’s frame and controls. Electron and a bundled engine are later (see below).
- Development wraps the native host in `Fregat Dev.app` with Fregat’s icon and a separate bundle
  identifier. Packaged clients use `Fregat.app` and its production identity.

**Default decision — 2026-10-03.** The owner rejected the installed Chrome window as the normal
Mac desktop experience and selected the retained native WebKit host. This supersedes the earlier
Mac Chrome-first decision. Today’s fresh development home was distinct from yesterday’s isolated
native acceptance home. Engine-selection checks must cover fresh defaults as well as transparent
mode, and visible verification must inspect the real native app and integrated traffic lights.

Verification for this change used the actual `Fregat Dev.app` on macOS. The opaque host exposed
`window.transparency`; selecting Transparent window saved it to the isolated settings home.
After reopening, the host reported transparent backdrop, overlay titlebar and Liquid Glass
capability, and received Glass then Frosted appearance commands. Both native windows were
visually inspected. The native runtime reported WebGPU available, EditContext absent and
screen capture absent. The editor retains its textarea input fallback. Evidence is in
`/tmp/fregat-native-default.urPRqz/`; the browser health capture is
`evidence/20261003T183718Z-look-1440x1000/`. Playwright WebKit was unavailable on this Mac;
system WKWebView supplied the native proof.

### Window material

**Status: Approved 2026-10-03.** `window.material` is an Appearance choice with three values,
default `none`. The Mac feedback established that fading AppKit's fixed tint and blur reads as
another opacity control, especially when the page adds its pane fill. The material now owns the
whole native surface when selected.

- `none` keeps the active behind-window `NSVisualEffectView` in the hierarchy at alpha `0.0001`.
  A positive alpha requests live desktop compositing while its blur and tint contribution is
  negligible. The desktop shows through the page's panes at `workbench.surface.opacity`.
- `frosted` shows the full-strength public `NSVisualEffectView` material. Page panes paint no fill.
- `glass` shows the public macOS 26 `NSGlassEffectView`. Runtime class lookup behind a macOS 26
  availability guard allows builds with older SDKs. Older systems use the frosted material;
  settings explain that Glass needs macOS 26. Page panes paint no fill.

Pane opacity stays visible and is marked not applicable while a material owns the transparent
native surface. Page pane blur stays off in this host for every material. Browser and Linux
surfaces retain their existing opacity and blur behavior; window material is not applicable
there. Content wells also clear their fill while a material is active. Selected controls and
muted fields retain their saved opacity. Dialog backdrops and the editor minimap retain their
separate filtering.

The rendering-only choice has window scope and switches live through the existing combined
appearance message, carrying opacity and material. The host starts clear until that message
arrives. The previous percentage setting and its callers are removed. Public AppKit properties
only; property names avoid Objective-C `new`, `init` and `copy` ownership families.

Mac acceptance uses Dark mode on macOS 26.4. Switch None, Frosted, Glass and back to None in a
transparent native window. Check that each material owns the entire pane surface, pane opacity
is marked not applicable for Frosted and Glass, and None restores the saved opacity. Repeat
with a light desktop behind the window, then reload. With a live video wallpaper, None must
keep playback continuous while the desktop stays sharp and untinted, including with the window
inactive and after switching back from Frosted or Glass. On macOS before 26, Glass must explain the
requirement and render the frosted fallback. The Fregat.app CI job proves native compilation;
Linux verification proves the bridge and page behavior with an isolated host fixture.

### Bundle layout

```text
Fregat.app/Contents/
  Info.plist             CFBundleIdentifier dev.shaulavo.fregat, LSUIElement true
  MacOS/fregat           `bun build --compile` of apps/desktop/src/launcher/index.ts
  MacOS/platform-webview the native host; runs from MacOS/ so it shares the bundle identity
  Resources/release/     a self-contained release (below)
  Resources/Fregat.icns  from scripts/app-icon (fregat.svg)
```

`LSUIElement` keeps the launcher out of the Dock on the Chrome path. The native host already calls
`setActivationPolicy:Regular` (`platform-webview.m`), so the native path shows Fregat in the Dock and
Cmd-Tab under the bundle's name and icon.

**Self-contained release.** Today `buildServer()` links `server/node_modules` and the release-root
`node_modules` into the build checkout. `Resources/release/` instead holds the server and worker
bundles, web assets, `build-config.json`, `bin/promote.ts`, and the darwin runtime dependencies
installed from the generated manifest and lock. Every dependency link resolves inside the payload.

**One runtime.** The LaunchAgent runs `promote.ts` and `current/server/index.js` with the service
host's `bun`, which is `process.execPath`: in a compiled launcher that names `MacOS/fregat`. A1
proves the compiled executable runs scripts as Bun with `BUN_BE_BUN=1` and the service unit sets
it; if that fails, A1 ships `MacOS/bun` and the service host points there. Either way no system Bun
is needed.

**Bundle-relative resources.** The launcher resolves resources from its executable inside the
bundle: the native host from `Contents/MacOS/platform-webview` (today
`apps/desktop/native/build/`), the release from `Contents/Resources/release`. The service setup
(`ensure-machine-service.ts`, today a computed dynamic import in `installation-client.ts`) is
imported statically so it compiles in, and the promotion source it reads becomes an embedded asset.
The checkout-root derivation in `launcher/index.ts` stays for development runs only.

### First launch and updates

1. The launcher resolves `server.releaseRoot` (default `~/Library/Application Support/Fregat/releases`).
2. When `current` is missing, or its commit differs from `Resources/release`, it copies the bundled
   release into `releases/` and links it: first install promotes directly, an update stages
   `pending` and follows the existing restart approval. No file inside a running release changes.
3. `ensureMachineService(intent, { productionRoot })` registers the LaunchAgent and socket against
   that release root, then the launcher opens the window for the chosen path. A Dock relaunch with
   the server stopped wakes it through the socket.

`scripts/deploy/release.ts` takes its root from `scripts/deploy/config.ts`, fixed to
`/work/platform-production`, and `createRelease`, `stagePending` and `swapCurrent` take no root. A2
extracts root-parameterized release creation, staging and atomic link operations; the app passes
its `server.releaseRoot`, and `bun run deploy` keeps `/work/platform-production` and its mesh live
check. The app's promotion skips the systemd and checkout live check and runs the server's own
readiness probe (`GET /system/identity`).

### Build

`bun run app:mac` builds the bundle on macOS into the build directory: compile the launcher, build
the native host, assemble the self-contained release, generate the icon, write `Info.plist`, then
ad-hoc `codesign`. Developer ID signing, notarization and a DMG wait for a public release. CI builds
the bundle on the macOS runner and checks its layout, `Info.plist`, and that no file or link in it
points outside the bundle; it does not open a window.

### Units

- **A1 — bundle builder**: `apps/desktop/scripts/build-app.ts`, `app:mac` script, icon and plist,
  self-contained release payload, the runtime proof (`BUN_BE_BUN` or `MacOS/bun`), bundle-relative
  resource resolution in the launcher, CI layout check. Done when the built app, moved to a path
  with spaces and with the checkout renamed away, launches the server through the LaunchAgent.
- **A2 — bundled first launch**: root-parameterized release operations extracted from
  `scripts/deploy/release.ts`, seeding or staging `Resources/release` under `server.releaseRoot`,
  the static service-setup import and embedded promotion source, then `ensureMachineService` and the
  window. Tests run against a temp release root with the real release code. A2 owns
  `scripts/deploy/` and `scripts/service/`; A1 owns `apps/desktop/scripts/` and the launcher's
  resource resolution.
- **A3 — owner Mac acceptance over mesh**: the checks in "Coordinator's Mac acceptance" above, run
  from the built `Fregat.app`, plus: a clean `~/Library/Application Support/Fregat`, Dock launch with
  the server stopped, transparency on and off, and the native-window path through the Browser setting
  `webview` (Chrome stays installed).

## Historical rationale and prototype design

The following rationale, prototype shape and browser/host measurements record the September
research baseline. Electrobun/Hutch names, deleted file paths and injected-CDP behavior here
explain the replacement decision; they are not current dependencies or launch instructions. The
installed-app and `Fregat.app` sections above supersede this prototype architecture.

### Why

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

Today the desktop waits for the mesh-managed API and Vite URLs, opens a window, installs
`window.platformBridge`, answers `pickEntry`, and flushes observability on quit. It does not
spawn or stop those shared servers. On macOS it attaches vibrancy behind a transparent window.
The launcher preserves shared-server ownership. The approved installed-app design above extends the
packaging follow-up with OS activation and a single server per machine/state home, never an
app-window-owned server.

## The shape

The owner's order (2026-09-26, Q1): use the user's installed Chromium-family browser in app mode;
when there is none, the system webview; when there is neither, the default browser in a tab.

```text
bun  apps/desktop/src/launcher/index.ts   (owns the window process)
 ├─ waits for mesh-managed API and web URLs (shared services, no child ownership)
 └─ window, one of:
     1. chromium --app=<url> --user-data-dir=<home>/desktop/chromium --remote-debugging-pipe
          CDP over fds 3/4: bridge injection, pickEntry, lifecycle, permissions
     2. platform-webview <url> <preload>  (C + WebKitGTK 4.1 on Linux, Obj-C + WKWebView on macOS)
          JSON lines over stdio: page messages out; eval, pick, drag, close in
     3. xdg-open / open <url>             (a tab in whatever the system has; no bridge)
```

- **Bun runs the launcher.** Reuse today's readiness checks, bridge, quit handling and wide
  events from `src/bun/index.ts`. The former `spawnServer`, `spawnWeb`, child lease and port
  ownership assumptions are obsolete. No separate runtime is bundled for the shell; packaged
  server/runtime validation stays in the packaging follow-up.
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
2. **Google Chrome**, when installed, regardless of the OS default. Linux finds its binaries
   and flatpak export; macOS finds the `com.google.Chrome` bundle.
3. **The default browser, if it is in the table.** Linux: `x-scheme-handler/https` from the XDG
   `mimeapps.list` search path (0 ms; `xdg-settings get default-web-browser` answers the same in
   106 ms), then the `.desktop` file's `Exec` token. macOS: `LSHandlerRoleAll` for `https` in
   `~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist` (read
   with `plutil -convert json`), then the app path by bundle id (`/Applications`, `~/Applications`,
   `mdfind kMDItemCFBundleIdentifier`), executable from `Info.plist` `CFBundleExecutable`. This
   machine resolves to Helium on both the PC and the Mac.
4. **The table, top to bottom**, on `PATH`, then the flatpak export dirs
   (`/var/lib/flatpak/exports/bin`, `~/.local/share/flatpak/exports/bin`), then the macOS bundles.
5. **The webview host**, if its library loads (`libwebkit2gtk-4.1.so.0` on Linux; always on macOS).
6. **The default browser in a tab** (`xdg-open` / `open`), with the reason in the log and a
   `desktop.window.degraded` event. The web picker and the web wallpaper cover what the bridge would.

**Approved owner decision, 2026-10-02.** `auto` uses the Chrome-first order above on Linux and
macOS. An explicit browser path stays first. The Browser setting describes the automatic order.

`window.transparency: 'window'` needs a see-through window, which only the webview host can make,
so under `auto` it selects the webview. The default transparency is `compositor`, which retains
Chrome-first selection.

Flatpak and snap run confined. Flatpak needs `flatpak run --filesystem=<profile dir>`; snap cannot
write hidden directories in `$HOME`, so its profile goes under `~/snap/<name>/common/platform`.
Whether fds 3/4 survive `flatpak run` is unverified (no flatpak here). If CDP does not answer within
5 s, the launcher kills that candidate and moves down the list.

### What each window can do

Chromium measured on this machine (Chromium 151 and Helium 0.15.7, Hyprland 0.56 native Wayland,
RTX 3060 Ti); macOS rows measured on `shaul-mac` (macOS 26.4, Chrome 153, Helium 0.16.3) where
noted; Electrobun rows from today's code.

| Capability                         | Electrobun today                                            | Chromium `--app` (path 1)                                                                                                                                          | Webview host (path 2)                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Engine                             | CEF, 409 MB bundled                                         | the user's Chromium, nothing bundled; WebGPU and EditContext present                                                                                               | WebKitGTK 2.52 / WKWebView; no EditContext                                                                                    |
| Profile                            | CEF's own                                                   | `--user-data-dir=<PLATFORM_HOME>/desktop/chromium`, `--profile-directory=Platform`; 12–28 MB fresh                                                                 | WebKit default data dir                                                                                                       |
| Isolation from user's browsing     | yes                                                         | yes: separate process, no shared cookies; `--disable-extensions` needed (below)                                                                                    | yes                                                                                                                           |
| Bridge injection                   | preload string                                              | `Page.addScriptToEvaluateOnNewDocument` plus an immediate `Runtime.evaluate`                                                                                       | `WKUserScript` / `webkit_user_script` at document start                                                                       |
| `pickEntry`                        | Electrobun GTK dialog, X11                                  | `Runtime.addBinding` → launcher → `platform-webview pick` (portal / `NSOpenPanel`)                                                                                 | host's own dialog: portal on Linux, sheet on macOS                                                                            |
| Titlebar                           | macOS `hiddenInset`, traffic lights over our bar            | native frame; none on Hyprland; macOS draws Chrome's titlebar above ours                                                                                           | macOS `hiddenInset`; Linux native frame                                                                                       |
| Window drag                        | `electrobun-webkit-app-region-drag`                         | native frame does it                                                                                                                                               | macOS: `performWindowDragWithEvent` on a `drag` message                                                                       |
| Dark mode                          | `gdbus` portal read (X11 workaround)                        | native: `prefers-color-scheme: dark` true before first load                                                                                                        | native on Wayland (Gate 0) and macOS                                                                                          |
| Transparent / vibrancy             | macOS vibrancy (CEF OSR, 5.5 MB/paint)                      | no                                                                                                                                                                 | macOS `NSVisualEffectView`                                                                                                    |
| Keyboard                           | CEF passes everything                                       | every chord probed reaches the page first and is preventable: Ctrl+W, Ctrl+Shift+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+L, Ctrl+Shift+I/J/C, F5, F11, F12, Ctrl+Shift+Q | as the engine                                                                                                                 |
| Clipboard, notifications           | CEF defaults                                                | `Browser.grantPermissions` pre-grants `clipboardReadWrite` and `notifications` for our origin (measured `prompt` → `granted`)                                      | WKWebView: `clipboard.readText` and `Notification` exist on `http://127.0.0.1`                                                |
| Screen capture (Plan 163)          | `getDisplayMedia` in CEF                                    | `getDisplayMedia` with the portal picker, as in a tab                                                                                                              | WKWebView: `getDisplayMedia` absent (feature reports unsupported). WebKitGTK: `captureStream` aborts the web process; hide it |
| Devtools                           | CEF devtools                                                | Chrome DevTools (Ctrl+Shift+I when the page does not claim it)                                                                                                     | Web Inspector                                                                                                                 |
| Close window                       | quits                                                       | Linux: browser exits in 407 ms, code 0. macOS: Chrome keeps running (measured), so the launcher sends `Browser.close` on the last page's `Target.targetDestroyed`  | host exits, launcher quits                                                                                                    |
| Second launch                      | connects to shared services; no server-port ownership check | Chromium's singleton hands off in 44 ms and opens a second window, which the first launcher's CDP session attaches to and bridges                                  | explicit host-instance ownership                                                                                              |
| Launcher crash                     | —                                                           | the pipe closes and the browser exits within 300 ms: no orphan window                                                                                              | stdin EOF ends the host                                                                                                       |
| Tray, global shortcuts, deep links | available, unused                                           | none                                                                                                                                                               | none                                                                                                                          |
| Window identity                    | —                                                           | Wayland `app_id` `chrome-127.0.0.1__platform_-Platform` (host + path + profile dir); `--class` is ignored on Wayland                                               | `app_id` of the host binary                                                                                                   |
| Dock icon                          | ours                                                        | Linux: ours through a `.desktop` with that `StartupWMClass`. macOS: the browser's icon                                                                             | ours once bundled                                                                                                             |

Nothing on the page needs the bridge at document start in the Chromium path: `backdrop` falls out
of the user agent (`compositesOverDesktop`), `colorScheme` is `null` because Chromium reads the
portal, and every `getPlatformBridge()` call runs at use time. So the race below costs nothing as
long as the launcher also evaluates the bridge into the current document.

### Supervision and quit

The launcher owns its browser or native-host process and its IPC, plus any picker helper it
starts. Window close flushes desktop observability and releases those owned processes/resources.
It must leave mesh-managed API/Vite processes and the shared terminal host running. Verify that
closing or crashing the launcher preserves an existing browser session and its running terminal.

A shared-server outage uses the app's existing connection/recovery behavior. Start failures before
a window exists retain `showStartFailure`: `platform-webview message` on Linux and macOS, stderr
and a log event elsewhere. Browser singleton handoff must distinguish a process started by this
launch from a pre-existing instance; a second launcher cannot tear down the first window.

Plan 132 transfers its Electrobun vibrancy pointer workaround to Gate 3. The replacement native
host owns its window directly; verify that path on macOS instead of patching obsolete Electrobun
window discovery. Plan 126's desktop capability matrix consumes these host results. Its unrelated
chat/provider batches do not wait on the desktop launcher.

## Gates

**Closeout: Gates 1–4 done, 2026-10-03, following approved owner acceptance.**
`bun run desktop:dev` runs the launcher directly. Gates 1–3 below retain their original
engineering requirements and dated proof reports, including the former opt-in command and
default-shell descriptions. Those historical reports do not reopen the accepted Mac gate.

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
5. Lifecycle: browser exit → owned-window cleanup only. A second `desktop:dev` uses Chromium's
   singleton handoff with the same profile, opens a bridged second window, then exits 0. Prove
   that handoff and launcher failure do not stop shared services or another launcher's window.
6. Settings: register `window.browser` (machine scope, `requiresRestart`) with its consumer here.
   Regenerate `docs/settings-reference.md`.
7. Frame counter: 2 s after `Page.loadEventFired`, count rAF for one second and put
   `rafPerSecond`, `product` and `engine: 'chromium'` on `desktop.window.open`. A zero is the NVIDIA
   signature from Gate 0 in any engine.
8. Resolve the browser profile under the effective desktop state home and prove dev/test/prod
   isolation. There is no current `childLeaseFile` to move. Do not reintroduce a shared-server
   lease or take ownership of another launcher through a stale profile record.

**Exit**: `bun run desktop:dev -- --shell=installed` opens Platform in the default Chromium-family
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

**Status: DONE — approved owner acceptance 2026-10-03.** The owner accepted the desktop
paths and approved removal. The following 2026-10-02 partial report records the earlier
engineering proof and its limits.

**Historical partial report — 2026-10-02.** The launcher now discovers LaunchServices' supported default,
reads bundle executables, uses Chromium first, and falls back to the owned Objective-C host or
`open`. The WKWebView owns its window, document-start bridge, picker sheets, startup message,
drag handling and vibrancy view directly. Electrobun remains the default and keeps its library;
its titlebar classes stay until Gate 4 while WKWebView uses the data-region listener.

The Mac scratch proof passed both native backdrop contracts, overlay titlebar and capture policy,
picker timeout acknowledgement, host close, startup-message cleanup, and window/picker/message
parent TERM and KILL cleanup. The fixture server remained reachable after each owned host exit.
The actual macOS build function produced both `platform-webview` and `libVibrancy.dylib`.
On macOS, only incoming CDP bytes renew startup idle: no Linux `/proc` progress is inferred.
Silent and CPU-busy fixtures stalled and were reaped; incoming-CDP progress reached the absolute
startup cap and was reaped. Registered production idle/cap settings are unchanged.

**Approved G3b outcome — 2026-10-02: Chromium engineering proof passed; owner acceptance PARKED.**
The earlier root exact baseline and production `--app` launches stayed at `about:blank` while
CDP target metadata showed the fixture URL. Ordered diagnosis established known-good CDP
arithmetic and successful `data:` and `file:` DOM navigation. Same-session fixture `curl` passed
for explicit `127.0.0.1`, `localhost` and `::1` bindings; fresh Chrome HTTP navigations stalled
on every binding. This disproves the broader claim that non-GUI Chromium cannot load pages.

Read-only own-process launchd observation placed the launch in the SSH resource coalition.
Diagnostic `--no-proxy-server` and `--proxy-bypass-list=<-loopback>` both retained the stall.
Scratch netlog showed DIRECT proxy resolution and successful fixture TCP connections, followed
by `URL_REQUEST_START_JOB`, completed first-party-set metadata and `COMPUTED_PRIVACY_MODE`,
with no HTTP send before cleanup cancellation. An owned Chrome stack sample showed
`SecItemAdd` → `defaultKeychainUI` → `makeLoginAuthUI` → `AuthorizationCopyRights` blocked,
with other keychain mutex waiters. No keychain item was inspected, unlocked or changed by the
executor; no privacy/security setting, launchd service or owner profile was changed.

A same-scratch-profile bare headless control still stalled; adding only `--use-mock-keychain`
loaded the real fixture DOM/title/body and generated HTTP requests. The first comparison attempt
read a stale `DevToolsActivePort` and failed its debugger connection; that record is retained.
The corrected harness removes its own stale port file before launching the next controlled process.
This is causal behavioral evidence for the SSH keychain interaction, not a real-keychain acceptance
claim or a reason to weaken production Chromium arguments.

The Mac native and Chromium proofs were one-off runs on the owner's Mac over SSH; their
machine-specific scripts are removed from the checkout. The Chromium proof used Darwin, the
approved scratch prefix and an isolated scratch `HOME`; its mock keychain required explicit
`--mock-keychain`. With that scratch-only switch, **Chrome and Helium both passed actual
`--app` / production CDP-pipe**
fixture DOM and bridge checks, a new bridged window, live same-profile singleton handoff to a
third bridged page, and last-page shutdown. The fixture remained reachable after each owned
browser exited. This is separate from the bare WebSocket diagnostic baseline. A regression locks
production Mac arguments to their existing real-keychain/system-proxy list. Startup budgets,
Linux attachment/GL behavior, shared mesh ownership and the Electrobun default are unchanged.
Native/build/parent-cleanup proofs from the preceding unit were retained without repeating them.

Evidence: `/work/tmp/fregat-evidence/114-g3b-macos-20261002/` contains ordered navigation,
loopback, proxy, keychain comparison (including the failed stale-port attempt), netlog, verified
owned-process stack samples and `app-pipe-runtime.jsonl`. The preceding native evidence remains
at `/work/tmp/fregat-evidence/114-g3-macos-20261002/`. Owned windows and fixture endpoints
were closed; scratch-linked process and PID absence are checked before removing the one remote
scratch. No rendering-rate or visual acceptance claim is made, and no deployment is part of this unit.

**Owner acceptance completed — 2026-10-03.** The approved desktop acceptance closes the
real-keychain and visual/Cmd-Q/drag/picker gate for the installed Chromium path and native
WKWebView window. The owner authorized Gate 4 deletion. The SSH mock-keychain experiment
above remains engineering evidence with its original limits; it is not relabeled as the
owner's real-keychain proof. The current development command is `bun run desktop:dev`.

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
5. Verify on an authorized macOS host: Chromium and webview paths, `window.transparency: 'window'`,
   Cmd-Q, and that quitting leaves shared servers and terminals alive.

**Exit**: the Gate 1 and 2 checklists pass on the Mac in both paths.

### Gate 4 — Delete Electrobun (S–M)

**Status: DONE — 2026-10-03, approved owner acceptance.** The owner accepted the Mac
desktop paths and explicitly approved removal. The installed launcher and native window are
now the desktop entry points. This closes the 2026-10-02 parked decision; scratch engineering
proofs retain their historical limitations.

- [x] Remove the old main/preload/RPC shell, its SDK/configuration, TypeScript and test aliases,
      ignored devkit projection and CI preparation/cache. Keep native host builds in CI.
- [x] Remove old-shell-only color-scheme, portal and window-discovery helpers. The retained
      native window owns its platform integration directly.
- [x] Remove Hutch repository wiring. Machine caches/symlinks are outside this removal's scope;
      cleanup requires a separate owner action after checking other consumers. No outside-checkout
      payload deletion is authorized by this plan.
- [x] Make `desktop:dev` run the launcher directly and update desktop/development/mesh guidance.
- [x] Describe transparent-window mode as the system-webview path and remove CEF paint-copy claims
      from active setting copy.

**Exit**: repository source/configuration has no Electrobun/Hutch runtime or build dependency.
Documentation may retain explicitly historical, versioned research and deletion rationale; a
blanket text search is an audit inventory, not a reason to rewrite measured history.

## Later, deliberately

- **Signing and Linux packaging.** `Fregat.app` above covers macOS packaging. Developer ID
  signing, notarization, a DMG and an AppImage wait for a public release.
- **An own-engine app.** Electron, or a Bun-based equivalent that bundles Chromium, comes after
  `Fregat.app` ships; both window paths above stay until then.
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

1. **Chrome-first.** Approved 2026-10-02: owner. Automatic selection tries Google Chrome before
   the OS-default supported Chromium browser, then the remaining scan and native fallback.
   Explicit browser selection wins. This supersedes the 2026-09-26 installed-Chromium order.
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
   app window cannot be see-through and the user asked for see-through. Reconfirmed 2026-10-02:
   this explicit transparency choice retains the native webview; the default is `compositor`.
6. **The browser profile.** Decided 2026-09-26: research recommendation — a separate
   `--user-data-dir` under `PLATFORM_HOME`. Chrome refuses remote debugging on the default profile,
   and a separate profile keeps the app's storage and permissions out of the user's browsing.
7. **When nothing is installed.** Decided 2026-09-26: research recommendation — open the default
   browser in a tab. It is "whatever the system has", and the web layer already works in a tab.
8. **Name.** Decided 2026-10-02: the installed-app path is part of Fregat. The code stays
   in `apps/desktop`; the host binary is `platform-webview`.
9. **macOS default path.** The Chromium window on macOS draws the browser's titlebar above ours,
   shows the browser's dock icon, and has no vibrancy; the webview window keeps `hiddenInset`,
   vibrancy and our own icon once bundled, but loses EditContext and Chrome DevTools.
   (a) Chromium first on macOS too, as on Linux. (b) Webview first on macOS, Chromium first on
   Linux and Windows. **Recommendation: (a)**: one engine on every desktop keeps the editor's
   EditContext route and `agent:browser trace` on the engine users run, and question 5 already
   gives the native look to anyone who turns on see-through windows.
   Decided 2026-09-26: owner — (a). Superseded 2026-10-03: owner — (b), native WebKit
   is the normal macOS app. The installed Chrome frame was rejected for that experience.
