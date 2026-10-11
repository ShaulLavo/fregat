# Singapore

A code editor for the browser that keeps every version.

<p align="center">
  <a href="https://github.com/ShaulLavo/fregat/actions/workflows/workspace-libraries.yml"><img src="https://github.com/ShaulLavo/fregat/actions/workflows/workspace-libraries.yml/badge.svg" alt="Workspace library checks" /></a>
  <a href="https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="https://github.com/ShaulLavo/fregat/tree/main/editor"><img src="https://img.shields.io/badge/install-source%20%2F%20workspace-blue" alt="Install from source or workspace" /></a>
</p>
<p align="center">
  <a href="https://singapore.shaulavo.dev/">Website and demo</a> ·
  <a href="https://github.com/ShaulLavo/fregat/blob/main/editor/AGENTS.md#design-documents">Documentation</a> ·
  <a href="https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08.md">Benchmarks</a> ·
  <a href="https://github.com/ShaulLavo/fregat/discussions">Discussions</a>
</p>

![Singapore editor with a file tree and syntax highlighting](https://raw.githubusercontent.com/ShaulLavo/fregat/main/editor/docs/images/editor.webp)

Singapore is a browser editor with a persistent text buffer. Each edit produces a new version and shares unchanged storage with earlier versions.
You can keep an old snapshot readable while editing the current document.

## What it gives you

- **Readable history.** A copy-on-write piece table keeps earlier versions available. [Text storage](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/storage/piece-table.md) explains the tree and snapshots.
- **Positions that survive edits.** Anchors follow text through insertions and deletions. Read the [anchor rules](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/positions/anchors.md).
- **Browser-native text paint.** Syntax colors use the CSS Custom Highlight API. EditContext handles input in Chromium. [Browser behavior](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/display/browser-quirks.md) records the compatibility limits.
- **Workers for derived work.** Tree-sitter parsing and highlighting use worker-side source snapshots. The main thread retains the document. See the [syntax design](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/syntax/tree-sitter.md).
- **Optional language tools.** Add syntax languages, language-server integration, a minimap, or search as packages. Start with the [core API](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/README.md).

## Performance

A 10 MiB TypeScript document with lexical highlighting. This was a noisy experiment with other jobs on the host; a quiet rerun is pending.

| Measurement                       |  Singapore |   Monaco | CodeMirror |
| --------------------------------- | ---------: | -------: | ---------: |
| First-frame opportunity           |    29.6 ms |  89.7 ms |    31.5 ms |
| First detected highlighted text   | 1,517.7 ms | 169.4 ms |    56.1 ms |
| End typing, p95 frame opportunity |    32.3 ms |  49.0 ms |    32.7 ms |
| JavaScript heap after open        |   25.2 MiB | 29.5 MiB |   17.4 MiB |

Singapore reaches the first frame sooner than Monaco, but highlighted open is slower than both competitors.
It waits for a full-document parse before viewport highlighting; the other editors can highlight the viewport first.

| Larger files    | Singapore                                                 | Monaco | CodeMirror |
| --------------- | --------------------------------------------------------- | ------ | ---------- |
| Through 100 MiB | Passed all 3 repetitions                                  | Passed | Passed     |
| 200 MiB         | All 3 attempts missed the 30-second highlighting deadline | Passed | Passed     |

<details>
<summary>Benchmark setup and limits</summary>

| Detail          | Setup                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| Date            | 2026-10-08                                                                                  |
| Machine         | Intel Core i7-14700K running Linux                                                          |
| Browser         | Headless Chromium 153                                                                       |
| Versions        | Singapore 0.2.6, Monaco 0.57.0, CodeMirror 6; configurations recorded in the report         |
| Fixture         | Repeated TypeScript text with lexical highlighting                                          |
| Timing          | Animation-frame opportunities; physical display latency remains unmeasured                  |
| Memory          | JavaScript heap; WASM, DOM, and GPU memory remain unmeasured                                |
| Run conditions  | Other jobs shared the host. A quiet rerun is pending.                                       |
| Deployment size | Singapore's complete TypeScript deployment is larger than both competitors when compressed. |

See the [method, raw samples, bundle sizes, and reproduction commands](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08.md#reproduce).

</details>

## Quick start

[Try the browser demo](https://singapore.shaulavo.dev/) to edit text without installing anything.
For current code, clone Fregat and prepare its workspace packages:

```sh
git clone https://github.com/ShaulLavo/fregat.git
cd fregat
bun install --frozen-lockfile
bun run build:workspaces
```

The npm packages currently serve 0.1.2. Publishing the current release is deferred.
Use the source workspace for the APIs described here. [Development setup](https://github.com/ShaulLavo/fregat/blob/main/docs/development.md#workspace-libraries) explains the workspace links.

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!)
editor.setText('const value = 1;\n')
```

Give `#editor` a height in your page. Call `editor.dispose()` when you remove the editor.
The [core README](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/README.md) covers documents, plugins, and lifecycle.

## Documentation

- [Start here](https://singapore.shaulavo.dev/docs/start-here/introduction/) for setup and the package guides.
- [Known limits](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/limitations.md) for measurement ceilings, analysis budgets and bounded package behavior.
- [Browser quirks](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/display/browser-quirks.md) for engine bugs and their workarounds.

## Planned work

| Work                                                    | Status      | Plan                                                                                                                                                             |
| ------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collaborative text editing                              | Planned     | [E066](https://github.com/ShaulLavo/fregat/blob/main/plans/e066-collaborative-text.md)                                                                           |
| WebRTC collaboration plugin                             | Planned     | [E067](https://github.com/ShaulLavo/fregat/blob/main/plans/e067-webrtc-collaboration-plugin.md)                                                                  |
| Quiet browser comparison and highlighted-open follow-up | In progress | [Plan 336](https://github.com/ShaulLavo/fregat/blob/main/plans/336-packages-as-products.md#track-p-proof-starts-now-benchmarks-run-through-the-heavy-job-runner) |

The [Fregat roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md) schedules this work.

## Credits and contributing

Singapore borrows ideas from [CodeMirror](https://codemirror.net/), [Monaco and VS Code](https://github.com/microsoft/monaco-editor), [Fred](https://github.com/cdacamar/fredbuf), Cameron DaCamara's editor, and [Zed](https://zed.dev/).

Development happens in [Fregat](https://github.com/ShaulLavo/fregat/tree/main/editor).
This repository is a read-only mirror of its `editor/` folder. Submit issues and pull requests to Fregat.
Read the [contribution guide and AI policy](https://github.com/ShaulLavo/fregat/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE). Dependencies keep their own licenses.
