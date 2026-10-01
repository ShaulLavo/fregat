# @singapore-editor/diff

diffs for the singapore editor. a diff is a regular `Editor` with one plugin, so deleted lines highlight, select and copy like any other text. stacked or split, with collapsed regions you can expand, inline word changes and per-side syntax colors

## try it

```sh
npm install @singapore-editor/core @singapore-editor/diff
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import {
  createDiffEditorOptions,
  createDiffPlugin,
  createTextDiff,
  joinRenderLines,
} from '@singapore-editor/diff'
import '@singapore-editor/core/style.css'
import '@singapore-editor/diff/style.css'

const plugin = createDiffPlugin({ mode: 'document' })
const editor = new Editor(document.querySelector('#diff')!, {
  ...createDiffEditorOptions(),
  plugins: [plugin],
})

// the plugin projects rows, the host puts them in the editor
plugin.onDidChangeRows(() => {
  editor.setText(joinRenderLines(plugin.getRows()), { tokens: plugin.getTokens() })
})
plugin.onDidChangeTokens(() => editor.setTokens(plugin.getTokens()))

plugin.setFile(
  createTextDiff({
    oldFile: { path: 'note.ts', text: 'keep\nold\nskip\n' },
    newFile: { path: 'note.ts', text: 'keep\nnew\nskip\n' },
  }),
)
```

for a git patch, `parseGitPatch(patchText)` returns one diff per file. pass any of them to `setFile`

for a split view, make two plugins with `side: 'old'` and `side: 'new'` and give both the same `createDiffRegionStore()`, so expanding a region on one side expands it on the other

## more

- [hosting](docs/hosting.md): editor options, split view, row lookup under the pointer, document vs overlay mode
- [colors](docs/theme.md): theme fields and the `diff.*` color ids
- `createSplitProjection`, `createStackedProjection` and `createLiveDiffProjection` give you the rows without an editor
- `prepareDiffSyntax(file)` parses both sides ahead of time. pass its result as `setFile(file, prepared)` and the first frame is already colored
- [the editor](../../README.md)
