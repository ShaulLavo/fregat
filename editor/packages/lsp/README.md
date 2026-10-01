# @singapore-editor/lsp

a small language server client. it speaks json-rpc over a websocket or a web worker, runs the `initialize` handshake, matches requests to responses, and keeps open documents in sync

it runs in the browser, a worker or bun. [`@singapore-editor/lsp-plugin`](../lsp-plugin/) turns it into editor features

## try it

```sh
npm install @singapore-editor/lsp
```

connect, open a file, ask for a hover

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

`connect` resolves once the server answers `initialize`. after that `client.serverCapabilities` says what it supports

requests time out after 3 s. pass `{ timeoutMs, signal }` as the third argument to `request` to change that or to cancel. aborting sends `$/cancelRequest`

a server in a worker works the same way: `client.connect(createWorkerLspTransport(worker))`

## more

- `@singapore-editor/lsp/positions`, offset and position conversion over strings or line-start snapshots, plus `didChange` content changes from text edits
- `@singapore-editor/lsp/types`, the transport, document and workspace types
- `lsp` re-exports the `vscode-languageserver-protocol` types, so `lsp.Hover` and friends come from this package
- [`@singapore-editor/lsp-plugin`](../lsp-plugin/), diagnostics, completion, hover and navigation in the editor
- [`@singapore-editor/typescript-lsp`](../typescript-lsp/), typescript in a worker, no server needed
