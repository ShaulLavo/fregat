<p align="center">
  <img src="apps/web/public/icons/fregat.svg" width="96" alt="Fregat rocket" />
</p>
<h1 align="center">Fregat</h1>
<p align="center">The complete IDE in your browser, with your agents inside.</p>
<p align="center">
  <a href="https://github.com/ShaulLavo/fregat/actions/workflows/ci.yml"><img src="https://github.com/ShaulLavo/fregat/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="docs/development.md"><img src="https://img.shields.io/badge/install-source-blue" alt="Run from source" /></a>
</p>
<p align="center">
  <a href="https://fregat.shaulavo.dev/">Website</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="https://github.com/ShaulLavo/fregat/discussions">Discussions</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/workbench-dark.webp" />
  <img src="docs/images/workbench.webp" alt="Fregat workbench with editor, file tree, and terminal" />
</picture>

Open a folder and get an editor, terminals, Git, and language servers in one workspace.
Run Claude Code and Codex beside your files. The Fregat server runs on your machine.

Fregat is pre-1.0 and early. Expect bugs and changing APIs. You can run it from source today. There are no app releases or downloads yet.

## Why Fregat

Plenty of tools put an agent next to your code. Fregat is built around two other things: how your work survives, and how much control you keep over an agent's changes.

- **Our own editor and terminal.** [Singapore](https://singapore.shaulavo.dev/) keeps every version of your text. [ghostty-webgpu](https://ghostty.shaulavo.dev/) brings Ghostty's terminal core into the browser.
- **One server per machine.** Browser tabs, the desktop window, the terminal client and a paired phone share it, so closing a window leaves your agents and terminals running. On Linux, terminals also survive a server restart and replay their output.
- **Review agents like pull requests.** Undo or reapply a hunk, attach line comments to a message, and fork a chat from a turn. Ask a second model to review, or send one prompt to several models, each in its own worktree.
- **Closing a file loses nothing.** Undo history for closed files is kept in the browser and restored when the file is unchanged on disk. Deleted files and folders in the tree can be restored with undo.
- **Your own agents.** Fregat drives the Claude Code and Codex CLIs you already installed and signed in to, and shows context usage per chat.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture.dark.svg" />
  <img src="docs/assets/architecture.light.svg" alt="Three clients (a desktop window, the web app and a terminal client) call one machine server. The server holds the orchestration engine, the files, Git and language server routes, and a separate terminal host. It talks to a SQLite state home, to Claude Code and Codex, to your files and to your shells." />
</picture>

All clients talk to one server on your machine. [Architecture](docs/architecture.md) explains each box.

## Quick start

Install [Bun 1.4.4](https://bun.sh/) (the version pinned in `packageManager`, check with `bun --version`), [Node.js 26 or newer](https://nodejs.org/), and [Git](https://git-scm.com/), then run:

```sh
git clone https://github.com/ShaulLavo/fregat.git
cd fregat
bun install --frozen-lockfile
bun run build:workspaces
bun run dev
```

The dev server prints `[dev] Client: http://127.0.0.1:5173`.

1. Open that URL and pick a folder. On macOS, `bun run dev` also opens a desktop window. Use `bun run dev:web` for the browser only.
2. Open a terminal in the workspace.
3. To use agents, install [Claude Code](https://code.claude.com/docs/en/setup) or [Codex](https://developers.openai.com/codex/cli/) and sign in.

If something fails, [troubleshooting](docs/troubleshooting.md) lists the usual causes.
The server listens on `127.0.0.1` only. A phone or another computer reaches it through an HTTPS proxy or an SSH tunnel, plus device pairing: see [Reach Fregat from another device](docs/remote-access.md). Keep access private and pair only devices you trust.

## What you can do

| Task                                      | Where                                            |
| ----------------------------------------- | ------------------------------------------------ |
| Run it, run the checks, build a release   | [Development](docs/development.md)               |
| Reach it from a phone or another computer | [Remote access](docs/remote-access.md)           |
| Change a setting                          | [Settings reference](docs/settings-reference.md) |
| Find your way around the code             | [Monorepo map](docs/monorepo.md)                 |
| Use the terminal client                   | [`apps/tui`](apps/tui/README.md)                 |
| Understand a subsystem                    | [Documentation index](docs/README.md)            |

## The parts

| Project                                                       | What it does                                            |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| [Singapore](https://github.com/ShaulLavo/singapore)           | A code editor for the browser that keeps every version. |
| [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu) | Ghostty's terminal, in the browser.                     |
| [hotkeys](https://github.com/ShaulLavo/hotkeys)               | Keyboard shortcuts for editors and complex apps.        |

These three are not separate products from separate teams. They are folders of this repository, `editor/` (Singapore), `ghostty-webgpu/` and `hotkeys/`, and Fregat's own build uses them from here. A workflow publishes each folder to the standalone repository in the table, so those repositories are read-only copies, and issues and changes go to this one.

## Status

Fregat is pre-1.0 and has no app releases. APIs and on-disk formats change without notice.

| Area              | State                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Platforms         | Linux and macOS, as the landing page states. Windows is not listed.                                                             |
| Install           | From source only. `@fregat/hotkeys` is not on npm. The npm releases of Singapore and ghostty-webgpu lag this repository.        |
| Agents            | Claude Code and Codex, through your own installs and logins.                                                                    |
| Terminal restarts | Terminals survive a server restart on Linux. The macOS behavior is not verified.                                                |
| Remote access     | Needs an HTTPS proxy or SSH tunnel, plus device pairing. Tested through Tailscale Serve only. [Details](docs/remote-access.md). |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), including the [AI-contribution policy](CONTRIBUTING.md#ai-contributions).
Report reproducible bugs in [Fregat issues](https://github.com/ShaulLavo/fregat/issues).
Ask questions in [Discussions](https://github.com/ShaulLavo/fregat/discussions).
Report security problems through [private security advisories](SECURITY.md).

## License

[MIT](LICENSE). Bundled dependencies keep their own licenses.
