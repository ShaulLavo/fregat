# Plan 339: Fast full-document syntax for 10 MiB files

## Status and ownership

- Status: Approved. Owner request, 2026-10-08. Make the entire 10 MiB file fast first. Incremental and viewport-first work comes later.
- Kind: Editor performance, with bounded tree-sitter-x work when measurements justify it.
- Owner: Singapore syntax lane. Coordinate parser changes with the tree-sitter-x owner and prepared-document changes with the async editor lane.
- Parent: [Plan 336](336-packages-as-products.md). [Plan 338](338-singapore-docs-load-speed.md) owns docs asset delivery and takeover. This plan owns complete-file syntax throughput.
- Inspected baseline: 77fef3fa0cfa76be7d1a914fa5bd87629b1259c5. Package versions 0.2.6; packaged tree-sitter-x `3805c8921570361c317cb766cc8e96ae700de8cb`, web-tree-sitter 0.28.1; TypeScript grammar 0.23.2.
- Deliverable of this PR: execution plan, a reusable full-document diagnostic in the browser comparison benchmark, a native parse control, and dated experiment evidence. Parser optimizations follow in measured units.

## Outcome and scope

Opening a 10 MiB TypeScript file produces syntax tokens for its entire contents quickly. The success clock ends after complete parsing, injection discovery, highlight queries, overlap resolution, packing, delivery and construction of the main-thread token store. The first highlighted frame must use that complete result. Plain text may paint earlier.

Keep the existing virtualized renderer. Rendering only mounted rows is separate from deciding which source bytes to parse or highlight. The accepted run parses and highlights all source bytes before it reports success. It starts from a fresh document and tree. Existing-tree reuse, warm token caches, incremental edits, partial results, viewport queries and early visible highlighting cannot satisfy this plan's budgets. They can ship on top after the complete-file targets pass.

Use the simple editor API and the normal TypeScript plugin. Preserve token styles, capture precedence, UTF-16 positions, injections, fold/bracket output, cancellation, document disposal and multi-view sharing. The work is not a new editor engine, lexer-only mode, large-file cutoff or reduced-language mode.

## Current code

- [`syntaxController.ts`](../editor/packages/editor/src/editor/syntaxController.ts) currently requests `syntaxMode: range`. It first gets a full parse acknowledgment, then asks for visible tokens. That is a different workload from full-document highlighting, even though the root tree is already complete.
- [`session.ts`](../editor/packages/tree-sitter/src/session.ts) already supports `syntaxMode: full` and requests `resultMode: full`. The benchmark selects this existing path through a build-only source transform and disables subsequent range queries. Shipping editor source stays unchanged.
- [`treeSitter.worker.ts`](../editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts) parses the root, discovers injection layers, then flattens every layer. Whole-tree highlight collection currently uses `Query.matches`; range collection uses `Query.captures`. The paths have different output shapes and normalization work.
- The worker already measures root parse, injection discovery, structural walk, highlight query plus predicates, capture sorting, overlap resolution and packing. Parse/query totals contain these phases. Input uses a worker-owned piece-table replica and UTF-16 callback reads.
- Packed tokens already travel as transferable arrays. [`EditorTokenStore.fromPacked`](../editor/packages/editor/src/syntax/tokenStore.ts) validates style IDs and adopts sorted arrays in one segment. It sorts when the packed result does not assert sorted order. Do not plan a second object-token store or assume an expensive store rebuild without the measured clock.
- tree-sitter-x's source build already specifies `-O3`, LTO and optional `wasm-opt -O3`. Inspect the exact packaged artifact and grammar build before claiming a missing optimization flag. SIMD is a hypothesis about specific hot loops, not a blanket speed switch for a branch-heavy parser.

## Measured baseline

Measured 2026-10-08 at 2026-10-08T17:03:21.176Z on an Intel i7-14700K, 28 logical CPUs, 31.1 GiB RAM, Linux 7.2.8-arch1-2, headless Chromium 153.0.8010.12, Node 26.7.0 and Bun 1.4.2. Source commit `77fef3fa0cfa76be7d1a914fa5bd87629b1259c5` plus the benchmark-only transforms in this PR. Condition `noisy`, three rotated repetitions per editor, viewport 1280×720, device scale 1, local HTTP. The native build and other wave work could overlap; neither series is a quiet qualification.

Committed [browser samples](../editor/docs/performance/singapore-full-parse-2026-10-08/experiment.json.gz), [phase summary](../editor/docs/performance/singapore-full-parse-2026-10-08/summary.json) and [native samples](../editor/docs/performance/singapore-full-parse-2026-10-08/native.json) retain the method and provenance. Compressed traces sit beside the browser samples. Local screenshots and scheduling output remain under `/work/reports/plan-336/evidence/singapore-full-parse-10mb/`.

| Singapore observation                | Median of three, ms | Interpretation                                                                                            |
| ------------------------------------ | ------------------: | --------------------------------------------------------------------------------------------------------- |
| Editor mount                         |                34.5 | Text buffer and editor setup                                                                              |
| First frame                          |                38.9 | Plain text can already paint                                                                              |
| Text reset `postMessage`             |                 4.0 | Synchronous send cost                                                                                     |
| Text arrival in worker               |                 7.8 | Boundary delay, includes send, delivery and queue                                                         |
| Text reset round-trip                |                11.2 | Also includes worker replica construction and acknowledgment                                              |
| WASM root parse                      |               794.8 | Full tree, no old tree                                                                                    |
| Injection discovery                  |               512.4 | Scan finds zero injections                                                                                |
| Parse total                          |             1,310.9 | Contains root parse and injection discovery                                                               |
| Full structural walk                 |             1,261.2 | Whole tree                                                                                                |
| Full highlight query and predicates  |             1,481.0 | Whole tree, `Query.matches`                                                                               |
| Fold query and predicates            |               246.0 | Whole tree                                                                                                |
| Capture sorting                      |                11.6 | Already small                                                                                             |
| Overlap resolution                   |               176.7 | Capture to styled token conversion                                                                        |
| Token packing                        |                14.0 | Three packed arrays                                                                                       |
| Other full-query work                |               668.0 | Per-sample residual, principally untimed full-path capture normalization; attribution needs a finer probe |
| Full query total                     |             3,888.5 | Contains the walk/query/packing phases above                                                              |
| Worker parse plus full query         |             5,215.7 | Median of each sample's sum, not a sum of medians                                                         |
| Full request round-trip              |             5,224.6 | Parsing, complete query and delivery                                                                      |
| Reply boundary delay                 |                 0.1 | Transferred token arrays and cloned structural data                                                       |
| Main-thread token store construction |                 1.7 | `EditorTokenStore.fromPacked`                                                                             |
| Main-thread structural apply         |                 2.9 | Includes other settlement work                                                                            |
| Complete highlighted frame           |             5,395.2 | Samples 5,395.2 / 5,593.8 / 5,211.5                                                                       |

