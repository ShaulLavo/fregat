# @singapore-editor/file-animation

File transition and file edit animations for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

Not on npm yet. Build it from source with the [development guide](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/docs/development.md#set-up).

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import {
  createFileEditAnimationPlugin,
  createFileTransitionPlugin,
} from '@singapore-editor/file-animation'
import '@singapore-editor/core/style.css'
import '@singapore-editor/file-animation/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [createFileTransitionPlugin(), createFileEditAnimationPlugin()],
})
editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

## API highlights

- `createFileTransitionPlugin()` animates a file as it opens. The `mode` option picks `autoregressive` (the default), `parallel`, `token`, `diffusion`, or `magicMove`, which slides the text two files share from the previous file to the new one.
- `createFileEditAnimationPlugin()` animates every edit except typing.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/file-animation/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add these plugins to animate opened files and edits.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/packages/singapore/LICENSE)
