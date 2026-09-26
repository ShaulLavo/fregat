# tree-sitter markdown calibration (Plan 176, 2026-09-26)

[Plan 176](../../plans/176-markdown-parser.md) measured tree-sitter markdown at 42 ms per keystroke
and 43 ms for an unchanged reparse at 1 MB ([measurements](measurements.md)). This file checks
the instrument against controls, finds what each slowdown comes from, and measures a tree-sitter
integration with those causes removed.

**Verdict.** The tree-sitter runtime works as designed. The 42 ms comes from reparsing a freshly
parsed tree, a worst case this grammar hits on the first edit after every full parse. The
Editor worker adds a larger cost on every keystroke. With both fixed, a keystroke at 1 MB costs
2.4 ms (lezer: 0.65 ms) and the first frame costs 2.2 ms (lezer: 0.5 ms). tree-sitter can keep
up; lezer stays 3–4× faster.

## Setup

- Machine i7-14700K, Node 26.7.0. Machine-wide heavy jobs ran through the wave-heavy slots. Other
  agents shared the machine, so the numbers here are medians of three runs, and the full-parse
  timings vary by up to ±15%.
- web-tree-sitter 0.26.13 and 0.27.0 (Editor main moved to 0.27.0 in `794cbba` and rebuilt the
  markdown wasm). Both versions measure the same: every figure below matches across them within
  noise, and so do the parse logs, line for line.