All nine editor profiles completed. Each Singapore result covers 0..10,485,760 with 1,198,376 tokens, 14,380,512 token-array bytes, one root layer and no degraded phase. Query and structural work takes about three quarters of worker time. Root WASM parse alone takes about 15%. Text delivery, packing and token-store construction are small. Start with whole-query materialization and the structural walk, not a text-transfer redesign.

This is a noisy experiment, not a public speed claim. The deterministic ASCII fixture repeats an export declaration and a comment to exactly 10,485,760 bytes. It has duplicate declarations and a final partial comment. It exercises syntactic parsing, not TypeScript type checking. It has no actual regex/JSDoc injections, so injection discovery measures finding no injected languages. Add a mixed-language corpus before accepting injection improvements.

The browser run uses `editor/bench/compare --profile-open --open-only --full-document`. Build-only transforms select the complete path, add cross-thread receipt/send clocks and time `EditorTokenStore.fromPacked`. Assertions require a full-result request, byte-range coverage of the entire fixture, nonempty tokens, no degraded phases, no parse-only request and no range query. Every sample starts in a new browser context. Runtime/grammar startup is cold per context; OS file caches may be warm.

Worker times use their own monotonic clock. Boundary delays use `performance.timeOrigin + performance.now()` on both threads. Text outbound time includes cloning, dispatch and scheduling. Source reset round-trip also includes replica construction and the acknowledgment. Return delay includes structured cloning of structural output, transferable token delivery and main-thread scheduling. These clocks do not isolate copy bandwidth. The first-frame and highlighted-frame values are rAF opportunity proxies in headless Chromium, not physical presentation latency. Medians of nested phases do not add up to an end-to-end median.

### Reconcile the earlier highlighted-open result

The earlier [open-time summary](../editor/docs/performance/singapore-open-2026-10-08/after/open-summary.json) and [raw samples](../editor/docs/performance/singapore-open-2026-10-08/after/experiment.json.gz) recorded a 1,464.0 ms median for first visible highlighting of the same 10 MiB fixture. That noisy run was measured on the same machine and Chromium build at 2026-10-08T11:07:44.129Z, from source commit `308f5e514573c6cee874ad63201bbb17151b5c36`.

Its `parseOnly` request parsed the complete root and discovered injections. Its subsequent `queryRange` request walked, highlighted, normalized and packed only the requested visible scope, 0..23,359 code units, returning 2,672 tokens. The benchmark's highlighted-open clock ended after visible syntax settled and a frame opportunity passed. It did not wait for whole-file token production, delivery or store settlement.

The new `full` request queries and returns the entire 0..10,485,760 scope with 1,198,376 tokens. The 5,395.2 ms median ends after that complete result settles and the first complete highlighted-frame opportunity passes. Root-parse medians are similar, 767.0 ms earlier and 794.8 ms here. Query medians describe different workloads, 29.8 ms for the earlier visible-range query and 3,888.5 ms for the new whole-document query. These experiments do not measure a regression. Subtracting their medians would not establish a phase delta. The earlier visible-highlight result cannot satisfy this plan's complete-file acceptance gate.

### Native and competitor reference

Native root parse took 442.603 / 381.483 / 353.156 ms, median 381.483 ms, on the same machine. The browser root-parse median is about 2.08 times that native median. Native compiler was GCC 16.2.1 with `-O3 -std=c11`; all roots covered 10,485,760 bytes and reported no syntax error. Fixture SHA-256 is `512348577405c01df6f57142fb6c0d9123211797b9349b5af05047174adeece0` in both series.

Native source revision is `3569e367267ef536e29e859a875530b7d80416bd`, the source grammar-URL fix associated with package commit `3805c892`. The package commit contains generated bindings and WASM, not native C sources. Their build correspondence is inferred from the matching fix and dates; it has not been proved by a byte-identical rebuild. This is a qualified native reference, not a verified same-artifact compiler comparison.

The native control compiles the same installed TypeScript grammar's generated C parser and scanner with `cc -O3`. It reads the file before timing, uses a fresh parser and tree for each sample, and checks the root's final byte. Native contiguous UTF-8 input differs from the browser's UTF-16 callback input. The ratio includes input encoding, callback and binding costs; it is not a pure WASM penalty. Resolve packaged WASM provenance to a source revision and record any uncertainty before attributing a gap to the compiler.

For the same full string, CodeMirror/Lezer TypeScript parsed in 1,001.7 ms median and walked full-tree highlights in 75.8 ms median, emitting 1,348,173 styled spans over 10,485,760 code units. The per-sample combined median was 1,075.3 ms. Monaco/Monarch took 494.9 ms median to tokenize all 149,797 lines, emitting 2,246,955 tokens. These span counts differ because grammars, token grouping and styles differ. Their normal view-open clocks also include the forced synchronous reference work in this diagnostic; do not compare them with Singapore's early plain-text frame.

CodeMirror normally advances Lezer parsing through a time budget and visible demand. The dedicated reference instead calls its TypeScript parser on the whole string and walks the entire tree with `highlightTree`. Monaco's standalone TypeScript syntax provider is Monarch, not TextMate. Its dedicated reference calls `editor.tokenize` on the whole string after registering that grammar. It produces line tokens with carried lexical state and no semantic parse tree. Neither reference includes Singapore's structural records, folds, brackets or injection discovery. Their clocks are useful controls, not an editor-speed ranking.

