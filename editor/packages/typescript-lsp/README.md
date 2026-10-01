# @singapore-editor/typescript-lsp

typescript and javascript language features for the editor, all in the browser. the real typescript language service runs in a web worker and talks lsp to [`@singapore-editor/lsp-plugin`](../lsp-plugin/)

you get diagnostics, completion, hover, signature help, go to definition, references, rename, code actions and formatting. the standard library `.d.ts` files ship with the package

## try it

```sh
npm install @singapore-editor/core @singapore-editor/typescript-lsp
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createTypeScriptLspPlugin } from '@singapore-editor/typescript-lsp'
import '@singapore-editor/core/style.css'

const typescript = createTypeScriptLspPlugin()
const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [typescript],
})

typescript.setWorkspaceFiles([
  { path: '/src/math.ts', text: 'export const add = (a: number, b: number) => a + b\n' },
])

editor.openDocument({
  documentId: '/src/main.ts',
  text: "import { add } from './math'\n\nadd(1, '2')\n",
  languageId: 'typescript',
})
```

the worker sees the open document plus whatever you hand `setWorkspaceFiles`, so imports resolve and `'2'` gets a red squiggle. update files with `upsertWorkspaceFiles` and `deleteWorkspaceFiles`

`compilerOptions` sets the compiler options. `onDiagnostics`, `onOpenDefinition` and `onApplyWorkspaceEdit` hand counts, cross-file jumps and multi-file edits to your app

## more

- [one project, many editors](docs/shared-project.md), sharing one worker and file set across tabs
- `@singapore-editor/typescript-lsp/server`, `createTypeScriptLspServerSession({ send })` runs the same worker behind your own socket
- `@singapore-editor/typescript-lsp/ts-diagnostics`, converts typescript diagnostics to lsp ones
- `createTypeScriptLspWorkerOwner` for hosts that start and watch the worker themselves
- [`@singapore-editor/lsp-plugin`](../lsp-plugin/), the generic plugin this one configures
