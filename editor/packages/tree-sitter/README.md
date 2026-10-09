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

## Merge units

`TreeSitterWorkerOwner.mergeUnit()` queries an already-parsed snapshot using its document ID,
runtime session ID, snapshot version, language ID and UTF-16 range. It returns `status: 'ok'`
with the smallest enclosing syntax unit, its source-spelling signature and its parent's range
and commutativity flag. A retired or unavailable snapshot returns `status: 'stale'` and
`unit: null`.

Language contributions supply `mergeUnitQuerySource`. Queries capture `@merge.unit`,
`@merge.signature` and `@merge.commutative`. An optional repeated `@_merge.member` capture
limits commutativity to parents whose named semantic children all match that pattern. Comments
leave eligibility unchanged. The worker compiles this query only when requested. Languages
without a query, unmatched ranges and units with syntax errors use the enclosing complete
lines with `source: 'line'`. Fallback includes requested line separators and keeps CRLF together.

Named JavaScript imports use the local alias as their signature when present. Go field names
are individual units whose parent range identifies the owning declaration, including grouped
fields. Ordered parents expose source-name hints; duplicate-signature comparisons apply to
commutative parents. JavaScript class bodies and objects, Go and Rust field lists, and
TypeScript interfaces containing methods or call signatures stay ordered. Property-only
TypeScript interfaces and JSON objects allow unordered children.

Generic languages reuse their retained parse. Markdown creates a structural block tree on
its first merge-unit request because its native renderer keeps its tree private. Injected
code uses the deepest containing registered language's query. Successful results retain
that selected language ID, including line fallback.

## In the Singapore family

`@singapore-editor/core` owns the editor view. This optional package adds syntax parsing. Choose the other plugins your app needs.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://shaulavo.dev/singapore/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
