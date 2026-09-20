# Native syntax implementation, 2026-09-20

This is an implementation increment of `native-syntax-coverage-plan.md`, not completion of its
full-catalog research pass. The inventory contains 242 canonical Shiki 4.4.3 IDs: 24 partial native
mappings, 218 candidates and no external blockers. Plain text and ANSI are accounted for separately.
No entry claims full TextMate parity.

## Delivered

- Editor's checked-in manifest generates lazy contributions and asset-free detection metadata.
  Source locks record npm integrity, revisions where available, parser ABI, input and emitted asset
  hashes, transformed query hashes and notices. Astro has a reproducible source-build lock.
- TypeScript and TSX have separate identities and parsers. Detection prioritizes explicit IDs,
  exact filenames, longest extensions and supported shebangs. JSX stays supported; `react` is removed.
- Astro and Svelte inject TypeScript and CSS. Style `lang` attributes request their own language;
  unsupported preprocessors remain unavailable. Markdown fences load catalog languages on demand.
- Delayed language loading is deduplicated and checked against session lifetime and document
  version. The worker reuses its root tree when injection assets arrive. Injection traversal allows
  eight levels, caps layers at 256 and rejects equal-language/equal-range ancestor cycles.
- The catalog adds Python, shell scripts, Rust, Go, YAML, TOML, C, C++, C#, Java, PHP and Lua.
  Every shipped grammar passes query compilation, capture admission, curated categories, malformed
  source parsing and a real browser-worker edit comparison. Folding and injections remain separate
  capability fields; missing capabilities do not inflate a verified-language count.
- Queries map upstream capture names explicitly. Existing JavaScript local-scope predicates remain
  a documented partial-support gap. New grammars with unsupported predicates remain candidates pending runtime support or tested query adaptation.
- Worker diagnostics separate parsing, injection discovery, traversal with predicates, structural
  extraction, normalization, sorting, overlap resolution and packing. Statistics include raw and
  deduplicated captures, layers, requested range and transferred token-buffer bytes.
- Markdown colors fence labels without painting the entire fence as a string. Embedded comments
  and keywords retain their own styles; full and range worker tests check the painted comment token.
- Duplicate TypeScript highlight and fold rules are removed. Thirty before/after corpus comparisons
  produced identical normalized captures.

## Correctness and measurements

A real worker edit test exposed stale CSS tokens after removing an Astro `</style>` delimiter inside
Markdown. Injection discovery now rechecks the document after edits; parser trees remain incremental.
This deliberately favors correctness until narrower invalidation has a proof for ancestor-sensitive
injections. Tests cover delayed loads after closure, superseded versions, Unicode, CRLF, injection
creation and removal, text-only predicate changes and unsupported preprocessors.

The optional worker profile uses 850 generated TypeScript lines, a 5,000-character query range,
five fresh workers and 20 token-changing edits per worker. Before removing duplicates, median
highlight traversal with predicates was 1.2 ms, structural extraction 0.9 ms and total range queries
3.0 ms. After removing duplicates, the highlight and total medians stayed at 1.2 ms and 3.0 ms.
The p95 total changed from 7.5 to 5.4 ms, but this single ordered comparison does not establish a
speedup beyond machine variance. No latency improvement is claimed.

## Remaining work

- Evaluate and admit the remaining 218 candidates. Most only have discovery evidence; builds,
  query adaptation and runtime support are implementation work, not external blockers.
- Swift, Vue, SCSS and GraphQL await builds and query integration.
  MDX frontmatter and cross-expression emphasis remain partial-coverage work. Ruby locals and Kotlin pattern
  matching are deferred. Broaden Astro expressions and Svelte/preprocessor coverage.
- Complete compiler provenance for upstream prebuilt WASM, rebuild all accepted parsers from source,
  and add generated query-source updates with per-language coverage diffs.
- Add further language-specific folds and structural fixtures. Continue explicit expected-category
  coverage rather than treating incremental/fresh equivalence alone as correctness.
- Complete the wider performance matrix: five alternating native/Shiki runs, early and settled
  controls, long lines, large pastes, mixed languages, retained WASM memory and production asset size.
  Transfer wall time and application/paint are not yet independently instrumented.

The development API on port 3001 was unavailable. Browser integration uses the existing mesh build;
no development service was started or restarted. The benchmark now handles production blob workers,
trusted-origin settings requests and theme-bundle overrides in its isolated browser context.

## Verification record

The final web release is `20260920T095002Z-f7a5257b-native-syntax-coverage`.
The server process was reused. Browser scenarios passed for Astro in both palettes and Markdown
containing Astro and Python fences; screenshots were read back. Registration logs show only
requested dependencies, and no Shiki requests.

