# Coming from Monaco

Move one editor view first. Check its text, selection, commands and disposal before adding language features.

## Concepts side by side

- `monaco.editor.create(element, options)` becomes `new Editor(element, options)` from `@singapore-editor/core/editor`.
- An `ITextModel` with a URI becomes a named document opened with `openDocument`.
- `getValue` and `setValue` become `materializeFullText()` and `setText`.
- A model language becomes `languageId` on `openDocument`, plus a syntax plugin.
- `defineTheme` and `setTheme` become an `EditorTheme` object and `setTheme`.
- Model decorations become `setRangeDecorations` for text paint, and extension contributions for other presentations.
- Language providers become `lsp-plugin` connected to an LSP server, or `typescript-lsp` in a worker.
- Editor disposal stays `dispose()` when the view closes.

## Mount the first view

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  wordWrap: true,
})
editor.openDocument({
  documentId: '/src/main.ts',
  text: 'export const answer = 42\n',
  languageId: 'typescript',
})
const text = editor.materializeFullText()
console.log(text)
```

Keep the original application's saved text separate from view lifetime. Monaco model ownership and Singapore document sessions have different contracts. Read [documents and sessions](../guides/documents.md) before sharing a document across views.

## Port language features separately

A language id alone supplies no diagnostics or completions. Install the syntax plugin for colours and connect a language server for semantic features. Monaco's language extensions and worker configuration cannot be passed directly to Singapore.

## Check these differences

Singapore uses UTF-16 offsets for edit ranges. Monaco positions are one-based line and column pairs. Convert at your application's boundary and test emoji and CRLF files.

Singapore's syntax paint cannot use bold or italic. Rows have fixed height. Inlay hints, CodeLens and a Monaco-level screen-reader audit are gaps. Mobile and touch are outside the current target. Check the commands your application uses against the [generated core reference](/docs/reference/api/core/overview/).

No editor-level comparison currently establishes an overall speed or memory advantage over Monaco. Run your application's real files through both editors before making that claim.

Continue with [themes](../guides/themes.md), [language servers](../guides/lsp.md) and [decorations](../guides/decorations.md).
