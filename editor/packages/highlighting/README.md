# @singapore-editor/highlighting

syntax colors for editors, diffs and standalone snippets, from one service

tree-sitter gives the structure (folds, brackets, injections, selection) and the editor palette's colors. pick an imported vs code theme and shiki paints its textmate colors over the same structure. both engines run in workers

## try it

not on npm yet. use it from this workspace

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createHighlightingPlugin } from '@singapore-editor/highlighting'

const editor = new Editor(element, { plugins: [createHighlightingPlugin()] })
```

the plugin makes its own service and disposes it when the editor drops the plugin

highlight a snippet with no editor at all

```ts
import { createHighlightingService, highlightLines } from '@singapore-editor/highlighting'

const highlighting = createHighlightingService()
const code = 'const value = 1\n'
const result = await highlighting.highlight(code, { language: 'typescript' })

for (const line of highlightLines(code, result.tokens)) {
  for (const segment of line) console.log(segment.text, segment.style?.color ?? result.foreground)
}

await highlighting.dispose()
```

tokens are utf-16 offsets into exactly the text you passed. a language with no grammar comes back as `language: 'text'` with no tokens

## more

- [sharing one service across editors, diffs and previews](docs/service.md), themes, aborts, errors, disposal
- [`@singapore-editor/tree-sitter`](../tree-sitter/), the structure side
- [`@singapore-editor/tree-sitter-languages`](../tree-sitter-languages/), the grammars it loads
