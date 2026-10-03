# development

how the repo is put together. the [readme](../README.md) covers what fregat is and how to run it

## what's where

- `apps/web`, the editor shell, workspace tree, git views, file picker, client state
- `apps/server`, elysia rpc for filesystem, git, file watching, auth, provider adapters, and the typescript lsp websockets
- `apps/desktop`, the Bun launcher, installed Chromium app integration, and native C/Objective-C system-webview hosts
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

commit hooks are opt-in. `bun run hooks:install` gets you oxfmt and oxlint over staged files, then a repo typecheck

## workspace libraries

Editor packages live in `editor/packages/`, and the terminal library lives in `ghostty-webgpu/`. Bun installs their workspace links from the root `bun.lock`. Run `bun install --frozen-lockfile` at the root, then `bun run build:workspaces` to prepare the exports used by production builds and typechecking.

`dev` and `dev:web` serve both libraries from their TypeScript source through Vite aliases. Turbo coordinates tasks; Vite owns browser updates through its normal module graph and watcher. Fregat UI and the Editor React adapter use Fast Refresh. The adapter replaces its retained controller when its implementation changes. Editor core changes reload the page. Terminal panel and saved-viewport components are excluded from Fast Refresh because their cached modules retain WASM owners; their changes use Vite's native page reload. Generated `dist` files and unloaded package sources leave the page running. The custom source reload plugin is deleted.

`bun run --cwd apps/web typecheck` checks the browser and Node configurations plus the source map Vite uses. `typecheck:dev`, the development watcher and production builds use the same checker. Source-package unused checks remain with their producer packages.

Browser verification gives terminal IDs a per-run namespace in session storage before navigation. New tabs, restored tabs, chat terminals and terminal actions use those actual IDs. The harness observes and kills its own terminals through the normal API. It uses the browser's native `WebSocket`.

Ghostty's `ghostty-vt.wasm` and `bridge.wasm` are compiled artifacts. Run `bun run build:wasm` in `ghostty-webgpu/` after changing their native inputs. To rebuild only the bridge, run `bun run build:bridge --source /absolute/path/to/ghostty` from that directory, with a clean official Ghostty checkout at `GHOSTTY_SOURCE_REVISION` in `ghostty-webgpu/src/core/version.ts` (currently `c8554f28e0efe2f5595f32020371c34b25ec628f`). Both commands verify the source revision and clean tree before compiling. Production builds read `dist`; run `bun run build:workspaces` after source changes. Restart dev after changing a package's export map.

The family folders are mirrored to their standalone repositories. Make library changes here and follow `editor/AGENTS.md` and `ghostty-webgpu/AGENTS.md` for their package rules.

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

## optional local release installation

`bun run install-release` is an optional Linux integration with Mesh and user systemd. It builds first by default; `--from=<release-directory>` installs a previously built release. Installation additionally needs `mesh`, `systemctl`, `df`, Node and Playwright Chromium. This integration owns `platform-prod.service` on loopback port 3301. Run it on the machine serving the configured target.

Configure `developer.deployTarget` in that machine's production settings (`~/.platform/settings.json`). Add the key to the existing JSON object, preserving other settings. The default is `null`; install-release, restart, rollback and pair refuse before effects with guidance for setting the target.

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

The installed release records its configured page URL. Immediate, restart and rollback checks and their messages use the checked release's recorded URL for navigation, release polling, health evidence and observation. A standalone check requires `node scripts/deploy/live-check.mjs --target=<deployed-page-url>`. `bun run pair` prints a link for the configured target. The release endpoint under the configured application base reports the served release, commit, dirty-file count, pending update, phase and live-check result.

Adopting this setting for an existing installation requires recording its current root, host, origin and route before the next installation or pairing command. The command preserves the service identity, loopback port and existing release workflow. Portable release building needs none of these installation settings.
