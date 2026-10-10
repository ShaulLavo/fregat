# @singapore-editor/typescript-lsp

TypeScript and JavaScript language services in a browser worker for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/typescript-lsp
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createTypeScriptLspPlugin } from '@singapore-editor/typescript-lsp'
import '@singapore-editor/core/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const typescript = createTypeScriptLspPlugin()
const editor = new Editor(host, {
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

## API highlights

- `createTypeScriptLspPlugin()` connects the worker language service.
- `setWorkspaceFiles()` supplies imported files.
- `upsertWorkspaceFiles()` updates those files.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/typescript-lsp/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add this plugin for TypeScript and JavaScript language features.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://singapore.shaulavo.dev/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
