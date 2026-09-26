# Markdown parser measurements (Plan 176 research, 2026-09-26)

Numbers behind [Plan 176](../../plans/176-markdown-parser.md). The plan carries the answers,
the recommendation and the phases; this file carries the method and the tables.

## Pinned sources

| Source                               | Version / commit                                                       |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Platform                             | origin/main `c130dd35a`                                                |
| Editor                               | main `74e76be`                                                         |
| tree-sitter-markdown (what we ship)  | npm 0.3.2, the wasm in `tree-sitter-languages/src/grammars/`           |
| tree-sitter-markdown (upstream head) | v0.5.3 release wasm; clone `references/tree-sitter-markdown` `a0a00f8` |
| web-tree-sitter                      | 0.26.13 (the Editor's version)                                         |
| `@lezer/markdown`                    | 1.7.2 (npm and `references/lezer-markdown` `f847886` agree)            |
| micromark / mdast-util-from-markdown | 4.0.2 / 2.x, with `micromark-extension-gfm`                            |
| comrak (npm wasm)                    | 0.48.0-rc.0                                                            |
| pulldown-cmark-wasm (npm)            | 0.1.0 (2022, wraps an old pulldown-cmark)                              |
| CommonMark spec                      | 0.31.2 (`commonmark-spec` npm, 652 examples)                           |
| GFM spec                             | cmark-gfm `test/spec.txt`, the 24 extension examples                   |
| tree-sitter-md (spike)               | `ShaulLavo/tree-sitter-md` `b962319`: grammar from upstream v0.5.3     |
| pulldown-cmark / tree-sitter (Rust)  | 0.13.4 / 0.27.0, compiled into tree-sitter-md's wasm                   |

Probes live in `/work/tmp/research2/176/` (throwaway): `ts.mjs` (tree-sitter as the worker runs
it, plus variants), `constructs.mjs` (normalizer), `spec-run.mjs`, `corpus-run.mjs`, `bench.mjs`,
`stream.mjs`, `memory.mjs`, `chromium.mjs`, `features.mjs`, `midstream.mjs`. Machine: i7-14700K,
Bun 1.4.0, Node 26.7.0, Chromium from Playwright 1.63. Timings are medians after three warm-up
runs.

## Method: normalized construct lists

Trees differ in shape, so every parser's output becomes a sorted list of
`kind@start-end[:extra]` entries, ranges trimmed of surrounding whitespace: paragraph, heading
(level), thematic break, code block (decoded info word), blockquote, list (ordered or not), list
item, task (checked), HTML block, definition, table (alignments), emphasis, strong, strikethrough,
code span, link, image, inline HTML, hard break. An example passes when the list equals
micromark's exactly. List tightness is compared separately, because neither tree-sitter nor lezer
carries it.

micromark is the reference: its HTML output passes 652/652 CommonMark examples here
(`allowDangerousHtml`), and comrak does too.

Normalizations that remove shape differences, not parser errors:

- tree-sitter wraps `~~a~~` as a strikethrough inside a strikethrough one character in; counted
  once. A setext heading's inner `paragraph` node is skipped. Block nodes that end after the next
  line's `> ` continuation are trimmed back.
- Constructs inside an image description are dropped for every parser (alt text is plain text).
- lezer's `Task` node replaces the item's paragraph; it counts as one.

"refcheck" is a post-pass over the tree: collect every definition label, then drop reference-style
links and images (`[a]`, `[a][]`, `[a][b]`) whose label has no definition. Neither tree-sitter nor
lezer validates references while parsing; the post-pass is one walk of the tree.

"TS today (worker)" is the Editor's shape: one inline parse per `inline` node over the node's whole
range, table cells not parsed. "binding" is the upstream Rust binding's shape: `inline` and
`pipe_table_cell` nodes, named children excluded from the ranges. "combined" is one inline parse
over every range.

## Spec pass rate per section

| Section                    |   n | TS today (worker) | TS binding+cells | TS binding+refcheck | TS combined+refcheck |       lezer |  lezer+refcheck | lezer GFM+refcheck |
| -------------------------- | --: | ----------------: | ---------------: | ------------------: | -------------------: | ----------: | --------------: | -----------------: |
| Tabs                       |  11 |                11 |               11 |                  11 |                   11 |          10 |              10 |                 10 |
| Backslash escapes          |  13 |                13 |               13 |                  13 |                   13 |          13 |              13 |                 13 |
| Entity references          |  17 |                16 |               16 |                  17 |                   17 |          16 |              17 |                 17 |
| Precedence                 |   1 |                 1 |                1 |                   1 |                    0 |           1 |               1 |                  1 |
| Thematic breaks            |  19 |                19 |               19 |                  19 |                   19 |          19 |              19 |                 19 |
| ATX headings               |  18 |                18 |               18 |                  18 |                   18 |          18 |              18 |                 18 |
| Setext headings            |  27 |                25 |               25 |                  25 |                   24 |          27 |              27 |                 27 |
| Indented code blocks       |  12 |                12 |               12 |                  12 |                   12 |          12 |              12 |                 12 |
| Fenced code blocks         |  29 |                29 |               29 |                  29 |                   29 |          29 |              29 |                 29 |
| HTML blocks                |  44 |                43 |               43 |                  43 |                   43 |          43 |              43 |                 43 |
| Link reference definitions |  27 |                19 |               19 |                  25 |                   25 |          19 |              26 |                 26 |
| Paragraphs, blank lines    |   9 |                 9 |                9 |                   9 |                    9 |           9 |               9 |                  9 |
| Block quotes               |  25 |                25 |               25 |                  25 |                   25 |          25 |              25 |                 25 |
| List items                 |  48 |                47 |               47 |                  47 |                   47 |          46 |              46 |                 46 |
| Lists                      |  26 |                26 |               26 |                  26 |                   26 |          26 |              26 |                 26 |
| Code spans                 |  22 |                18 |               18 |                  18 |                   18 |          22 |              22 |                 22 |
| Emphasis and strong        | 132 |               120 |              120 |                 120 |                  120 |         132 |             132 |                132 |
| Links                      |  90 |                67 |               67 |                  82 |                   81 |          70 |              84 |                 84 |
| Images                     |  22 |                20 |               20 |                  21 |                   21 |          21 |              22 |                 22 |
| Autolinks                  |  19 |                19 |               19 |                  19 |                   19 |          19 |              19 |               15 † |
| Raw HTML                   |  20 |                17 |               17 |                  17 |                   17 |          17 |              17 |                 17 |
| Inlines, breaks, text      |  21 |                21 |               21 |                  21 |                   21 |          21 |              21 |                 21 |
| GFM tables                 |   8 |                 7 |                8 |                   8 |                    8 |           8 |               8 |                  8 |
| GFM task lists             |   2 |                 2 |                2 |                   2 |                    2 |           2 |               2 |                  2 |
| GFM strikethrough          |   2 |                 2 |                2 |                   2 |                    1 |           2 |               2 |                  2 |
| GFM autolinks              |  11 |                 0 |                0 |                   0 |                    0 |          11 |              11 |                 11 |
| GFM disallowed raw HTML    |   1 |                 1 |                1 |                   1 |                    1 |           1 |               1 |                  1 |
| **Total**                  | 676 |       607 (89.8%) |      608 (89.9%) |     **631 (93.3%)** |          627 (92.8%) | 639 (94.5%) | **662 (97.9%)** |        658 (97.3%) |

† The four are GFM autolink literals inside CommonMark examples, where the CommonMark reference
has GFM off; lezer with GFM on is right by GFM. The GFM-section rows use micromark with GFM.

The v0.5.3 upstream grammar passes exactly the same 631 examples as 0.3.2: upstream has not moved
on correctness since the npm release.

comrak's HTML passes 652/652; the 2022 `pulldown-cmark-wasm` build passes 586/652 (current
pulldown-cmark claims full compliance, but no maintained wasm build exposes its offsets).

