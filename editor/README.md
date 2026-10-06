![singapore editor with a file tree and syntax highlighting](docs/images/editor.webp)

# singapore

a code editor for the browser, written from scratch. same shelf as monaco and codemirror

the core is a persistent AVL piece table with copy-on-write. edits copy the changed tree path and share the rest, so old versions stay readable. snapshots and stable text anchors take inspiration from zed

## how it differs

| editor                                                                                            | text storage                                          |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [singapore](docs/storage/piece-table.md)                                                          | persistent AVL piece table, copy-on-write             |
| [monaco and vs code](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation) | mutable red-black piece tree                          |
| [codemirror 6](https://github.com/codemirror/state/blob/main/src/text.ts)                         | immutable tree of text lines, with structural sharing |
| [zed](https://zed.dev/blog/zed-decoded-rope-sumtree)                                              | copy-on-write B+ tree rope, built on SumTree          |

singapore paints syntax through the css highlight api. tree-sitter and language servers are optional plugins. still moving

## try it

[open the demo](https://shaullavo.github.io/singapore/), which browses this repo through the github api

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

call `editor.dispose()` when you're done

## what's in it

- multi-cursor editing, undo, folding, and virtualized rows
- gutters, find, minimap, diff, and markdown as [separate packages](packages/)
- tree-sitter syntax, language servers, and react and solid adapters

## more

[core api](packages/editor/README.md) · [architecture](ARCHITECTURE.md) · [progress](PROGRESS.md) · [roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md)

development happens in [fregat](https://github.com/ShaulLavo/fregat/tree/main/editor). this repo mirrors its `editor/` folder; submit changes there.

to run the demo locally, use bun 1.4.2 or newer, then `bun install` and `bun run dev` from this folder
