# the shared service

one `HighlightingService` per page can serve every editor, diff and snippet. it owns engine choice, grammar and alias loading, theme registration, and the lifetime of its two workers (shiki and tree-sitter). callers bring theme data and, optionally, the languages they expect to open

## creating one

```ts
import { createHighlightingService, createHighlightingPlugin } from '@singapore-editor/highlighting'

const highlighting = createHighlightingService({
  // imported vs code theme data, by the id a `vscode` selection names
  resolveTheme: (id) => loadTheme(id),
  // languages to prepare after first paint. null prepares the default grammar set
  preloadLanguages: () => workspaceLanguages,
})
```

other options: `shikiWorker` and `treeSitterBackend` replace the default workers, and `maxTokenizationLineLength` is read on every shiki document open and snippet

## editors

```ts
const syntax = createHighlightingPlugin({
  service: highlighting,
  theme: { current: () => ({ format: 'vscode', id: 'dracula' }), subscribe },
})
```

`theme` is either a fixed selection (`{ format: 'editor' }` or `{ format: 'vscode', id }`) or a source with `current()` and an optional `subscribe(listener)` that returns an unsubscribe. left out, documents use the editor's own palette

a plugin given a `service` borrows it and never disposes it. without one, each activation owns a service of its own

under an imported theme, textmate colors paint over the same tree-sitter structure. switching back to the editor palette removes only the colors

## diffs and prepared documents

`service.documentBackend(theme)` returns the backend `@singapore-editor/diff` accepts, `{ kind: 'highlighter' }` or `{ kind: 'tree-sitter' }`, for that theme. `prepareDiff(file, theme)` parses a diff ahead of its view and `showDiff(view, file, side, theme)` picks up the kept result

## snippets

```ts
const result = await highlighting.highlight(sample, {
  language: 'typescript',
  theme: { format: 'vscode', definition: registration },
  signal,
})
```

- needs no DOM, editor or document
- tokens are utf-16 offsets into exactly the submitted text, and frozen
- `themeRevision` follows the theme's content, so two themes with the same name and different colors get different revisions
- with no `theme`, snippets paint with `github-dark`. `{ format: 'editor', definition }` takes an editor palette
- an unknown language answers `language: 'text'` with no tokens
- aborting rejects that caller with an `AbortError`. the shared worker keeps serving everyone else
- with no worker available the call rejects with a `HighlightingError` of code `unavailable`. it never tokenizes on the main thread

`highlightLines(text, tokens)` turns a result into lines of styled segments for renderers that draw spans

## disposal

whoever created the service disposes it. `await highlighting.dispose()` stops both workers and rejects work still in flight. calling it twice is safe
