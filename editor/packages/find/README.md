# @singapore-editor/find

Find and replace with regular expressions and case-preserving replacements for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/find
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createEditorFindPlugin } from '@singapore-editor/find'
import '@singapore-editor/core/style.css'
import '@singapore-editor/find/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [createEditorFindPlugin()],
})
editor.setText('const value = 1\n')
```

## API highlights

- `createEditorFindPlugin()` adds the search widget.
- `editor.openFind()` opens search from code.
- `editor.replaceAll()` applies the current replacement.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/find/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add this plugin for find and replace.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
