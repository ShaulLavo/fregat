# development

how the repo is put together. the [readme](../README.md) covers what fregat is and how to run it

## what's where

- `apps/web`, the editor shell, workspace tree, git views, file picker, client state
- `apps/server`, elysia rpc for filesystem, git, file watching, auth, provider adapters, and the typescript lsp websockets
- `apps/desktop`, the Bun launcher, installed Chromium app integration, and native Zig/Swift system-webview hosts
- `apps/mac`, the native swift client
- `apps/tui`, the terminal client
- `packages/contracts`, shared dtos, runtime schemas, the settings registry
- `packages/ui`, react components, styles, primitives
- `packages/tree`, the file tree, its hooks and its path store
- `packages/observability`, structured logging and telemetry config

the rough rule: anything with side effects lives on the server, product workflows and ui state live in web. web reaches the server through `apps/web/src/lib` helpers or feature-local api modules, never by redeclaring a dto inside a component. the ui package stays app-agnostic and keeps react as a peer dependency

every user-facing knob is a registry entry in `packages/contracts/src/settings/keys.ts`, never a loose localStorage key. `docs/settings-reference.md` is generated, so rerun `bun run settings:reference` after touching the registry

[filesystem boundaries](filesystem-boundaries.md) covers ordinary editor access, the optional server root restriction, and the separate permissions agents run under

## checks

```bash
bun run verify
```

typecheck, lint, format:check, test. lint is oxlint, formatting is oxfmt. narrow it with `bun --filter web test` or `bun --filter server typecheck`

Use Git 2.31 or newer. Run `bun run hooks:install` in each checkout that should use commit hooks. The command installs an ignored `.fregat-hooks/pre-commit` wrapper and selects it through Git's worktree configuration. Commits run oxfmt, oxlint, repository gates, and typechecking. Dependency installation leaves existing hook selection unchanged.

Relative selection follows a moved checkout. The installer preserves existing custom `core.hooksPath` settings and stops before writes when one applies. A custom hook manager can invoke `bun run hooks:pre-commit` explicitly. The first opt-in enables `extensions.worktreeConfig`. An ordinary common `core.bare=false` value moves into the main worktree's config. Bare repositories, `core.worktree` overrides, and unrelated dormant worktree configuration require separate Git setup. Existing common hooks remain in place.

## workspace libraries

The Linux desktop host requires Zig 0.17.x, `pkg-config`, and WebKitGTK 4.1 development headers.
The macOS host requires Swift 6 and the macOS SDK from the Xcode command-line tools.
`bun run --cwd apps/desktop build:native` builds the host for the current platform. Linux uses
`zig translate-c` to generate library declarations, then compiles the Zig host with safety checks.
The macOS build compiles the Swift host with AppKit and WebKit, targeting macOS 11 and later.
With a graphical session available, `bun run --cwd apps/desktop verify:native --evidence <directory>`
exercises the real host's startup scripts, launcher messages, picker cancellation, persistent
cookies and storage, state-home isolation, and shutdown. It opens temporary verification windows
and writes protocol receipts to the evidence directory.

Editor packages live in `editor/packages/`, and the terminal library lives in `ghostty-webgpu/`. Bun installs their workspace links from the root `bun.lock`. Run `bun install --frozen-lockfile` at the root, then `bun run build:workspaces` to prepare the exports used by production builds and typechecking.

Desktop launcher bundle tests load these workspace exports too. Build the libraries before running the launcher checks from a fresh checkout:

```bash
bun run build:workspaces
cd apps/desktop
bun --bun vitest run src/launcher/tests/build-native.test.ts src/launcher/tests/bundle.test.ts src/launcher/tests/check-app.test.ts
```

`dev` and `dev:web` serve both libraries from their TypeScript source through Vite aliases. Turbo coordinates tasks; Vite owns browser updates through its normal module graph and watcher. Fregat UI and the Editor React adapter use Fast Refresh. The adapter replaces its retained controller when its implementation changes. Editor core changes reload the page. Terminal panel and saved-viewport components are excluded from Fast Refresh because their cached modules retain WASM owners; their changes use Vite's native page reload. Generated `dist` files and unloaded package sources leave the page running. The custom source reload plugin is deleted.

`bun run --cwd apps/web typecheck` checks the browser and Node configurations plus the source map Vite uses. `typecheck:dev`, the development watcher and production builds use the same checker. Source-package unused checks remain with their producer packages.

Browser verification gives terminal IDs a per-run namespace in session storage before navigation. New tabs, restored tabs, chat terminals and terminal actions use those actual IDs. The harness observes and kills its own terminals through the normal API. It uses the browser's native `WebSocket`.

Ghostty's `ghostty-vt.wasm` and `bridge.wasm` are compiled artifacts. Run `bun run build:wasm` in `ghostty-webgpu/` after changing their native inputs. To rebuild only the bridge, run `bun run build:bridge --source /absolute/path/to/ghostty` from that directory, with a clean official Ghostty checkout at `GHOSTTY_SOURCE_REVISION` in `ghostty-webgpu/src/core/version.ts` (currently `c8554f28e0efe2f5595f32020371c34b25ec628f`). Both commands verify the source revision and clean tree before compiling. Production builds read `dist`; run `bun run build:workspaces` after source changes. Restart dev after changing a package's export map.