VS Code's TextMate path is a separate reference. A full-document run would carry grammar state through every line with vscode-textmate and vscode-oniguruma, with the same grammar and full UTF-16 token coverage asserted. Monaco does not supply that benchmark. Record it separately if needed; do not label the measured Monarch clock TextMate. No TextMate timing was measured in this PR.

## Goal metrics

On the reference i7-14700K, use the same 10 MiB fixture, headless Chromium build, viewport, package versions and complete-result assertions. These are execution targets, not forecasts or measured claims.

| Milestone | Worker parse plus full query diagnostic | Open to complete highlighted frame | Additional gate                                                                                        |
| --------- | --------------------------------------: | ---------------------------------: | ------------------------------------------------------------------------------------------------------ |
| M0        |                 Retain today's baseline |            Retain today's baseline | All three full-document samples complete with equal token output                                       |
| M1        |                        At most 4,000 ms |                   At most 4,500 ms | At least 25% less total work than the qualified baseline; no phase regression beyond measurement noise |
| M2        |                        At most 3,000 ms |                   At most 3,500 ms | Full result and main-thread settlement, including mixed-language cases                                 |
| M3        |                        At most 2,000 ms |                   At most 2,000 ms | Target for this plan, five paired repetitions and tail report                                          |
| Stretch   |                        At most 1,000 ms |                   At most 1,000 ms | Attempt after M3; stop when the next change fails the cost/gain test                                   |

M3 requires complete-result settlement within 2,000 ms of open, including delivery, token-store construction and structural apply. The first highlighted frame using that complete result must also pass within 2,000 ms. The stretch uses 1,000 ms for both gates. Worker parse/query budgets are intermediate diagnostics; meeting them alone cannot pass a milestone. Delivery and settlement consume part of the same completion budget, with no extra frame allowance.

A milestone already passed by the measured baseline requires a tighter next budget, rather than claiming an improvement for meeting an existing result. Freeze M1's exact threshold after the quiet M0 qualification. Keep return delivery plus token-store construction below 100 ms at M3, and report the largest main-thread task. Do not move work outside the measured interval to pass. Track process RSS and WASM memory alongside JavaScript heap. Reject a latency win that doubles total peak memory unless a smaller-memory variant meets the target.

## Candidate techniques and order

Expected gains below are hypotheses. Replace them with paired phase deltas after each experiment. Choose the next experiment by measured end-to-end share, not by the novelty of a technique.

| Rank | Technique                                                  | Expected gain and cost                                                                                                                                                                                                                                                                           | Decision gate                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Whole-query result production in tree-sitter-x             | High potential if query time dominates. Profile C matching, JS node wrappers, predicates, text reads and per-match allocation separately. Medium cost. Prefer a packed C/binding result or fewer crossings over moving allocations between JS functions.                                         | Full capture/style equality on overlapping patterns, predicates, Unicode and injections; no missing tail tokens.                                                                                               |
| 2    | Query source and predicate work                            | Medium to high potential when repeated generic patterns or regex predicates dominate. Audit TypeScript/JavaScript merged queries, redundant patterns and repeated node-text materialization. Medium cost.                                                                                        | Keep precedence and language semantics. Fewer patterns must produce the same canonical token stream. A capture/match limit is a correctness guard, never a truncation optimization.                            |
| 3    | Injection discovery and structural traversal               | Medium potential even for files without injections. Measure the scan, predicate reads and node-wrapper allocation. Check whether structural records and captures can share one traversal, or optional structural work can complete inside the same full-result budget more cheaply. Medium cost. | Preserve folds, brackets and errors. Match zero-injection and mixed-language output; report separate injected parse/query costs. No silent layer-cap truncation.                                               |
| 4    | Root parser and input adapter in tree-sitter-x             | Bounded by the measured root-parse share. Compare contiguous UTF-16 parsing with piece-table callback parsing before changing parser C. Look for repeated chunk reads, tiny callbacks and avoidable UTF-16 conversion. Medium cost.                                                              | Same parser/grammar and identical root structure. Record callback count, code units copied and allocation totals. Preserve fragmented snapshots and Unicode offsets.                                           |
| 5    | Capture normalization, sorting, overlaps and token packing | Medium potential if post-query work is material. Produce sorted captures once, resolve precedence in a sweep and emit packed arrays directly. Reuse the current structure-of-arrays format before inventing compression. Medium cost.                                                            | Equal tokens and style IDs after canonicalization, including overlaps. Measure both worker work and decode/store cost.                                                                                         |
| 6    | WASM build experiments                                     | Small to medium potential, cheap to test. Existing source builds already have `-O3` and LTO; verify runtime and grammar provenance. Compare `-O2`/`-O3`, LTO and wasm-opt variants, then targeted SIMD where generated code supports it.                                                         | Retain toolchain/build flags and wasm hashes, cold startup, binary size and memory. Reject a hot-loop gain erased by larger compile/startup cost.                                                              |
| 7    | Text-copy reduction                                        | Low ceiling if the source-transfer share is small. Reuse replica chunks, avoid full-string flattening, and make callback reads bounded. Medium cost.                                                                                                                                             | Transferable text ArrayBuffers and SharedArrayBuffer redesigns are out under the prior decision. Existing transferable token arrays remain. No parallel text mirror or hidden cache.                           |
| 8    | Main-thread token store                                    | Low ceiling when `fromPacked` is already cheap. Audit validation and sorted flags, preserve array adoption and remove duplicate construction only if a profile finds it. Low cost.                                                                                                               | Same immutable ownership and range lookup behavior. Measure validation, sorting, store creation and structural apply separately.                                                                               |
| 9    | Parallel highlight queries by byte range                   | Uncertain gain, high cost. Separate browser workers cannot share a JS Tree or the existing WASM heap. Sending a tree object is not a supported design. Reparse-per-worker repeats parse/injection work and multiplies memory.                                                                    | Try only after single-worker M2 and only if query work still dominates. Prove a feasible tree-sharing/serialization design without SAB, or reject this candidate. Include setup/reparse/merge time and memory. |

