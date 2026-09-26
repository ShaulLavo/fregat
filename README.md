# singapore

a code editor for the browser, written from scratch. same shelf as monaco and codemirror

![](docs/images/editor.webp)

piece table storage, rendering through the css highlight api, tree-sitter and lsp as optional plugins. the core owns the text and the editing runtime. loading and saving are the host's job

still moving. package boundaries change between commits

## try it

[demo](https://shaullavo.github.io/singapore/), browses this repo off the github api

not on npm under this name yet. clone it and `bun link`

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector('#editor')!)
editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

gutters, find, minimap, syntax and language servers are separate packages. nothing loads until you register it

## packages

`core` (the `editor` folder), `gutters`, `find`, `markdown`, `minimap`, `scope-lines`, `diff`, `panes`, `tree-sitter`, `tree-sitter-languages`, `lsp`, `plugin-ui`, `lsp-plugin`, `typescript-lsp`, `decode`, `spellcheck`, `react`, `solid`. all under `@singapore-editor/`, one folder each in `packages/`

## running the repo

bun 1.3.10 or newer. browser tests need playwright

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

`bench:*` scripts live in `packages/editor` and `packages/tree-sitter`

## more

- [architecture](ARCHITECTURE.md), main thread vs worker, open questions
- [progress](PROGRESS.md), what's implemented vs designed
- [piece table](docs/storage/piece-table.md), [positions](docs/positions/types-and-conversions.md), [anchors](docs/positions/anchors.md), [selections and undo](docs/editing/selections-and-undo.md), [transforms](docs/display/transforms.md), [virtualization](docs/display/browser-virtualization.md), [tree-sitter](docs/syntax/tree-sitter.md)
- [fregat's roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md) sets execution order across both repos