[Evidence and check results](/work/tmp/fregat-evidence/native-syntax-coverage-20260920/summary.md)
include the before/after trace, five-run worker samples, capture-equivalence results and build logs.
The focused suites passed 185 tests. Runtime and web typechecks pass; the language package's full
test-source typecheck encounters the existing `packages/editor/src/editor/indentationGuess.ts:83`
possibly-undefined indexed value. Its distributable builds successfully.

## Generic SQL increment

Generic SQL now uses DerekStride/tree-sitter-sql at
`97614d051eebfd3bc5d97c0bdb5a1638719ca811`, compiled with Tree-sitter 0.26.13 and wasi-sdk 29.
The source build records archive, parser, query, license and WASM hashes in `sql-build.lock.json`.
A second build reproduced every output byte. The WASM is about 11 MB before transport compression
and loads only when SQL is requested. No startup or latency improvement is claimed.

The generated query replaces upstream Lua numeric predicates with JavaScript regexes and keeps
numeric and string captures mutually exclusive. Curated token assertions cover CTEs, SELECT/JOIN,
DDL, quoted identifiers, comments, signed and decimal numbers, lowercase exponents and quoted
numeric strings. Real browser workers compare incremental and fresh output after string delimiter
edits, Unicode replacement, JOIN changes, fence language changes and fence removal, in full and
range modes. The document fixture also checks the normal CRLF ingestion path.

SQL remains partial. Dialect parity, PL/SQL, uppercase exponent literals and SQL folds are not
established. The subsequent MDX increment follows below.

The increment passed 52 language admission checks and 30 browser-worker checks. The source build,
generated-file check, package build, Tree-sitter typecheck and web typecheck passed. The language
package's test-source typecheck still reports the existing `indentationGuess.ts:83` error.

Release `20260920T101706Z-6e04e664-native-sql` serves this increment; the server process was reused.
[SQL admission evidence](/work/tmp/fregat-evidence/native-sql-admission-20260920/summary.md)
records the browser checks and screenshots for standalone SQL and Markdown fences in both palettes.

## MDX increment

MDX now uses srazzak/tree-sitter-mdx at `3aa29e8de1bf0213948a04fe953039b6ab73777b`,
compiled with Tree-sitter 0.26.13 and wasi-sdk 29. A checked-in patch lets paragraph and heading
content contain JSX and expressions. It also replaces the scanner's positional paragraph-interruption
table with named token indices. The upstream table omitted JavaScript token slots and read beyond
its bounds. WASM consequently ended a fence early and swallowed the JSX following its closing fence,
even though the native CLI parsed the same fixture correctly and neither reported a parse error.

The source build records the archive, patch, generated parser, scanner, upstream and adapted queries,
license and WASM hashes. Rebuilding reproduced all outputs byte for byte. The WASM is about 939 KiB
uncompressed and loads on request. No performance improvement is claimed.

The adapted query adds JSX tags, attributes and comments, and limits fence string coloring to the
info string. Both complete locals-dependent builtin-name specializations are omitted; identifiers
keep ordinary variable or call categories, including when shadowed. No unsupported predicate is
silently removed while retaining its specialized capture. Markdown text nodes and JSX text receive
separate Markdown injections; fence languages load dynamically. Consecutive prose lines stay in
one inline injection so multiline emphasis retains its style.

Curated assertions cover imports, strings, heading expressions, inline JSX, properties, bold and multiline text,
code spans, nested Markdown, mapped JSX, SQL fence colors and JSX comments. Parser tests check
parent nodes and UTF-16 ranges, including Unicode and CRLF. Real Chromium workers check standalone
MDX and MDX inside Markdown, in full and range modes, with a nested SQL fence. Thirteen edits per
case compare captures, painted tokens, injections and folds with a fresh parse. They cover brace
and tag removal/restoration, Unicode, strings, fence language changes and fence removal.

Screenshot review also caught Markdown preview hiding heading and emphasis markers inside an
MDX fence. Preview now excludes captures inside the retained fence-content ranges, while syntax
highlighting still consumes those captures. Real worker results verify that fenced MDX produces
no preview replacements; the existing Markdown replacement suite keeps ordinary preview covered.

The five upstream corpus tests, 58 focused language checks, 34 browser-worker checks and 13
Markdown replacement checks pass.
The reproducible source build, generated-file check, distributable build, runtime and Markdown typechecks, and
web typecheck pass. The language test-source typecheck still reports the existing
`indentationGuess.ts:83` error. Frontmatter injection, emphasis spanning expressions or JSX,
JavaScript injections, builtin-name specialization and folds remain unsupported. The inventory
now records 24 partial mappings and 218 candidates.

Release `20260920T103700Z-43d3ac17-native-mdx` serves the increment and the Markdown preview fix.
The server process was reused. [MDX admission evidence](/work/tmp/fregat-evidence/native-mdx-admission-20260920/summary.md)
records both palette checks, inspected screenshots, lazy registrations and the deployment check.
