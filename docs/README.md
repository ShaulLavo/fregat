# Documentation

Start with the [README](../README.md) if you want to know what Fregat is. This index is for people who run it from source, change it, or want to know how it works.

## Run it and fix it

- [Development](development.md): run from a checkout, run the checks, build and install a release, pair a device.
- [Troubleshooting](troubleshooting.md): the failures a new checkout hits first.
- [Releasing packages](releasing.md): changesets and the version PR.

## How it is built

- [Architecture](architecture.md): the big picture, one server per machine, how an agent turn flows.
- [Monorepo map](monorepo.md): every folder and what it owns.
- Decision records explain why the repository is shaped this way: [001, one repository with mirrors](adr/001-one-repository-with-mirrors.md), [002, a typed router owns web navigation](adr/002-typed-router-owns-web-navigation.md) and [003, one server per machine](adr/003-one-server-per-machine-shared-by-clients.md).

## Internals

These pages describe how subsystems work today. They are written for contributors and are dry on purpose. Some still carry the history of the work that produced them.

| Area                  | Pages                                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files and documents   | [Filesystem boundaries](filesystem-boundaries.md), [document and tab identity](document-and-tab-domain.md), [document-backed content views](document-backed-content-views.md), [async operations](async-operation-ownership.md), [workspace indexes](workspace-indexing.md) |
| Navigation and layout | [Workspace navigation](workspace-navigation.md), [workspace rails](workspace-rails.md), [page subscriptions](page-subscriptions.md)                                                                                                                                         |
| State and UI          | [State ownership](state-ownership.md), [web layering](web-layering.md), [web code layout](web-code-layout.md), [design language](web-design-language.md), [shared patterns](pattern-layer.md), [physical feel](physical-feel.md)                                            |
| Sessions and machines | [Session domain](session-domain.md), [worktree lifecycle](worktree-lifecycle.md), [federated environments](federated-environments.md), [remote server releases](remote-server-releases.md), [web push](web-push.md)                                                         |
| Editor and loading    | [First paint](editor-first-paint-design.md), [warm reload design](instant-reload-design.md) and [implementation](instant-reload-implementation.md), [boot and first load](boot-and-first-load.md), [HTML bootstrap](html-bootstrap.md)                                      |
| Keyboard              | [Keymap architecture](keymap/architecture.md), [adding commands and bindings](vscode-keymap-development.md)                                                                                                                                                                 |
| Terminals             | [Terminal processes and transport](terminal.md), [terminal host](terminal-host.md)                                                                                                                                                                                          |
| Chat                  | [Dictation](chat-dictation.md)                                                                                                                                                                                                                                              |
| Observability         | [Admission and retention](observability-overhead.md)                                                                                                                                                                                                                        |
| Appearance            | [Theme bundles](theme-bundles.md)                                                                                                                                                                                                                                           |
| Terminal client       | [Foundation](tui-foundation.md), [workbench](tui-workbench.md), [agent view](tui-agent.md), [worktrees](tui-worktrees.md), and the [TUI guide](../apps/tui/README.md)                                                                                                       |
| Native macOS client   | [Editor core design](native-editor-core-design.md), [benchmark harness](native-bench-harness.md), and the [`apps/mac` README](../apps/mac/README.md)                                                                                                                        |

## Reference

- [Settings reference](settings-reference.md): generated by `bun run settings:reference` from `packages/contracts/src/settings/keys.ts`.
- [Native syntax coverage](native-syntax-coverage.md): generated by `bun run syntax:coverage`.
- Package pages: [`packages/pty`](../packages/pty/README.md), [`packages/contracts`](../packages/contracts/README.md), and one README per app and package under `apps/` and `packages/`.

## The other products

Singapore (`editor/`), ghostty-webgpu and hotkeys keep their own docs next to their code: [`editor/`](../editor/README.md), [`ghostty-webgpu/`](../ghostty-webgpu/README.md) and [`hotkeys/`](../hotkeys/README.md).

## Product site

The [landing page](https://fregat.shaulavo.dev/) is `apps/site`. All product sites run on Cloudflare Workers. See [production product sites](../scripts/product-sites/README.md) for builds and publishing.
