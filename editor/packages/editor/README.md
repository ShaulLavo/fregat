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

## transactions and reconciliation

`createPlugin` scopes can subscribe to each text transaction, including typing, an IME
commit, paste, commands, undo/redo, `editor.edit`, and `setText`. This works with
`new Editor(element)` and plain plugin options. A transaction carries the immutable
before/after snapshots, the actual normalized atomic edits, its origin, the local
source view ID, and an optional opaque author tag. Buffer revision numbers are local
to each buffer; `setText` replaces that buffer. Document attachment itself emits no
text transaction. Scopes release their subscriptions when removed, and plugins that
do not subscribe incur no transaction fan-out. Transactions are captured in commit
order and delivered once after view acceptance, including edits and replacements
authored by change callbacks or transaction listeners. If an outgoing document is
swapped or detached before acceptance, its captured commits finish delivery to the
remaining subscriptions. Disposing the editor or removing the final transaction
subscription drops pending commits and releases their snapshot references.

```ts
import { createPlugin } from '@singapore-editor/core/extensions'

const plugin = createPlugin({
  name: 'shared-text',
  view(scope) {
    scope.onDidTransaction((transaction) => {
      // Send transaction.edits against transaction.snapshotBefore.
    })
    scope.applyEdits([{ from: 0, to: 0, text: 'peer text' }], undefined, {
      history: 'skip',
      origin: 'remote',
      author: 'peer',
    })
  },
})
```

`scope.reconcile(baseSnapshot, sequentialBatches, options)` (also available on
`Editor` and `DocumentSession`) builds the final snapshot before publishing one
content transition. It maps all attached selections, ends active composition,
projects tracked decorations, and keeps the existing history graph. It adds no undo
entry and emits no transaction echo. Its origin defaults to `remote`; `replay` is
also supported. Collaborative undo policy belongs to the caller.

Every batch uses offsets into the preceding batch's resulting snapshot. Required
`options.edits` describes the current-to-final transition for selection and consumer
projection; reconciliation validates it before changing state. Supply the precise
edits known by the collaboration layer, including an empty array for unchanged text.
This preserves unchanged interior spans without computing a character diff.
Offsets allow an identity-aware caller to use this same API.

The 128-entry synchronization chain is a bounded consumer aid. Consumers that cannot
bridge their cursor to the current snapshot reset from the new snapshot. It does not
replace an authored-operation log.

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
