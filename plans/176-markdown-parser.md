# Plan 176: One markdown parser

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — recommendation: one parser, `tree-sitter-md` (a custom
  tree-sitter block grammar and an inline resolver in one wasm module, its own repository),
  behind live preview, colours, folds and fence injections; remark stays in chat. It passes 672/676
  spec examples (lezer 662), has no real mismatch on our corpus (lezer about 20), and keystrokes at
  1 MB cost 0.49 ms median, 1.0 ms p95 (lezer 0.59 and 3.0 ms in the same runs). See
  [Custom grammar + Rust resolver spike](#custom-grammar--rust-resolver-spike). The lezer
  findings below stand as the benchmark it was measured against. Adopted by the owner 2026-09-26
  (question 1 (d)); the phases below are scheduled in the waves. The spike's resolver is Rust; the
  release's is C (owner, 2026-09-26; Phase 0).
  Calibrated 2026-09-26 ([tree-sitter-calibration.md](../docs/markdown-parser/tree-sitter-calibration.md)):
  the 42 ms tree-sitter keystroke was the first reparse of a freshly parsed tree. A careful
  integration of today's grammar costs 2.4 ms at 1 MB.
- Replaces [Plan 108](108-markdown-modes.md) D5. Plan 108 Phase 2 and the chat parser decision
  wait on this plan. [Plan 111](111-editor-decorations.md)'s decoration API does not.
- Planned at: Platform `d42184dc`, Editor `74e76be`, 2026-09-26. Researched at Platform
  `c130dd35a`, Editor `74e76be`. Origin: the investigation into markdown files painting as raw
  source before their live-preview decorations land.
- Method, tables and pinned versions: [docs/markdown-parser/measurements.md](../docs/markdown-parser/measurements.md).

## Outcome

A measured choice of the parser behind the editor's live preview and split view, and a measured
answer to whether that parser can also replace remark in chat.

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

## What exists today

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
  300-paragraph file paragraphs 289–300 show `**bold**`, `*em*`, `` `code` `` and `[link](…)`
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

## Candidates

| Candidate                                 | Shape                                                                                                               | Known limits                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| tree-sitter-markdown with a preview query | Today's grammar; a query written for decorations                                                                    | Upstream's caveat; the 256-layer cap; async until warm                    |
| tree-sitter-markdown with a grown scanner | Fork or upstream the C external scanner                                                                             | Parser work in C against the spec examples                                |
| A Rust parser compiled to wasm            | `pulldown-cmark`, `comrak`, `markdown-rs`                                                                           | None is incremental; a wasm load before the first parse                   |
| `@lezer/markdown`, forked if needed       | Hand-written TypeScript that emits Lezer trees and reuses old tree fragments when it reparses; ships GFM extensions | Does not validate link references; a second tree format                   |
| `tree-sitter-md` (owner direction)        | Custom block grammar + C inline resolver in one wasm module, own repository                                         | Its own tree-sitter runtime; 193 KB gzip                                  |
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
   scenario does not exist yet; Phase 2 adds it.
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
It clears every bar. The resolver measured here is Rust on pulldown-cmark; Phase 0 rewrites it in
C and must match these numbers.

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
- **Not done in the spike.** pulldown-cmark runs its whole pipeline per leaf, with continuation
  lines re-indented by four virtual spaces so it cannot start a block the grammar ruled out;
  Phase 0 replaces it with cmark's inline pass in C behind a leaf entry point. No footnotes, math
  or CJK flanking (chat features). No license chosen. Not published: `npm publish` needs an npm login with
  rights to the free `tree-sitter-md` name (and 2FA if the account has it), a license, and the
  wasm built before `npm pack`.

## Recommendation

- **Editor: `tree-sitter-md` for live preview, colours, folds and fence injections**, one parse
  per document on the main thread, inside the edit operation. It is the owner's preferred shape
  and it clears the bar: 99.4% against lezer's 97.9%, no real corpus mismatch, faster than lezer
  at every size measured, and the one module serves every markdown output, so the editor holds
  one markdown tree. Fence contents stay with web-tree-sitter's language grammars in the worker.
  The price is bytes (193 KB gzip against 20 KB) and a second tree-sitter runtime beside
  web-tree-sitter's.
- **Split view** keeps remark (Plan 108 D4); its scroll sync reads remark positions.
- **Chat keeps remark** until the editor settles (owner, question 2). tree-sitter-md reaches chat
  only with footnotes, `$$` math and CJK flanking added and measured against remark.
- **lezer** stays the fallback: if the owner rejects the bytes or the own-repository cost, Plan
  176's lezer recommendation and phases as of research/176b `1f74ff059` apply unchanged.

Decided 2026-09-26: research recommendation — the document lives on the main thread, not in the
worker: a keystroke costs 0.49 ms median and 1.0 ms p95 at 1 MB, the first frame needs a
main-thread instance anyway, and one instance avoids parsing twice. The combined inline injection
is closed (finding 6). A Rust parser alone stays closed (none is
incremental; comrak's AST crossing costs more than a JavaScript parse); an inline pass behind
an incremental block grammar, per leaf and cached, is the shape that works (Rust in the spike, C
from Phase 0).

## Proposed phases

0. **tree-sitter-md to a release** (M; repository `ShaulLavo/tree-sitter-md`). First a C resolver
   spike on a branch: replace the Rust crate with C that builds on `commonmark/cmark` 0.31.2's
   inline parser (`inlines.c` and what it needs; BSD-2) through a one-leaf entry point, with GFM
   strikethrough and autolink literals ported from `github/cmark-gfm`'s extensions (BSD-2; its own
   core follows spec 0.29, so only the extensions come from it). The per-leaf cache, label-based
   definition invalidation and the record, highlight, fold and injection outputs move to C; the JS
   API stays, and the virtual-indent workaround goes with pulldown-cmark. clang builds grammar,
   scanner, runtime and resolver for `wasm32`. The spike merges only if it holds the Rust build's
   numbers: 672/676 spec examples or better, 0 real corpus mismatches, fuzz clean, and keystroke
   median and p95 at 1 MB no slower than the Rust build in the same runs (0.49 and 1.0 ms at the
   spike); size and memory reported. It also answers whether grammar and resolver can load as one web-tree-sitter side
   module sharing the Editor's runtime (Plan 189 Pass 2 acts on the answer).
   Then: fix the four spec failures and add a frontmatter switch; C tests, the spec floor, the corpus check and
   the fuzz test in CI with a wasm build job; publish 0.1 to npm (MIT, chosen 2026-09-26;
   publishing needs the owner's `npm login`). Notices: tree-sitter-markdown, tree-sitter, cmark
   and cmark-gfm; pulldown-cmark's and markdown-rs's leave with their code.
1. **Markdown document in `@singapore-editor/markdown`** (M; Editor `packages/markdown`). Depend
   on `tree-sitter-md`; one `MarkdownDocument` per open markdown file on the main thread, edited
   inside the edit operation; `setText` parses a 60-row prefix and appends the rest in idle time
   (measure a chunked append: the whole append is one 29 ms task at 1 MB); one idle `reparse()`
   after every full parse. Load and exercise the module ahead of the first markdown file (Plan 170).
   Port `bench/spec.mjs` and `constructs.mjs` into `packages/markdown/test/` with micromark as a
   dev dependency.
2. **Live preview from records** (M; Editor `packages/markdown/src/replacements.ts`, `index.ts`;
   needs Plan 111 Phase 1's `trigger: 'edit'`). Replace capture recovery with the records for the
   visible rows plus a margin: heading, list, quote and fence marks, emphasis and strikethrough
   delimiters, code-span runs, `LinkText` inside each link or image, table cells, tasks.
   Multi-line spans work. Delete the containment and adjacency code. Platform adds Plan 177's
   frame-count scenario for markdown and Plan 108 Phase 2's editing-equivalence suite.
3. **Colours, folds and injections from the same document** (L; Editor syntax controller,
   `tree-sitter/src/treeSitter/treeSitter.worker.ts`, `tree-sitter-languages`). Markdown's root
   layer reads `highlights()` and `folds()` on the main thread; `injections()` hands fence ranges
   and languages to the worker, which parses only those layers. Delete the markdown and
   markdown-inline grammars, their queries and the markdown path through the 256-layer cap. The
   worker repairs from the calibration that still apply to fence layers: discover injections from
   changed ranges plus the edit, bound each input read to its range, one idle reparse after a
   full parse.
   The worker repairs landed 2026-09-26 in wave 2, lane E1 ([singapore#43](https://github.com/ShaulLavo/singapore/pull/43),
   in `editor-ref` `db3e1bd`): injections found from changed ranges plus the edit, bounded input
   reads, one idle reparse after a full parse, and the cap refilled after deletes. Worker bench at
   1 MB: keystroke median 37 → 10 ms, first keystroke 82 → 20 ms. This phase keeps the rest.

Chat: no phase while question 2 stands at (a).

## Owner questions

1. **The parser behind live preview.** (a) `@lezer/markdown` on the main thread; tree-sitter
   keeps colours, folds and fence injections. (b) tree-sitter in the worker with a preview query,
   grouped matches, refcheck and a C grammar fork. (c) tree-sitter on the main thread as a second
   wasm instance, with the same query and fork. (d) `tree-sitter-md` on the main thread for live
   preview, colours, folds and fence injections.
   **Recommendation:** (d) — the owner's preferred shape, and it clears the bar: 672/676 against
   lezer's 662, no real corpus mismatch against lezer's ~20, keystroke at 1 MB 0.49 / 1.0 ms
   (median / p95) against 0.59 / 3.0 ms, first frame 0.36 against 0.47 ms, and one markdown tree
   in the editor. The price is 193 KB gzip against 20 KB and a repository to maintain.
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

- No decoration API work (Plan 111), no block widgets, no Obsidian features (Plan 108 Phase 3).
- No grammar warm-up (Plan 170) and no prefetch work (Plan 177).
- No change to chat rendering before the decision.
