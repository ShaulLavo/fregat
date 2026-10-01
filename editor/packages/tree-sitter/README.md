# @singapore-editor/tree-sitter

tree-sitter syntax for `@singapore-editor/core`. parses in a worker and gives the editor highlights, folds, brackets, injected languages and structural selection

it ships no grammars. bring your own, or take the bundled set from [`@singapore-editor/tree-sitter-languages`](../tree-sitter-languages/)

## try it

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'

const editor = new Editor(element, {
  plugins: [createTreeSitterLanguagePlugin(TREE_SITTER_LANGUAGE_CONTRIBUTIONS)],
})
```

grammars load the first time a document needs them. every editor using this plugin shares one worker

with your own grammar, make a provider and register languages on it

```ts
import {
  createTreeSitterSyntaxPlugin,
  createTreeSitterSyntaxProvider,
} from '@singapore-editor/tree-sitter'

const provider = createTreeSitterSyntaxProvider()
provider.registerLanguage({
  id: 'lua',
  extensions: ['.lua'],
  load: async () => ({
    wasmUrl: '/grammars/tree-sitter-lua.wasm',
    highlightQuerySource: await fetch('/grammars/lua-highlights.scm').then((r) => r.text()),
  }),
})

const editor = new Editor(element, { plugins: [createTreeSitterSyntaxPlugin(provider)] })
```

a contribution can also carry `foldQuerySource`, `injectionQuerySource`, `aliases` and `filenames`

## more

- [how the syntax system works](../../docs/syntax/tree-sitter.md): worker ownership, incremental parses, injections
- `expandTreeSitterSelection`, `shrinkTreeSitterSelection` and `selectTreeSitterToken` drive structural selection commands
- `bun run bench:syntax` runs the syntax benchmark in `bench/`
- [`@singapore-editor/highlighting`](../highlighting/) pairs this with shiki for imported vs code themes
