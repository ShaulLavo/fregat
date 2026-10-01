# singapore

Development happens in the [Fregat monorepo](https://github.com/ShaulLavo/fregat/tree/main/editor).
This repository mirrors its `editor/` folder. Submit changes to Fregat.

a code editor for the browser, written from scratch. same shelf as monaco and codemirror

![](docs/images/editor.webp)

piece table storage, rendering through the css highlight api, tree-sitter and lsp as optional plugins. the core owns the text and the editing runtime. loading and saving are the host's job

still moving. package boundaries change between commits

## try it

[demo](https://shaullavo.github.io/singapore/), browses this repo off the github api

```sh
npm install @singapore-editor/core
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!)
editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

gutters, find, minimap, syntax and language servers are separate packages. nothing loads until you register it

## packages

`core` (the `editor` folder), `textbuffer`, `gutters`, `find`, `markdown`, `minimap`, `scope-lines`, `diff`, `panes`, `tree-sitter`, `tree-sitter-languages`, `lsp`, `plugin-ui`, `lsp-plugin`, `typescript-lsp`, `decode`, `spellcheck`, `highlighting`, `paged`, `react`, `solid`. all under `@singapore-editor/`, one folder each in `packages/`

## running the repo

bun 1.4.2 or newer. browser tests need playwright

```sh
bun install
bun run dev
```

`dev` serves the demo from `examples/app`

```sh
bun run typecheck
bun run test
bun run lint
bun run build
```

`bench:stress` and `bench:input` run from the root. most packages with hot paths (`editor`, `textbuffer`, `find`, `tree-sitter`, …) have their own `bench:*` scripts

## more

- [architecture](ARCHITECTURE.md), main thread vs worker, open questions
- [progress](PROGRESS.md), what's implemented vs designed
- [piece table](docs/storage/piece-table.md), [positions](docs/positions/types-and-conversions.md), [anchors](docs/positions/anchors.md), [selections and undo](docs/editing/selections-and-undo.md), [transforms](docs/display/transforms.md), [virtualization](docs/display/browser-virtualization.md), [tree-sitter](docs/syntax/tree-sitter.md)
- [fregat's roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md) sets execution order across the workspace
- [shared Markdown semantics for Editor and Fregat TUI](plans/bubli-markdown-consumer.md), the existing consumer work package aligned with Fregat's app-local terminal UI
