# @singapore-editor/core

the editor itself. it holds the text, runs editing, selections and undo, paints rows through the css highlight api, and owns keymaps, themes and the plugin api

gutters, find, minimap, tree-sitter and lsp are separate packages that plug into this one

## try it

```sh
npm install @singapore-editor/core
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector('#editor')!, {
  theme: { type: 'dark', backgroundColor: '#1e1e1e', foregroundColor: '#d4d4d4' },
})

editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

Give the host element a definite height, such as `height: 400px`. The editor fills that height and scrolls its document within it. Block, flex and grid hosts are supported.

call `editor.dispose()` when you're done with it

plugins go in `plugins` when you construct the editor. a plugin is an object with a `name` and an `activate(context)` that registers what it adds

## entry points

- `/editor`: the `Editor` class and its option types
- `/document`: document sessions, snapshots, anchors and text edits
- `/extensions`: the plugin api
- `/rendering`: themes and `registerEditorColor`
- `/syntax`: syntax provider contracts and token helpers
- `/keymap`: named pack data and command metadata, for hosts that share keys with the editor
- `/shiki`: a shiki highlighter plugin and vscode theme conversion
- `/style.css`: the base stylesheet

`/testing`, `/debug`, `/logging` and `/secondary-views` are for tests, diagnostics and embedders

## more

- [themes and the gutter inset](docs/appearance.md)
- [keymaps and chords](docs/keymap.md)
- [row presentation handles](docs/row-presentation.md), for plugins that touch mounted rows
- [the singapore repo](../../README.md), with the demo and the other packages
- benchmarks are the `bench:*` scripts in `package.json`

bundles unicode bidi data under the [unicode license v3](scripts/unicode/LICENSE.txt)
