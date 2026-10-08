# @singapore-editor/core

The browser editor at the core of Singapore, with text editing, selections, undo history, themes, and plugins.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

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

## API highlights

- `Editor.setText()` loads text into a view.
- `openDocument()` gives a document its own identity.
- `dispose()` releases the view and its plugins.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/core/overview/)

## In the Singapore family

Start with `@singapore-editor/core`. Add optional packages for gutters, search, syntax, or language server features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
