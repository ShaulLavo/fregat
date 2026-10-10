# @singapore-editor/decode

Text reveal animations for documents opened in the Singapore editor.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/decode
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createDecodePlugin } from '@singapore-editor/decode'
import '@singapore-editor/core/style.css'
import '@singapore-editor/decode/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [createDecodePlugin({ mode: 'parallel' })],
})
editor.openDocument({
  documentId: 'example.ts',
  text: 'const value = 1;\n',
  languageId: 'typescript',
})
```

## API highlights

- `createDecodePlugin()` adds a reveal animation.
- `mode` selects line, parallel, token, or diffusion reveals.
- `maxDurationMs` caps the animation duration.
- `createMorphPlugin()` animates text changes: text that survives an edit slides to its new place, removed text fades out, and new text streams in. Undo, redo and large edits morph; typing stays instant.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/decode/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add this plugin to animate newly opened documents.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
