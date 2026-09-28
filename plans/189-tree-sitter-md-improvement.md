# Plan 189: Keep improving tree-sitter-md

## Status and authorization

- Status: APPROVED 2026-09-26 (owner). Ongoing: it follows [Plan 176](176-markdown-parser.md), which
  releases `tree-sitter-md` (its Phase 0) and puts it in the Editor (Phases 1–3). This plan owns
  what comes after: the open items the spike left, then three passes (correctness, memory and bundle
  size, speed). Each pass ships as its own releases of the package.
- Repository: [ShaulLavo/tree-sitter-md](https://github.com/ShaulLavo/tree-sitter-md) (MIT), npm
  `tree-sitter-md`. Spike findings: `docs/FINDINGS.md` in that repository; Platform measurements in
  [`docs/markdown-parser/measurements.md`](../docs/markdown-parser/measurements.md).
- Refreshed 2026-09-28 against `tree-sitter-md` `ab81f6c`. The C rewrite and shared-runtime
  extension are complete. The two extension modules total 74,937 gzip bytes, excluding host/JS.
  The spec score remains 672/676. The expanded stress runner reports 120 incremental/fresh
  mismatching comparisons, and depth 256 still traps. Those release blockers belong to Plan 176
  Phase 0. Its current-state table links the evidence and separates historical timing runs.

## Rules for every pass

- **Measure first, then change.** Each pass starts by committing its benchmark or corpus, records
  the before number, and ends with the after number in the repository's findings.
- **Ratchet gates.** CI in the repository holds the spec floor, the fuzz check (incremental equals
  fresh), the corpus mismatch count, a size budget and speed budgets. A pass may tighten a gate and
  never loosen one. The Editor pins a published version; a new release reaches Platform through an
  ordinary Editor bump.
- **No pass trades another away silently.** A size or speed change reports all three numbers.

## Boundary with Plan 176

Plan 176 Phase 0 owns the four spec failures, frontmatter switch, existing incremental/fresh
mismatches and nesting safety, CI and first publish. Its Phase 1 owns document integration,
correct first paint, reference readiness, cold-load warm-up and the measured scheduling decision.
The [behaviour contract](../docs/markdown-parser/editor-behaviour.md) replaces a fixed prefix-append
assumption. Chunking is not a separate deferred task here: if needed for responsive integration,
it must be proved in Phase 1. CodeMirror's scheduling is precedent, not an API the current parser has.

After that release, this plan owns new differential findings, extensions, and measured improvements
to the shipped budgets. For the 33 task-item paragraph shapes and 3 positionless mdast autolinks,
retain explicit per-construct differences until the rendering contract requires a change. Example
260 belongs to Plan 176's four-spec-failure gate; offer its scanner fix upstream when it lands.

## Pass 1: correctness

Goal: the 676 examples all pass, and nothing we render differs from micromark except where we chose
to.

- **Differential fuzzing against micromark.** Generate random markdown (nesting, delimiters, links,
  entities, HTML, tables, lists) and compare construct lists with micromark + GFM. Every difference
  becomes a spec-style fixture before it is fixed.
- **A larger corpus.** Every `.md` file under `references/` (thousands of real READMEs and docs)
  plus Platform and Editor, run through the corpus check in CI as a mismatch count that only goes down.
- **Full GFM.** Tables, strikethrough, task lists and autolinks against the whole GFM spec, not only
  its extension examples.
- **Extensions, all required** (owner, 2026-09-26: every one ships in this plan; none is optional
  scope): footnotes, `$$` math, CJK-friendly flanking, wiki links, callouts (`> [!NOTE]`, GitHub
  alerts included) and `==highlights==`. Each has its own parse option, so a consumer turns on the
  ones it wants. With all options off the spec runner holds the plain CommonMark and GFM floor; with
  each option on, its own test suite and the corpus check against micromark with the matching
  extension. This covers what chat needs from remark (Plan 176 question 2) and Plan 108's Obsidian
  phase. The resolver is C on cmark (Plan 176 Phase 0), which has none of these: footnotes port from
  cmark-gfm's extension; math, wiki links, callouts, highlights and CJK flanking are written here
  (pulldown-cmark had math, wiki links and GitHub alerts; choosing C moved them into this pass).

## Pass 2: memory and bundle size

Start from Phase 0's released extension and re-measure its complete host/JS/grammar/resolver
payload and per-document memory. The old Rust 193 KB figure and standalone C 130 KB figure are
historical baselines, not current bundle costs.

- **Size.** Compare `-Oz`, `-O3` and `wasm-opt` with speed and cold-load results; investigate entity
  tables and unused exports. Runtime sharing already landed through `tree-sitter-x`; do not repeat
  the stock-web-tree-sitter side-module experiment or plan a tree-transfer adapter. Measure both
  main-thread and worker loading, since they cannot share one wasm heap across realms.
- **Memory.** Stop holding the document twice: read text from JS in chunks or keep one UTF-8 copy;
  bound the per-paragraph inline cache; reuse linear memory across documents, since a wasm heap grows
  and never shrinks.
- Proposed targets, to confirm with the first measurements: ≤ 100 KB gzip, ≤ 3 MB of linear memory
  for a 1 MB document.

## Pass 3: speed

- **Budgets in CI**, like the Editor's `bench:check`: keystroke median and p95 at 46 KB and 1 MB,
  first frame warm and cold, full parse, first reparse after open.
- **Profile before tuning.** A per-function profile of a keystroke and a full parse (native and
  wasm) names where the time goes: scanner, parse tables, the inline resolver, or the JS boundary.
- **Candidates**, each kept only with a measured win: fewer records crossing into JS per request,
  resolver caching keyed on paragraph text, a cheaper scanner state for the block grammar, and
  `opt-level` chosen with Pass 2.

## Order

After Plan 176's release and integration gates, run these passes against the shipped baseline.
Coordinate shared resolver/runtime files when scheduling work. The wave placement remains in
[docs/next-wave.md](../docs/next-wave.md); Plan 176 owns integration blockers and this plan owns
subsequent improvements.
