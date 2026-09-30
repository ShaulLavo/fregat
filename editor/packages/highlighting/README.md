# @singapore-editor/highlighting

One highlighting service for editors, diffs and standalone snippets. It owns engine policy, grammar
and alias loading, theme registration and worker lifetime. Callers supply theme data and, optionally,
the languages they expect.

## Simple editor

```ts
import { createHighlightingPlugin } from '@singapore-editor/highlighting'

new Editor(element, { plugins: [createHighlightingPlugin()] })
```

Each activation creates its own service and disposes it when the editor lets go of the plugin.
Tree-sitter supplies structure (folds, brackets, injections, selection) and the editor palette's
colors.

## Shared service

```ts
const highlighting = createHighlightingService({
  resolveTheme: (id) => themes.load(id), // imported VS Code theme data by id
  preloadLanguages: () => workspaceLanguages, // null prepares the default grammar set
})

const syntax = createHighlightingPlugin({
  service: highlighting,
  theme: { current: () => ({ format: 'vscode', id: 'dracula' }), subscribe },
})
```

A borrowed service is never disposed by a plugin. Under an imported theme, TextMate colors paint over
the same Tree-sitter structure; switching back to the editor palette removes only the colors. Diffs
and prepared documents take the same providers through `service.documentBackend(theme)`.

## Standalone snippet

```ts
const result = await highlighting.highlight(sample, {
  language: 'typescript',
  theme: { format: 'vscode', definition: registration },
  signal,
})
```

No DOM, editor or document is needed. Tokens are UTF-16 offsets into exactly the submitted text and
are frozen. `themeRevision` changes with the theme's content, so two same-name themes never share
colors. Unknown languages answer with `language: 'text'` and no tokens. Abort rejects the caller with
an `AbortError`; the shared worker keeps serving. Without a worker the call rejects with code
`unavailable`; it never tokenizes on the main thread.

## Disposal

The creator disposes: `await highlighting.dispose()` stops both workers and rejects work still in
flight. Disposing twice is safe.
