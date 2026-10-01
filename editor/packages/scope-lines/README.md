# @singapore-editor/scope-lines

three plugins that show code structure: indent guides down each open block, sticky headers that keep the enclosing function or class pinned at the top while you scroll, and bracket pair colors by nesting depth

they read the editor's folds and brackets. indent guides and sticky headers work from indentation when no syntax plugin is loaded. bracket colors need one

## try it

```sh
npm install @singapore-editor/core @singapore-editor/scope-lines
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import {
  createBracketColorsPlugin,
  createScopeLinesPlugin,
  createStickyScrollPlugin,
} from '@singapore-editor/scope-lines'
import '@singapore-editor/core/style.css'
import '@singapore-editor/scope-lines/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [createScopeLinesPlugin(), createStickyScrollPlugin(), createBracketColorsPlugin()],
})
```

scope lines draw a guide for every visible block and highlight the ones holding the caret. `mode: 'current'` draws only the innermost block around the caret, `showActive: false` drops the highlight, and `minLineSpan` skips short blocks

sticky scroll shows up to five headers. change that with `maxLineCount`

bracket colors stop at `maxLevel` deep and skip files with more than `maxBrackets` brackets

## more

- [`@singapore-editor/tree-sitter`](../tree-sitter/), the syntax plugin that supplies real scopes and brackets
- [`@singapore-editor/gutters`](../gutters/), fold arrows for the same blocks
