# fregat

a local-first code editing workspace, all in one bun monorepo

a vite react client talking to an elysia server that does the actual filesystem, git and lsp work, with a shared contracts package so both sides agree on the shapes. there's also an electrobun desktop shell that wraps the same client. the editor itself is Singapore, the `@singapore-editor/*` packages, developed in a sibling repo

## what's where

- `apps/web` — the editor shell, workspace tree, git views, file picker, client state
- `apps/server` — elysia rpc: filesystem, git, file watching, auth, typescript lsp websockets
- `apps/desktop` — electrobun native shell (bun main process + preload bridge)
- `packages/contracts` — shared server/web DTOs, runtime schemas, the settings registry
- `packages/ui` — shared react components, styles, primitives
- `packages/tree` — the file tree: components, hooks, path store, render utils
- `packages/observability` — structured logging + telemetry config, used everywhere
- `docs`, `scripts` — plans and notes, repo tooling

rough rule: anything with side effects lives on the server, product workflows and ui state live in web. web talks to the server through `apps/web/src/lib` helpers or feature-local api modules, never by re-declaring DTOs in a component. the ui package stays app-agnostic, react is a peer dep there

user-facing knobs are registry entries in `packages/contracts/src/settings/keys.ts`, never a stray localStorage key. `docs/settings-reference.md` is generated, rerun `bun run settings:reference` after you touch the registry

[filesystem boundaries](docs/filesystem-boundaries.md) explains normal editor access, the optional server root restriction, and separate agent permissions.

## the editor packages

you need a sibling checkout of the editor repo at `../Editor` — there's no npm fallback right now, `@singapore-editor/decode` isn't published. the root `overrides` map points every `@singapore-editor/*` at it via bun's `link:` protocol (`"@singapore-editor/core": "link:@singapore-editor/core"`), backed by `bun link` global links. so: run `bun link` inside each `../Editor/packages/*` once, then `bun install` here, and the dev server can read the linked editor source. ci does the same thing by cloning `ShaulLavo/singapor` as a sibling and linking each package

`ghostty-webgpu` is linked the same way: the root override is `"ghostty-webgpu": "link:ghostty-webgpu"`, backed by a `bun link` run once inside a sibling checkout at `../ghostty-webgpu`. the npm release lags that repo, so the checkout is the version we actually run. ci clones `ShaulLavo/ghostty-webgpu` as a sibling, builds it and links it

they're deliberately not bun workspaces btw — turbo won't touch a workspace package whose realpath is outside the repo root, so a `"../Editor/packages/*"` glob (or the `packages/editor-*` symlinks) just breaks `bun run dev`. `overrides` + `link:` gets you live source without workspace membership

## running it

```bash
bun install
bun run dev
```

`dev` brings up web + server + desktop. `bun run dev:web` skips the desktop app, `bun run desktop:dev` runs just it. `.env` at the root is optional, it's only read for overrides like `PORT`, `WEB_PORT` and the `OBSERVABILITY_*` knobs

`bun run dev:tui` opens settings, commands, and file browsing against the existing server. See the
[TUI guide](apps/tui/README.md) for connection options, keyboard controls, and headless frames.

`bun run verify` is the full gate: typecheck, lint, format:check, test. lint is oxlint, formatting is oxfmt. scope anything to one package with `bun --filter web test` or `bun --filter server typecheck`

open the url dev prints and you should land on the workspace shell with the file tree and editor

### editing the editor and Ghostty

`bun run dev` and `bun run dev:web` serve both libraries from their linked TypeScript source. No separate demo server or JavaScript build watcher is needed. Startup prints every source package and its resolved directory. A missing source file stops startup instead of falling back to `dist`.

Editing Platform UI uses its normal hot reload. Editing the editor or Ghostty reloads the page so mounted instances use the new code. Use the development URL printed by the launcher; the mesh production URL continues to serve built assets.

The web dev task also watches source types. `bun run --cwd apps/web typecheck:dev` runs that check once. Vite and this check share the same source map, including nonliteral editor subpaths and Ghostty CSS. The generated config lives in `apps/web/node_modules/.tmp/tsconfig.dev.json`. The existing `typecheck` and production build still check package declarations; the source check leaves unused-symbol checks to each repository.

Ghostty's `ghostty-vt.wasm` and `bridge.wasm` remain compiled assets. After changing their native inputs, run `bun run build:wasm` or `bun run build:bridge` in the Ghostty checkout. TypeScript and renderer edits need neither command. Restart development after changing a package's export map or relinking a checkout.

Production still requires the linked packages' builds. Source development does not update their `dist` directories.

optional lefthook hooks — oxfmt and oxlint over staged files, then a repo typecheck, on every commit:

```bash
bun run hooks:install
```
