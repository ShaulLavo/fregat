# @singapore-editor/tree-sitter

Worker-based Tree-sitter parsing for Singapore syntax colors, folds, and brackets.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages
```

## Usage

```ts
import '@singapore-editor/core/style.css'
import { Editor } from '@singapore-editor/core/editor'
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [createTreeSitterLanguagePlugin(TREE_SITTER_LANGUAGE_CONTRIBUTIONS)],
})
editor.setText('const value = 1\n', { languageId: 'typescript' })
```

## API highlights

- `createTreeSitterLanguagePlugin()` installs language contributions.
- `createTreeSitterSyntaxProvider()` registers custom grammars.
- `expandTreeSitterSelection()` selects a larger syntax node.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/tree-sitter/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. This optional package adds syntax parsing. Choose the other plugins your app needs.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://shaulavo.dev/singapore/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