### What still fails

tree-sitter binding+refcheck, 45 examples:

| Cluster                                                                  | Examples                                   | Class                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| GFM autolink literals (`www.`, bare `https://`, emails): absent          | 11 (621–631 GFM)                           | Grammar + inline scanner, or a text post-pass               |
| Flanking with Unicode punctuation, `* a *`, `**foo bar **`, `a**"foo"**` | 8 (353, 354, 380, 385, 391, 392, 397, 398) | Scanner (flanking classification is ASCII)                  |
| Rule of three (`*foo**bar*`, `**foo*bar*baz**`)                          | 4 (411, 412, 415, 429)                     | Structural: delimiter-stack arithmetic across nesting       |
| Code span backtick-run matching, code span vs HTML precedence            | 4 (330, 331, 340, 343)                     | Scanner lookahead for three; 343 is precedence (structural) |
| Links in links, bracket deactivation, emphasis vs link precedence        | 4 (512, 520, 523, 528)                     | Structural: CommonMark's bracket stack is a post-pass       |
| Reference fallback reinterpretation (`[foo][bar][baz]`)                  | 2 (570, 571)                               | Structural: needs the definitions while parsing             |
| Raw HTML: multi-line attribute values, 0.31 comment rules                | 3 (616, 625, 626)                          | Grammar                                                     |
| `<textarea>` HTML block (added in 0.31)                                  | 1 (171)                                    | Scanner, one tag name                                       |
| `---\n---`, `---\nFoo\n---` setext vs thematic break                     | 2 (96, 98)                                 | Block scanner                                               |
| `![foo](<url>)` angle destination in images; `<foo\nbar>` destination    | 2 (580, 491)                               | Grammar                                                     |
| Nested quote lazy continuation in a list                                 | 1 (260)                                    | Block scanner, hard                                         |
| Label with an escaped bracket; whitespace-only label                     | 2 (194, 552)                               | Grammar                                                     |
| Definition followed by a setext heading                                  | 1 (215)                                    | Block scanner                                               |

