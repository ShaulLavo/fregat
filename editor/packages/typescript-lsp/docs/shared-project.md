# one project, many editors

create one `TypeScriptLspWorkspace` for the project's source files and one `LspConnectionPool` provider for its root, configuration and compiler options. pass the same `workspace` and `connectionProvider` to each document's `createTypeScriptLspPlugin` call. each plugin keeps its own navigation and diagnostic callbacks while borrowing the worker

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

apply disk changes through the workspace's `upsertWorkspaceFiles` and `deleteWorkspaceFiles`. a shared connection receives one initial file set, keeps receiving updates while any document borrows it, and gets the current set again after reconnecting

release editor registrations as usual and call `pool.dispose()` when the project's owner ends. use a new provider identity when compiler options or canonical paths change, so the worker you get was initialized for that project
