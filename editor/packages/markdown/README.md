# @singapore-editor/markdown

Markdown preview and editing commands for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/markdown @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages
```

## Usage

```ts
import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core/editor'
import { markdown } from '@singapore-editor/tree-sitter-languages'
import {
  createMarkdownAuthoringPlugin,
  createMarkdownPreviewPlugin,
} from '@singapore-editor/markdown'
import '@singapore-editor/markdown/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [markdown(), createMarkdownPreviewPlugin(), createMarkdownAuthoringPlugin()],
})
editor.openDocument({
  documentId: 'notes.md',
  text: '# Notes\n\nsome **bold** text\n',
  languageId: 'markdown',
})
```

## API highlights

- `createMarkdownPreviewPlugin()` renders formatted Markdown over the source.
- `createMarkdownAuthoringPlugin()` adds editing commands.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/markdown/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. This optional package adds Markdown display and commands. Choose the other plugins your app needs.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
