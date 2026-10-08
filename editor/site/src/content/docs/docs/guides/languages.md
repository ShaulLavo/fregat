# Languages and tree-sitter

Add syntax colours and structural language data with tree-sitter. You need a bundler that emits module workers and WebAssembly assets.

## 1. Install the syntax packages

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages
```

## 2. Register the bundled languages

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [createTreeSitterLanguagePlugin(TREE_SITTER_LANGUAGE_CONTRIBUTIONS)],
})
editor.openDocument({
  documentId: '/src/main.ts',
  text: 'const value = 1\n',
  languageId: 'typescript',
})
```

The grammar loads when the document needs it. Tree-sitter parses in a worker and supplies highlights, folds, bracket information, structural selection and injected languages.

## 3. Bring a grammar

Register a language on `createTreeSitterSyntaxProvider`, then install `createTreeSitterSyntaxPlugin(provider)`. The contribution supplies a WebAssembly URL and highlight queries. Fold and injection queries are optional additions.

```ts
import { createTreeSitterSyntaxProvider } from '@singapore-editor/tree-sitter'

const provider = createTreeSitterSyntaxProvider()
provider.registerLanguage({
  id: 'lua',
  extensions: ['.lua'],
  load: async () => ({
    wasmUrl: '/grammars/tree-sitter-lua.wasm',
    highlightQuerySource: await fetch('/grammars/lua-highlights.scm').then((response) =>
      response.text(),
    ),
  }),
})
```

Build the grammar against Singapore's tree-sitter runtime. A grammar from a different runtime build needs compatibility verification.

## Shiki as a separate path

The core's `/shiki` entry point exposes Shiki highlighting and VS Code theme conversion. Use it when your integration needs its supported grammars or theme conversion. Tree-sitter supplies structural syntax information in addition to colours. Each path has its own worker and asset setup.

## If it doesn't work

### Plain text appears with no colours

Check `languageId`, the grammar request and the worker console. A document language id does not load a plugin by itself.

### A custom language fails to parse

Check the WebAssembly response and runtime compatibility, then validate the highlight query against that grammar's node names.

Continue with [bundling and workers](bundling.md), [workers](../concepts/workers.md) and [highlighting](../concepts/highlighting.md).
