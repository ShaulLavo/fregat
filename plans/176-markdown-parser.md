# Plan 176: One markdown parser

Owner direction, 2026-09-28: [Markdown experiences](../docs/markdown-experiences.md)
extends the target to visual and source-revealing authoring, rich composition and
streaming chat on our parser. Keeping remark for chat and split rendering was
the scope of the completed integration below. Migrating those consumers remains
required future work, with streaming and rendering acceptance checks.

## Status and authorization

- Status: **IMPLEMENTED**, refreshed 2026-09-28.
  Owner adopted `tree-sitter-md` on 2026-09-26. The C resolver rewrite and the subsequent
  `tree-sitter-x` extension migration have landed upstream. Phase 0 below is the remaining
  release gate; do not repeat those migrations. The parser serves the source-backed live preview
  and future rendered blocks inside the Editor. Chat and the existing split renderer keep remark.
- Released parser: `tree-sitter-md@0.1.0`, source `5dd917a`. Editor integration and Platform
  CI pin: `7edf180cea1e03a477db4c4626d39c9e985cdb3b`.
- The original research and Rust measurements below are historical. The
  [current implementation and release gate](#current-implementation-and-release-gate) supersede
  their packaging, completion and performance claims. The [behaviour research](../docs/markdown-parser/editor-behaviour.md)
  separates observed editor practices from the proposed integration contract.
- Replaces [Plan 108](108-markdown-modes.md) D5. Plan 108 Phase 2 and the chat parser decision
  wait on this plan. [Plan 111](111-editor-decorations.md)'s decoration API does not.
- Planned at: Platform `d42184dc`, Editor `74e76be`, 2026-09-26. Researched at Platform
  `c130dd35a`, Editor `74e76be`. Origin: the investigation into markdown files painting as raw
  source before their live-preview decorations land.
- Method, tables and pinned versions: [docs/markdown-parser/measurements.md](../docs/markdown-parser/measurements.md).

## Implementation evidence — 2026-09-28

- Published `tree-sitter-md@0.1.0` from `5dd917a`; npm tarball integrity matches the verified pack.
- Phase 0: 676/676 spec, 240 JS tests, 11,300 fuzz edits plus negative control, 183 chat messages,
  497 pinned repository fixtures with zero unexpected differences, native ASan/UBSan and nine
  packed Node/Bun/Chromium initialization checks pass.
- [Current complete-source browser measurements](https://github.com/ShaulLavo/tree-sitter-md/blob/5dd917a/docs/RELEASE-0.1.md)
  replace historical first-frame/payload numbers below. Giant blocks exceed frame/input budgets;
  the integration uses a retained worker parser and exact revision-bound visible outputs.
- Editor integration uses one retained owner across hover and view attachments, including the
  necessary Plan 198 ownership API. Live preview consumes records; colors, folds and fence ranges
  use the same MarkdownDocument. Old Markdown/inline grammars and queries are removed.
- Focused validation: 368 Editor lifecycle/owner/inline/fold tests, 64 real worker browser checks,
  73 language checks and 92 Platform ownership/preparation tests. Repository gates and Editor,
  Platform and scenario typechecks pass. An independent audit verified ownership, cancellation,
  stale-result admission and disposal.
- Browser source editing passes for a complete 1 MB document, including EOF references, exact
  preview rows, fenced-code keyword colors, copy, save, undo, redo and paste. Screenshots read
  from `/work/tmp/fregat-evidence/20260928T152358Z-scenario-markdown-source-editing`.
- Tab revisits after 0, 2 and 35 seconds show complete Markdown preview and fenced-code
  colors with the first text frame, with zero uncolored frames. Screenshots read from
  `/work/tmp/fregat-evidence/20260928T152414Z-scenario-editor-tab-hover-highlights`.
- Final first-paint trace: cold quick-open Markdown text/color/preview at 94 ms, warm at
  63 ms, keyboard revisit at 61 ms. Cold tree open shows editable source at 87 ms and complete
  color/preview at 118 ms; prepared tree opens paint together. Evidence:
  `/work/tmp/fregat-evidence/20260928T152625Z-trace-prefetch-first-paint`.
- Markdown and MDX use the shared parser for colors, including code fences, under every theme.
  The source-backed preview is enabled for Markdown. Chat and split rendering retain remark.

The following release inventory records the state before implementation; the evidence above
supersedes its remaining-work and benchmark claims.

## Current implementation and release gate

The [current upstream package](https://github.com/ShaulLavo/tree-sitter-md/tree/ab81f6cb216c102dd6e551c095843d1a08da6ba2)
loads two artifacts, a block grammar and a C resolver extension, into `tree-sitter-x`. It shares
that host's tree-sitter runtime and memory in a realm. Main thread and worker remain separate
realms; this does not share a heap across them. Both the package and Editor pin the fork's built
`web-tree-sitter` dependency to `e2985e082d9f3f137ca20af6d7cee9d1a1c8ddda`.

Recorded evidence, not fresh benchmarks from this documentation pass:

| Stage                          | Evidence                                                                                                                            | Meaning for implementation                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| C rewrite, merged as `299aa70` | 672/676 spec cases; 183/183 chat messages; exact gate over 497 docs; 129,793 gzip bytes; 1 MB edits 0.438 ms median / 0.891 ms p95  | Rewrite complete; these are the standalone C artifact's historical figures                                   |
| Shared runtime, `ab81f6c`      | Resolver 54,897 + grammar 20,040 gzip bytes; 109 focused tests reported passing; spec remains 672/676                               | About 75 KB for the two modules, excluding host runtime/JS; runtime-sharing spike complete                   |
| Extension measurements         | Separate Node 22/container run reports warm 1 MB edits 0.6412 ms median / 1.3590 ms p95; some bulk workloads regress                | Re-measure the integrated Editor on the same machine; do not compare directly with the older Node 26 figures |
| Expanded stress suite          | 120 incremental/fresh discrepancies reported in both old and new builds; 256-level nesting still fails                              | Migration equivalence is not a clean correctness gate; reduce and resolve these before release               |
| Release plumbing               | No `.github` workflows in the inspected upstream tree; constructor exposes only `gfm`; npm `latest` returned HTTP 404 on 2026-09-28 | Frontmatter option, CI and first publish remain                                                              |

Sources: [C review measurements](https://github.com/ShaulLavo/tree-sitter-md/blob/ab81f6cb216c102dd6e551c095843d1a08da6ba2/docs/FINDINGS.md#review-fixes-and-current-artifact),
[extension measurements](https://github.com/ShaulLavo/tree-sitter-md/blob/ab81f6cb216c102dd6e551c095843d1a08da6ba2/docs/measurements/tree-sitter-x/README.md),
and the [stress runner](https://github.com/ShaulLavo/tree-sitter-md/blob/ab81f6cb216c102dd6e551c095843d1a08da6ba2/experiments/perf-next/stress.mjs).
The 120 figure counts reported comparisons, not 120 independent bugs.

Development can continue with Phase 0. Editor release is gated on its correctness work. Full
rendered-block UX additionally needs Plan 111 Phases 4–5 and Plan 108 Phase 2; a parser alone does
not provide block layout, hit testing or editing controls. Document lifetime and result admission
must follow [Plan 198](198-document-owned-editor-analysis.md), with one compatible parser document
per retained buffer and view-specific selections and range demands.

## Outcome

One parser supplies structure for source-backed live preview and future fully rendered blocks
inside the Editor, along with colours, folds and fence boundaries. The existing split view and
chat keep remark. The historical research below explains the parser choice.

Owner direction, 2026-09-26: lean towards tree-sitter as the only markdown parser, editor and chat,
if it can be made correct and fast enough. `@lezer/markdown` is a benchmark candidate and a fork of
it is acceptable. remark stays in chat until a candidate matches it.

Owner, 2026-09-26: explore a custom tree-sitter grammar with a Rust inline resolver in its own repo
(`tree-sitter-md` on npm), consumed by the Editor as wasm; it is the preferred shape if it clears
the bar.

Owner, 2026-09-26: the resolver moves to C. The block grammar is a tree-sitter fork, so its scanner,
parse tables and runtime are C already; Rust only made sense for a parser written from scratch. One
language and one clang toolchain build the whole module, and the inline pass is vendored from the
CommonMark reference implementation (`commonmark/cmark`).

## Baseline at the original research revision

- **Live preview reads highlight captures, not the tree.** `@singapore-editor/markdown` receives
  `{ startIndex, endIndex, captureName }` records (`Editor/packages/editor/src/syntax/session.ts:9`).
  The tree stays in the worker, and the worker flattens every query match into loose captures, so
  the relationship between a link's `[` and its `)` is gone. The inline query names emphasis
  delimiters, code-span delimiters and all link brackets `punctuation.delimiter`
  (`tree-sitter-languages/src/queries/markdown-inline-highlights.scm`), because it was written for
  colour. `replacements.ts` rebuilds constructs by containment and adjacency, and skips any span
  that crosses a line, so `**bold across\n> two lines**` in a quote stays raw.
- **The grammar is `@tree-sitter-grammars/tree-sitter-markdown` 0.3.2**, the last npm release
  (2024-09). Upstream's GitHub is at v0.5.3 (2026-02) and passes exactly the same spec examples. It
  is two grammars, block and inline; upstream's README: "it is not recommended to use this parser
  where correctness is important".
- **Table cells are never inline-parsed.** `markdown-injections.scm` injects `markdown_inline`
  into `(inline)` only; upstream's Rust binding parses `inline` and `pipe_table_cell`. Bold, code
  and links inside a cell render raw; 167 of 382 Platform docs have tables.
- **One inline parse per paragraph, capped.** Every `inline` node is its own layer, up to
  `MAX_INJECTION_LAYERS = 256` (`tree-sitter/src/treeSitter/treeSitter.worker.ts:140`), counting
  fences and nested injections in document order. Past the cap everything stays raw: in a
  300-paragraph file paragraphs 289–300 show `**bold**`, `*em*`, `` `code` `` and a Markdown link
  unrendered (evidence `/work/tmp/fregat-evidence/20260926T095101Z-scenario-research-176-preview/`).
  `AGENTS.md` has 258 inline nodes; 10 Platform docs exceed the cap.
- **Injection ranges include child nodes.** The worker injects a node's whole range; tree-sitter's
  convention (and the markdown binding) excludes named children unless
  `injection.include-children` is set. For markdown that feeds `> ` continuations to the inline
  grammar, with no difference measured on the spec; for other languages it is a latent bug.
- **Decorations are always a second pass.** Captures come only from the tree-sitter worker
  (`syntaxController.ts:1259`), after the raw text has painted. Plans
  [170](170-language-census.md) (warm-up) and [177](177-prefetch-every-press.md) (prefetch) own
  those paths.
- **Chat runs remark.** `@workspace/markdown` (Plan 107) is `unified` with `remark-parse`,
  `remark-gfm`, `remark-math`, `remark-cjk-friendly` (and its strikethrough companion) and
  `mdast-util-to-hast`, plus tail-only healing (`remend`) and an incremental prefix parse for
  streaming. Plan 108 D4 renders the split view with the same package. Chat and split-view fences
  are highlighted by Shiki with the editor theme; the editor highlights with tree-sitter.

## Candidates compared in the original research

| Candidate                                 | Shape                                                                                                               | Known limits                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| tree-sitter-markdown with a preview query | Today's grammar; a query written for decorations                                                                    | Upstream's caveat; the 256-layer cap; async until warm                    |
| tree-sitter-markdown with a grown scanner | Fork or upstream the C external scanner                                                                             | Parser work in C against the spec examples                                |
| A Rust parser compiled to wasm            | `pulldown-cmark`, `comrak`, `markdown-rs`                                                                           | None is incremental; a wasm load before the first parse                   |
| `@lezer/markdown`, forked if needed       | Hand-written TypeScript that emits Lezer trees and reuses old tree fragments when it reparses; ships GFM extensions | Does not validate link references; a second tree format                   |
| `tree-sitter-md` (owner direction)        | Block grammar + C resolver extension in tree-sitter-x, own repository                                               | Current modules about 75 KB gzip, host runtime excluded                   |
| micromark (remark)                        | Today's chat parser, the baseline                                                                                   | One-shot parse; the editor would reparse the whole document per keystroke |

## Findings

Measured 2026-09-26 against micromark (652/652 CommonMark here) with normalized construct lists;
probes in `/work/tmp/research2/176/` (throwaway). "refcheck" is a one-walk post-pass that drops
reference links whose label has no definition, which neither tree-sitter nor lezer checks.

1. **Correctness.** CommonMark 0.31.2 plus the 24 GFM extension examples (676):

   | Parser                                    | Pass               |
   | ----------------------------------------- | ------------------ |
   | tree-sitter as the worker runs it today   | 607 (89.8%)        |
   | tree-sitter with table cells and refcheck | 631 (93.3%)        |
   | lezer 1.7.2                               | 639 (94.5%)        |
   | lezer with refcheck                       | 662 (97.9%)        |
   | comrak (HTML)                             | 652/652 CommonMark |

   Per-section table in the measurements doc. tree-sitter loses whole sections: GFM autolink
   literals (0/11), emphasis (120/132), code spans (18/22). lezer's remaining 14 are CommonMark
   0.31 changes it predates and link nesting that follows from not knowing the definitions.
   Our corpus: on all 183 real assistant messages from the production store, both tree-sitter
   (fixed) and lezer produce exactly micromark's constructs. On 497 repository docs (107,042
   constructs), tree-sitter today loses 18,002 constructs to the layer cap and table cells; fixed,
   it has 67 real mismatches (22 bare URLs, 20 code spans, 16 underscore emphasis such as
   `_maxDuration=30ms across _maxRounds`, 8 strikethroughs such as `~12% … ~1%`, 1 inline HTML)
   and recognizes frontmatter where micromark and lezer do not; lezer has about 20 (email
   false positives in `pkg@1.0.0`, code spans with escaped backticks).

2. **Speed** (Node, medians; 2 KB real message, 45 KB `AGENTS.md`, 1 MB of docs):

   | ms                                | 2 KB  | 45 KB | 1 MB |
   | --------------------------------- | ----- | ----- | ---- |
   | tree-sitter full (block + inline) | 1.05  | 18.9  | 419  |
   | tree-sitter keystroke, careful †  | —     | 0.30  | 2.4  |
   | lezer full                        | 0.17  | 2.76  | 40.9 |
   | lezer to the viewport (60 rows)   | 0.14  | 0.37  | 0.42 |
   | lezer one-character edit          | 0.086 | 0.086 | 0.82 |
   | lezer keystroke, same run as †    | —     | 0.10  | 0.65 |
   | micromark full                    | 0.62  | 16.3  | 311  |

   † Block reparse of the evolving tree, plus the inline node holding the edit, plus uncached
   visible inline nodes; p95 0.93 and 4.8 ms. The first reparse of a freshly parsed tree costs
   43 ms at 1 MB wherever the edit lands, because of tree-sitter's first-leaf reuse rule and this
   grammar's external scanner. One idle reparse after each full parse (41 ms at 1 MB) brings the
   first keystroke to 4.8 ms. The earlier "0.81 / 42.4 ms edit" and "unchanged reparse scales with
   size" figures measured that first reparse every time. Cold in Chromium: lezer loads in
   3.9 ms and first-parses `AGENTS.md` in 12.5 ms; tree-sitter needs 12.4 ms for the runtime and
   two grammars, 40.5 ms for the first parse, 20.1 ms warm. A worker round trip adds 0.1 ms to
   lezer and flattening adds 6 ms to tree-sitter. Memory per parsed `AGENTS.md`: lezer about
   600 KB, mdast 560 KB, tree-sitter about 80 KB of wasm heap. Bundle: lezer + GFM 20 KB gzip, new;
   tree-sitter's runtime and grammars (221 KB gzip) already ship in the editor worker; chat's remark
   chain is 41 KB gzip. Rust: comrak spends 323 ms at 1 MB marshalling its AST into JS and is
   380 KB gzip; the only pulldown-cmark wasm on npm is a 2022 HTML-only wrapper; `markdown-rs` has
   no wasm build. None is incremental.

3. **First frame.** lezer can decorate the visible rows inside `setText`: 0.4 ms to parse to the
   viewport at any size, synchronously, then finish in idle slices, as CodeMirror does. tree-sitter
   in the worker cannot by construction. On the main thread (a second wasm instance, loaded ahead of
   time) it can: its block grammar has no stop position, but a 60-row prefix parses in 1.0 ms at
   any size, its visible inline nodes in 1.2 ms, and the rest arrives as an append edit (128 ms at
   1 MB, same tree as a fresh parse). lezer's first frame is 0.48 ms. Plan 177's frame-count
   scenario did not exist at that revision; it now exists as `prefetch-first-paint` and Phase 2 extends it.
4. **What each tree carries** against remark: see the feature table in the measurements doc. In
   short, neither carries list tightness (derivable from blank lines between items), neither checks
   references, neither has footnotes; tree-sitter has frontmatter and a `$x$` math node chat does
   not want, and its lenient flanking happens to match `remark-cjk-friendly`; lezer has GFM
   autolinks, correct strikethrough, and explicit marker nodes (`EmphasisMark`, `LinkMark`, `URL`,
   `HeaderMark`, `QuoteMark`, `ListMark`, `CodeMark`, `TaskMarker`), which is the shape live preview
   hides and reveals. lezer's extension API (`parseBlock`, `parseInline`, `defineNodes`) covers
   frontmatter, math and footnotes in TypeScript.
5. **Fixability.** Of tree-sitter's 45 remaining spec failures, 34 are fixable in the grammar or
   its C scanners (autolink literals 11, Unicode flanking 8, HTML 4, code-span runs 3, setext 3,
   destinations and labels 4, lists 1) and 11 are structural: the rule of three, links in links,
   emphasis-versus-link precedence and reference fallback are passes over CommonMark's delimiter
   and bracket stacks, which a grammar with a one-position scanner cannot express. lezer's 14 are
   all TypeScript fixes in a 2,318-line package; the five link-nesting ones need the definitions
   while resolving brackets, which a fork can take from the previous parse.
6. **The split grammar.** Keep one inline parse per paragraph. A combined inline parse leaks
   constructs across blocks (a code span across two list items, strikethrough across paragraphs)
   and is slower: 28 ms against 19 ms at 45 KB, 1.86 s against 0.42 s at 1 MB, because
   tree-sitter's lexer scans the included-range list from the start at every token. Each paragraph
   parse costs about 17 µs when its input is bounded to the paragraph (35 µs when each call copies
   the next 10 KB of the document), so the cap buys nothing.
7. **Streaming**, 24-character chunks, per chunk: remark session 0.23 ms mean on a real 8.6 KB
   message and 0.66 ms on 45 KB; lezer incremental 0.019 and 0.048 ms; tree-sitter incremental 0.26
   and 0.085 ms. Mid-stream all three follow CommonMark: an unterminated `**`, `*`, `` ` `` or `~~`
   stays literal and an open fence runs to the end. Healing (`remend`) is a text transform in front
   of any parser; chat's session heals only the tail block, which keeps it under a millisecond
   where healing the whole text costs 1.4 ms at 45 KB.
8. **Two parsers.** Fence highlighting already diverges independently of the parser: chat and
   split view use Shiki with the editor theme, the editor uses tree-sitter. The markdown parser
   only decides where a fence starts and ends, and all candidates agree on fences (29/29 lezer).
   Edge-case rendering: both candidates match remark on every real chat message; on repository docs
   the differences are the ~20 (lezer) or 67 (tree-sitter) constructs above. Bytes: lezer adds
   20 KB gzip to the editor; remark stays where it is.

## Custom grammar + Rust resolver spike

Measured 2026-09-26 in [ShaulLavo/tree-sitter-md](https://github.com/ShaulLavo/tree-sitter-md)
`b962319` (`/work/projects/tree-sitter-md`; findings in its `docs/FINDINGS.md`, method and rows
in [measurements](../docs/markdown-parser/measurements.md#tree-sitter-md-custom-grammar--rust-resolver)).
It cleared the original spike gates. The resolver measured here is Rust on pulldown-cmark.
The C rewrite has since landed; current release gates and expanded stress findings are above.

- **Shape.** A fork of tree-sitter-markdown v0.5.3's block grammar with one token per line (556
  parse states against 925), and a Rust pass that runs each leaf block (paragraph, heading
  content, table cell) through pulldown-cmark 0.13.4's inline algorithm: delimiter stack with the
  rule of three, bracket stack with link-in-link deactivation and precedence, reference fallback.
  Link reference definitions leave the grammar, which is what makes the collapsed repeats safe:
  they are paragraph content, as CommonMark defines them, and the resolver strips them from each
  paragraph's start into a document-wide map. Each cached leaf records the labels it looked up;
  an edit that changes a definition drops exactly those leaves. GFM autolink literals are ported
  from markdown-rs. Grammar runtime and resolver compile into one wasm module; JS asks for rows and
  gets `[start, end, kind, extra]` records, highlight captures with the Editor's capture names,
  fold ranges and fence injections. The tree never crosses.
- **Correctness.** 672/676 spec examples (lezer + refcheck 662, today's tree-sitter 631): every
  emphasis, link, image, code-span, raw-HTML and autolink example passes. The four failures are two
  documents that open with `---` (read as frontmatter, which is right for 84 repository docs), a
  setext underline under a paragraph of definitions, and a lazy line in doubly nested quotes.
  Corpus: 183/183 chat messages identical; on 497 repository docs every mismatch is one of three
  shared shape differences (frontmatter, task-item paragraphs, positionless mdast autolinks), so
  0 real against lezer's ~20. Incremental results equal a fresh parse after 11,300 random edits.
- **Speed** (Node, medians of three runs, same text, edits and harness as the calibration; lezer
  in the same runs):

  | ms                                 | tree-sitter-md 46 KB | lezer 46 KB | tree-sitter-md 1 MB | lezer 1 MB | tree-sitter today 1 MB |
  | ---------------------------------- | -------------------: | ----------: | ------------------: | ---------: | ---------------------: |
  | First frame, 60 rows, decorated    |                 0.39 |        0.57 |                0.36 |       0.47 |                    2.2 |
  | Full parse                         |                  1.4 |         3.3 |                  26 |         48 |                    128 |
  | Keystroke median                   |                0.079 |       0.097 |                0.49 |       0.59 |                    2.4 |
  | Keystroke p95                      |                 0.14 |        0.21 |                 1.0 |        3.0 |                    4.8 |
  | First keystroke, idle reparse done |                 0.44 |        0.79 |                 1.6 |        2.3 |                    4.8 |

  The first-leaf reuse rule still costs one reparse after a full parse, now 8.6 ms at 1 MB instead
  of 43 ms (7.9 ms in idle time; without it the first keystroke costs 2.4 ms). Warm, 60 rows of
  highlights cost 0.024 ms, folds 0.008 ms, injections 0.007 ms.

- **First frame and load.** Warm, 0.36 ms in Node. Cold in Chromium the module loads in 2.4 ms
  (lezer 4.2 ms) and the first 60-row frame costs 6.4–9.5 ms (lezer 6.4–7.7 ms), almost all of it
  V8 compiling each wasm function on its first call. Decorating the first frame means running the
  module on the main thread, loaded and exercised once ahead of time (Plan 170).
- **Costs.** 193 KB gzip (562 KB raw; 161 KB at `opt-level=z`, 10–20% slower), against lezer's
  20 KB and the 221 KB today's tree-sitter markdown ships; the module carries its own tree-sitter
  runtime, so a worker that keeps web-tree-sitter for fence languages holds two. Memory: 0.5 MB of
  wasm memory for `AGENTS.md`, 7.5 MB for 1 MB (2 MB of it the UTF-16 text; lezer 4.6 MB for
  1.36 MB).
- **Incrementality per layer.** Block: tree-sitter's incremental reparse. Definitions: rescanned in
  the changed ranges, invalidation by label. Inline: per leaf, cached by text, resolved lazily for
  the requested rows, so a keystroke resolves one paragraph.
- **Not done in the original Rust spike.** pulldown-cmark runs its whole pipeline per leaf, with continuation
  lines re-indented by four virtual spaces so it cannot start a block the grammar ruled out;
  the completed C rewrite removed that workaround. Footnotes, math and CJK flanking remain
  outside this plan. MIT was subsequently chosen; current release tasks are in Phase 0 above.

## Recommendation and integration scope

- **Editor: `tree-sitter-md` for live preview, colours, folds and fence injections**, one parse
  per retained document, with ordinary edits integrated into the edit operation. The original
  spike scored 99.4% against lezer's 97.9% with no unexplained corpus mismatch. The parser
  supplies all Markdown outputs, so the Editor holds one Markdown tree. Fence contents stay with web-tree-sitter's language grammars in the worker.
  The current extension modules cost about 75 KB gzip plus the host runtime and JS. Use
  the current release gates above before claiming the integrated implementation meets the original
  timings.
- **Split view** keeps remark (Plan 108 D4); its scroll sync reads remark positions.
- **Chat keeps remark** until the editor settles (owner, question 2). tree-sitter-md reaches chat
  only with footnotes, `$$` math and CJK flanking added and measured against remark.
- **lezer** stays the fallback: if the owner rejects the bytes or the own-repository cost, Plan
  176's lezer recommendation and phases as of research/176b `1f74ff059` apply unchanged.

The 2026-09-26 research recommended a main-thread document: the spike's 1 MB keystrokes cost
0.49 ms median and 1.0 ms p95, and one instance avoided parsing twice. Phase 1 must now verify
that placement with the current implementation and complete-document preparation. The combined inline injection
is closed (finding 6). A Rust parser alone stays closed (none is
incremental; comrak's AST crossing costs more than a JavaScript parse); an inline pass behind
an incremental block grammar, per leaf and cached, is the shape that works (Rust in the spike, C
from the completed Phase 0 rewrite).

## Proposed phases

0. **Finish the tree-sitter-md release** (M; repository `ShaulLavo/tree-sitter-md`).
   Completed: C/cmark inline pass, removal of Rust and its virtual-indent workaround, MIT license
   and third-party notices, shared-runtime extension, reference-boundary and viewport-seek fixes.
   Remaining:
   - Reduce the expanded stress suite's incremental/fresh discrepancies to regression fixtures;
     fix them and require equality for decorations, highlights, folds and injections. Preserve
     negative controls. Address deep-nesting failure with bounded parsing or a controlled,
     documented source fallback; a wasm trap cannot leave a view frozen or corrupt sibling docs.
   - Fix spec examples 96, 98, 216 and 260. Add a frontmatter option: CommonMark/GFM conformance
     runs with it off; Editor file parsing enables it. Require 676/676 in conformance mode and
     extension fixtures with it on. Keep exact, per-document corpus differences, not just totals.
   - Add CI for the two wasm builds, focused JS and native ASan/UBSan checks, spec, corpus and
     incremental/fresh tests. Use the committed chat corpus; make pinned repository fixtures
     reproducible without the deleted research scratch directories.
   - Verify packed-package import and wasm loading in Node, Bun and the Editor's Vite browser
     build. Pin the same `tree-sitter-x` build in both consumers; exercise initialization order
     and repeated initialization, and include both wasm assets and notices.
   - Record current payload including host/JS, per-document memory, cold/warm browser opening,
     edits and bulk workloads against the same-run baseline. Publish 0.1 to npm after these
     gates. Publishing credentials may need the owner; implementation and package checks do not.
1. **Markdown document in `@singapore-editor/markdown`** (M; Editor `packages/markdown`).
   Implement the [proposed behaviour contract](../docs/markdown-parser/editor-behaviour.md#proposed-contract-for-platform).
   One compatible parser belongs to the retained source buffer's analysis, aligned with Plan 198;
   view attachment borrows it. Feed committed edits once, preserve undo, and dispose with the
   analysis owner. Reconcile integration order with Plan 198 before changing its ownership APIs.
   Use the current full-source block/definition pass and lazy visible inline resolution first.
   Prepare/warm through Plans 170/177's existing paths; request restored visible ranges too.
   Measure cold preparation, worst-case blocks, input latency and memory in Chromium. The current
   synchronous API cannot promise cooperative slices: if it exceeds the established budget,
   add and verify resumable or off-thread preparation before shipping that path. Record the
   numeric budgets and chosen mechanism in the behaviour research. The former fixed 60-row
   prefix/append prescription is retired; any partial parse needs explicit coverage, global
   reference readiness and equality with a fresh full parse.
   An idle `reparse()` is an optimization to retain only if its cost and first-edit benefit hold
   for the current build. Share the parser's conformance fixtures; keep Editor integration tests
   for buffer lifecycle, revision admission, visible records and source editing equivalence.
2. **Live preview from records** (M; Editor `packages/markdown/src/replacements.ts`, `index.ts`;
   uses the landed Plan 111 Phase 1 `trigger: 'edit'`). Replace capture recovery with records for
   visible rows plus a margin: heading, list, quote and fence marks, emphasis and strikethrough
   delimiters, code-span runs, `LinkText` inside each link or image, table cells, tasks.
   Multi-line spans work. Delete the containment and adjacency code. Extend the existing
   `prefetch-first-paint` and `editor-tab-hover-highlights` scenarios with exact visible Markdown
   coverage and stale-result checks. Add Plan 108 Phase 2's editing-equivalence suite; a probe
   that only finds one preview span is insufficient.
3. **Colours, folds and injections from the same document** (L; Editor syntax controller,
   `tree-sitter/src/treeSitter/treeSitter.worker.ts`, `tree-sitter-languages`). Markdown's root
   layer consumes `highlights()` and `folds()` from the document owner; `injections()` supplies
   fence ranges/languages to the worker, which parses only fence layers. Follow Phase 1's
   measured execution strategy: if preparation moves off-thread, publish revision-bound records
   to the owner without repeating the full parse on the main thread. Delete the markdown and
   markdown-inline grammars, their queries and the markdown path through the 256-layer cap.
   Preserve the landed fence-layer worker repairs below. Fence requests and results carry
   buffer incarnation/revision and configuration identity; a stale reply cannot decorate a moved
   or deleted fence.
   The worker repairs landed 2026-09-26 in wave 2, lane E1 ([singapore#43](https://github.com/ShaulLavo/singapore/pull/43),
   originally in `editor-ref` `db3e1bd`, also present in the current `2c4a27b` pin): injections
   found from changed ranges plus the edit, bounded input reads, one idle reparse after a full parse, and the cap refilled after deletes. Worker bench at
   1 MB: keystroke median 37 → 10 ms, first keystroke 82 → 20 ms. This phase keeps the rest.

Chat: no phase while question 2 stands at (a).

## Recorded owner decisions

1. **The parser behind live preview.** (a) `@lezer/markdown` on the main thread; tree-sitter
   keeps colours, folds and fence injections. (b) tree-sitter in the worker with a preview query,
   grouped matches, refcheck and a C grammar fork. (c) tree-sitter on the main thread as a second
   wasm instance, with the same query and fork. (d) `tree-sitter-md` on the main thread for live
   preview, colours, folds and fence injections.
   **Recommendation:** (d) — the owner's preferred shape, and it clears the bar: 672/676 against
   lezer's 662, no real corpus mismatch against lezer's ~20, keystroke at 1 MB 0.49 / 1.0 ms
   (median / p95) against 0.59 / 3.0 ms, first frame 0.36 against 0.47 ms, and one markdown tree
   in the editor. These are the original Rust comparison figures; current packaging and release
   gates are recorded above.
   Decided 2026-09-26: owner — (d), adopt `tree-sitter-md`. Licence MIT (committed `4214f0c`).
2. **Chat.** The rule says remark leaves only for a candidate close to micromark with remark's
   features closed. (a) Keep remark in chat. (b) Move chat to lezer, with math and footnote
   extensions, a CJK fork and a lezer-to-mdast adapter. (c) Move chat to tree-sitter-md, with
   footnotes, `$$` math and CJK flanking added and a records-to-mdast adapter.
   **Recommendation:** (a) — micromark is 100%, tree-sitter-md 99.4%, lezer 97.9%; none has
   footnotes and chat's math rules yet; remark streams a real 8.6 KB message at 0.23 ms per chunk; and
   every candidate already agrees with it on all 183 real messages, so editor and chat will not
   visibly diverge.
   Owner, 2026-09-26: too early; chat is decided only after the editor's markdown is settled.

## What this plan does not do

- Plan 111 owns decoration/block-layout APIs and Plan 108 owns rendered-block interactions. This
  parser must support both; Plan 176 alone does not ship their full UX or Plan 108 Phase 3 features.
- Plans 170/177 own general warm-up and prefetch infrastructure; Phase 1 integrates this parser
  with those paths and verifies its cold behaviour.
- No change to chat rendering before the decision.
