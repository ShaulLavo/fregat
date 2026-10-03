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

## installation-specific deployment

Deployment is optional. The current `bun run deploy` command targets the owner's installation and requires authorization and its local operational setup. The procedure below describes that installation. Other installations need their own deployment procedure.

`bun run deploy` builds the web app, verifies the candidate, swaps a symlink and runs a headless check against the live url. nothing restarts, so open terminals and agent sessions survive it. server changes need `bun run deploy --server`, which stages the release; the app shows "Update available" and the server restarts when someone clicks Restart. `bun run deploy --server --restart` sends that request itself: it waits for running sessions to finish (`developer.deployRestartWaitMinutes`, 30 by default), then restarts and waits for the live check. `--interrupt` ends busy turns and restarts at once, which a deploy run from inside a Platform chat needs because its own turn counts as busy. a restart ends every live session, so do not reach for `--server` on web-only work

`bun run deploy --rollback` moves back one release. the release endpoint under the configured application base path reports the served release, its commit, and the dirty-file count it was built from
