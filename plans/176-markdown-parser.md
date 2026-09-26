# Plan 176: One markdown parser

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — recommendation: `@lezer/markdown` behind live preview on the
  main thread, tree-sitter keeps colours, folds and fence injections, remark stays in chat. Two
  owner questions below; Phase 0 is independent of both. Nothing here authorizes implementation.
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
   | tree-sitter one-character edit    | 0.45  | 0.81  | 42.4 |
   | lezer full                        | 0.17  | 2.76  | 40.9 |
   | lezer to the viewport (60 rows)   | 0.14  | 0.37  | 0.42 |
   | lezer one-character edit          | 0.086 | 0.086 | 0.82 |
   | micromark full                    | 0.62  | 16.3  | 311  |

   tree-sitter's block reparse scales with the document even when nothing changed (9.3 ms at
   737 KB, 43 ms at 1 MB), at any edit position. Cold in Chromium: lezer loads in
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
   time) it could, but its block grammar has no stop position, so the first frame pays the
   whole-document block parse: 7.4 ms at 45 KB, 133 ms at 1 MB, unless the host parses a prefix
   first. Plan 177's frame-count scenario does not exist yet; Phase 2 adds it.
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
   and is slower: 28 ms against 19 ms at 45 KB, 1.86 s against 0.42 s at 1 MB. Each paragraph parse
   costs about 35 µs, so the cap buys nothing.
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

## Recommendation

- **Editor, live preview: `@lezer/markdown`** on the main thread, inside the edit operation. By
  the plan's own rule it is the candidate that decorates the first frame, and it is not a tie: it
  passes 97.9% against 93.3%, parses 6–10× faster, edits 5–50× faster, and its failures are
  TypeScript. tree-sitter keeps markdown colours, folds and fence injections, so the editor holds
  two markdown trees until Phase 4 decides whether colours move too.
- **Split view** keeps remark (Plan 108 D4); its scroll sync reads remark positions.
- **Chat keeps remark.** No candidate reaches micromark, and remark's footnotes, math rules and
  CJK emphasis stay open for both.
- **tree-sitter, if the owner keeps it** (question 1 b or c): Phase 0 plus a purpose-named
  `markdown-preview.scm` whose matches keep their grouping, refcheck on the main thread, and a
  grammar fork for the fixable 34. It stays at most ~96% and a keystroke at 1 MB costs ~42 ms in the
  worker.

Decided 2026-09-26: research recommendation — the Rust parsers are closed (none incremental;
comrak's AST crossing costs more than a JavaScript parse; no maintained wasm build exposes
pulldown-cmark's or markdown-rs's offsets). The combined inline injection is closed (question 6).
Moving the grammar from 0.3.2 to 0.5.3 buys no correctness and rides along with the next routine
grammar refresh.

## Proposed phases

0. **tree-sitter repairs, any answer** (S; Editor `tree-sitter-languages/src/queries/markdown-injections.scm`,
   `tree-sitter/src/treeSitter/treeSitter.worker.ts`). Inject `markdown_inline` into
   `pipe_table_cell`; exempt `markdown_inline` layers from `MAX_INJECTION_LAYERS` (35 µs each) or
   count the cap per parent language; honour `injection.include-children` by excluding named
   children from injection ranges. Test in `tree-sitter/test/` with a 300-paragraph document and a
   table; a Platform scenario `editor-markdown-preview-long` (the research drive, re-created: a
   300-paragraph file and a table, screenshots at paragraph 145, paragraph 300 and the table) shows
   paragraph 300 and a table cell rendered.
1. **lezer tree in `@singapore-editor/markdown`** (M; Editor `packages/markdown`). Depend on
   `@lezer/markdown` and `@lezer/common`; keep one incremental tree per document
   (`TreeFragment.applyChanges` from the edit's changes), parse to the viewport first
   (`startParse().stopAt()`), finish in idle slices. Extensions: frontmatter (a block parser at
   offset 0) and refcheck. Port the probe's construct normalizer into `packages/markdown/test/` with
   micromark as a dev dependency, gating the spec floor (662/676) and a corpus of repository docs
   and anonymized chat messages.
2. **Live preview from the tree** (M; Editor `packages/markdown/src/replacements.ts`,
   `index.ts`; needs Plan 111 Phase 1's `trigger: 'edit'`). Replace capture recovery with a walk
   of the visible rows' nodes: `HeaderMark`, `EmphasisMark`, `CodeMark`, `LinkMark` + `URL`,
   `ListMark`, `QuoteMark`, `TaskMarker`, strikethrough, table cells; multi-line spans work.
   Decorate the viewport plus a margin, not the document, so the inline map stays at hundreds of
   ranges whatever the file size (Plan 111 measured 7.2 ms per keystroke at 20k ranges). Delete the
   containment and adjacency code. Platform adds Plan 177's frame-count scenario for markdown
   (decorations in the frame of `setText`) and Plan 108 Phase 2's editing-equivalence suite.
3. **Fork only where users hit it** (S–M; upstream first at `code.haverbeke.berlin/lezer/markdown`,
   else vendored as Editor `packages/lezer-markdown`). CommonMark 0.31 deltas (`<textarea>`, HTML
   comments, `#\t`), bracket resolution against the known definitions (five link cases), the
   email autolink false positive, CJK-friendly flanking if the composer's live markdown needs it.
4. **Decide colours** (S decision, L if yes; Editor syntax controller). Whether markdown colours
   come from the lezer tree, leaving tree-sitter only for fences and HTML injections. That is the
   step that makes the editor one-parser; it needs a non-tree-sitter root layer and is weighed
   after Phase 2 ships.

Chat: no phase while question 2 stands at (a).

## Owner questions

1. **The parser behind live preview.** (a) `@lezer/markdown` on the main thread, inside the edit
   operation; tree-sitter keeps colours, folds and fence injections. (b) tree-sitter in the worker
   with a preview query, grouped matches, refcheck and a C grammar fork. (c) tree-sitter on the
   main thread as a second wasm instance, with the same query and fork.
   **Recommendation:** (a) — the only candidate that decorates the first frame at every size
   (0.4 ms to the viewport against a 7–133 ms whole-document block parse), 97.9% against 93.3% on
   the spec, 0.09–0.8 ms per edit against 0.8–42 ms, and its failures are TypeScript; the price is
   20 KB gzip and a second markdown tree.
2. **Chat.** The rule says remark leaves only for a candidate close to micromark with remark's
   features closed. (a) Keep remark in chat. (b) Move chat to lezer after Phase 3, with math and
   footnote extensions, a CJK fork and a lezer-to-mdast adapter. (c) Move chat to tree-sitter.
   **Recommendation:** (a) — micromark is 100%, lezer 97.9%, tree-sitter 93.3%; both lack
   footnotes and chat's math rules; remark streams a real 8.6 KB message at 0.23 ms per chunk; and
   both candidates already agree with it on all 183 real messages, so editor and chat will not
   visibly diverge.

## What this plan does not do

- No decoration API work (Plan 111), no block widgets, no Obsidian features (Plan 108 Phase 3).
- No grammar warm-up (Plan 170) and no prefetch work (Plan 177).
- No change to chat rendering before the decision.
