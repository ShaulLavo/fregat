![singapore editor with a file tree and syntax highlighting](docs/images/editor.webp)

# singapore

a code editor for the browser, written from scratch. same shelf as monaco and codemirror

piece table storage, rendering through the css highlight api, and optional tree-sitter and lsp plugins. still moving

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

## benchmarks

recorded typing dispatch p95 on an i7-14700K in chromium. this measures event handling; screen latency is measured separately

| document            | single view | shared views |
| ------------------- | ----------: | -----------: |
| 500,000 short lines |      1.0 ms |       1.6 ms |
| one-megabyte line   |      1.8 ms |       2.7 ms |

[method and full results](examples/stress/results/input-latency/README.md) · [textbuffer comparison](packages/textbuffer/bench/README.md)

## more

[core api](packages/editor/README.md) · [architecture](ARCHITECTURE.md) · [progress](PROGRESS.md) · [roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md)

development happens in [fregat](https://github.com/ShaulLavo/fregat/tree/main/editor). this repo mirrors its `editor/` folder; submit changes there.

to run the demo locally, use bun 1.4.2 or newer, then `bun install` and `bun run dev` from this folder
