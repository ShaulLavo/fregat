# @singapore-editor/lsp

A Language Server Protocol client with WebSocket and worker transports.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/lsp
```

## Usage

Run a language server that accepts LSP JSON-RPC over WebSocket at the example URL.

```ts
import { LspClient, createWebSocketLspTransport, offsetToLspPosition } from '@singapore-editor/lsp'

const client = new LspClient({ rootUri: 'file:///project' })
await client.connect(await createWebSocketLspTransport('ws://localhost:3001/lsp'))

const uri = 'file:///project/main.ts'
const text = 'const value = 1\nvalue.toFixed()\n'
await client.notify('textDocument/didOpen', {
  textDocument: { uri, languageId: 'typescript', version: 1, text },
})

const hover = await client.request('textDocument/hover', {
  textDocument: { uri },
  position: offsetToLspPosition(text, 18),
})

await client.shutdown()
```

## API highlights

- `LspClient.connect()` initializes a server connection.
- `request()` sends a request with cancellation and timeout options.
- `createWorkerLspTransport()` connects a worker.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/lsp/overview/)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
