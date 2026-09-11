# platform

a local-first code editing workspace, all in one bun monorepo

a vite react client talking to an elysia server that does the actual filesystem, git and lsp work, with a shared contracts package so both sides agree on the shapes. there's also an electrobun desktop shell that wraps the same client. the editor itself is the `@singapor/*` packages, developed in a sibling repo

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

you need a sibling checkout of the editor repo at `../Editor` — there's no npm fallback right now, `@singapor/decode` isn't published. the root `overrides` map points every `@singapor/*` at it via bun's `link:` protocol (`"@singapor/core": "link:@singapor/core"`), backed by `bun link` global links. so: run `bun link` inside each `../Editor/packages/*` once, then `bun install` here, and local editor changes show up in typecheck, tests and the dev server. ci does the same thing by cloning `ShaulLavo/singapor` as a sibling and linking each package

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

optional lefthook hooks — oxfmt and oxlint over staged files, then a repo typecheck, on every commit:

```bash
bun run hooks:install
```
