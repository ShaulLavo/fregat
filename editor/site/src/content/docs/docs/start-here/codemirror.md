# Coming from CodeMirror

Start with the text view, then add each extension's equivalent. Singapore packages and CodeMirror extensions have different lifecycle and update models.

## Concepts side by side

- `EditorView` becomes `Editor` from `@singapore-editor/core/editor`.
- `EditorState.doc` becomes versioned document reads from the piece table.
- `dispatch({ changes })` becomes the editor's `edit` method.
- `extensions` become `plugins` in editor options, plus core options.
- Language support comes from `tree-sitter` with language contributions.
- A theme extension becomes an `EditorTheme` and the core stylesheet.
- Decorations become text range decorations or view contributions.
- View cleanup becomes `dispose()`.

## Mount plain text

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!)
editor.setText('Hello from the new editor\n')
editor.edit([{ from: 0, to: 5, text: 'Welcome' }])
```

The resulting line begins with `Welcome`. Edit ranges use UTF-16 offsets, so check your application's range conversion and selection handling.

## Port extensions by purpose

Use `find` for search, `gutters` for line numbers and folding, and `lsp-plugin` for language-server features. CodeMirror facets, state fields and view plugins need a new implementation against Singapore's extension API.

CodeMirror's immutable tree of text lines and Singapore's persistent AVL piece table both share unchanged data between versions. They expose different document and anchor APIs.

## Plan for workers and assets

Lezer can parse on the main thread. Singapore's tree-sitter package parses in a worker and loads WebAssembly grammars. Verify worker URLs, grammar requests and your Content Security Policy in a production build.

CodeMirror has a large community extension ecosystem and years of production use. Singapore's public API is still moving, and no published editor-level comparison proves a smaller bundle or faster editor. Keep the existing editor available until your application's required features pass integration tests.

Continue with [languages and tree-sitter](../guides/languages.md), [bundling and workers](../guides/bundling.md) and [writing a plugin](../guides/plugins.md).