A range-partition experiment must still cover the entire document before success. Captures can cross partitions; ancestors can start before a range; predicates and grouped captures can depend on nodes outside it. Byte ranges in the cursor are raw UTF-16 bytes while editor positions are code units. Deduplicate boundary captures and preserve pattern precedence. Never equate dividing the range with safely dividing the query. Native thread-safe tree copies alone do not establish a browser implementation.

For injections, retain lazy language registration while accounting for its full startup time. Add TypeScript regex and JSDoc, HTML with JS/CSS, Markdown fences and nested mixed-language files. Distinguish discovery, injected parsing and per-layer queries. Handle unsupported languages and exhausted limits explicitly. A fallback/plain layer cannot satisfy a complete-highlight performance gate.

## Measurement protocol

1. Run the committed probe tests before a measurement. Build the full mode, then run `bench:full` with explicit repetitions, timeout, condition and output directory. `mode.json` prevents accidentally pairing a full run with a range-mode build.
2. Keep the 10 MiB repeated fixture as the stable comparison input. Add portable deterministic 1 MiB/10 MiB controls with realistic TypeScript, long lines, Unicode, malformed code and injection-heavy documents in M0. Record SHA-256, UTF-8 bytes, UTF-16 length, line count and grammar/query hashes for each.
3. The existing browser harness records git commit, benchmark source hash, served bundle hashes, package versions, browser/tool versions, machine, kernel, fixture identities, raw samples and compressed CDP traces. Retain failed runs. Record dirty-source status and transform identity explicitly in M0 before changing package code. Native output records the source commit, compiler, flags and identical fixture hash.
4. Noisy runs are bounded exploratory evidence. Qualification uses the host's quiet scheduler, records the receipt and overlapping jobs, alternates baseline/candidate order and runs at least five repetitions. Hold browser configuration, compiler/toolchain and fixtures fixed. Other machines use their documented scheduler or an observed quiet condition. No test depends on a particular host.
5. Capture a `trace --compare` proof through the existing browser verification tooling for any end-to-end performance claim, plus the dedicated open trace and worker phase comparison. For this tool-only plan PR, no before/after speedup is claimed. Inspect the trace before optimizing a phase. Profile only one workload at a time because instrumentation changes clocks.
6. Report medians, p95, all failures, full coverage, token/capture counts, serialized/transferred bytes, largest main task, process RSS, WASM memory and heap. Report normal uninstrumented open alongside diagnostics before publishing a headline. Show cold startup separately from a warmed runtime with a fresh document/tree; no old-tree reuse in either full-parse series.
7. Extend the committed full-result gate in M0 with token-output checksums and root/injection coverage, final-offset probes, match-limit status and expected token count for the repeated fixture. Existing range bounds alone prove request scope, not every color's correctness. Compare candidate tokens against the baseline and run the pinned parser correctness corpus.
8. CI runs deterministic tests, source-transform checks and a bounded full-document browser smoke. Wall-clock budgets are qualified on the reference machine; keep CI timing reports non-gating until runner variance is measured. Use counters and exact output checks as portable regressions.

## Execution phases

### Phase 0: Qualify the full path

- [x] Commit a full-document mode to the existing comparison benchmark, with tests for source drift, partial/range results and degraded replies.
- [x] Measure the 10 MiB browser workload and native parse control, keeping the competitor clocks reference-only.
- [x] Run quiet TypeScript M0 qualification with output checksums, root/injection coverage and packaged runtime WASM source/build provenance.
- [x] Add realistic, Unicode and injected corpora and bounded browser smoke commands. Record cold/warm startup, memory, retained snapshots, edits, cancellation and multiple dense documents.
- [ ] Qualify Markdown through resolver-owned root coverage and query-limit diagnostics. Complete byte-identical grammar WASM rebuilds before attributing performance to grammar build flags.

Exit with a checked full-document baseline and the ranked bottleneck. Leave viewport-first off for every acceptance run.

Qualification work in progress, 2026-10-08:

- The benchmark checks canonical token, palette and structural hashes, root/injection bounds, query limits and final tokens. Five quiet cold-context and five warmed-runtime repetitions passed with fresh measured documents and identical canonical output across both conditions. The deterministic TypeScript and HTML controls passed at 1 MiB and 10 MiB, including complete dense injections. The Markdown control remains rejected.
- The packaged runtime WASM is byte-identical to an `-O3`/LTO/`wasm-opt -O3` rebuild of tree-sitter-x source `fc034c3ad42a6a5669202fa40303bfb2cd8829fc` with wasi-sdk 34.0 and Binaryen 132. [Build provenance](../editor/docs/performance/singapore-full-parse-2026-10-08/runtime-wasm-provenance.json) records the flags, exports and grammar input hashes. The grammar WASM has not had a byte-identical rebuild.
- PR #1021 and the complete-injection repair #1062 are integrated. The earlier five cold and five warm runs remain preliminary evidence. The frozen M0 below uses the integrated main and expanded retention and lifecycle controls. Phase 0 remains partial because Markdown proof is absent.

### Phase 1: Remove the largest single-worker cost

- [ ] Profile the dominant phase. Split query engine, predicates, materialization and normalization when the coarse phase bundles them.
- [x] Retain the first correctness- and counter-backed candidate with unqualified timing, canonical output and all traces. Continue one candidate at a time toward M1.
- [x] Implement tree-sitter-x improvements in that repository, test its bindings/native correctness, then pin the reviewed package artifact in Fregat. Other changes stay in their owning Singapore package. Normal package patch changesets apply to future package-code PRs.
- [ ] Meet M1 or record the next bounded experiment with a measured ceiling. Delete rejected experiments.

### Phase 2: Reach the complete-file target

- [ ] Optimize the next measured cost, including injection discovery and full structural output. Avoid optimizing already-small transfer/store phases by guesswork.
- [ ] Meet M2, then M3. Re-rank candidates after each win. Consider query partitioning/parallelism only under its feasibility and memory gate.
- [ ] Run the full syntax tests, Unicode/injection corpus, cancellation/disposal cases and simple-API multi-view cases. Add a regression test for each accepted change.

### Phase 3: Publish evidence, then add incremental work

