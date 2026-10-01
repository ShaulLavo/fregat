# Workspace Content Engine Evaluation Plan

Status: draft

This plan covers evaluating indexed content-search engines for workspace search. It is intentionally separate from the shipped path-index foundation summarized in [Workspace Search Next Steps](workspace-search-next-steps.md). That foundation keeps ripgrep as the content engine; this plan asks whether ripgrep should later be augmented or replaced for persisted workspace content search.

## Candidates

Primary candidates:

- `rg`: current baseline and correctness oracle.
- `erogol/ngi`: trigram-indexed regex search that prefilters candidate files and delegates exact matching to ripgrep when useful.
- `PythonicNinja/trigrep`: disk-backed trigram / sparse n-gram indexed regex search.
- `sourcegraph/zoekt`: mature trigram-based code search engine with query language, service mode, ranking, and local directory/repo indexing.
- `dmtrKovalenko/fff`: resident file/content search engine with a background watcher and incremental re-indexing, shipping a Node/Bun SDK. Unlike the others it spans **both** layers — path search and content search — so it is the first candidate that questions the workspace path index as well as ripgrep.

Candidate URLs:

- https://github.com/erogol/ngi
- https://github.com/PythonicNinja/trigrep
- https://github.com/sourcegraph/zoekt
- https://github.com/dmtrKovalenko/fff

## Scope

In scope:

- Persisted workspace content search.
- Literal and regex content queries.
- Include and exclude path filters.
- Case sensitivity.
- Whole-word matching if supported or emulatable.
- Streaming or first-result latency where possible.
- Index build, update, and invalidation cost.
- Correctness parity against ripgrep.

Out of scope:

- Current-file editor find.
- Dirty open-buffer search.
- Whole-filesystem search.
- Workspace quick-open path search.
- AST search and semantic search.
- Replace-in-files execution. Replacement should continue to validate against current file contents independently.

## Principle

Ripgrep remains the fallback and oracle until another engine proves all required behavior.

An indexed engine can accelerate candidate selection, but exact matches must still be verified. False positives are acceptable if final results are exact. False negatives are not acceptable.

## Content Search Engine Interface

Add an internal interface before integrating any engine deeply.

Required behavior:

- Accept `WorkspaceSearchQuery`.
- Accept workspace root and path scope.
- Accept cancellation.
- Emit normalized `WorkspaceSearchEvent` values.
- Report provider metadata and timings.
- Report whether the result was indexed, fallback, full scan, or partial.
- Return warnings for unsupported query features instead of silently changing behavior.

Expected implementations:

- `RgContentSearchEngine`.
- `NgiContentSearchEngine`.
- `TrigrepContentSearchEngine`.
- `ZoektContentSearchEngine`.
- `FffContentSearchEngine`.

The engine interface should sit below the current disk provider. Open-buffer overlay should remain outside it.

## Benchmark Matrix

Benchmark each engine on the same workspace roots.

Workspaces:

- This repository.
- A medium TypeScript/React repository.
- A large monorepo if available locally.
- A synthetic fixture with many files and controlled match distribution.

Query classes:

- Selective literal: one rare symbol.
- Common literal: `function`, `const`, `import`.
- Short literal: one or two characters.
- Regex with required literals: `import.*from.*react`.
- Alternation: `TODO|FIXME|HACK|XXX`.
- Anchored regex: `^\\s*export\\s`.
- Whole word query.
- Case-insensitive query.
- Include glob query.
- Exclude glob query.
- Query with zero matches.
- Query that matches binary-looking or very large files.

Metrics:

- Cold index build time.
- Incremental update time after editing one file.
- Incremental update time after editing many files.
- Index disk size.
- Peak memory during indexing.
- Warm query total latency.
- First-result latency.
- Result count parity with ripgrep.
- File count parity with ripgrep.
- Output normalization cost.
- Cancellation latency.
- Behavior when index is missing, stale, or corrupt.

## Correctness Harness

Use ripgrep as the reference.

For each query:

