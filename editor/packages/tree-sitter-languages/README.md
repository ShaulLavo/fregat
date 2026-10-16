# @singapore-editor/tree-sitter-languages

Tree-sitter grammars and syntax queries for Singapore language plugins.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Runtime requirements

Tree-sitter and native Markdown parsing require Chromium 144, Firefox 145, Safari 26.2, or newer. Parser tests and direct calls require Node.js 26.0.0 or Bun 1.2.22 or newer. These floors follow `WebAssembly.Memory.prototype.toResizableBuffer()` support.

Repository checks use the pinned Bun version and Node 26. Vitest's Node shebang and explicit `node` commands select Node from `PATH`, including when a package script starts with `bun run`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter-languages
```

## Usage

```ts
import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core/editor'
import { css, html, typeScript } from '@singapore-editor/tree-sitter-languages'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [typeScript(), html(), css()],
})
editor.setText('const value = 1\n', { languageId: 'typescript' })
```

## API highlights

- `typeScript()` installs TypeScript syntax.
- `TREE_SITTER_LANGUAGE_CONTRIBUTIONS` contains the bundled language set.
- The `/metadata` entry lists language IDs and file extensions.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/tree-sitter-languages/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. This optional package adds language grammars. Choose the other plugins your app needs.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://singapore.shaulavo.dev/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
Grammar licenses are listed in [NOTICE](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/tree-sitter-languages/NOTICE).
