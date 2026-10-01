# @singapore-editor/tree-sitter-languages

the bundled tree-sitter grammars for [`@singapore-editor/tree-sitter`](../tree-sitter/), with their highlight, fold and injection queries

23 languages: javascript (with jsx), typescript, tsx, html, css, json, markdown, mdx, astro, svelte, python, shell, rust, go, c, c++, c#, java, php, lua, sql, yaml and toml. each one loads its wasm and queries the first time a document needs it

## try it

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages
```

pick a few

```ts
import { Editor } from '@singapore-editor/core/editor'
import { css, html, typeScript } from '@singapore-editor/tree-sitter-languages'

const editor = new Editor(element, {
  plugins: [typeScript(), html(), css()],
})
```

`javaScript`, `typeScript`, `html`, `css`, `json` and `markdown` each return an editor plugin. `typeScript({ tsx: true })` covers `.tsx` files and `javaScript({ jsx: true })` adds `.jsx`. for everything at once, hand `TREE_SITTER_LANGUAGE_CONTRIBUTIONS` to `createTreeSitterLanguagePlugin` from `@singapore-editor/tree-sitter`

`@singapore-editor/tree-sitter-languages/metadata` lists every language's id, extensions, aliases and capability status, and imports no grammars

## more

- [catalog maintenance](docs/catalog.md): regenerating, query policy, per-language patches, worker loading
- `languages.json` is the manifest. `bun run languages:verify` checks generated output against it

grammars come from their upstream projects. their licenses are in [NOTICE](NOTICE). the astro, mdx and sql licenses also sit in [notices/](notices/)
