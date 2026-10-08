<p align="center">
  <img src="https://raw.githubusercontent.com/ShaulLavo/fregat/main/apps/web/public/icons/fregat.svg" width="96" alt="Fregat rocket" />
</p>
<h1 align="center">Fregat</h1>
<p align="center">The complete IDE in your browser, with your agents inside.</p>
<p align="center">
  <a href="https://github.com/ShaulLavo/fregat/actions/workflows/ci.yml"><img src="https://github.com/ShaulLavo/fregat/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="docs/development.md"><img src="https://img.shields.io/badge/install-source-blue" alt="Run from source" /></a>
</p>
<p align="center">
  <a href="https://shaulavo.dev/fregat/">Website and demo</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="PLAN.md">Roadmap</a> ·
  <a href="https://github.com/ShaulLavo/fregat/discussions">Discussions</a>
</p>

![Fregat workbench with editor, terminals, and agent sessions](https://raw.githubusercontent.com/ShaulLavo/fregat/main/docs/images/workbench.webp)

Open a folder and get an editor, terminals, Git, and language servers in one workspace.
Run Claude Code and Codex beside your files. Everything runs on your machine.

Fregat is early. Expect bugs and changing APIs. You can run it from source today.

## What are you selling me?

"Isn't this just Cursor?" The familiar part is a code workspace with agents.
The reason to try Fregat is how your work survives, and how much control you have over an agent's changes.

- **Our own editor and terminal.** [Singapore](https://shaulavo.dev/singapore/) keeps readable versions of your text. [ghostty-webgpu](https://shaulavo.dev/ghostty-webgpu/) brings Ghostty's terminal core into the browser.
- **Work keeps going.** Browser and desktop windows share one machine server. Terminals survive server restarts and replay output. Updates wait for running agent turns, check the new release, and roll back a failed update. Read the [installed-app contracts](plans/114-installed-app.md).
- **Review agents like pull requests.** Undo or reapply a hunk, collect line comments into a message, and fork a chat from a turn. Ask a second model to review, or send one prompt to several models in separate worktrees. See the [agent workbench](plans/139-acting-on-agent-diffs.md).
- **Nothing is lost when you close a file.** The editor's undo graph survives closing its tab. File-tree undo restores a deleted folder with its tabs and unsaved edits. See [undo behavior](docs/research/packages-as-products/fregat-workbench.md#4-undo-that-goes-further-than-any-editor).
- **Bring your own agents.** Sign in to Claude Code and Codex, run them side by side, and save permissions as each tool's own rules. Track usage and cost per chat. See [agent sessions](docs/session-domain.md) and [approval rules](plans/145-harness-controls.md).

## Proof from the parts

The editor and terminal publish their methods, scripts, wins, and losses.
These measurements describe the libraries and their tested workloads. Fregat itself has no published competitor speed comparison.

| Project        | Evidence                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Singapore      | [Browser comparison experiment](editor/docs/performance/browser-compare-2026-10-08.md). At 10 MiB, highlighted open took 1,517.7 ms, versus Monaco's 169.4 ms and CodeMirror's 56.1 ms. This noisy experiment needs a quiet rerun.                                                                     |
| ghostty-webgpu | [Terminal benchmarks](ghostty-webgpu/docs/benchmarks.md). WebGL's estimated CPU energy ratio against xterm.js was 0.751 for heavy logs and 1.361 for one ASCII line per tick. [Correctness](ghostty-webgpu/docs/correctness.md) records 167 passing and 2 failing cases in a fixed 169-case selection. |

## Quick start

Install [Bun](https://bun.sh/) and [Git](https://git-scm.com/), then run:

```sh
git clone https://github.com/ShaulLavo/fregat.git
cd fregat
bun install --frozen-lockfile
bun run dev
```

1. Open the URL printed by the development server and pick a folder.
2. Open a terminal in that workspace.
3. To use agents, install [Claude Code](https://code.claude.com/docs/en/setup) or [Codex](https://developers.openai.com/codex/cli/) and sign in.

[Development and source builds](docs/development.md) covers checks and the desktop launcher.
Remote phone browsers need an HTTPS proxy and device pairing. Keep access private and pair only devices you trust.

## The parts

| Project                                                       | What it does                                            |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| [Singapore](https://github.com/ShaulLavo/singapore)           | A code editor for the browser that keeps every version. |
| [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu) | Ghostty's terminal, in the browser.                     |
| [hotkeys](https://github.com/ShaulLavo/hotkeys)               | Zed-style keymaps for the web.                          |

These projects live in this monorepo. Their standalone repositories are read-only mirrors.

## Planned work

These are approved directions. The linked plans record what has shipped and what remains.

| Work                                       | Status                                              | Plan                                                                                                         |
| ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Shared editing between you and your agents | Planned                                             | [Collaborative text](plans/e066-collaborative-text.md) and [Delta DB](plans/delta-db-implementation-plan.md) |
| Office documents in tabs                   | Planned. PDF and CSV support has shipped.           | [Documents in the editor](plans/156-documents-in-the-editor.md)                                              |
| Visual Markdown editing                    | Planned. Source view and live preview have shipped. | [Markdown modes](plans/108-markdown-modes.md)                                                                |

The [full roadmap](PLAN.md) owns scheduling. Planned work has no release date here.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), including the [AI-contribution policy](CONTRIBUTING.md#ai-contributions).
Report reproducible bugs in [Fregat issues](https://github.com/ShaulLavo/fregat/issues).
Ask questions in [Discussions](https://github.com/ShaulLavo/fregat/discussions).
Report security problems through [private security advisories](SECURITY.md).

## License

[MIT](LICENSE). Bundled dependencies keep their own licenses.
