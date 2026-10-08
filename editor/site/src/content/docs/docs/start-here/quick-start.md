# Quick start

Mount an editable text view in a browser application. You need a client-side JavaScript entry point and a bundler that resolves ESM and CSS imports, such as Vite.

## 1. Install the core

```sh
npm install @singapore-editor/core
# or: pnpm add @singapore-editor/core
# or: bun add @singapore-editor/core
# or: yarn add @singapore-editor/core
```

## 2. Give the editor a container

Add an HTML element with the id `editor`. Set `height: 20rem`, `display: flex` and `flex-direction: column` in your stylesheet. This constrains the editor's scroll area to the element's height.

## 3. Mount it

Save this as `main.ts`. Retain the editor so you can release it when the view closes.

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const element = document.querySelector<HTMLElement>('#editor')!
const editor = new Editor(element)
editor.setText('const greeting = "Hello, Singapore"\n')
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) editor.dispose()
})
```

You should see one line of text and be able to move the caret, select text and type. Undo returns to an earlier edit. Syntax colours need a highlighting plugin. If nothing shows, see [If it doesn't work](#if-it-doesnt-work).

On a desktop browser this page is itself a Singapore editor with Markdown and TypeScript plugins. Click into the sample above and type.

## Open a named document

Use a document id when a view needs identity, such as a tab or a language-server URI. Plain `setText` remains useful for unnamed text.

```ts
import { Editor } from '@singapore-editor/core/editor'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!)
editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1\n',
  languageId: 'typescript',
})
```

## If it doesn't work

### The editor has no visible rows

Check the container's height, flex layout and the core stylesheet import. Mount after the container exists in the DOM.

### Highlighting is absent

The core edits plain text. Follow the [languages and tree-sitter guide](../guides/languages.md) to load a syntax plugin.

### A server-rendered page fails to load

Create the editor after client-side mount. The core uses browser DOM APIs.

Continue with [documents and sessions](../guides/documents.md), [themes](../guides/themes.md), or the [TypeScript playground](playground.mdx).