34 are fixable in the grammar or its C scanners; 11 are structural. The structural
ones are the rules CommonMark specifies as passes over a delimiter or bracket stack after
tokenizing; an LR/GLR grammar with a scanner that sees one position at a time cannot express
them, which is the class upstream's README warns about.

lezer+refcheck, 14 examples: CommonMark 0.31 changes it predates (`<textarea>` 171, HTML comments
625/626), `#\tFoo` (10), two list edge cases (260, 280), a definition-then-setext case (215), an
escaped angle destination (493), raw HTML 621, and five link-nesting cases (512, 523, 528, 569, 571) that fail because lezer turns every `[x]` into a link while parsing: a fork that consults the
definitions set while resolving brackets fixes them. All are TypeScript changes in a 2,318-line
package.

Features against remark's list (chat pipeline: `remark-parse`, `remark-gfm`, `remark-math` with
single-dollar off, `remark-cjk-friendly`):

| Feature                 | remark (chat)  | tree-sitter 0.3.2                             | lezer 1.7.2 + GFM                                                                    |
| ----------------------- | -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Loose and tight lists   | `spread`       | not in tree; derivable from blank lines       | not in tree; derivable the same way                                                  |
| Link references checked | yes            | no; refcheck post-pass                        | no; refcheck post-pass or fork                                                       |
| Footnotes               | yes (GFM)      | no (`[^1]` parses as a shortcut link)         | no; extension API                                                                    |
| Math                    | `$$…$$` only   | `latex_block` for `$x$` and `$$x$$` (differs) | no; extension API                                                                    |
| CJK-friendly emphasis   | yes            | yes by accident: flanking is lenient          | no (`**太郎は「こんにちは」**と` stays literal); fork                                |
| Table alignment         | `align`        | align nodes per delimiter cell                | in `TableDelimiter` text                                                             |
| Task lists              | `checked`      | checked/unchecked markers                     | `Task` / `TaskMarker`                                                                |
| Frontmatter             | not configured | `minus_metadata`, `plus_metadata`             | no; small block extension                                                            |
| HTML blocks             | yes            | yes (not `textarea`)                          | yes (not `textarea`)                                                                 |
| GFM autolink literals   | yes            | no                                            | yes (emails in `pkg@1.0.0` are a false positive)                                     |
| Strikethrough flanking  | yes            | no (`~12% to\n~1%` strikes through)           | yes                                                                                  |
| Source positions        | offsets        | UTF-16 code units (verified with an emoji)    | UTF-16 code units                                                                    |
| Explicit marker nodes   | no             | delimiters named; link brackets anonymous     | `EmphasisMark`, `LinkMark`, `URL`, `HeaderMark`, `QuoteMark`, `ListMark`, `CodeMark` |

## Our corpus

497 repository `.md` files (382 Platform, 115 Editor; 6.9 MB) and the 183 assistant messages in
the production state store (64 KB, read from a copy and deleted after). Reference: micromark with
GFM. Math kinds excluded.

