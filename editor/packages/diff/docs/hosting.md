# hosting a diff editor

how a host wires the diff plugin into an `Editor`. back to the [readme](../README.md)

## who owns what

a diff is a real `Editor` with one plugin. the plugin owns the diff model, the projected rows, the expansion state and the gutter. the host owns the editor's document, because plugins can't change document text. so the host pushes the plugin's rows in and re-applies its tokens:

```ts
plugin.onDidChangeRows(() => {
  editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
})
plugin.onDidChangeTokens(() => editor.setTokens(plugin.getTokens()))
```

the tokens travel with the text. `setText` replaces the document, and an expansion toggle without them repaints uncolored until the next parse.

`editor.syncText` is cheaper: it applies the minimal prefix/suffix edit, and for an expansion that edit is exactly the inserted lines. it also keeps caret and selection where they were, and an expansion moves every row below the region, so a selection would end up on different text. use it when your host has no selection to lose.

## editor options

`createDiffEditorOptions()` returns what the diff's editor needs: a static read-only document, the configured `tabSize` with indentation detection off, no cursor-line paint over the row tint, `folding: false` so no fold can hide projected rows, and only the navigation, selection and find keys. spread it and add your own plugins, typography and theme. the pushed text carries no `languageId`; the plugin keeps a syntax document per side.

`keymap` and `cursorLineHighlight` are whole objects, and a field an override leaves out falls back to the editor default (every key pack, a painted cursor line). extend them:

```ts
const preset = createDiffEditorOptions()
const editor = new Editor(host, {
  ...preset,
  cursorLineHighlight: { ...preset.cursorLineHighlight, gutterNumber: true },
  keymap: { ...preset.keymap, layers: [...preset.keymap.layers, hostLayer] },
  plugins: [plugin],
})
```

## split view

split mode is two editors, `side: 'old'` and `side: 'new'`, laid out and scroll-synced by the host. give both plugins the same region store. with separate stores, expanding a collapsed region on one side leaves the other where it was and every row below it misaligns:

```ts
const regions = createDiffRegionStore()
const left = createDiffPlugin({ mode: 'document', side: 'old', regions })
const right = createDiffPlugin({ mode: 'document', side: 'new', regions })
```

there is one store and both sides read it. the panes stay aligned while word wrap is off and no fold map is set.

## rows

`plugin.getStackedRows()` returns both sides in row order, with the plugin's current region expansions. for a stacked plugin it is the same readonly array as `getRows()`. for a split plugin it is cached until the file or expansion state changes. plugins with private region stores stay independent; plugins given the same store see each other's toggles. overlay mode returns its live projection rows, as `getRows()` does.

a host that needs the diff row under a pointer calls `diffRowAtEvent(event)`. it returns the pane's side, its rows and the index into them, resolved through the editor's own row geometry. it returns `null` outside a document-mode diff pane.

expansion belongs to a diff, keyed by its content. pushing the same path with different content resets it, because region keys are absolute line numbers and any edit above a region renumbers it. pushing an identical file again keeps it.

## modes

- `document` puts a synthetic buffer of the projected rows in the editor. deletion rows are real document lines, so they highlight, select and copy like any other text. use this for a diff view.
- `overlay` keeps the host's live, editable buffer and injects deletions as extra rows. injected rows have no offset space (`startOffset === endOffset`), so they can't be selected or copied, get no inline word diff, and borrow syntax colors from the document text at their anchor offset. [overlayModeLimits.test.ts](../test/overlayModeLimits.test.ts) pins this down. use it for a live dirty-diff against an editable document, with `setBaseFile` and `setEnabled`.
