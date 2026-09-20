# Expand native syntax coverage and improve queries

Status: implementation in progress, 2026-09-20. The generated catalog, TS/TSX split, Astro, dynamic injection loading and initial language batches are implemented. The complete Shiki inventory is in [native-syntax-coverage.md](native-syntax-coverage.md). Full-catalog admission and the remaining verification work are not complete. See [implementation notes](native-syntax-implementation.md).

Keep built-in palettes on Tree-sitter. Extend the existing native provider to as many Shiki languages as available grammars and verified queries allow. Improve both query accuracy and the cost of producing highlights from trees we already maintain.

The target is complete accounting for Shiki's catalog, followed by the largest verified native subset. Literal coverage of every language remains an open research task. Shiki distributes TextMate grammars; those are not interchangeable with Tree-sitter parsers and queries. [Shiki language catalog](https://shiki.style/languages), [Tree-sitter highlighting model](https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html).

## Preserve the native path

Opening `Component.astro` with a built-in palette must load the Astro grammar and required embedded languages into the existing Tree-sitter provider. The same trees serve structural features and highlighting. Switching built-in palettes recolors existing token categories without reparsing.

A Markdown fence can request another native language on demand. Adding hundreds of catalog entries must not load hundreds of grammars when a file opens. Unsupported languages retain the existing unavailable-language behavior; they do not silently start Shiki.

This plan covers language recognition, highlighting, embedded languages, query quality, and performance. Report folding and structural capabilities separately. Language-server completion and diagnostics, arbitrary TextMate theme conversion, and changes to the user-selected Shiki path are separate work.

## Starting point

The installed Shiki 4.4.3 catalog contains **242 canonical language IDs**. Platform's editor currently exposes 53 Shiki loaders. The native package provides JavaScript with JSX, TypeScript with TSX, HTML, CSS, JSON, and Markdown with an inline parser. Seven native contributions do not mean seven equivalent Shiki languages: variants and internal parsers require explicit mapping.

Regenerate the Shiki count from `apps/web`:

```sh
bun -e 'import { bundledLanguagesInfo } from "shiki/langs"; console.log(bundledLanguagesInfo.length)'
```

Current ownership:

| Concern                                             | Existing location                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Native language contributions and queries           | Editor: `packages/tree-sitter-languages/src/index.ts`, `src/queries/`             |
| Lazy descriptor registry                            | Editor: `packages/tree-sitter/src/treeSitter/registry.ts`                         |
| Document sessions and static injection loading      | Editor: `packages/tree-sitter/src/session.ts`                                     |
| Parse, query, injection layers, and token transport | Editor: `packages/tree-sitter/src/treeSitter/treeSitter.worker.ts`                |
| Capture styles and overlap resolution               | Editor: `packages/editor/src/syntax/captures.ts`                                  |
| Theme-to-engine selection                           | Platform: `apps/web/src/features/editor/state/syntax-highlighting.ts`             |
| File recognition and Shiki mapping                  | Platform: `apps/web/src/features/editor/utils/file-path.ts`, `shiki-languages.ts` |
| Structural provider alongside Shiki                 | Platform: `apps/web/src/features/editor/utils/plugins.ts`, `prepared-document.ts` |
| Browser benchmark                                   | Platform: `scripts/agent/scenarios/editor-syntax-benchmark.ts`                    |

Editor is the repository at `/work/projects/Editor`. Platform's `packages/editor-*` paths link into it. Make shared parser and query changes in Editor, then verify their integration in Platform.

### Measured baseline

Three fresh-browser runs per engine and file, with 20 whitespace edits per run, produced these medians:

| TypeScript file         | Native first edit | Shiki first edit | Native later edits | Shiki later edits |
| ----------------------- | ----------------: | ---------------: | -----------------: | ----------------: |
| 163 lines, 5,354 bytes  |            3.8 ms |         290.6 ms |             2.1 ms |            2.2 ms |
| 851 lines, 36,495 bytes |            7.7 ms |         232.6 ms |             5.7 ms |            3.1 ms |

These are worker cycles, including the ensuing viewport query. They exclude pre-dispatch delay and paint. Tree-sitter remains active under Shiki. The two engines run concurrently, so their durations are not added.

On the larger file, native `queryRange` took about 5.1 ms, versus 2.4 ms with highlighting disabled. This operation also includes structural extraction, capture normalization, sorting, overlap resolution, and packing. The difference is the cost of the highlight-enabled path, not a measurement of query traversal alone.