| Parser                       | Chat: docs identical | Repo: docs identical | Repo constructs missing / extra (of 107,042)                                                                                                                    |
| ---------------------------- | -------------------: | -------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tree-sitter today            |              182/183 |              215/497 | 18,002 / 161: 13,440 code spans, 3,306 strong, 789 links lost to the layer cap and unparsed table cells                                                         |
| tree-sitter binding+refcheck |              183/183 |              386/497 | 239 / 66, of which 168 are frontmatter (tree-sitter is right) and 67 are real: 22 autolink literals, 20 code spans, 16 emphasis, 8 strikethrough, 1 inline HTML |
| tree-sitter-md ¶             |              183/183 |              406/497 | 208 / 33 of 105,952: 171 frontmatter, 33 + 33 task-item shape (as lezer), 3 positionless mdast autolinks (as lezer); 0 real                                     |
| lezer GFM+refcheck           |              183/183 |              488/497 | 43 / 46, of which about 20 are real: 6 email false positives, 14 code spans                                                                                     |

¶ Measured 2026-09-26 with the docs read from Platform `c130dd35a` and Editor `74e76be`
(105,952 constructs; lezer measures 43 / 46 on that set, as above).

Both candidates agree with micromark on every construct of every real chat message. The shared
residue (33 paragraphs on each side) is a shape difference in GFM task items.

## Speed

Full parse, one-character edit near the middle, and a 60-row viewport parse. Node 26 (V8, what
Chromium runs); Bun within 10%. 2 KB is a real assistant message, 45 KB is `AGENTS.md` (381
lines), 1 MB is `docs/` and `plans/` concatenated (7,318 lines).

| ms, median                                                |  2 KB |        45 KB |       1 MB |
| --------------------------------------------------------- | ----: | -----------: | ---------: |
| micromark + GFM (mdast)                                   |  0.62 |         16.3 |        311 |
| tree-sitter today (worker shape, cap 256)                 |  1.08 |         18.7 |        151 |
| tree-sitter block + every inline                          |  1.05 |         18.9 |        419 |
| tree-sitter block only                                    |  0.34 |          7.4 |        133 |
| tree-sitter combined inline                               |  1.13 |         28.2 |      1,857 |
| tree-sitter 60 visible rows (block + inline)              |  1.01 |          9.1 |        129 |
| tree-sitter edit on a fresh tree (block + touched inline) |  0.45 |         0.81 |       42.4 |
| tree-sitter keystroke, careful integration ‡              |     — |         0.30 |        2.4 |
| tree-sitter-md full (block; inlines resolve lazily) §     |     — |          1.4 |         26 |
| tree-sitter-md keystroke, median / p95 §                  |     — | 0.079 / 0.14 | 0.49 / 1.0 |
| tree-sitter-md first frame, 60 rows decorated §           |     — |         0.39 |       0.36 |
| lezer + GFM full                                          |  0.17 |         2.76 |       40.9 |
| lezer 60 visible rows (`stopAt`)                          |  0.14 |         0.37 |       0.42 |
| lezer edit (`TreeFragment.applyChanges`)                  | 0.086 |        0.086 |       0.82 |
| comrak `parseMarkdown` (AST to JS)                        |  0.11 |          2.8 |        323 |
| pulldown-cmark-wasm (HTML string only)                    | 0.044 |         0.47 |        5.3 |

The tree-sitter "1 MB today" figure is lower than the full parse because the cap stops inline
parsing after 255 layers.