- Run `rg` with the current app semantics.
- Run each candidate engine.
- Normalize path separators, line numbers, column numbers, and line text.
- Compare file paths and match ranges when available.
- Categorize mismatches as unsupported feature, false positive after verification, false negative, or output-shape mismatch.

The harness should record:

- Engine command.
- Query options.
- Workspace root.
- Index state.
- Raw summary output.
- Normalized mismatch report.

False negative reports should block promotion.

## Candidate Notes

### `ngi`

Strengths:

- Small Rust CLI.
- Designed around trigram prefilter plus ripgrep exact matching.
- JSONL output.
- Auto-builds and incrementally updates an index.
- Falls back to full ripgrep scan when the candidate set is too broad.

Concerns:

- Very young project.
- No release history at the time of review.
- Index location defaults to `.ngi/` in the project root.
- Need to verify cancellation, path filters, ignore semantics, and JSON stability.
- Need to verify behavior on non-git workspaces.

Best use:

- Fast spike to answer whether a lightweight indexed-ripgrep wrapper is materially better for our workloads.

### `trigrep`

Strengths:

- Rust implementation.
- Disk-backed trigram index.
- Explicitly targets large codebase and agent search workloads.
- Has separate CLI and index crates.

Concerns:

- Young project.
- Need to verify output format, query feature coverage, incremental updates, and ignore semantics.
- Need to decide whether it offers enough over `ngi` to justify maintaining both integrations.

Best use:

- Compare against `ngi` as another lightweight local indexed grep design.

### Zoekt

Strengths:

- Mature code search engine.
- Supports substring and regexp matching.
- Rich query language with boolean operators.
- Local directory and git repo indexing.
- Service mode exists.
- Ranking can use code-oriented signals and symbols.

Concerns:

- Larger integration surface.
- Go-based service/tooling in an otherwise Bun/TypeScript server path.
- Index size can be significant.
- Query semantics differ from ripgrep.
- Need to decide how local unsaved changes and near-real-time updates should be handled.
- Need to verify whether command mode or service mode is the right integration.

Best use:

- Serious long-term content-search backend candidate if lightweight engines are not enough.

### `fff`

Added 2026-08-21. Every number below is the project's own claim and none of it has
been reproduced here; that is what the benchmark harness is for.

Strengths:

- Attacks the cost we actually pay. Our disk provider spawns `fd` and `rg` per
  query; `fff` is built around the opposite model, and the README puts it as: on a
  500k-file Chromium checkout, the difference between 3-9 seconds per ripgrep
  spawn and sub-10ms per query. That is the same insight the workspace index was
  built on, taken further and applied to content as well as paths.
- Spans both layers. Frecency-ranked fuzzy path matching _and_ three-mode content
  search (plain / regex / fuzzy), plus a background watcher with incremental
  re-indexing, git status caching, and definition-line classification. Those map
  onto `workspace-index.ts`, `fuzzy-rank.ts`, our `fd`/`rg` spawning, and parts of
  the git feature.
- Real Node/Bun SDK: `@ff-labs/fff-node`, MIT, prebuilt binaries for
  darwin/linux/win32 x64+arm64, so no Rust toolchain at install time.
- Claimed footprint is modest: ~26 MB resident for a 100k-file repo, ~360 bytes
  per file of content index.
- Active and widely used — ~10k stars, and it reportedly backs file search in
  nushell and opencode.

Concerns:

- Version 0.10.x with a very high release cadence. The API is moving.
- The SDK binds through `ffi-rs`, a Node N-API FFI layer. Our server runs under
  Bun, which has its own `bun:ffi`. **Whether `ffi-rs` loads under Bun at all is
  the first thing to check** — if it does not, the C FFI (`libfff_c`) or the MCP
  server become the integration surface instead, with very different costs.
- A resident engine owns process lifecycle, memory, and index storage. We would
  need workspace open/close/switch semantics for it, which is the same problem the
  Zoekt service-mode experiment raises.
