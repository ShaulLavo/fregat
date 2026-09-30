# development

how the repo is put together. the [readme](../README.md) covers what fregat is and how to run it

## what's where

- `apps/web`, the editor shell, workspace tree, git views, file picker, client state
- `apps/server`, elysia rpc for filesystem, git, file watching, auth, provider adapters, and the typescript lsp websockets
- `apps/desktop`, the electrobun shell, a bun main process and a preload bridge
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

`dev` and `dev:web` serve both libraries from their TypeScript source. Startup prints each package's resolved directory. Editing Fregat's UI hot reloads; editing loaded Editor or Ghostty modules reloads the page so mounted instances pick up the new code. Generated `dist` files and unloaded source files leave the page running. Turbo coordinates workspace tasks; Vite owns browser updates. The Editor controller retained in React state and Ghostty's cached runtime still require the source reload fallback. `bun run --cwd apps/web typecheck:dev` checks the same source map Vite uses.

Ghostty's `ghostty-vt.wasm` and `bridge.wasm` are compiled artifacts. Run `bun run build:wasm` or `bun run build:bridge` in `ghostty-webgpu/` after changing their native inputs. Production builds read `dist`; run `bun run build:workspaces` after source changes. Restart dev after changing a package's export map.

The family folders are mirrored to their standalone repositories. Make library changes here and follow `editor/AGENTS.md` and `ghostty-webgpu/AGENTS.md` for their package rules.

## the shared dev server

on a machine with mesh, `bun run dev:serve` registers the dev pair as a mesh route named `:5173`. mesh holds 5173 and 3001 and proxies them to 15173 and 13001, where `bun run dev:upstream` binds vite and the api on `127.0.0.1`. the first connection starts it and holds requests until both ports answer; an open tab counts as use, and once nothing has been connected for `developer.devServerIdleMinutes` (15 by default) mesh stops it. rerun `dev:serve` after changing that setting

`mesh serve stop :5173` restarts it on the next connection, which is the way to pick up a changed export map or a relinked checkout. `bun run dev` beside the route stops with an error naming it, never a second copy on another port. `bun run dev:unserve` removes the route. the desktop app in dev opens the shared server like any browser

## shipping it

`bun run deploy` builds the web app, verifies the candidate, swaps a symlink and runs a headless check against the live url. nothing restarts, so open terminals and agent sessions survive it. server changes need `bun run deploy --server`, which stages the release; the app shows "Update available" and the server restarts when someone clicks Restart. `bun run deploy --server --restart` sends that request itself: it waits for running sessions to finish (`developer.deployRestartWaitMinutes`, 30 by default), then restarts and waits for the live check. `--interrupt` ends busy turns and restarts at once, which a deploy run from inside a Platform chat needs because its own turn counts as busy. a restart ends every live session, so do not reach for `--server` on web-only work

`bun run deploy --rollback` moves back one release. `GET /platform/release` answers whether a change actually landed, reporting the served release, its commit, and the dirty-file count it was built from

the route still says `platform`. renaming it costs a restart, and a restart costs every open session, so it waits for a moment when that is free