- Grammars: npm 0.3.2 (the Editor's wasm, both builds), upstream v0.5.3 (release wasm and source),
  and variants regenerated with tree-sitter CLI 0.26.9. Controls: `tree-sitter-typescript`
  0.23.2, `tree-sitter-javascript` 0.25.0, `tree-sitter-json` 0.24.8, the Editor's wasm files.
- Files: `docs/` and `plans/` cut at 1,000,143 chars (the plan's 1 MB); the plan's 46 KB
  `AGENTS.md`; a real 1.18 MB TypeScript file (vscode `agentService.test.ts`), 1.07 MB of JS
  (`react-dom-client.development.js`), 1.06 MB of JSON (opencode `openapi.json`).
- Native: tree-sitter runtime v0.27.0 compiled from source with a probe hook (reduce reasons,
  first-leaf refusals), gcc -O2, both grammar versions. `tree-sitter parse --time` agrees on the
  full parse (147 ms at 1 MB).
- Probes live in `/work/tmp/research2/176b/` (throwaway): `ctl.mjs`, `chain.mjs`, `careful.mjs`,
  `inline.mjs`, `norm.mjs`, `harness-check.mjs`, `worker-bench.ts`, `native/drv.c`.

## 1. Control: the harness is fine

Same harness, same machine, each edit on a copy of the freshly parsed tree (the plan's method):

| wasm, ms               | Full parse | Unchanged reparse | One char at 2% / 50% / 98% |
| ---------------------- | ---------: | ----------------: | -------------------------: |
| TypeScript, 1.18 MB    |        113 |              0.04 |         0.29 / 0.05 / 0.06 |
| JavaScript, 1.07 MB    |         84 |             0.002 |            2.3 / 2.4 / 2.5 |
| JSON, 1.06 MB          |         45 |             0.001 |         0.07 / 0.17 / 0.13 |
| markdown block, 1.0 MB |        128 |                43 |               43 / 43 / 43 |
| markdown block, 46 KB  |        7.3 |             0.001 |         0.71 / 0.67 / 0.56 |

Native: TypeScript 76 / 0.02 / 0.2–0.3 ms, JSON 28 / 0.000 / 0.04–0.12 ms, markdown block
142 / 29 / 27 ms. Every edited tree equals a fresh parse of the edited text. The harness,
`tree.edit()` and the input callback all behave. The slowdown is specific to markdown.

Harness variants on the 1 MB unchanged reparse change nothing: same parser 44–50 ms, new parser
46 ms, after `reset()` 44 ms, 4 KB callback 44 ms, reparsing a copy 43 ms. One variant changes
everything: reparsing a tree that came out of an incremental parse costs 3.0 ms.

## 2. What makes the first reparse O(document)

tree-sitter's parse log (`setLogger`) for the unchanged 1 MB reparse: 118,786
`cant_reuse_node_is_fragile`, 5,766 `cant_reuse_node` (first leaf), 111,158 `reuse_node` of
single tokens, 117,013 shifts, 124,862 reductions. The parser skips the lexing but re-shifts and
re-reduces every token. TypeScript's unchanged reparse logs 109 reuses and 106 reductions.

Two rules in `lib/src/parser.c` cause it, and this grammar's shape triggers both:

1. **The first-leaf rule.** A node can be reused only if its first token was lexed in the same
   lex mode as the current state, or if the current state has no external tokens
   (`ts_parser__can_reuse_first_leaf`). In a fresh parse, the first token of each block is the
   lookahead that closed the previous block, so it was lexed in the inner state, before the
   reductions. On reparse, the parser reaches it after reusing the previous block, in the outer
   state. A normal grammar gets past this through the "no external tokens" fallback. Every state
   in this block grammar consults the external scanner, so the fallback never applies. The probe
   hook sees six refusals for "state has external tokens" for every one for a zero-width token,
   and none for any other reason.
   Relaxing the rule in the probe runtime brings the reparse down to 0.02 ms, but it is unsound:
   6–11 of 2,000 random edits then produce a tree that differs from a fresh parse. The rule is
   correct.
2. **Fragile repeats.** `_line` is `repeat1` over single tokens, so a 1 MB file has 155,081
   `_line_repeat1` nodes. tree-sitter merges repeat nodes in table cells with two actions
   (`REDUCE` + `SHIFT_REPEAT`), and such nodes are fragile. Every grammar has these; JSON and
   TypeScript close each repeat inside a delimited node (`{…}`, `(…)`), so fragility stops there.
   A markdown block starts and ends with a repeat, so fragility runs up through `paragraph`
   (2,012 of 2,021), lists, list items and `document_repeat2`. Table cells do the same
   (`pipe_table_cell_repeat1`, 73,868 fragile nodes). This is also why the full block parse costs
   128 ms per MB, against 45 ms for JSON.

The declared conflicts (`link_label`/`_line`) are not the cause: removing link reference
definitions and all three conflicts changes nothing. Scanner state is not the cause either:
serialized states are 4–15 bytes, and the log shows no `external_scanner_state_changed`.

**Why it looked like it scaled with size.** A reparse re-lexes each refused token in the state
it now reaches, so its output tree passes the first-leaf rule next time. The plan's probe edited
`tree.copy()` of a fresh parse every time, which measures the first keystroke after a full parse,
over and over. Small files hid this: the root node reuses whole while the document has at most
two top-level sections, so `AGENTS.md` once or twice (46 and 92 KB) measured 0 ms and three times
(138 KB) 1.1 ms. Unchanged reparses of the same
1 MB tree after k passes:

| k passes (wasm, ms) |   0 |   1 |   2 |   3 |   4 |
| ------------------- | --: | --: | --: | --: | --: |
| stock grammar       |  47 | 3.5 | 1.9 | 2.3 | 1.1 |
| left-recursive line |  30 | 1.7 | 0.8 | 0.9 | 0.4 |

Editor-shaped keystrokes (edit the evolving tree, 300 random positions, block grammar only):

| wasm, ms                                | First keystroke | Later median | Later p95 | Unchanged after |
| --------------------------------------- | --------------: | -----------: | --------: | --------------: |
| markdown 1.0 MB                         |              46 |          2.0 |       4.5 |            0.95 |
| markdown 1.0 MB, one idle reparse first |             4.8 |          1.9 |       2.7 |            0.93 |
| markdown 46 KB                          |             1.5 |         0.17 |      0.44 |           0.006 |
| TypeScript 1.18 MB (control)            |             1.1 |          1.0 |       1.4 |            0.07 |
| JSON 1.06 MB (control)                  |             0.7 |         0.41 |      0.55 |           0.006 |

Native, same loop: stock 0.85–0.95 ms median at 1 MB, v0.5.3 1.0–1.4 ms. Once the first
keystroke has passed, the block grammar edits at TypeScript's cost.

**A grammar fix exists, but it is not a one-liner.** Making `_line` left-recursive
(`prec.right(1, choice(seq($._line, X), X))`) removes the word-level fragile nodes. It brings the
steady keystroke to 0.12 ms natively (0.85 before) and 1.3 ms in wasm (3.5 in the same run), and
the first reparse to 20 ms. But it breaks link reference definitions: 160 of 1,786 files
(repository docs, Editor docs, all CommonMark and GFM examples) parse differently, for example
`[foo]: /url "title"` becomes a paragraph. The GLR fork that recognises definitions depends on
the repeat. Declaring the new conflict instead needs more conflicts in other rules (indented
code), and each one brings fragility back. It is grammar work to do upstream.

## 3. Version and wasm

- Runtime 0.26.13 and 0.27.0: same timings, same logs.
- Grammar 0.3.2 and v0.5.3: same reuse counts to within 10 nodes, same timings; the Editor's
  two wasm builds (74e76be and 794cbba) agree too.
- Native and wasm: the block grammar costs the same natively (142–149 ms full) as in wasm
  (128 ms). The steady keystroke is 0.9 ms native against 1.9 ms in wasm. Native is not the
  answer.

## 4. The inline cost

Per inline parse at 1 MB (8,951 `inline` and `pipe_table_cell` nodes), wasm:

| Input                                                   | µs per call | All nodes |
| ------------------------------------------------------- | ----------: | --------: |
| Whole document string (the plan's probe)                |          32 |    287 ms |
| Callback bounded to the node's end                      |        16.7 |    150 ms |
| The node's substring, ranges made relative              |        16.7 |    150 ms |
| Fixed cost of a call (1-char input, `reset()` included) |         1.1 |         — |
| Native, per node                                        |          13 |    115 ms |

The substring trees are identical to the whole-document trees (8,951/8,951). Half the plan's
figure was the input callback copying up to 10 KB of the document into wasm memory per call:
web-tree-sitter's string input is `text.slice(index)`, and it copies up to 5,120 code units per
call. The Editor worker's piece-table callback reads 4,096 code units. The rest is the inline
grammar itself: JS↔wasm crossing and tree allocation cost about 1 µs.

**Combined inline parse, 1.86 s.** Natively it is 1.9 s too, so wasm is not the cause.
`ts_lexer_goto` (`lib/src/lexer.c`, unchanged on tree-sitter main) scans the included-range list
from index 0 every time a token starts, which is quadratic: about 150,000 tokens times thousands
of ranges. An unchanged reparse costs the same 2.0 s. The approach is also wrong for markdown
(constructs leak across blocks, Plan 176 point 6), so the quadratic scan does not matter to us.

**What the Editor worker does today** (its own `TreeSitterWorkerClient`, `parseOnly`, Editor main
`67c779e`, 10 keystrokes):

| Worker, per keystroke, ms | parseRoot | injectionDiscovery | parseInjection (256 layers) | Total |
| ------------------------- | --------: | -----------------: | --------------------------: | ----: |
| 46 KB, keystrokes 2–10    |   0.3–0.5 |                2.9 |                     6.8–7.9 |    12 |
| 1 MB, first keystroke     |        43 |                 28 |                         9.7 |    85 |
| 1 MB, keystrokes 2–10     |   0.9–5.6 |              24–50 |                        6–21 | 34–77 |

`handleEdit` passes the whole document as the changed range ("Delimiter edits can invalidate
descendants outside the edited range"). So every keystroke re-runs the injection query over the
whole tree, copies and edits every layer tree, and reparses all 256 layers, each reading 4 KB of
input. Without the cap it would reparse 8,951 layers. At 46 KB the block reparse is 3% of the
keystroke. With the highlight query (`full` mode) the 46 KB keystroke is 18 ms.

## 5. A careful integration, measured

`careful.mjs` works like this. The block tree evolves with each edit. The first frame parses a
60-row prefix (input ends at the prefix), and the rest arrives as an append edit. Inline trees are
parsed from the node's substring, stored position-independent and cached by that text. Each
keystroke reparses the block, the inline node holding the edit and any visible inline node not in
the cache. lezer (`@lezer/markdown` 1.7.2 + GFM, `TreeFragment.applyChanges`) runs on the same
text and the same 200 edits in the same process. Medians of three runs:

| ms (wasm, Node)                                              | tree-sitter 46 KB | lezer 46 KB |         tree-sitter 1 MB | lezer 1 MB |
| ------------------------------------------------------------ | ----------------: | ----------: | -----------------------: | ---------: |
| First frame, 60 rows (block + inlines)                       |        0.97 + 1.3 |        0.48 |                1.0 + 1.2 |       0.48 |
| Whole document (block only / lezer tree)                     |               7.4 |         5.4 |                      128 |         47 |
| First keystroke after open                                   |               2.4 |        0.70 |                       46 |        2.8 |
| First keystroke, one idle reparse after open (41 ms at 1 MB) |               2.4 |        0.70 |                      4.8 |        2.8 |
| Keystroke median (block + inline + visible)                  |              0.30 |        0.10 | 2.4 (1.75 + 0.11 + 0.45) |       0.65 |
| Keystroke p95                                                |              0.93 |        0.19 |                      4.8 |        2.9 |

The prefix-then-append tree equals a fresh parse, and after 200 keystrokes the block tree equals
a fresh parse too. What the integration changes, against the plan's probe and the worker:

1. Edit the evolving tree, and give the tree one reparse in idle time after every full parse, so
   the first keystroke does not pay 46 ms.
2. Parse inline nodes lazily for the viewport, from their own text, cached by text. A keystroke
   then reparses one inline node (0.1 ms). Untouched paragraphs cost nothing, and there is no
   layer cap.
3. Bound every input read to the range being parsed.
4. Find touched layers from the root tree's changed ranges plus the edit, not the whole document.
5. Parse a prefix for the first frame and append the rest.

## 6. How other editors do it

(Clones: `references/zed` `933d8d93`, `references/neovim` `521eddec`, `references/helix`
`079a789e`, `references/tree-house` `750cff21`.)

- **None combines inline nodes.** Neovim, Helix and Zed all give each `inline` node its own
  `markdown_inline` tree (Neovim `runtime/queries/markdown/injections.scm:21-25`, Helix
  `runtime/queries/markdown/injections.scm:22`, Zed `crates/grammars/src/markdown/injections.scm`).
  Neovim and Helix combine only `html_block`.
- **Neovim parses injections for the visible range only.** The highlighter passes each window's
  line range to `LanguageTree:parse(ranges)` (`highlighter.lua:582-610`). Parsing runs in 3 ms
  slices and gives up at `'redrawtime'` (2 s). An edit invalidates only the regions it touches,
  but a change in the number of inline regions drops every child tree (`languagetree.lua:874-879`).
  History: nvim-treesitter#2916 measured about 35 ms per keystroke in files over 500 lines, mostly
  the block parse. neovim#22309 made injections incremental, #22420 made parsing async, and
  #24647 stopped parsing off-screen injections.
- **Helix (tree-house) parses the whole document and every layer, synchronously.** It reparses
  only layers marked modified, but runs the injection query over each parent's whole root on
  every edit (`injections_query.rs:382`). A layer parse has a 500 ms timeout, after which syntax
  is off for the buffer. Complaints: helix#4139 (typing lag in a markdown file with links),
  helix#3072 (open; a 5 MiB file takes over 5 s to open and about 660 MiB of memory).
- **Zed parses the whole document**, keeps untouched layers in a SumTree, runs the injection
  query only over changed ranges widened by a few rows (`syntax_map.rs:915-947`), and gives each
  edit a 1 ms synchronous budget before it moves the parse to a background task
  (`buffer.rs:1170-1173`).

None of them works around the first-keystroke effect: they all edit the evolving tree, so they
pay it once after open. The complaints above are about the block parse on the first keystroke,
whole-document injection queries and highlight queries. Our worker has the second of these.

## What changes for Plan 176

- The plan's "tree-sitter one-character edit, 42.4 ms at 1 MB" and "block reparse scales with
  the document even when nothing changed" describe the first keystroke after a full parse. A
  careful integration costs 2.4 ms per keystroke at 1 MB and 0.30 ms at 46 KB (lezer 0.65 and
  0.10).
- The first frame no longer needs the whole block parse: a 60-row prefix parses in 1.0 ms, and
  its visible inlines in 1.2 ms (lezer 0.48 ms).
- Correctness is unchanged: 93.3% against 97.9%, and 11 structural failures in C.
- The worker's markdown path costs 12 ms per keystroke at 46 KB and 34–77 ms at 1 MB today, most
  of it injection discovery and reparsing all 256 layers. That cost exists whichever parser
  drives live preview, because tree-sitter keeps the colours.
