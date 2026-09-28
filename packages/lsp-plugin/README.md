# @singapore-editor/lsp-plugin

Editor integration layer for LSP-backed Singapore language features.

This package adapts `@singapore-editor/lsp` transports to `@singapore-editor/core` plugins for diagnostics,
completion, hover, definition navigation, references, and document synchronization.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/lsp @singapore-editor/lsp-plugin
```

## Usage

```ts
import { createLanguageServerPlugin } from '@singapore-editor/lsp-plugin'

const plugin = createLanguageServerPlugin({
  webSocketRoute: 'ws://localhost:3000/lsp',
})
```

## Exports

- `createLanguageServerPlugin` connects the editor to a language server or shared document session.
- `createLanguageServerAdapterPlugin` supports custom transport factories and adapter configuration.
- `createWebSocketLspTransportFactory` and `createWorkerLspTransportFactory` create transport
  factories.
- Diagnostic, path, markdown tooltip, completion, and document-sync helpers are available through
  subpath exports.

## Keys

The completion list and the signature hint are driven by editor commands, not by listening to
keys: `editor.action.triggerSuggest` (Ctrl+Space), `selectNextSuggestion`, `selectPrevSuggestion`,
`selectNextPageSuggestion`, `selectPrevPageSuggestion`, `acceptSelectedSuggestion`,
`hideSuggestWidget`, `closeParameterHints`, `showNextParameterHint` and `showPrevParameterHint`.
The core's `suggest` keymap pack binds them under the context keys this plugin registers
(`suggestWidgetVisible`, `parameterHintsVisible`, `parameterHintsMultipleSignatures`). A host that
turns the editor's keymap off, or drops that pack, binds these commands itself or the list cannot
be driven from the keyboard. They are part of `commands`, so `commands: []` registers none of them.

## Document lifetime

The connection-only API owns its document session automatically. Dispose the editor to close it:

```ts
const plugin = createLanguageServerPlugin({
  webSocketRoute: 'ws://localhost:3001/lsp',
})
```

For tabs or split editors, create a session beside the text buffer and pass it to each view:

```ts
import {
  createLanguageServerDocument,
  createLanguageServerPlugin,
} from '@singapore-editor/lsp-plugin'

const document = createLanguageServerDocument({
  buffer,
  uri: 'file:///project/main.ts',
  languageId: 'typescript',
  lanes: [
    {
      id: 'typescript',
      features: { diagnostics: 0, completion: 0, hover: 0, navigation: 0 },
      webSocketRoute: 'ws://localhost:3001/lsp',
    },
  ],
})

const plugin = createLanguageServerPlugin({ document })
```

The session synchronizes buffer changes and receives diagnostics even with no mounted view.
Each view renders the current diagnostics on attachment. Disposing a view unsubscribes it;
it does not close the document. The host calls `document.dispose()` when the document closes.
Multiple views share the session, with independent completion, hover, and selection UI.

Use `documentId` when the editor uses an opaque identity different from the URI. Connection
options and an explicit `document` are mutually exclusive plugin inputs. Both forms use the
same synchronization and diagnostic implementation.

For shared sessions, pass `onApplyWorkspaceEdit` to `createLanguageServerDocument`.
The document uses it both to advertise workspace-edit support during initialization and to
apply edits requested by its views. It cannot be supplied on a plugin borrowing that document.
The connection-only plugin still accepts `onApplyWorkspaceEdit` directly.

### Diagnostic hover actions

`getDiagnosticActions({ documentUri, textVersion, diagnostic })` supplies actions beside each diagnostic note. It is supported by the server, server-set and adapter plugins, including `createTypeScriptLspPlugin`. Return an empty array when no action applies. Each action has a `label` and `run(): void | Promise<void>`.

The tooltip prevents repeated invocation while an action is pending, preserves keyboard focus, and shows a rejected action's message beside its button. Progressive hover replies retain pending actions and their errors. An action refuses to run after its document, text version or diagnostic changes; the user can reopen the hover for a fresh action. The host owns application behavior and async operation state.
