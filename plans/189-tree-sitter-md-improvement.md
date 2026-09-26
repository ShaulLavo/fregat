# Plan 189: Keep improving tree-sitter-md

## Status and authorization

- Status: PROPOSED 2026-09-26 (owner). Ongoing: it follows [Plan 176](176-markdown-parser.md), which
  releases `tree-sitter-md` (its Phase 0) and puts it in the Editor (Phases 1–3). This plan owns
  what comes after: the open items the spike left, then three passes (correctness, memory and bundle
  size, speed). Each pass ships as its own releases of the package.
- Repository: [ShaulLavo/tree-sitter-md](https://github.com/ShaulLavo/tree-sitter-md) (MIT), npm
  `tree-sitter-md`. Spike findings: `docs/FINDINGS.md` in that repository; Platform measurements in
  [`docs/markdown-parser/measurements.md`](../docs/markdown-parser/measurements.md).
- Starting point (spike, 2026-09-26, Rust resolver; Plan 176 Phase 0 moves it to C at the same
  numbers or better): 672/676 spec examples, 0 real mismatches against micromark on
  our corpus, keystroke at 1 MB 0.49 ms median and 1.0 ms p95, first frame 0.36 ms warm and
  6.4–9.5 ms cold, full parse 26 ms at 1 MB, 193 KB gzip, 7.5 MB linear memory for a 1 MB document.

## Rules for every pass

- **Measure first, then change.** Each pass starts by committing its benchmark or corpus, records
  the before number, and ends with the after number in the repository's findings.
- **Ratchet gates.** CI in the repository holds the spec floor, the fuzz check (incremental equals
  fresh), the corpus mismatch count, a size budget and speed budgets. A pass may tighten a gate and
  never loosen one. The Editor pins a published version; a new release reaches Platform through an
  ordinary Editor bump.
- **No pass trades another away silently.** A size or speed change reports all three numbers.

## Open items from the spike (after Plan 176 Phase 0)

Plan 176 Phase 0 owns the inline pass rewrite, the four spec failures, the frontmatter switch, CI
and the first publish. What remains:

1. **Chunked append** (S–M). `setText` on a 1 MB file appends the rest after the first 60 rows as one
   29 ms task. Split it into idle-time chunks that keep incremental equal to fresh.
2. **Cold first frame** (S). 6.4–9.5 ms cold against 0.4 ms warm is V8 compiling wasm lazily. Try
   eager compile hints and one throwaway parse during Plan 170's warm-up; measure in Chromium.
3. **Corpus differences that are shape, not error** (S). The 33 task-item paragraph shapes and the
   3 autolink literals without positions: decide per construct whether to match mdast or document
   the difference.
4. **Example 260** (S). The lazy continuation inside nested quotes fails in upstream's scanner too;
   fix it here and offer the fix upstream to tree-sitter-markdown.

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

Starting at Phase 0's C release; the spike measured 193 KB gzip (pulldown-cmark ~120 KB of code, the
tree-sitter C runtime 96 KB, parse tables and data 178 KB raw) and 7.5 MB of linear memory for a 1 MB
document (2 MB of it the UTF-16 text). Re-measure before the first change.

- **Size.** `-Oz` against `-O3` and `wasm-opt` (the Rust build measured 161 KB at `opt-level=z`, 10–20%
  slower keystrokes, so decide with Pass 3's numbers); compress or drop the entity table; strip what
  the Editor never calls. If Phase 0 found that grammar and resolver load as one web-tree-sitter side
  module, drop the module's own tree-sitter runtime and share the Editor's; otherwise measure the
  cost of the tree crossing a module boundary against the 96 KB.
- **Memory.** Stop holding the document twice: read text from JS in chunks or keep one UTF-8 copy;
  bound the per-paragraph inline cache; reuse linear memory across documents, since a wasm heap grows
  and never shrinks.
- Proposed targets, to confirm with the first measurements: ≤ 100 KB gzip, ≤ 3 MB of linear memory
  for a 1 MB document.

## Pass 3: speed

- **Budgets in CI**, like the Editor's `bench:check`: keystroke median and p95 at 46 KB and 1 MB,
  first frame warm and cold, full parse, first reparse after open (8.6 ms at 1 MB today).
- **Profile before tuning.** A per-function profile of a keystroke and a full parse (native and
  wasm) names where the time goes: scanner, parse tables, the inline resolver, or the JS boundary.
- **Candidates**, each kept only with a measured win: fewer records crossing into JS per request,
  resolver caching keyed on paragraph text, a cheaper scanner state for the block grammar, and
  `opt-level` chosen with Pass 2.

## Order

Open items 1–2 with Plan 176 Phase 1 (they need the real Editor document); then the three passes,
which touch different code and can run in parallel. Scheduled in wave 3 of
[docs/next-wave.md](../docs/next-wave.md), after wave 2's MD lane.
