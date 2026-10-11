# @singapore-editor/core

The browser editor at the core of Singapore, with text editing, selections, undo history, themes, and plugins.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import '@singapore-editor/core/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)
const editor = new Editor(host)
editor.setText('const value = 1\n')
// Call editor.dispose() when removing the view.
```

## Content-height embedding

Use content mode for a code sample or document that scrolls with its page. Give the host its width and leave its height automatic.

Create the view with `new Editor(host, { scrollMode: 'content', wordWrap: true })`, then load the sample with `setText()`.

Content mode paints every display row and grows after edits, font changes, preview replacements and resizing. Caret and search reveal scroll outside ancestors. `setScrollMode('content')` switches an existing view to this layout. `static` keeps its existing all-row layout with horizontal editor scrolling; `virtualized` keeps a bounded window of rows.

Content mode supports up to 10,000 display rows, 1,048,576 UTF-16 source units and 1,000,000 CSS pixels of content height. Exceeding a limit throws an error with code `EDITOR_CONTENT_LAYOUT_LIMIT`. Refused replacements and edits preserve the attached document, selections and undo history. Use `virtualized` for larger documents.

## API highlights

- `Editor.setText()` loads text into a view.
- `openDocument()` gives a document its own identity.
- `dispose()` releases the view and its plugins.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/core/overview/)

## In the Singapore family

Start with `@singapore-editor/core`. Add optional packages for gutters, search, syntax, or language server features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
