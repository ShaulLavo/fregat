# Native syntax implementation, 2026-09-20

This is an implementation increment of `native-syntax-coverage-plan.md`, not completion of its
full-catalog research pass. The inventory contains 242 canonical Shiki 4.4.3 IDs: 22 partial native
mappings, 212 candidates and 8 documented blockers. Plain text and ANSI are accounted for separately.
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
  a documented partial-support gap. New grammars with unsupported predicates are blocked.
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

- Evaluate and admit the remaining 212 candidates. Discovery records a pinned Helix grammar source
  where one matches; this is not a query, build or fixture evaluation.
- Resolve the eight recorded blockers, especially lexical locals, Kotlin's Lua predicates,
  grammar builds and missing query bundles. Broaden Astro expressions and Svelte/preprocessor coverage.
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