- [ ] Record qualified full-file timing/memory results, toolchain, fixtures, method and reproducible scripts under the editor performance docs. Keep wins and losses together.
- [x] Check installed package exports and one framework consumer after any public API or artifact change.
- [ ] Review browser screenshots and frame traces. Confirm the first highlighted frame receives a complete store and that later scrolling needs no extra syntax query for that version.
- [ ] Attempt the stretch target if measured cost and implementation complexity justify it. Otherwise close with the achieved M3 numbers and a bounded follow-up.
- [ ] Only after the complete-file gate, layer viewport-first and incremental behavior on top. Keep the full mode in the benchmark permanently so those features cannot hide a throughput regression.

## Acceptance and stop conditions

The plan completes at M3 when all qualified repetitions return complete, equal syntax and structural output, memory stays within the agreed budget, complete-result settlement finishes within 2,000 ms of open, and the first highlighted frame using that complete result also passes within 2,000 ms. Delivery, token-store construction and structural apply are included. The stretch applies the same gates within 1,000 ms. The stretch goal is a later optimization target, not a prerequisite for layering incremental work.

Stop an experiment when it needs a second text owner, SAB/transferable-text redesign, unsafe tree sharing, silent capture/layer truncation, a reduced-language shortcut, a public API expansion without a consumer need, or substantially more complexity than the measured gain warrants. A failed technique changes the ranking, not the owner's approval to make the complete file faster. Record the evidence and try the next bounded candidate.

### JSDoc grammar recovery control, 2026-10-08

The bundled `tree-sitter-jsdoc` 0.25.0 grammar reports an error for the valid single-line comment `/** @param {string} value */`. A standalone parse returns `(ERROR (tag_name) (type) (identifier) (ERROR (UNEXPECTED '*')))`. Adding ` description` after `value`, or putting ` */` on the next line, returns a `document` with `hasError: false`. This reproduces without the editor, included ranges or the worker, so the grammar is the source of this observation.

The real-worker dense 10 MiB control repeats that first comment and `/[a-z]+/` 190,650 times. It now returns all 381,300 injections and colors the final comment and regex, with no degraded status. It also preserves 571,950 syntax error records from the grammar. These records are complete output, but they cannot establish correct JSDoc diagnostics. Keep this control separate from the grammar-valid dense control when attributing structural work, output size and delivery cost.

Reproduce from a fresh checkout after installing root dependencies:

```sh
cd editor/packages/tree-sitter-languages
bun -e 'import { Language, Parser } from "web-tree-sitter"; await Parser.init(); const parser = new Parser().setLanguage(await Language.load(new Uint8Array(await Bun.file("node_modules/tree-sitter-jsdoc/tree-sitter-jsdoc.wasm").arrayBuffer()))); for (const text of ["/** @param {string} value */", "/** @param {string} value description */", "/** @param {string} value\n */"]) { const tree = parser.parse(text); console.log(JSON.stringify({ text, hasError: tree.rootNode.hasError, tree: tree.rootNode.toString() })); tree.delete(); } parser.delete();'
```

The bounded standalone and worker evidence is under `/work/reports/plan-339/qualification/injection-cost/`. Dependency source was unchanged. An upstream grammar fix needs the owner's request under the local upstream policy; dropping error records would invalidate the full-output comparison. Consumer impact beyond the syntax-result error records is unconfirmed.

### Qualification controls and unresolved Markdown proof, 2026-10-08

The full-document harness now measures simultaneous sampled browser RSS and
records idle-fence worker retention. Its separate lifecycle control retains four
text snapshots across three edits, restores the original token and structural
hashes, opens two extra dense documents, supersedes an already dispatched dense
parse and checks its cancellation reply, then verifies that disposal restores
the active document's snapshot/tree counts. The dense fixtures require every
expected injection range, including the tail, exact token counts and retained
grammar recovery records. CI runs a bounded dense lifecycle smoke.

A 1 MiB grammar-valid lifecycle run returned 31,300 injections and 266,050
tokens with zero syntax errors. Its worker held 125,202 trees in four edited
snapshots, grew to 187,804 trees across three documents, and returned to 125,202
after the extra documents were disposed. The cancelled parse reported
`reason: superseded` after root parsing and injection discovery had started.
These are bounded verification observations, not a throughput improvement.

The Markdown control remains unqualified. Reproduce with
`bun run --cwd editor/bench/compare build:full`, then
`bun run --cwd editor/bench/compare smoke:full --corpus markdown --output <evidence>`.
The root Markdown resolver exposes decorations, highlights, folds, injections
and line positions, but no actual root-tree bounds. The worker's
`parseMarkdownDocument` stores the resolver with `layers: []`; only embedded
syntax contributes ordinary Tree-sitter layers. Its full reply also lacks the
explicit full-analysis marker. The strict gate rejects this reply. Inferring root
coverage from requested ranges, line count or source length would conceal the
missing proof. A resolver-owned coverage/query-limit diagnostic is needed before
Markdown timings can qualify. No dependency source was changed and no new issue
was opened. Realistic TypeScript, long lines, Unicode, malformed TypeScript,
sparse JSDoc/regex and HTML controls passed the prior 1 MiB strict run; final
qualification records their reruns and the Markdown failure separately.

### Frozen TypeScript M0 and next experiment, 2026-10-09

[Qualification evidence](../editor/docs/performance/singapore-full-parse-2026-10-08/qualified-m0/qualification.json)
contains all samples, canonical output, phase budgets, build hashes and sanitized
whole-job memory receipts. Compressed experiments and browser traces sit beside
it. These instrumented, headless runs establish a full-document baseline. They
make no headline performance or physical-presentation claim.

The frozen 10 MiB repeated fixture has five quiet repetitions per startup
condition, a fresh measured document and tree, 1,198,376 tokens, no syntax errors,
and identical token, palette and structural hashes across all ten samples.
Every result covers the actual root from 0 through 10,485,760 UTF-16 units and
reports no query-limit exhaustion. The warm condition keeps a separate 1 MiB
prime editor on the shared worker. One declared server remained running during
quiet admission; the admission lock excluded new jobs for the measured span.