Waiting two seconds before editing reduced Shiki's first cycle to 5.4 ms. Its 53 preloaded grammar modules accounted for about 7.08 MB of decoded development JavaScript. That is not production download size or retained memory. These results support avoiding another runtime and its startup work; they do not establish a universal native speed advantage.

Measurements used the Vite development server, Headless Chrome 153 with SwiftShader, and an i7-14700K. Only two TypeScript files and whitespace edits were measured. Preserve these controls, then add representative edits and mixed languages before setting performance budgets. Full evidence: [benchmark report](/work/tmp/fregat-evidence/syntax-comparison/summary.md).

## Build a catalog behind the existing provider

Use a checked-in manifest and reproducible asset generation in `Editor/packages/tree-sitter-languages`. Generate the existing `TREE_SITTER_LANGUAGE_CONTRIBUTIONS` interface with lazy loaders. Keep file-detection metadata importable without importing grammar assets.

Each manifest entry records canonical identity, aliases, extensions, exact filenames, parser source revision, query sources, injection dependencies, and tested capabilities. Pin grammar and query sources independently. Retain source hashes, license notices, compiler versions, parser ABI, and emitted WASM hashes in the build lock artifact.

Use upstream grammar repositories and maintained query collections as build inputs. Start with the grammar's own queries and compare suitable Helix bundles. Helix already records grammar revisions and query sources; it does not become a runtime dependency. Its language-server commands and configuration are outside the import boundary. [Helix language contribution guide](https://docs.helix-editor.com/guides/adding_languages.html).

A proposed maintenance interface, to implement in phase 1:

```sh
# In Editor/packages/tree-sitter-languages:
bun run languages:generate
bun run languages:verify
bun run languages:generate -- --check
```

Generation reads pinned inputs. Updating upstream revisions is a separate, explicit operation. Verification builds the selected parsers, checks query compatibility, and runs fixtures. The check mode fails on stale generated files. A failed build must not publish a partial catalog.

