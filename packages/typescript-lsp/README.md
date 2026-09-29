# @singapore-editor/typescript-lsp

TypeScript language-service plugin for Singapore.

This package wires the generic LSP adapter to a browser worker backed by TypeScript and
`@typescript/vfs`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/typescript-lsp
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createTypeScriptLspPlugin } from '@singapore-editor/typescript-lsp'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [createTypeScriptLspPlugin()],
})
```

## Exports

- `createTypeScriptLspPlugin` registers completion, diagnostics, hover, definition, and reference
  behavior for TypeScript documents.
- `createTypeScriptLspWorkerOwner` exposes the worker owner for custom wiring.
- `summarizeDiagnostics` and `diagnosticHighlightGroups` expose diagnostic helpers.
- `fileNameToDocumentUri`, `documentUriToFileName`, and related path helpers are re-exported.

## Sharing one project across editors

Create one `TypeScriptLspWorkspace` for the project's source files and one
`LspConnectionPool` provider for its root, configuration and compiler options. Pass the same
`workspace` and `connectionProvider` to each document's `createTypeScriptLspPlugin` call.
Each plugin keeps its own navigation and diagnostic callbacks while borrowing the worker.

```ts
import { LspConnectionPool } from '@singapore-editor/lsp-plugin'
import { createTypeScriptLspPlugin, TypeScriptLspWorkspace } from '@singapore-editor/typescript-lsp'

const pool = new LspConnectionPool()
const workspace = new TypeScriptLspWorkspace()
workspace.setWorkspaceFiles(projectFiles)
const connectionProvider = pool.provider(projectIdentity)
const plugin = createTypeScriptLspPlugin({
  workspace,
  connectionProvider,
  rootUri,
  compilerOptions,
})
```

Apply disk changes through the workspace's `upsertWorkspaceFiles` and `deleteWorkspaceFiles`.
A shared connection receives one initial file set, retains updates while any document borrows it,
and receives the current set after reconnecting. Release editor registrations normally and call
`pool.dispose()` when the project's owner ends. Use a new provider identity when compiler options
or canonical paths change so the initialized worker matches its project.
