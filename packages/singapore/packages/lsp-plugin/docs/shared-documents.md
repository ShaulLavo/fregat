# shared documents

the connection-only plugin owns its document session. dispose the editor to close it:

```ts
const plugin = createLanguageServerPlugin({
  webSocketRoute: 'ws://localhost:3001/lsp',
})
```

for tabs or split editors, create a session beside the text buffer and pass it to each view:

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

the session syncs buffer changes and receives diagnostics even with no view mounted. each view renders the current diagnostics when it attaches. disposing a view unsubscribes it and leaves the document open. the host calls `document.dispose()` when the document closes. views that share a session each keep their own completion, hover and selection ui

pass `documentId` when the editor uses an opaque identity different from the uri. connection options and an explicit `document` are mutually exclusive plugin inputs. both forms use the same sync and diagnostics code

## workspace edits

for shared sessions, pass `onApplyWorkspaceEdit` to `createLanguageServerDocument`. the document uses it to advertise workspace-edit support during `initialize` and to apply edits its views request. a plugin borrowing that document cannot supply its own. the connection-only plugin takes `onApplyWorkspaceEdit` directly
