# web

The Fregat browser app: workbench, editor shell, file tree, Git views, chat and terminal panels. It is a Vite and React app that talks to [`apps/server`](../server/) over typed routes. The Singapore editor, the ghostty-webgpu terminal and `@fregat/hotkeys` come from this repository's workspace.

From the repository root, after `bun install --frozen-lockfile` and `bun run build:workspaces`:

```sh
bun run dev:web                 # this app and the server, without the desktop launcher
bun run --cwd apps/web test     # node, dom and compiler projects
bun run --cwd apps/web test:browser
```

The dev server listens on `127.0.0.1:5173` and the API on `3001`. `/dev` is a component gallery.

Read [web code layout](../../docs/web-code-layout.md) before adding files, [web layering](../../docs/web-layering.md) for import rules, and the [architecture](../../docs/architecture.md) for how this app fits with the server.
