# @singapore-editor/lsp-plugin

connects a language server to the editor. you get diagnostics, completion, hover, signature help, go to definition, references, rename, code actions, formatting and document highlights, whatever the server supports

it keeps the open document in sync with the server as you type. the protocol client underneath is [`@singapore-editor/lsp`](../lsp/)

## try it

```sh
npm install @singapore-editor/core @singapore-editor/lsp @singapore-editor/lsp-plugin
```

point it at a websocket that speaks lsp json-rpc

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createLanguageServerPlugin } from '@singapore-editor/lsp-plugin'
import '@singapore-editor/core/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
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

the `documentId` becomes the document's uri, here `file:///project/main.ts`. disposing the editor closes the document on the server

follow what the server is doing with `onStatusChange` and `onDiagnostics`. jumps to other files go to your `onOpenDefinition` and `onOpenReferences`, and edits that span files go to `onApplyWorkspaceEdit`

## more than one server

`createLanguageServerSetPlugin({ lanes })` runs several servers on one document. each lane lists the features it serves with a rank. lower ranks go first, and a lane only gets a feature its server supports

```ts
import {
  allLanguageServerFeatures,
  createLanguageServerSetPlugin,
} from '@singapore-editor/lsp-plugin'

const plugin = createLanguageServerSetPlugin({
  lanes: [
    {
      id: 'typescript',
      features: allLanguageServerFeatures(),
      webSocketRoute: 'ws://localhost:3001/ts',
    },
    {
      id: 'eslint',
      features: { diagnostics: 0, codeActions: 1 },
      webSocketRoute: 'ws://localhost:3001/eslint',
    },
  ],
})
```

## more

- [shared documents](docs/shared-documents.md), one server session for tabs and split views, and who disposes it
- [keyboard](docs/keyboard.md), the commands that drive the completion list and signature hints
- [diagnostic actions](docs/diagnostic-actions.md), buttons beside each diagnostic in the hover
- `LspConnectionPool` lets editors share one connection per project so switching files skips the handshake
- subpath exports (`./diagnostics`, `./paths`, `./completion`, `./document-sync`, `./workspace-edit` and more) expose the pieces for hosts that build their own ui
- [`@singapore-editor/typescript-lsp`](../typescript-lsp/), this plugin wired to typescript in a worker
