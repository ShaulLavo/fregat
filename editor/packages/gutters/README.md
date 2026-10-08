# @singapore-editor/gutters

Line numbers and fold controls for the Singapore editor.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/gutters
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createFoldGutterPlugin, createLineGutterPlugin } from '@singapore-editor/gutters'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [createLineGutterPlugin(), createFoldGutterPlugin()],
})
editor.setText('const value = 1\n')
```

## API highlights

- `createLineGutterPlugin()` adds line numbers.
- `createFoldGutterPlugin()` adds fold controls.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/gutters/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add these plugins for line numbers and fold controls.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