The family folders are mirrored to their standalone repositories. Make library changes here and follow `editor/AGENTS.md` and `ghostty-webgpu/AGENTS.md` for their package rules.

## CI turnaround

PR CI reads the workspace manifests and Turbo task inputs to select changed packages and their consumers. Local package names also connect catalog-backed dependencies such as Hotkeys. A server change includes web and TUI tests because their fixtures use the server. A source-reading test, such as the contracts vocabulary check, selects its package checks without treating that package as changed production code.

Selected packages run their own formatting, lint, typecheck, and shared-package tests. Ghostty family verification owns its formatting, lint and type checks. App test shards and library browser and packaging checks keep their separate runners. Shared structural checks, generated checks, script types, and script tests run once for code changes because they inspect or import code across the repository. Root configuration, workflow actions, scripts, patches, unknown code paths, removed workspaces, and Turbo global dependencies retain full validation. Main pushes select changes since the last successful main run, including changes from replaced queued runs. Scheduled and manual CI runs validate every package.

Setup builds the library prerequisites of each runner's consumers. The shared script-test runner prepares every library, while the lint and mobile runners skip library builds. Product sites build once and are shared with mobile browser shards. Ordinary site changes check representative phone pages in Chromium and WebKit; scheduled and manual runs crawl every page. Collaboration stress, textbuffer benchmarks and full-document lifecycle probes run during scheduled or manual validation. Plans, root documentation and Markdown agent instructions run formatting; published site content selects its site checks. Declare new cross-package source reads in the owning task's `inputs` or `dependsOn` in `turbo.json`. Run the selector controls with `bun --bun vitest run --config vitest.scripts.config.mjs scripts/ci/affected.test.mjs scripts/ci/packages.test.mjs`.

Standalone families share one runner. Each uses a fresh `git archive` export and independent install outside the checkout. Editor also installs a second export with hoisted dependencies and checks tree-sitter runtime identity.

The CI verdict summary separates each completed job's queue and execution seconds. It also reports run creation to verdict runner start, including the initial Changes queue. On reruns, that total starts at the original run creation. The diagnostic step can fail without changing the verdict.

To compare two and four web shards at the same branch head, dispatch `ci.yml` with `web_shards=4`, wait for completion, then dispatch with `web_shards=2`. Keep the branch head fixed and repeat under comparable overlapping PR activity. Compare the final CI completion timestamp against run creation, along with the queue table. PR and main runs keep four shards until the measurements support a change.

```bash
gh workflow run ci.yml --ref <branch> -f web_shards=4
gh workflow run ci.yml --ref <branch> -f web_shards=2
```

Each web shard uploads a `web-timings-*` artifact for 14 days. Download reports from several successful runs, then refresh weights using all their paths:

```bash
bun apps/web/scripts/shard-durations.ts <report-1.json> <report-2.json> <report-3.json>
```

