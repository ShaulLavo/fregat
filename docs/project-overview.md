# Fregat overview

Open a folder and get an editor, terminals, Git, and language servers in one workspace.
Run Claude Code and Codex beside your files. The Fregat server runs on your machine.

Fregat is pre-1.0 and early. Expect bugs and changing APIs. You can run it from source today. There are no app releases or downloads yet.

## Run from source

```sh
git clone https://github.com/ShaulLavo/fregat.git && cd fregat && bun install --frozen-lockfile && bun run build:workspaces && bun run dev
```

The dev server prints `[dev] Client: http://127.0.0.1:5173`.

1. Open that URL and pick a folder. On macOS, `bun run dev` also opens a desktop window. Use `bun run dev:web` for the browser only.
2. Open a terminal in the workspace.
3. To use agents, install [Claude Code](https://code.claude.com/docs/en/setup) or [Codex](https://developers.openai.com/codex/cli/) and sign in.

If something fails, [troubleshooting](troubleshooting.md) lists the usual causes.

### Requirements

- [Bun 1.4.4](https://bun.sh/), the version pinned in `packageManager`. CI installs that version, so it gives you the same lockfile and test results. Check with `bun --version`.
- [Node.js 26 or newer](https://nodejs.org/), because the editor's Tree-sitter and Markdown parsing need `WebAssembly.Memory.prototype.toResizableBuffer()`.
- [Git](https://git-scm.com/), because the Git views and worktrees run the `git` command.
- A recent browser: Chromium 144, Firefox 145 or Safari 26.2 or newer, for the same WebAssembly API.

## Features

- **Our own editor and terminal.** [Singapore](https://singapore.shaulavo.dev/) keeps every version of your text. [ghostty-webgpu](https://ghostty.shaulavo.dev/) brings Ghostty's terminal core into the browser.
- **One server per machine.** Browser tabs, the desktop window, the terminal client and a paired phone share it, so closing a window leaves your agents and terminals running. On Linux, terminals also survive a server restart and replay their output.
- **Agent changes reviewed like pull requests.** Undo or reapply a hunk, attach line comments to a message, and fork a chat from a turn. Ask a second model to review, or send one prompt to several models, each in its own worktree.
- **Undo history survives closing a file.** It is kept in the browser and restored when the file is unchanged on disk. Deleted files and folders in the tree can be restored with undo.
- **Your own agents.** Fregat drives the Claude Code and Codex CLIs you already installed and signed in to, and shows context usage per chat.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture.dark.svg" />
  <img src="assets/architecture.light.svg" alt="Three clients (a desktop window, the web app and a terminal client) call one machine server. The server holds the orchestration engine, the files, Git and language server routes, and a separate terminal host. It talks to a SQLite state home, to Claude Code and Codex, to your files and to your shells." />
</picture>

All clients talk to one server on your machine. [Architecture](architecture.md) explains each box.

## Where to go next

- [Development](development.md): run it, run the checks, build a release.
- [Remote access](remote-access.md): reach it from a phone or another computer. This setup is work in progress.
- [Settings reference](settings-reference.md): every setting.
- [Monorepo map](monorepo.md): find your way around the code.
- [`apps/tui`](../apps/tui/README.md): the terminal client.
- [Documentation index](README.md): how each subsystem works.

The server listens on `127.0.0.1` only. A phone or another computer reaches it through an HTTPS proxy or an SSH tunnel, plus device pairing. Keep access private and pair only devices you trust.

## The parts

- [Singapore](https://github.com/ShaulLavo/singapore): a code editor for the browser that keeps every version.
- [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu): Ghostty's terminal, in the browser.
- [hotkeys](https://github.com/ShaulLavo/hotkeys): keyboard shortcuts for editors and complex apps.

These libraries accept changes in their own repositories. Fregat consumes immutable release tarballs pinned in its root catalog and lockfile. Follow [Adopt package releases](releasing.md) to update a pin.

## Status

Fregat is pre-1.0 and has no app releases. APIs and on-disk formats change without notice.

- **Platforms:** Linux and macOS, as the landing page states. Windows is not listed.
- **Install:** Fregat runs from source. Its editor, terminal, and hotkeys dependencies come from the pinned standalone GitHub Releases.
- **Agents:** Claude Code and Codex, through your own installs and logins.
- **Terminal restarts:** terminals survive a server restart on Linux. The macOS behavior is not verified.
- **Remote access:** work in progress and may change. It needs an HTTPS proxy or SSH tunnel, plus device pairing, and was tested through Tailscale Serve only. [Details](remote-access.md).

## Contributing

Read [CONTRIBUTING.md](../CONTRIBUTING.md), including the [AI-contribution policy](../CONTRIBUTING.md#ai-contributions).
Report reproducible bugs in [Fregat issues](https://github.com/ShaulLavo/fregat/issues).
Ask questions in [Discussions](https://github.com/ShaulLavo/fregat/discussions).
Report security problems through [private security advisories](../SECURITY.md).

## License

[MIT](../LICENSE). Bundled dependencies keep their own licenses.
