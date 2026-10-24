# Language servers

Connect a language server for diagnostics, completion, hover and the features it supports. Syntax highlighting is a separate plugin.

## 1. Connect a WebSocket server

You need a server endpoint that carries LSP JSON-RPC messages. The example assumes your application hosts that endpoint at the shown local URL.

```sh
npm install @singapore-editor/core @singapore-editor/lsp @singapore-editor/lsp-plugin
```

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

The document id maps to `file:///project/main.ts`. Use a secure WebSocket endpoint when serving the application over HTTPS.

## 2. Handle host actions

Use `onOpenDefinition` and `onOpenReferences` to open files in your application. Use `onApplyWorkspaceEdit` for edits spanning files. The server's capabilities determine which features are available. The plugin can expose diagnostics, completion, hover, signature help, definition, references, rename, code actions, formatting and document highlights.

## 3. Run TypeScript in a worker

`@singapore-editor/typescript-lsp` runs the TypeScript language service in the browser and supplies its standard-library declarations. Pass the other virtual files so imports resolve.

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createTypeScriptLspPlugin } from '@singapore-editor/typescript-lsp'

const typescript = createTypeScriptLspPlugin()
typescript.setWorkspaceFiles([{ path: '/src/math.ts', text: 'export const answer = 42\n' }])
const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [typescript],
})
editor.openDocument({
  documentId: '/src/main.ts',
  text: "import { answer } from './math'\nconsole.log(answer)\n",
  languageId: 'typescript',
})
```

`upsertWorkspaceFiles` and `deleteWorkspaceFiles` update that file set. Types for external imports must be available to the worker's project.

## If it doesn't work

### Completion and hover are absent

Check the connection status and server capabilities. Inspect worker or WebSocket failures. Confirm that the document language and URI match what the server expects.

### Imports are unresolved in the TypeScript worker

Add the referenced virtual files and declarations, using consistent paths. The worker sees the open document and files you supply.

Continue with the TypeScript playground and the generated `lsp`, `lsp-plugin` and `typescript-lsp` reference groups.