| Metric                         | Cold median |   Cold p95 | Warm median |   Warm p95 |
| ------------------------------ | ----------: | ---------: | ----------: | ---------: |
| Complete highlighted frame     |  4,877.9 ms | 4,922.6 ms |  4,887.9 ms | 4,953.0 ms |
| Worker full work               |  4,700.7 ms | 4,735.5 ms |  4,755.7 ms | 4,824.1 ms |
| Structural walk                |  1,185.7 ms | 1,203.0 ms |  1,168.3 ms | 1,206.7 ms |
| Highlight query and predicates |  1,315.9 ms | 1,332.5 ms |  1,254.9 ms | 1,287.8 ms |
| Token-store construction       |      1.2 ms |     1.3 ms |      1.3 ms |     1.6 ms |
| Largest main-thread task       |     46.8 ms |    48.1 ms |     39.1 ms |    44.5 ms |

M1 now requires all five repetitions in each condition to stay within 4,000 ms
worker full work and 4,500 ms complete highlighted frame. It also requires a
25% reduction in median diagnostic work, measured as each sample's worker
parse/query elapsed durations plus main-thread union work. The frozen ceilings
are 3,539.052750035763 ms cold and 3,576.3765000357625 ms warm. This work measure
is a proxy, not CPU seconds. Reject a phase median increase greater than the
larger of 1 ms and that phase's frozen maximum-minus-minimum spread. Reject a
latency win that doubles a matched whole-job peak unless the smaller-memory
variant meets the target. M1 has not passed.

The historical pre-review baseline batch's whole-job peak was 1,498,374,144 bytes. The 1 MiB controls
and lifecycle batch peaked at 2,049,671,168 bytes, and the 10 MiB controls batch
at 6,432,743,424 bytes. These include browser control, hashes, traces and
retention inspection; they are separate from sampled browser RSS and committed
WASM capacity. These memory receipts are superseded by the correction below.
The original raw measurements remain intact. All three receipts show zero OOM kills and zero leftovers. The
1 MiB batch exited 1 because the final Markdown proof was correctly rejected.
The 10 MiB batch completed all eight controls, including 313,006 grammar-valid
injections with zero errors and 381,300 recovery injections with 571,950 error
records. Those controls have one repetition each and establish correctness,
not timing distributions.

The controls precede a final portable RSS guard that reports an unavailable
process list as unknown memory. Every recorded process list was nonempty. The
final baseline and every earlier control have byte-identical measured browser
assets; their distinct benchmark fingerprints are preserved. The final harness
has a regression test for the unavailable-list case.

Reproduce from the checkout after the documented root install and browser setup:

```sh
bun run --cwd editor/bench/compare test
bun run --cwd editor/bench/compare build:full
bun run --cwd editor/bench/compare smoke:full --corpus dense-injected --lifecycle --timeout 150000 --output <lifecycle-evidence>
node editor/bench/compare/run.mjs --profile-open --open-only --full-document --sizes 10 --editors singapore --repetitions 5 --timeout 60000 --condition quiet --output <cold-evidence>
node editor/bench/compare/run.mjs --profile-open --open-only --full-document --sizes 10 --editors singapore --repetitions 5 --timeout 60000 --condition quiet --warm --output <warm-evidence>
node editor/bench/compare/summarize-open.mjs <cold-experiment.json.gz>
```

Use the execution host's quiet scheduler for measurement. Repeat the control
command with `--corpus realistic|long-line|unicode|malformed|injected|html|dense-injected|dense-recovery`
and one repetition at each size. Preserve Markdown's failure with
`--corpus markdown`; it remains outside the qualified timing set.

Phase 1 starts by splitting query engine, predicate and materialization costs
inside the 1.25 to 1.32 second highlight phase. The separate 1.17 to 1.19 second
structural walk is the other leading cost. Inspect `collectTreeData`,
`walkTreeCursor`, `collectCursorBracket` and `collectCursorError` in
`editor/packages/tree-sitter/src/treeSitter/treeSitter.worker.ts`, recording
node visits and native getter counts before choosing a candidate. Keep the
whole-tree traversal and all diagnostics. No optimization or measured ceiling
has been accepted yet.

### Memory review corrections, 2026-10-09

[Corrected memory evidence](../editor/docs/performance/singapore-full-parse-2026-10-08/memory-correction/qualification.json)
replaces the historical memory observations while preserving the frozen timing
baseline and M1 thresholds. The probe now parses Linux RSS/high-water fields
with tab or space separation, retains only the latest unproved reply, counts
replies monotonically, and releases packed/structural payloads after hashing.
The disposal gate compares worker/document/snapshot identities, tree and
snapshot counts, and source reads, pins and UTF-16 units. Committed WASM
capacity may remain allocated.

All 28 refreshed samples passed: five cold and five warm 10 MiB repetitions,
sixteen 1 MiB/10 MiB controls, and cold/warm 1 MiB smoke. Every canonical output
and actual coverage list equals its historical counterpart. Linux per-process
RSS and high-water values are now available for every observed process. The
dense lifecycle returns to one document, four snapshots, 125,202 trees, four
source reads, zero pins and 4,194,304 retained source units, with the same
identities as after the edits. Post-disposal, post-GC JavaScript heap is
91,100,436 bytes; simultaneous observed process RSS is 799,404,032 bytes. These
remain distinct from allocator-live bytes, which are unmeasured.

The corrected cold/warm batch peaked at 1,572,909,056 whole-job bytes. All ten
samples completed before an invalid operator corpus argument stopped that
batch with exit 1; no control sample was attempted in that invocation. The
corrected controls/smoke batch exited 0 and peaked at 6,544,244,736 bytes. Both
receipts show zero OOM kills, zero leftovers and no expired quiet hold. The
required coverage metadata, hashes and traces still have diagnostic memory
costs; these are memory qualification results, not memory-reduction claims.

The three reviewer regressions fail with the original whitespace parser,
append-only reply retention and document-count-only disposal gate. The fixed
probe suite passes 39 tests, including proof release and rejection of unchanged
document counts with leaked trees, snapshots, sources or changed identities.
No shipping parser/editor source or open timing markers changed.

### First retained structural candidate, 2026-10-09

