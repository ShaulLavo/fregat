# @singapore-editor/tree-sitter-languages

Bundled Tree-sitter language contributions for Singapore.

The catalog includes JavaScript with JSX, TypeScript, TSX, HTML, CSS, JSON, Markdown and its inline
parser, Astro, Python, shell scripts, Rust, Go, YAML, TOML, C, C++, C#, Java, PHP, Lua, Svelte and SQL.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/tree-sitter @singapore-editor/tree-sitter-languages
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { javaScript, typeScript } from '@singapore-editor/tree-sitter-languages'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [javaScript({ jsx: true }), typeScript({ tsx: true })],
})
```

## Exports

- `javaScript`, `typeScript`, `html`, `css`, `json`, and `markdown` create language plugins.
- `TREE_SITTER_LANGUAGE_CONTRIBUTIONS` exports the bundled contribution list.
- Individual constants such as `JAVASCRIPT_TREE_SITTER_LANGUAGE` expose raw contributions.

## Catalog maintenance

`languages.json` owns parser identities, lazy assets, detection metadata, dependency lists,
query composition, capture mappings and capability status. `src/metadata.ts` is generated and
contains no grammar imports. Import it through `@singapore-editor/tree-sitter-languages/metadata`.
TypeScript uses `.ts`, `.mts` and `.cts`; TSX has its own `tsx` identity. JavaScript retains JSX.
The ambiguous `react` alias is not registered.

```sh
bun run languages:generate
bun run languages:generate -- --check
bun run languages:verify
bun run languages:build -- --check
```

Generation validates all input files before writing outputs. The lock includes npm integrity,
source revisions where published, source and query hashes, parser ABI, emitted WASM hashes and
mapped-query hashes. `NOTICE` retains upstream licenses. npm sources are exact versions. Their
compiler provenance is explicitly unknown when the upstream package does not publish it.
Astro is built from the revision in `languages.json` with tree-sitter 0.27.0 and wasi-sdk 34.
`astro-build.lock.json` records that build's inputs and output; `languages:build -- --check`
rebuilds it and compares the lock. Set `TMPDIR` for build scratch on machines without `/work`.
Updating revisions is an explicit manifest edit, followed by regeneration and verification.

The 23 parser entries include Markdown's internal inline parser. Every entry has a curated
capture fixture and a browser-worker edit comparison. These establish partial support, not
complete language parity. Platform's `bun run syntax:coverage` compares this catalog with its
installed Shiki release and records every canonical ID separately.

### Query policy and patches

Query inheritance is explicit ordered composition in `queries.highlights` and `queries.folds`.
Unexpanded `inherits` directives fail admission. Public captures must map to the palette taxonomy.
`captureMappings` records adaptations such as `module` to `namespace`, `escape` to `string.escape`
and Lua's `parameter` to `variable.parameter`. Capture replacement skips comments and string
literals and preserves private predicate captures. Markdown fence labels carry `text.literal`; the whole block does not override injected colors.
`none` and `embedded` intentionally retain raw
captures without painting over their children.

Astro's local queries add CSS injection and delimiters to the pinned upstream queries. Svelte's
local injection query translates language-named captures to the worker's explicit injection
properties. A style `lang` attribute requests that language, so unavailable SCSS is not parsed as
CSS. Complex Astro expressions, Svelte preprocessors and version-specific syntax remain partial.

The JavaScript injection query omits the upstream Glimmer rule. Its `@glimmer` capture was never
consumed and its `offset!` directive was never evaluated here. Regex and JSDoc remain explicit
unavailable dependencies. Existing JavaScript/TypeScript `is-not? local` predicates are a recorded
legacy gap, not an admitted new semantic feature. New query bundles using unsupported predicates
must not be added to that exception. Ruby and Kotlin have not been admitted for this reason.

SQL is built from DerekStride/tree-sitter-sql at the revision in `languages.json`.
`bun run languages:build:sql` regenerates its parser, WASM, adapted highlight query, notice and
`sql-build.lock.json`; add `-- --check` to reproduce and compare those outputs.
The adaptation replaces Lua numeric patterns with JavaScript regexes, excludes numbers from
string captures, and removes the redundant spell-check marker on comments. `storageclass`
maps to `keyword.storage`. Fixtures cover generic statements and lazy Markdown fences.
Dialect parity, PL/SQL, uppercase exponent literals and SQL folds are not established.

MDX is built from srazzak/tree-sitter-mdx at the pinned revision in `languages.json`.
`WASI_SDK_PATH=/work/cache/tree-sitter/wasi-sdk bun run languages:build:mdx` regenerates the
WASM, adapted query, notice and source lock. Add `-- --check` to compare a reproducible build.
`patches/mdx-inline.patch` permits JSX and expressions inside paragraphs and headings, and fixes
an incorrectly indexed scanner table that read past its bounds during paragraph interruption.
The five upstream corpus cases still pass. Admission checks assert UTF-16 node ranges and final
worker paint for mixed prose, JSX, expressions, nested Markdown and lazy SQL fences.

The highlight adaptation omits both complete locals-dependent builtin-name rules. Those names
retain ordinary variable or call categories, including when shadowed. It adds JSX and comment
captures and paints only fence info strings, leaving embedded code to its injected grammar.
The local injection query uses Markdown inline nodes, Markdown inside JSX text and dynamic fences.
Frontmatter, emphasis spanning JSX/expression boundaries, tagged templates, builtin-name
specialization and folds remain unsupported. MDX support is partial.

### Runtime loading and diagnostics

Sessions load static dependencies from metadata and request missing captured languages after
worker discovery. The registry deduplicates asset loading. Delayed results are checked against
session lifetime and document version. The worker reuses its root tree when new injection assets
arrive. Edits rediscover injections across the document because delimiter changes can invalidate
child layers outside the changed text range. Parsing still uses incremental trees.

Injection recursion stops at eight levels and 256 layers. Equal-language, equal-range ancestor
cycles are rejected; smaller nested ranges may reuse the same language. Unavailable languages
are reported in worker `missingLanguages` and never cause a Shiki fallback.

Worker timings separate root parsing, injected parsing, injection discovery, highlight traversal
with predicates, fold queries, structural walks, capture normalization, sorting, overlap resolution
and packing. Totals such as `queryRange` include these phases and must not be added to them.
Statistics record raw and deduplicated capture counts, layers, requested range and transferred token
buffer bytes. Buffer bytes exclude the small cloned style table and other structural response data.
Worker request wall time includes queueing and transfer; it does not isolate transfer time or paint.

For the optional five-run worker profile:

```sh
bun run --cwd ../tree-sitter test -- --browser.enabled --browser.headless --silent=false --reporter=verbose test/native-profile.browser.test.ts
```
