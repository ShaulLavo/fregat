# Plan 176: One markdown parser

## Status and authorization

- Status: RESEARCH, authorized 2026-09-26 (owner). Nothing here authorizes implementation.
- Replaces [Plan 108](108-markdown-modes.md) D5. Plan 108 Phase 2 and the chat parser decision
  wait on this plan. [Plan 111](111-editor-decorations.md)'s decoration API does not.
- Planned at: Platform `d42184dc`, Editor `74e76be`, 2026-09-26. Origin: the investigation into
  markdown files painting as raw source before their live-preview decorations land.

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
  colour. `replacements.ts` rebuilds constructs by containment and adjacency.
- **The grammar is `@tree-sitter-grammars/tree-sitter-markdown` 0.3.2.** It is two grammars, block
  and inline, following CommonMark's two-phase parsing strategy: the inline grammar parses paragraph
  text with block prefixes such as `> ` cut out through included ranges. Upstream's README: "it is
  not recommended to use this parser where correctness is important. The main goal for this parser
  is to provide syntactical information for syntax highlighting". Its block scanner is 1,597 lines
  of C, lists do not distinguish loose from tight "for efficiency", and URI autolinks deviate from
  the spec to keep the generated parser small.
- **One inline parse per paragraph.** `markdown-injections.scm` declares the inline injection
  without `injection.combined`, so every `inline` node is its own parse, up to
  `MAX_INJECTION_LAYERS = 256` (`tree-sitter/src/treeSitter/treeSitter.worker.ts:140`). Past the
  cap, emphasis and links stay raw.
- **Decorations are always a second pass.** Captures come only from the tree-sitter worker
  (`syntaxController.ts:1259`), after the raw text has painted. A cold markdown open resolves seven
  grammar descriptors one after another (`withInjectedLanguages`, `session.ts:350`). Only a
  hover-prepared open whose tree-sitter stage finished before the click decorates the first frame.
  Plans [170](170-language-census.md) (warm-up) and [177](177-prefetch-every-press.md) (prefetch)
  own those paths.
- **Chat runs remark.** `@workspace/markdown` (Plan 107) is `unified` with `remark-parse`,
  `remark-gfm`, `remark-math`, `remark-cjk-friendly` (and its strikethrough companion) and
  `mdast-util-to-hast`, plus termination healing and an incremental prefix parse for streaming.
  Plan 108 D4 renders the split view with the same package.

## Why D5 is replaced

D5 said live preview "moves to an AST" because highlight captures cannot carry structure. That part
holds, but a purpose-named tree-sitter query answers it, as Plan 111's answer 6 already noted: a
`markdown-preview.scm` with `@link.destination`, `@emphasis.delimiter` and `@heading.marker` ends
the guessing and keeps tree-sitter. What D5 never weighed is which parser: upstream's correctness
caveat, the worker round trips before the first decorated frame, and everything remark does on top
of a parse. Those decide it, and they are measurable.

## Candidates

| Candidate                                 | Shape                                                                                                                 | Known limits                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| tree-sitter-markdown with a preview query | Today's grammar; a query written for decorations                                                                      | Upstream's caveat; the 256-layer cap; async until warm                       |
| tree-sitter-markdown with a grown scanner | Fork or upstream the C external scanner                                                                               | Parser work in C against the spec examples                                   |
| A Rust parser compiled to wasm            | Measure existing ones before writing one: `pulldown-cmark`, `comrak`, `markdown-rs` (micromark's port, same author)   | None of the three is incremental; a wasm load before the first parse         |
| `@lezer/markdown`, forked if needed       | Hand-written TypeScript that emits Lezer trees and reuses old tree fragments when it reparses; ships `GFM` extensions | Does not validate link references (its README says so); a second tree format |
| micromark (remark)                        | Today's chat parser, the baseline                                                                                     | One-shot parse; the editor would reparse the whole document per keystroke    |

`@lezer/markdown` is cloned at `references/lezer-markdown` (1.7.2). The project moved from GitHub
to `https://code.haverbeke.berlin/lezer/markdown`, and the clone's remote points there. Its README
explains why it is hand-written: the Lezer runtime "runs LR parsers, and Markdown can't really be
parsed that way".

Each candidate is also measured in two placements where it can run in both: the worker and the main
thread. web-tree-sitter runs on the main thread once its wasm has loaded.

## Research questions

1. **Correctness.** Pass rate on the CommonMark 0.31.2 spec examples and the GFM spec examples,
   per spec section, per candidate. `references/lezer-markdown/test/` has a spec harness to start
   from. Trees differ in shape, so compare a normalized construct list with source positions
   (heading levels, emphasis spans, links with label and destination ranges, list tightness, code
   spans and fences, tables) against micromark's output. Then the same comparison on our corpus:
   the repo's `.md` files and a sample of real assistant messages.
2. **Speed.** Cold load (wasm fetch and compile, or JS parse), full parse, a one-character edit in
   the middle, and a simulated chat stream appending chunks, on 2 KB, 45 KB (`AGENTS.md`) and 1 MB
   documents. Main thread and worker. Memory per document.
3. **First frame.** Can the candidate produce the visible rows' decorations in the same render as
   `setText`? Use Plan 177's Phase 0 scenario, which counts frames until decorations appear.
4. **What each tree carries** against remark's feature list: loose and tight lists, link references
   checked against their definitions, footnotes, math, CJK-friendly emphasis, table alignment, task
   lists, frontmatter, HTML blocks, source positions.
5. **Fixability.** Sort each tree-sitter failure cluster into scanner-fixable or structural. Rules
   that depend on text elsewhere in the document, such as link references, cannot be fixed in one
   incremental pass by any candidate; lezer skips them too.
6. **The split grammar.** Does one combined inline parse keep emphasis inside its paragraph, and is
   it faster than one parse per paragraph? What does a document past 256 inline nodes look like
   today?
7. **Streaming.** Tree-sitter's incremental edit at the end of the document against remark's
   incremental prefix parse and healing: cost per chunk, and how each renders an unterminated
   `**` or fence mid-stream.
8. **Two parsers.** If the editor picks one parser and chat keeps remark, what diverges: fence
   highlighting, edge-case rendering, bundle bytes.

Probes and raw output go in `/work/tmp/research/176/` (throwaway). Findings land in this plan.

## Proposed decision rule

- **Editor, live preview and split view.** The candidate that decorates the first frame and whose
  failures fall where live preview tolerates them: the source is one caret move away. Tree-sitter
  wins ties, because it is already loaded for folds and injections.
- **Chat.** Leave remark only if a candidate lands close to micromark on the spec and on our corpus
  and the remark feature list can be closed. The owner sets the threshold after seeing the numbers.
  If no candidate qualifies, this plan closes with the editor decision alone.

## Deliverables

- Findings and a recommendation in this plan.
- An executable plan for the chosen parser, and Plan 108 Phase 2 rewritten against it.

## What this plan does not do

- No decoration API work (Plan 111), no block widgets, no Obsidian features (Plan 108 Phase 3).
- No grammar warm-up (Plan 170) and no prefetch work (Plan 177).
- No change to chat rendering before the decision.