[Cursor-read evidence](../editor/docs/performance/singapore-full-parse-2026-10-08/cursor-reads/comparison.json)
retains the normal timed experiments, both overhead-heavy native counter
profiles, all control traces and the bounded replication intent. The shipping
change reads a cursor's type and missing state once, and reads source offsets
only when a bracket or error diagnostic needs them. Whole-tree traversal,
bracket depth, error order and independent injection trees are preserved.

The 10 MiB ordinary fixture's native structural counters confirm type reads
drop from 4,194,318 to 2,097,159 and start-offset reads from 2,097,159 to zero.
Missing-state reads remain 2,097,159. Highlight predicate calls remain 748,985.
These counter profiles establish work shape. All twenty timing samples and
eighteen controls/smokes preserve complete token, palette, structural and
actual-coverage output. Lifecycle checks also pass.

Timing qualification failed. The result below uses the original paired five
baseline and five candidate samples per startup condition. The structural
speedup is supported by the output and native counters, but the timing is
unqualified.

| Metric                     | Frozen cold median | Original candidate cold median | Frozen warm median | Original candidate warm median |
| -------------------------- | -----------------: | -----------------------------: | -----------------: | -----------------------------: |
| Complete highlighted frame |         4,877.9 ms |                     4,599.9 ms |         4,887.9 ms |                     4,669.4 ms |
| Worker full work           |         4,700.7 ms |                     4,398.4 ms |         4,755.7 ms |                     4,519.4 ms |
| Structural walk            |         1,185.7 ms |                       929.7 ms |         1,168.3 ms |                       924.6 ms |
| Diagnostic work proxy      |         4,718.7 ms |                     4,426.3 ms |         4,768.5 ms |                     4,530.7 ms |

Cold passed its phase guards. Warm overlap resolution rose from 160.4 ms to
167.7 ms, an increase of 7.3 ms against the frozen 7.0 ms allowance. Both
windows completed successfully, so adding five more samples and pooling them
cannot turn that failure into acceptance. All confirmation artifacts, pooled
distributions and the declared replication intent remain as exploratory
evidence. No unchanged-code acceptance rerun will be performed.

The retained windows also used baseline-first ordering. Future qualification
must prospectively freeze the paired protocol and alternate baseline/candidate
order. The next optimization will measure on top of this structural change.
These are instrumented headless-frame experiments. They establish no physical
presentation, CPU-seconds or uninstrumented headline claim.

Matched whole-job peak memory is 1,906,339,840 bytes across the candidate timing
batches versus 1,572,909,056 corrected baseline bytes. Controls/smoke peak at
6,603,534,336 bytes versus 6,544,244,736 baseline bytes. Both remain below the
2x rejection bound. Committed WASM capacity, heaps and sampled RSS are recorded
separately. No memory-reduction claim is made.

M1 is still unpassed: worker/frame maxima exceed 4,000/4,500 ms, and median
diagnostic work falls only 6.2% cold and 5.0% warm in the original unqualified
windows against the required 25%.
The next bounded experiment is to split predicate text extraction and capture
materialization in the remaining roughly 1.25 s highlight-query phase, count
node wrappers/string reads, and test one change on the same complete-output
protocol. The native profile attributes about 0.4 s each to the query engine
and predicate callbacks, with the rest still bundled in decoding/materialization.
Any tree-sitter-x source change needs its own reviewed repository PR before
pinning; none is included in this cursor-read change.

### Bounded predicate reads and query-local reuse — 2026-10-09

