# @singapore-editor/diff

Diff rendering and editor-diff helpers for Singapore.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/diff
```

## Usage

A diff is a real `Editor` with one plugin. The plugin owns the diff model, the projected rows, the
expansion state and the gutter; the **host owns the editor's document**, because no plugin context
can mutate document text. So the host pushes the plugin's rows in and re-applies its tokens:

```ts
import {
  createDiffEditorOptions,
  createDiffPlugin,
  joinRenderLines,
  parseGitPatch,
} from '@singapore-editor/diff'
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'
import '@singapore-editor/diff/style.css'

const plugin = createDiffPlugin({ mode: 'document', side: 'stacked' })
const editor = new Editor(host, {
  ...createDiffEditorOptions(),
  plugins: [plugin],
  tabSize: 4,
})

const push = () => {
  // The tokens travel with the text: `setText` replaces the document, and a toggle without them
  // would repaint uncoloured until the next parse.
  //
  // `Editor.syncText` is the cheaper alternative — it computes the minimal prefix/suffix edit
  // rather than tearing the document down, and for an expansion that edit is exactly the inserted
  // lines. It is not the default here because it also preserves caret and selection across rows
  // that have moved, and an expansion moves every row below the region: a reader holding a
  // selection would find it pointing at different text. Worth taking if your host has no selection
  // to lose.
  editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
}
plugin.onDidChangeRows(push)
plugin.onDidChangeTokens(() => editor.setTokens(plugin.getTokens()))

plugin.setFile(parseGitPatch(patchText)[0])
```

`createDiffEditorOptions()` returns what the diff's editor needs: a static read-only document, the
configured `tabSize` with no indentation guess, no cursor-line paint over the row tint, `folding:
false` so no fold command can hide projected rows, and the navigation, selection and find keys.
Spread it and add your own options: plugins, typography, theme. The pushed text carries no
`languageId`, because the language belongs to the plugin's per-side syntax documents.

`keymap` and `cursorLineHighlight` are whole objects, and a field an override leaves out takes the
editor default: every key pack and a painted cursor line. Extend them:

```ts
const preset = createDiffEditorOptions()
const editor = new Editor(host, {
  ...preset,
  cursorLineHighlight: { ...preset.cursorLineHighlight, gutterNumber: true },
  keymap: { ...preset.keymap, layers: [...preset.keymap.layers, hostLayer] },
  plugins: [plugin],
})
```

Split mode is two editors, `side: 'old'` and `side: 'new'`, laid out and scroll-synced by the host.
**Give both plugins the same region store**, or expanding a collapsed region on one side leaves the
other where it was and every row below it misaligns:

```ts
const regions = createDiffRegionStore()
const left = createDiffPlugin({ mode: 'document', side: 'old', regions })
const right = createDiffPlugin({ mode: 'document', side: 'new', regions })
```

This is not the mirroring the design forbids — there is one store, and both sides read it, rather
than two sets kept in step. The panes stay aligned only while word wrap is off and no fold map is
set.

A host that needs the diff row under a pointer calls `diffRowAtEvent(event)`. It answers with the
pane's side, its rows and the index into them, resolved through the editor's own row geometry,
so a host never reads `data-editor-virtual-row` or a pane class to find out where a press landed.

Expansion is per _diff_, not per path: pushing the same path with different content resets it,
because region keys are absolute line numbers and any edit above a region renumbers it. Pushing an
identical file again keeps it.

## Theme

Pass an `EditorTheme` to each diff editor. Base colors use the same fields as a plain editor:

| Removed CSS hook                  | EditorTheme field       |
| --------------------------------- | ----------------------- |
| `--editor-diff-background`        | `backgroundColor`       |
| `--editor-diff-foreground`        | `foregroundColor`       |
| `--editor-diff-gutter-background` | `gutterBackgroundColor` |

The removed hooks have no aliases. Set these fields on the diff editor itself. Its rows and gutter
inherit the values, and `editor.setTheme(theme)` updates them without remounting.

```ts
editor.setTheme({
  type: 'light',
  backgroundColor: '#ffffff',
  foregroundColor: '#18181b',
  gutterBackgroundColor: '#f4f4f5',
  colors: { 'diff.added.bg': '#dcfce7' },
})
```

`createDiffPlugin` registers the following `EditorTheme.colors` ids. Defaults follow the theme's
`type`; explicit colors override those defaults. A light theme should also supply its base colors.

| Color id                               | Paint                                           |
| -------------------------------------- | ----------------------------------------------- |
| `diff.added`, `diff.deleted`           | Added and deleted gutter numbers and indicators |
| `diff.modified`                        | Input to the default hunk background mix        |
| `diff.added.bg`, `diff.deleted.bg`     | Changed rows and their gutter rows              |
| `diff.hunk.bg`, `diff.hunk.foreground` | Hunk separators and their gutter rows           |
| `diff.placeholder.bg`                  | Empty cells on one side of a split diff         |
| `diff.muted`                           | Empty diff message                              |
| `diff.border`, `diff.split.handle`     | Host diff borders and split handles             |

## Stacked rows

`plugin.getStackedRows()` returns both sides in row order, including the plugin's current region
expansions. For a stacked plugin it returns the same readonly array as `getRows()`. For a split
plugin the result is cached until its file or expansion state changes. Private region stores keep
views independent; plugins given the same store observe each other's toggles. Overlay mode returns
its live projection rows, as `getRows()` does.

## Modes

- **`document`** (default) — the editor holds a synthetic buffer of the projected rows. Deletion rows
  are real document lines, so they highlight, select and copy like any other text. This is the
  parity path.
- **`overlay`** — the editor holds the host's live, editable buffer and deletions arrive as injected
  rows. Injected rows have no offset space (`startOffset === endOffset`), which means no selection,
  no copy, no inline word-diff, and syntax colouring borrowed from whatever document text sits at
  the anchor offset. Non-parity by construction — see `test/overlayModeLimits.test.ts`. Use it for a
  live dirty-diff against an editable document, not for a diff view.

## Exports

- `createDiffPlugin` — the one plugin factory, carrying both modes. `mode` is required.
- `createDiffEditorOptions` — the editor options a document-mode diff needs.
- `createDiffRegionStore` — shared expansion state for the two sides of a split view.
- `parseGitPatch` and `createTextDiff` build diff models.
- `createSplitProjection`, `createStackedProjection`, and `createLiveDiffProjection` expose render
  projections.
- `joinRenderLines` turns projected rows into the buffer text the host pushes in.
- `projectDiffSyntaxTokens` maps full-file token streams onto projected rows.
