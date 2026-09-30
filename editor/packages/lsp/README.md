# @singapore-editor/lsp

Runtime-neutral LSP client primitives for Singapore packages.

This package is the low-level transport and protocol layer. Use `@singapore-editor/lsp-plugin` when you want
an editor plugin that connects these primitives to `@singapore-editor/core`.

## Install

```sh
npm install @singapore-editor/lsp
```

## Usage

```ts
import { LspClient, createWebSocketLspTransport } from '@singapore-editor/lsp'
```

## Exports

- `LspClient` manages request, response, notification, and workspace synchronization state.
- `createWebSocketLspTransport` and `createWorkerLspTransport` create managed transports.
- Position helpers convert between editor offsets and LSP positions.
- Protocol error helpers expose LSP response and cancellation errors.
- `lsp` re-exports `vscode-languageserver-protocol` types.