[tree-sitter-x #24](https://github.com/ShaulLavo/tree-sitter-x/pull/24) is reviewed
and merged at `89300c9e82946c9bc59b16ca1415afa86fcdbdb9`. Singapore pins its
published artifact `a052adf5c2c34ef78f97d1631c41ca83db9816d3` through the package
dependency and root override. Root and injection callbacks forward the optional
exclusive UTF-16 end index. Ordinary parser reads retain the 4,096-unit chunk
limit and surrogate-safe boundaries; exact bounded reads preserve the requested
range. Each query invocation owns its text reuse, with fresh reads on subsequent
calls and other trees.

**Timing qualification failed; M1 remains unpassed.** The prospective window
was declared before any measurement, with five baseline/candidate pairs for
each startup condition and alternating order. Its baseline is the structural
candidate at `9d78f3e84f683325d57ebcb4b3b1b1b86518f407`. Every original attempt
completed. No failed sample was replaced, no acceptance rerun was made, and no
threshold was widened. The complete declaration, twenty timing traces, thirty-two
control traces, counter diagnostics and fifty-two matched scheduler receipts are
in [the preserved evidence](../editor/docs/performance/singapore-full-parse-2026-10-08/predicate-reads/comparison.json).

The following are original instrumented experiment medians, in milliseconds.
They describe headless frame opportunities, not physical presentation or CPU
seconds, and do not establish a qualified speedup.

| Startup | Metric                         | Baseline | Candidate |
| ------- | ------------------------------ | -------: | --------: |
| Cold    | Complete highlighted frame     |   4652.3 |    4523.8 |
| Cold    | Full worker work               |   4470.0 |    4337.4 |
| Cold    | Highlight query and predicates |   1345.1 |    1172.7 |
| Cold    | Diagnostic work proxy          |   4489.5 |    4358.2 |
| Warm    | Complete highlighted frame     |   4659.9 |    4413.4 |
| Warm    | Full worker work               |   4520.3 |    4286.0 |
| Warm    | Highlight query and predicates |   1256.4 |    1146.9 |
| Warm    | Diagnostic work proxy          |   4532.2 |    4298.2 |

Cold phases pass the frozen guards. Warm overlap resolution increased from
163.7 to 210.9 ms, a 47.2 ms increase against the unchanged 7.0 ms allowance.
The five candidate observations span 207.9–214.7 ms; this is retained as a failed
window. The cause of that phase increase is unconfirmed. The original-M0 phase
comparison also fails that guard. All twenty timing samples preserve canonical
tokens, palette/style, structural output, actual root coverage and query-limit
proof. Candidate worker work and the original work-proxy ceilings still miss M1.

All sixteen matched 1 MiB/10 MiB controls preserve complete canonical output:
realistic TypeScript, long lines, Unicode, malformed source, injections, dense
injections, dense recovery and HTML. The matched dense-injection lifecycle
control passes edits, multiple documents, cancellation and disposal checks.
Every matched whole-job memory peak stays below twice its baseline. Retained
process RSS, WASM sizes, JavaScript heap observations, all samples and p95 values
are in the raw experiments and comparison. Markdown qualification, allocator-live
bytes and byte-identical grammar rebuilds remain incomplete.

The separate overhead-heavy counter diagnostic preserves canonical output. Its
highlight query still evaluates 748,985 predicates, but node text/source reads
fall from 748,985 to 149,797. Returned source units fall from 3,067,241,055 to
748,985; the latter equals the consumed node-text units. Repeated reads are
eliminated within that invocation. These are callback-returned UTF-16 units,
not a measurement of allocated or copied bytes. Diagnostic durations are
inclusive and overhead-heavy; they are excluded from acceptance timing.

Capture materialization remains the next bounded candidate: the diagnostic
still records 1,947,361 capture-unmarshal passes and node wrappers. Counters
measure calls, not allocator totals. Profile that production path and preserve
all query/predicate/capture ordering and canonical output before changing its
representation. Any runtime change again needs its own reviewed tree-sitter-x
PR, followed by a new prospective paired window. The failed current window
cannot be rescued with unchanged-code reruns.

Verification: the runtime's binding suite and compatibility CI pass with the
reviewed source; Fregat builds 27 workspace packages; all 39 benchmark probe
tests and 34 source/worker/runtime-identity tests pass; tree-sitter TypeScript
and the React web consumer typecheck pass. Node resolution confirms Markdown
and its host use the same pinned runtime. Its WASM remains byte-identical to the
qualified artifact: SHA-256
`65aa79c497fe2172b9d635af91f7004129ba2728eeb41eb226c17de208ed5eed`.
The temporary diagnostic transform was removed and the ordinary benchmark
build restored.

### Standalone runtime identity repair, 2026-10-09

Status: Approved. The hoisted standalone Editor check in Fregat #1086 found a
second runtime below Markdown. The root Fregat override had hidden the mismatch:
Markdown still required artifact `3805c892`, while the host used `a052adf5`.
The original failed qualification observations above remain unchanged.

Reviewed [tree-sitter-md #11](https://github.com/ShaulLavo/tree-sitter-md/pull/11)
aligns its required peer and development dependency with `a052adf5`. The normal
runtime updater now pins merged Markdown source
`00b65ee848d7ea6a3f6123b0507b7a791d6a6769` throughout the consumer manifests,
language catalog and release fixture. Grammar and resolver binaries are
unchanged. The standalone Editor root also overrides the runtime, and the
updater includes that root and the documentation site's development pin.
This keeps nested and standalone installations on the same artifact.

Verification runs the standalone action's install, build, typecheck, lint and
format checks, then both runtime identity and host-loaded Markdown tests in
isolated and hoisted installations. The updater and authored-pin tests cover
the mirror override, documentation site and exact required Markdown peer.

### Candidate experiments and overlap attribution, 2026-10-09

Approved. Candidate PRs now use a short paired A/B experiment with identical
canonical output. Experiment numbers stay labelled as experiments. Run the full
frozen qualified protocol when a candidate appears to meet M1, M2 or M3. The
original structural and predicate-read failed windows remain failed and retained.

The independent review of [#1086](https://github.com/ShaulLavo/fregat/pull/1086#issuecomment-6071208625)
attributed approximately 45.8 ms of its original 47.2 ms warm overlap increase to
worker garbage collection. All five original warm candidates collected the old
generation in that phase; no original warm baseline did. This is an upstream
allocation/retention effect in unchanged overlap code. The review did not isolate
bounded strings from the query-local text cache.

A separate four-run warm ABBA experiment added direct worker overlap markers.
Canonical hashes, actual coverage and query-limit proof remain identical in both
pairs. Baseline overlap was 251.511 and 187.135 ms, including 143.989 and 88.228 ms
of top-level worker GC pauses. Candidate overlap was 203.272 and 209.749 ms,
including 98.225 and 101.562 ms of GC. Both candidates collected the old generation;
neither baseline did. Wall time after subtracting those GC intervals was
107.522/98.907 ms baseline and 105.047/108.187 ms candidate.

The phase's GC mechanism is confirmed directly. The exact 47 ms delta is not
stable across these exploratory runs, and this experiment does not establish
the responsible allocation or rescue the original failed qualification.
[Raw traces and experiment proofs](https://github.com/ShaulLavo/fregat/tree/main/editor/docs/performance/singapore-full-parse-2026-10-08/overlap-experiment)
retain both pairs and the marker/GC attribution.

Two capture-allocation experiments were rejected. Both retain complete canonical
hashes, root coverage, query-limit proofs and all four cold/warm observations.
The full query-local native-node cache passed 151 native and grammar differential
tests, but increased highlight-query work from 1247.8 to 1435.0 ms cold and from
1134.0 to 1346.3 ms warm. Complete frames changed from 4558.8 to 4735.9 ms cold
and from 4396.1 to 4546.3 ms warm.

Lazy public start-position objects and reused rejected-match arrays passed 150
native tests and a fresh TypeScript graph, but produced no consistent gain.
Complete frames changed from 4556.0 to 4606.2 ms cold and from 4391.8 to
4408.1 ms warm. Highlight queries changed from 1232.6 to 1207.0 ms cold and
from 1141.7 to 1200.1 ms warm. Overlap changed from 137.7 to 163.6 ms cold
and from 209.4 to 224.8 ms warm. The source and exact compiled bundles of both
rejected designs are retained with their original measurements. Neither was
published or rerun as an acceptance window.

The next experiment uses flat capture ranges in accepted-match order. It decodes
predicate-free native records without public Node or Point wrappers, and only
materializes predicate-bearing matches. Native execution, options, properties,
text predicates and query-limit semantics stay shared with ordinary matches.
Injection and fold consumers retain grouped node-bearing matches. A separately
reviewed runtime PR must precede any consumer dependency pin.
