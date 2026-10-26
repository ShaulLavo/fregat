# Monorepo map

Where each folder lives and what it owns. For how the pieces talk to each other, read the [architecture](architecture.md).

## Apps

| Folder         | Package   | Owns                                                                                                        |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web`     | `web`     | The browser app: workbench, editor shell, file tree, Git views, chat, terminal panels. Vite and React.      |
| `apps/server`  | `server`  | The machine server: filesystem, Git, language servers, terminals, agent sessions, settings. Bun and Elysia. |
| `apps/desktop` | `desktop` | The Bun launcher that opens the app in an installed Chromium app or a native system webview (Zig, Swift).   |
| `apps/tui`     | `tui`     | The terminal client, built on OpenTUI. It talks to the same server.                                         |
| `apps/mac`     | none      | A Swift package: a stub native macOS window and the editor benchmarks. It is outside the Bun workspace.     |
| `apps/site`    | `site`    | The Astro landing page at [fregat.shaulavo.dev](https://fregat.shaulavo.dev/).                              |

## Shared packages

All are private workspace packages (`@workspace/*`). None is published.

| Folder                   | Owns                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `packages/contracts`     | Shared types, runtime schemas and the settings registry (`src/settings/keys.ts`).               |
| `packages/client-core`   | Client logic that the web app and the terminal client share: transport, environments, commands. |
| `packages/ui`            | React components, styles and shared UI patterns.                                                |
| `packages/tree`          | The file tree. A product-owned fork of Pierre's tree and path-store packages.                   |
| `packages/markdown`      | Streaming Markdown rendering: sessions, block splitting and healing of partial text.            |
| `packages/observability` | Structured logging configuration built on evlog.                                                |
| `packages/pty`           | Runs a program in a pseudo-terminal from Bun.                                                   |
| `packages/push`          | A thin wrapper over `web-push` for VAPID keys and request details.                              |
| `packages/utils`         | Small shared helpers.                                                                           |

## Standalone libraries

Singapore, ghostty-webgpu, and hotkeys live in their own repositories. Fregat consumes their pinned release archives. Make changes in those repositories. For coordinated local development, use [local package checkouts](local-package-checkouts.md).

| Repository                                                              | What it is                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| [ShaulLavo/singapore](https://github.com/ShaulLavo/singapore)           | Singapore, a code editor for the browser.        |
| [ShaulLavo/ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu) | Ghostty's terminal, in the browser.              |
| [ShaulLavo/hotkeys](https://github.com/ShaulLavo/hotkeys)               | Keyboard shortcuts for editors and complex apps. |

Each repository has its own `AGENTS.md` and docs.

## Everything else

| Path                              | Holds                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `docs/`                           | This documentation.                                                                                                               |
| `scripts/`                        | The dev launcher, CI selectors, generators, census checks, release build, and `scripts/agent` (the browser verification harness). |
| `.github/workflows/`              | CI and release automation.                                                                                                        |
| `.agents/skills/`                 | Agent skills. `.claude/skills/` links to them.                                                                                    |
| `patches/`                        | Patches applied to pinned dependencies by Bun.                                                                                    |
| `test/parity/`                    | Fixtures for the T3 Code parity checks.                                                                                           |
| `PLAN.md`, `plans/`, `.internal/` | Working material for contributors and agents, not user documentation.                                                             |

## Build order

`bun install --frozen-lockfile` links every workspace. Some Fregat workspaces import built `dist` output, so run `bun run build:workspaces` before `bun run dev` or a typecheck. Turbo runs that build and the per-package tasks.