- Ranking is its own. Our `fuzzy-rank.ts` is shared through the contracts package
  and also serves the command palette, so adopting `fff` ranking for paths means
  either two rankers or a wider migration.
- Correctness parity still has to be proven against `rg` like any other candidate.
  Fuzzy content search in particular has no `rg` equivalent to check against.

Best use:

- The strongest single candidate to evaluate first, because it is the only one
  that could collapse `fd` + `rg` + `workspace-index.ts` into one dependency. If
  the Bun/FFI question answers well, spike it before the trigram engines.

## Integration Experiments

### Experiment 1: External CLI Adapters

Run each candidate as a child process.

Goals:

- Prove query coverage.
- Measure command startup overhead.
- Measure output parsing cost.
- Avoid deep integration until the candidate is validated.

Acceptance:

- Engine can be installed locally.
- Engine can index a workspace.
- Engine can return normalized matches.
- Engine can be cancelled.
- Engine can fall back to `rg` or report unsupported features.

### Experiment 2: Index Lifecycle

Exercise index build and update behavior.

Scenarios:

- First search with no index.
- Explicit rebuild.
- File edit.
- File create.
- File delete.
- File rename.
- Branch checkout or mass file churn.
- Index corruption or missing index files.

Acceptance:

- Search remains correct.
- Failure mode is fallback, rebuild, or clear warning.
- The app never returns stale false-negative results silently.

### Experiment 3: Service Mode For Zoekt

Evaluate whether Zoekt should run as a long-lived service.

Questions:

- Can we maintain one index per workspace?
- Can we choose index storage outside the repo root?
- Can we stream or page results?
- Can we update incrementally enough for active development?
- Can we shut down cleanly when a workspace closes?

Acceptance:

- Service lifecycle is predictable.
- Index storage is app-owned.
- Search requests are cancellable or bounded.
- Query results can be normalized into existing `WorkspaceSearchEvent` values.

## Promotion Criteria

A candidate can become an optional provider when:

- It has no false negatives against the benchmark harness for supported query classes.
- Unsupported query classes reliably fall back to `rg`.
- Warm query latency is materially better than `rg` for selective and medium-selective searches.
- Broad queries are not materially worse than `rg`.
- Index build and update cost is acceptable.
- Disk usage is acceptable for normal workspaces.
- The engine can be disabled with one config flag.
- The app can recover from missing, stale, or corrupt indexes.

A candidate can replace ripgrep as default only after:

- It has been optional for a while.
- It has telemetry showing reliable wins.
- It handles cancellation and stale indexes safely.
- It has clear operational behavior across workspace open, close, rename, and branch changes.

## Deliverables

- Benchmark harness.
- Normalized result comparator against ripgrep.
- Bun/FFI feasibility answer for `@ff-labs/fff-node`.
- Engine adapter spike for `fff`, covering both path and content search.
- Engine adapter spike for `ngi`.
- Engine adapter spike for `trigrep`.
- Engine adapter spike for Zoekt command mode.
- Zoekt service-mode notes.
- Summary table with recommendation.

## Recommended Order

1. Build the engine interface using `rg`.
2. Add the correctness harness.
3. Answer the cheap blocking question for `fff`: does `@ff-labs/fff-node` load
   under Bun? A few minutes of work that decides whether step 4 is possible.
4. Spike `fff`, for both path and content search.
5. Spike `ngi`.
6. Spike `trigrep`.
7. Spike Zoekt command mode.
8. Evaluate Zoekt service mode only if command mode results justify deeper work.

## References

- Current server search: `apps/server/src/fs/search.ts`
- Current search tool runner: `apps/server/src/fs/search-tool-runner.ts`
- `fff`: https://github.com/dmtrKovalenko/fff
- `fff` Node SDK: https://www.npmjs.com/package/@ff-labs/fff-node
- `ngi`: https://github.com/erogol/ngi
- `trigrep`: https://github.com/PythonicNinja/trigrep
- Zoekt: https://github.com/sourcegraph/zoekt
- Zoekt design: https://github.com/sourcegraph/zoekt/blob/main/doc/design.md
