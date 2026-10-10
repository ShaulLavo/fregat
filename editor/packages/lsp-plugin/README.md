# @singapore-editor/lsp-plugin

Language server diagnostics, completion, hover, and navigation for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/lsp-plugin
```

## Usage

Run a language server that accepts LSP JSON-RPC over WebSocket at the example URL.

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createLanguageServerPlugin } from '@singapore-editor/lsp-plugin'
import '@singapore-editor/core/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [
    createLanguageServerPlugin({
      webSocketRoute: 'ws://localhost:3001/lsp',
      rootUri: 'file:///project',
    }),
  ],
})

editor.openDocument({
  documentId: '/project/main.ts',
  text: 'const value: number = "one"\n',
  languageId: 'typescript',
})
```

## API highlights

- `createLanguageServerPlugin()` connects one server.
- `createLanguageServerSetPlugin()` assigns features to several servers.
- `onApplyWorkspaceEdit` sends cross-file edits to your app.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/lsp-plugin/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add this plugin to connect the view to a language server.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