The updater normalizes checkout paths and records the median duration per file. The current weights cover 777 files from successful CI runs [37149185179](https://github.com/ShaulLavo/fregat/actions/runs/37149185179), [37148852375](https://github.com/ShaulLavo/fregat/actions/runs/37148852375), and [37148631038](https://github.com/ShaulLavo/fregat/actions/runs/37148631038). Each file has three samples, extracted from Vitest's per-file log durations.

Editor retains `--concurrency=1` and the existing Core and Stress cache settings. In run 37149185179, Core reported 117.81 seconds, Textbuffer 54.30 seconds, and Stress 36.00 seconds. A parallelism experiment must bound Vitest workers and keep browser-sensitive tasks serialized, then compare execution and reliability at the same commit.

## optional Mesh dev server

on a machine with mesh, `bun run dev:serve` registers the dev pair as a mesh route named `:5173`. mesh holds 5173 and 3001 and proxies them to 15173 and 13001, where `bun run dev:upstream` binds vite and the api on `127.0.0.1`. the first connection starts it and holds requests until both ports answer; an open tab counts as use, and once nothing has been connected for `developer.devServerIdleMinutes` (15 by default) mesh stops it. rerun `dev:serve` after changing that setting

`mesh serve stop :5173` restarts it on the next connection, which is the way to pick up a changed export map or a relinked checkout. `bun run dev` beside the route stops with an error naming it, never a second copy on another port. `bun run dev:unserve` removes the route. `bun run desktop:dev` opens these shared routes through the launcher; it waits for readiness and leaves API, Vite and shared terminals running when its window closes

## desktop app

The launcher automatically selects Fregat’s native WebKit window on macOS and prefers an installed Chrome app on Linux. An explicit browser executable selects the installed Chromium path. Transparent-window mode selects the native host under automatic selection. Installed browser apps work from their OS shortcuts with no launcher or injected bridge running; native hosts retain their own window transport.

`bun run app:mac` builds a self-contained `Fregat.app` on macOS. Production clients share one machine server per state home. Installation reuses a matching service or registers the OS-activated service; closing or uninstalling the browser app keeps that service, mesh routes and terminals. [Plan 114](../plans/114-installed-app.md) records the approved installation, picker and native-window contracts.

## portable release build

`bun run build-release --output=<new-directory>` builds a self-contained release for the current OS and architecture. Omit `--output` for a unique directory under the OS temporary directory. It uses the documented Bun/build prerequisites, compiles workspaces, web and server, installs the pinned runtime dependency closure, includes `bin/bun`, and verifies the artifacts. Its `web/`, `server/`, relative runtime dependency links and bundled Bun move together. Building never reads machine installation settings, contacts Mesh, changes a service or writes application state.

`--base=/` is the default application route. Pass a route such as `--base=/fregat/` when building for an installation at that route. The web build records this base; installing it requires the same configured route. `--reason=<text>` records the purpose in `build-config.json`. Use a new output directory; the command preserves existing directories and removes only its own incomplete output on failure. Git, a shell and optional provider tools remain host prerequisites when using those features. The bundled runtime is platform-specific.

```bash
bun install --frozen-lockfile
bun run build-release --output=./fregat-release --base=/fregat/
```

Package publishing is separate: `bun run release` is the Package releases workflow's Changesets publishing step.

## pairing another device

A browser on another device, such as a phone reaching the machine over the tailnet, shows a pairing screen naming the machine until it is paired. Make a code on the machine or on any paired device in Settings › Machines › Pair a device, then scan it or type it on the new device.

With no paired browser at hand, run the pair command on the machine, over SSH for example. In an installed release, run `bun current/server/pair.js` from the release folder: `server.releaseRoot`, by default `~/.local/share/fregat/releases` on Linux and `~/Library/Application Support/Fregat/releases` on macOS; an `install-release` installation uses its `productionRoot`. In a checkout, `bun run pair` runs the same command. It asks the server at the `server.address` setting over loopback (`--address=http://127.0.0.1:<port>` picks another server) and prints the code, plus a link when the server is served at an address other devices reach. A code works once, for 5 minutes.

## optional local release installation

`bun run install-release` is an optional Linux integration with Mesh and user systemd. It builds first by default; `--from=<release-directory>` installs a previously built release. Installation additionally needs `mesh`, `systemctl`, `df`, Node and Playwright Chromium. This integration owns `platform-prod.service` on loopback port 3301. Run it on the machine serving the configured target.

Configure `developer.deployTarget` in that machine's production settings (`~/.platform/settings.json`). Add the key to the existing JSON object, preserving other settings. The default is `null`; install-release, restart and rollback refuse before effects with guidance for setting the target.

```json
{
  "developer.deployTarget": {
    "productionRoot": "/srv/fregat-production",
    "meshHost": "my-machine",
    "meshOrigin": "https://my-machine.example",
    "meshRoute": "/fregat"
  }
}
```

Choose a dedicated, mounted production directory with at least 2 GiB free and an absolute Unix path with fully resolved segments and systemd-safe characters. Whitespace, quotes, backslashes and systemd `$`/`%` substitutions are rejected. Prepare it with your user's ownership. Use a canonical HTTP or HTTPS origin and `/` or slash-separated alphanumeric, underscore and hyphen route segments. A trailing slash is accepted. Register the matching proxy once with `mesh serve <meshHost> 3301 --at <meshRoute> --isolate`. Installation verifies the route and renders the service's root and allowed origin from the configured target.

```bash
# First installation: use the built server and stage it for startup/restart.
bun run install-release --from=./fregat-release --server --restart
# Build and install web changes, reusing the current server.
bun run install-release
# Build a server update, then request the existing Restart workflow.
bun run install-release --server --restart
```

Web-only installation reuses the running server bundle, verifies the candidate, swaps the current link and checks the live page while open terminals and sessions continue. When a server release is already pending, web changes reuse that pending server and go live with it at Restart. `--from` follows the same policy: add `--server` to install the built server; omit it to reuse the existing server. A first installation needs `--server`.

`--server` alone stages the release and the app shows "Update available". `--restart` sends the Restart button's request, waits for busy sessions up to `developer.deployRestartWaitMinutes` (30 minutes by default), promotes and waits for the live check. Alone it builds nothing and restarts into the already staged release. `--interrupt` ends busy turns and restarts immediately; an installation run inside a Platform chat needs it because its own turn counts as busy. `--rollback` drops pending, moves current back one release and restarts when the server differs. `--skip-live-check` skips immediate and post-restart browser checks.

The installed release records its configured page URL. Immediate, restart and rollback checks and their messages use the checked release's recorded URL for navigation, release polling, health evidence and observation. A standalone check requires `node scripts/deploy/live-check.mjs --target=<deployed-page-url>`. The release endpoint under the configured application base reports the served release, commit, dirty-file count, pending update, phase and live-check result.

Adopting this setting for an existing installation requires recording its current root, host, origin and route before the next installation or pairing command. The command preserves the service identity, loopback port and existing release workflow. Portable release building needs none of these installation settings.