The "edit on a fresh tree" row reparses `tree.copy()` of a full parse each time, which is the
first keystroke after a full parse. That reparse is O(document) (0 ms at 92 KB, 9.3 ms at 737 KB,
43 ms at 1 MB, at any edit position): tree-sitter refuses to reuse a block whose first token was
lexed in another lex mode when the state has external tokens, and every state in this grammar
does. The reparse re-lexes those tokens, so the tree it returns reparses cheaply. ‡ is the
evolving tree plus lazy, text-cached inline nodes for the viewport; lezer measured 0.10 and
0.65 ms in the same run. Method and the causes: [tree-sitter-calibration.md](tree-sitter-calibration.md).
§ Same harness and edits as ‡, medians of three runs in which lezer measured 0.097 / 0.21 ms
(46 KB) and 0.59 / 3.0 ms (1 MB) per keystroke; see [tree-sitter-md](#tree-sitter-md-custom-grammar--rust-resolver).

Streaming, 24-character chunks, per chunk (Bun):

| ms per chunk (mean / p95 / max)                   | 8.6 KB real message   | 45 KB `AGENTS.md`    |
| ------------------------------------------------- | --------------------- | -------------------- |
| remark session, healed (chat today)               | 0.23 / 0.43 / 2.45    | 0.66 / 1.79 / 3.72   |
| micromark full reparse + `remend` on all text     | 1.47 / 3.03 / 5.26    | 9.61 / 19.3 / 33.3   |
| lezer incremental                                 | 0.019 / 0.037 / 0.049 | 0.048 / 0.091 / 0.68 |
| lezer incremental + `remend` on all text          | 0.32 / 0.69 / 1.27    | 1.43 / 2.77 / 3.98   |
| tree-sitter incremental (block + touched inlines) | 0.26 / 0.52 / 0.72    | 0.085 / 0.22 / 0.48  |

`remend` is linear in the text it is given; the chat session heals only the tail block, which is
why it stays under a millisecond. Healing is a text transform in front of any parser.

Mid-stream, all three parsers agree with CommonMark: `Some **bold te`, `Some *it`, `` Use `code``
and `~~gone` stay literal until closed; an unclosed fence runs to the end of the text; a header row
with a partial delimiter row is a paragraph. `a [link](http://exa` becomes a shortcut link `[link]`
in tree-sitter and lezer (unvalidated reference) and plain text with refcheck. `remend` closes
emphasis, code and strikethrough and gives the link a placeholder destination, for any parser.

## Cold load, main thread and worker (Chromium)

Fresh browser context per run, `cache-control: no-store`, local server, `AGENTS.md`, median of 5:

| Candidate   |   Load (module + wasm compile) | First parse | Warm parse | Flatten preview nodes |                    Worker round trip, warm |
| ----------- | -----------------------------: | ----------: | ---------: | --------------------: | -----------------------------------------: |
| lezer + GFM |                         3.9 ms |     12.5 ms |     3.2 ms |    1.4 ms (all nodes) |                                     3.2 ms |
| tree-sitter | 12.4 ms (runtime + 2 grammars) |     40.5 ms |    20.1 ms |  6.0 ms (2,266 nodes) |                                    22.6 ms |
| micromark   |                         3.5 ms |     36.3 ms |    16.6 ms |                     — | fails: its entity decoder needs `document` |

tree-sitter-md, same setup, first 60 rows decorated instead of a whole parse: load 2.4 ms, first
frame 6.4 ms (`AGENTS.md`) and 9.5 ms (1 MB), warm full parse of 1 MB 31 ms; lezer in the same
harness: load 4.2 ms, first frame 7.7 and 6.4 ms, warm full parse 45 ms.

Bundle bytes (esbuild, minified; gzip -9):

| Payload                                                        |          Raw |       Gzip | Already shipped?        |
| -------------------------------------------------------------- | -----------: | ---------: | ----------------------- |
| `@lezer/markdown` + `@lezer/common` + GFM                      |        60 KB |      20 KB | no                      |
| chat's remark parse chain (unified, remark-parse/gfm/math/cjk) |       141 KB |      41 KB | yes, chat               |
| micromark + GFM to mdast                                       |        80 KB |      23 KB | inside the remark chain |
| web-tree-sitter JS + runtime wasm                              |  75 + 202 KB | 19 + 80 KB | yes, editor worker      |
| markdown + markdown-inline grammars (0.3.2)                    | 379 + 374 KB | 60 + 62 KB | yes, editor worker      |
| tree-sitter-md.wasm (grammar + runtime + resolver, `-O3`)      |       562 KB |     193 KB | no                      |
| comrak (wasm inlined in JS)                                    |       633 KB |     380 KB | no                      |
| pulldown-cmark-wasm                                            |       181 KB |      76 KB | no                      |

Retained memory per parsed document (Node, 20 copies held, heap + external): lezer about 600 KB
for `AGENTS.md` and 4.6 MB for 1.36 MB of docs; micromark's mdast 560 KB and 11 MB; tree-sitter
(both trees, wasm heap) about 80 KB and 3.4 MB. The wasm heap grows in pages and never shrinks, so
the tree-sitter figures are a floor.

## The split grammar

- One parse per paragraph is what keeps constructs inside their block. The combined parse leaks
  across block boundaries: a code span across two list items (example 42), strikethrough across
  two paragraphs (GFM 492), a link across paragraphs (551).
- It is also slower: 28 ms against 19 ms at 45 KB, 1,857 ms against 419 ms at 1 MB (natively
  too: `ts_lexer_goto` scans the included ranges from index 0 per token). Each per-paragraph
  parse costs about 35 µs with the whole document as input and 17 µs with input bounded to the
  paragraph.
- Past the cap. The worker stops adding injection layers at 256, counting fences and nested
  injections, in document order. In `/work/tmp/fregat-evidence/20260926T095101Z-scenario-research-176-preview/`
  a 300-paragraph file shows bold, italics, code and collapsed links through paragraph 145 and raw
  `**bold**`, `*em*`, `` `code` `` and `[link](…)` for paragraphs 289–300. `AGENTS.md` has 258
  inline nodes; 10 of 382 Platform docs exceed the cap.
- Table cells are never inline-parsed: the Editor's injection query names only `(inline)`, while
  upstream's Rust binding parses `inline` and `pipe_table_cell`. 167 of 382 Platform docs have
  tables; the same evidence run shows `**bold**`, `` `code` `` and `[link](…)` raw inside cells.

## tree-sitter-md (custom grammar + Rust resolver)

Spike of 2026-09-26 in `ShaulLavo/tree-sitter-md` `b962319` (`/work/projects/tree-sitter-md`):
a fork of the v0.5.3 block grammar with one token per line and link reference definitions left
to the resolver, and a Rust pass that runs each leaf block through pulldown-cmark 0.13.4's inline
algorithm, with a document-wide definition map and per-leaf caching. Runners live in the repo's
`bench/` (`spec.mjs`, `corpus.mjs`, `keystroke.mjs`, `fuzz.mjs`, `memory.mjs`, `chromium.mjs`),
with this file's normalizer (`constructs.mjs`) and a reader for the module's records.

Spec, same normalizer and reference as the section table above:

| Section                    |   n |  tree-sitter-md | lezer + refcheck |
| -------------------------- | --: | --------------: | ---------------: |
| Tabs                       |  11 |              11 |               10 |
| Setext headings            |  27 |              25 |               27 |
| HTML blocks                |  44 |              44 |               43 |
| Link reference definitions |  27 |              26 |               26 |
| List items                 |  48 |              47 |               46 |
| Links                      |  90 |              90 |               84 |
| Raw HTML                   |  20 |              20 |               17 |
| Every other section        | 409 |             409 |              409 |
| **Total**                  | 676 | **672 (99.4%)** |      662 (97.9%) |

Failing: 96 and 98 (`---` at the start reads as frontmatter, always on), 216 (a setext underline
under a paragraph of definitions), 260 (lazy continuation in nested quotes in a list).

Keystrokes: Node 26.7.0, the calibration's text and 200 seeded edits, each followed by
decorations for the 60 rows around the edit; medians of three runs in a wave-heavy slot, lezer in
the same runs:

| ms                                       | tree-sitter-md 46 KB | lezer 46 KB | tree-sitter-md 1 MB | lezer 1 MB |
| ---------------------------------------- | -------------------: | ----------: | ------------------: | ---------: |
| First frame (60-row prefix, decorated)   |                 0.39 |        0.57 |                0.36 |       0.47 |
| Full parse (tree-sitter-md: block only)  |                  1.4 |         3.3 |                  26 |         48 |
| Decorate the whole document              |                  1.1 |           — |                16.5 |          — |
| Rest of the document as an append edit   |                  2.2 |           — |                  29 |          — |
| Idle reparse after the append            |                  0.0 |           — |                 7.9 |          — |
| First keystroke (after the idle reparse) |                 0.44 |        0.79 |                 1.6 |        2.3 |
| First keystroke (no idle reparse)        |                 0.45 |         1.0 |                 2.4 |        2.4 |
| Keystroke median                         |                0.079 |       0.097 |                0.49 |       0.59 |
| Keystroke p95                            |                 0.14 |        0.21 |                 1.0 |        3.0 |
| Keystroke max                            |                 0.31 |           — |                 1.4 |          — |

The 1 MB keystroke is 0.19 ms edit (block reparse, definitions, cache invalidation) plus 0.27 ms
for the 60 rows (the edited paragraph resolved again). Warm, 60 rows cost 0.023 ms (decorations),
0.024 ms (highlight captures), 0.008 ms (folds), 0.007 ms (fence injections). Every edited
document equalled a fresh parse (11,300 random edits, `fuzz.mjs`; a control against altered text
fails every check).

Wasm: 562 KB, 193 KB gzip (`opt-level=z`: 458 / 161 KB, 10–20% slower keystrokes). Code:
pulldown-cmark about 120 KB, tree-sitter C runtime 96 KB, the resolver 49 KB, scanner and lexer
28 KB; data 178 KB. Linear memory per document (fresh instance, high-water): 0.5 MB for
`AGENTS.md`, 7.5 MB for 1 MB after parsing, 8.4 MB with every inline resolved.