Platform generates a comparison report against its installed Shiki version. Editor's reusable catalog does not depend on Shiki at runtime. The report records one row per canonical Shiki ID, with aliases as metadata. Account separately for Shiki's plain-text and ANSI special modes; neither is a missing parser grammar. [Shiki special languages](https://shiki.style/languages#special-languages).

Every row has a state: verified, partial, candidate, or blocked. A partial or blocked row includes the missing behavior, evidence, and next action. A filename match or successful WASM build alone is never verified language support. Track highlighting, injections, detection, and folds separately so partial support cannot inflate the headline count.

### Admit queries only when their semantics work

Compilation is necessary but insufficient. Some host-specific query predicates and properties are not evaluated by our runtime. Imported queries must pass an explicit compatibility check for predicates, directives, inheritance, locals, captures, and injection semantics. Tree-sitter describes this host responsibility in its [predicate and directive reference](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html).

Expand query inheritance at build time. Preserve private captures required by predicates. Map public capture names to the existing palette taxonomy, with explicit mappings for differences such as `markup.*` and `text.*`. Record intentional parent-scope mappings. An unmapped public capture fails admission instead of disappearing into the default color.

Support a missing semantic feature when admitted languages require it, or adapt the query with equivalent fixtures. Never delete a predicate merely to make a query compile. Keep local patches small, attributable to upstream revisions, and covered by examples.

The current worker supports fixed and captured injection languages and combined injections. It caps nesting at two and does not implement every upstream injection convention. Audit child exclusion, included children, filename or shebang resolution, range adjustments, and property tests before accepting bundles that use them. [Helix injection semantics](https://docs.helix-editor.com/guides/injection.html).

## Execute in verifiable phases

### 1. Establish the catalog and complete inventory

Generate today's native contributions from the manifest with unchanged output. Preserve the existing provider API and laziness. Produce the complete 242-ID Shiki comparison report, recording its installed package version. Use the [Tree-sitter parser registry](https://github.com/tree-sitter/tree-sitter/wiki/List-of-parsers) for discovery, then verify candidate repositories individually.

Resolve TypeScript and TSX as distinct language identities. Keep `.ts`, `.mts`, and `.cts` on the TypeScript grammar and `.tsx` on TSX. Update explicit Shiki mappings and all affected callers in the same pass. Preserve JSX behavior and remove ambiguous aliases such as `react` unless the caller supplies an unambiguous language.

Define deterministic detection precedence: an explicit language ID supplied by the caller, exact filename, longest matching extension, then supported content hints such as a shebang. Test ambiguous extensions and variants independently. Leave unresolved cases explicit; adding a manual language-selection UI is separate work.

**Exit:** every Shiki ID is accounted for; current native fixtures still pass; TS and TSX resolve correctly; a cold TypeScript open loads only its required grammar assets. Unresearched rows remain candidates rather than claimed support.

### 2. Ship Astro and general embedded-language loading

Admit the existing [Astro grammar](https://github.com/virchau13/tree-sitter-astro) at a pinned revision. Test frontmatter, markup, expressions, components, script bodies, style bodies, comments, and incomplete syntax. Its existing grammar is a starting point; compatibility with our WASM build and queries still needs proof.

Replace static injection-language regex inference with validated dependency metadata. Extend the existing session/backend boundary so missing dynamic languages can be resolved lazily. Deduplicate requests, retain session and document-version checks, and prevent closed or superseded sessions from applying delayed results.

Load a parent grammar's required static dependencies and resolve captured dependencies when discovered. Handle unavailable dependencies explicitly. Test deeper valid nesting before revising the current depth limit. Bound recursion and work, detecting non-progressing injection cycles without banning legitimate nested use of the same language.

Use Markdown fences as the dynamic-loading control, including an Astro fence containing script or style code. Inspect injection boundaries and ensure that child tokens do not erase unrelated parent tokens.

**Exit:** Astro renders correctly under built-in light and dark palettes; both Astro and dynamic Markdown injections pass real worker fixtures; no Shiki worker starts. Read screenshots from the running app and retain the evidence directory.

### 3. Expand coverage in batches

Prioritize by user value and admission results. The following are candidate waves, not claims that all their grammars already work:

| Wave              | Candidates                                          | Main validation concern                                      |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Common files      | Python, Bash, YAML, TOML, SQL, Dockerfile, Rust, Go | Filename detection, dialects, predicates, external scanners  |
| Web variants      | Vue, Svelte, SCSS, GraphQL, MDX                     | Embedded languages, delimiter edits, variant accuracy        |
| Wider development | C, C++, C#, Java, Kotlin, Swift, PHP, Ruby, Lua     | ABI compatibility, query quality, capture mapping            |
| Remaining catalog | Every remaining Shiki ID                            | Explicit candidate, verified coverage, or documented blocker |

Do not block independent languages on one difficult template grammar. Each batch must include locked assets, fixtures, detection metadata, notices, and a regenerated coverage report. Treat variants such as SQL dialects and MDX as separate coverage questions; a nearby grammar does not establish parity.

**Exit per batch:** new entries pass admission and browser smoke checks; existing fixtures remain correct; unrelated grammar assets do not load. Continue until every candidate has been evaluated, with remaining gaps tied to a concrete grammar, build, query, or runtime limitation.

### 4. Improve query accuracy and measure each stage

Begin this phase alongside catalog work using today's languages. Establish expected captures for declarations, parameters, properties, calls, types, constants, comments, strings, interpolation, JSX, and nested Markdown formatting. Include malformed and unfinished code. Add injection-boundary fixtures as phase 2 lands.

Keep the existing deterministic overlap rules. A narrow interpolation capture must not remove the surrounding string. Strong Markdown text inside a heading must retain the intended style. Test equivalent capture sets in different enumeration orders. Shiki can reveal missing cases, but its token boundaries are not the correctness oracle for Tree-sitter.

Instrument existing worker diagnostics to separate parse, injection discovery, query traversal and predicates, structural walks, normalization, overlap resolution, sorting, packing, transfer, and application. Where the API cannot separate native query work from predicate evaluation, report them together. Record capture counts, duplicates, layer counts, requested ranges, and transferred bytes alongside timings.

**Exit:** each reported cost has a defined boundary; fixtures expose missing or incorrect colors; at least one profile identifies the dominant native cost. Do not describe the entire `queryRange` duration as highlight-query execution.

### 5. Remove measured redundant work

Choose the change from phase 4's profile. Existing range-bounded queries, cancellation, and packed token transport remain the baseline.

Evaluate these structural opportunities before local tuning:

1. Remove repeated capture rules in composed JavaScript and TypeScript queries when token-equivalence fixtures prove them redundant.
2. Avoid repeating structural extraction for the same parsed snapshot and requested range when only highlight demand changes.
3. Reduce the capture-array, sorting, object-token, and packed-token passes if they dominate. Preserve raw captures for consumers that request them, including Markdown consumers.
4. Reuse unaffected query output only if prior changes leave query execution as the bottleneck.

For reuse, combine explicit text edits with structural changed ranges. A renamed identifier can change a regex predicate without changing tree shape. Expand invalidation for ancestor-sensitive patterns, multiline captures, locals, and injection boundaries. Include document version, language layer, and query revision in reuse identity. Requery the affected layer when locality is unproven.

**Exit per optimization:** incremental output exactly matches fresh full recomputation after each corpus edit; the targeted phase improves beyond repeated-run noise; cold loading and p95 edit latency do not regress beyond measured baseline variance. Preserve query-quality gains even when they require a stated performance tradeoff.

The earlier 3.1 ms warm Shiki worker cycle on the 851-line fixture is a comparison target, not a promised native budget. Set budgets after representative token-changing and mixed-language measurements. Do not optimize solely for whitespace edits.

## Verify behavior and performance

Extend existing Editor tests before adding a separate harness:

- `packages/tree-sitter-languages/test/index.test.ts`, `captureTokens.test.ts`, and `foldQueries.test.ts` for real grammar/query admission and palette captures.
- `packages/tree-sitter/test/session-injectedLanguages.test.ts` and `treeSitter-worker.test.ts` for dependency loading and edit correctness.
- `packages/tree-sitter/test/treeSitter-workerClient.browser.test.ts` for actual browser WASM and worker behavior.

Use fixtures with Unicode and surrogate pairs, CRLF, text-only predicate changes, delimiter removal, multiline edits, large pastes, undo/redo, scrolling into unseen regions, stale replies, and injection creation or removal. Compare incremental tokens and required structural results with a fresh parse and full recomputation. Keep curated expected-category fixtures too: two equally wrong computations can agree.

Run only relevant package tests with plain Vitest, plus the affected package typechecks. Platform app tests use `bun --bun vitest` where needed. The running app proves integration: extend the browser scenarios and feature map for Astro and token-changing edits, centralizing selectors in `scripts/agent/selectors.ts`.

Capture a native baseline and an after trace with the same fixture and settings:

```sh
bun run agent:browser trace editor-syntax-native --file large.ts
bun run agent:browser trace editor-syntax-native --file large.ts --compare <baseline-evidence-directory>
```

Use the existing benchmark fixture workspace or an equivalent fixed corpus. Repeat unprofiled runs for timing statistics; profiler overhead must not enter the comparison table. Alternate engine order and report medians and p95 across at least five runs. Compare both early-edit and settled Shiki controls. Add Astro, Markdown injections, a larger source file, and long lines.

Measure production asset requests and retained worker/WASM memory separately from development-module bytes. Verify grammar loading stays proportional to requested language dependencies. Run `look` or a scenario on changed surfaces, read screenshots, and cite trace comparisons for performance claims. Reuse the existing dev server; do not start a replacement if it is down.

For implementation increments, deploy the verified web build with `bun run deploy` and check the served release. Use `--server` only if that increment changes the server. This planning document requires no application deployment.

## Completion and maintenance

The first useful delivery is the generated catalog plus correctly highlighted Astro. Broader deliveries add verified batches and measured query improvements independently.

The coverage effort finishes its first pass when every installed Shiki ID has been evaluated and every accepted grammar ships with fixtures. Publish the verified count and remaining gaps. Reaching 242 verified IDs requires resolving those gaps; a complete report alone does not mean complete native support.

CI checks generated metadata, source locks, query compatibility, notices, and fixtures for changed bundles. A Shiki upgrade regenerates the comparison inventory. A grammar or query update includes a coverage diff and rechecks its dependent languages. Keep broad performance runs for runtime changes and representative new grammars, rather than running every benchmark for metadata edits.

The largest uncertainty is how many upstream bundles pass our runtime's semantics. Phase 1 makes that visible; Astro and Markdown exercise the difficult shared parts early. Use the measured failure categories to choose the next runtime feature instead of attempting to emulate an entire upstream editor.
