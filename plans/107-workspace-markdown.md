# A markdown package we own

Status: implemented 2026-09-13. `@workspace/markdown` renders chat; streamdown and its four plugins are gone. First-load JS went from 2292 KB to 2120 KB gz, `shiki` resolves to 4.4.3 only, and duplicated chunk basenames fell from 123 to 3 (the remainder are mermaid's own d3 forks, all lazy). See [Outcome](#outcome).

Chat markdown is rendered by [streamdown](https://github.com/vercel/streamdown), which brings a second complete Shiki installation one major behind the editor's, a lazy map of every grammar and theme Shiki ships, and an eagerly imported Mermaid. This plan replaces it with `@workspace/markdown`: one renderer we own, on our Shiki, serving chat today and the editor's markdown preview ([Plan 108](108-markdown-modes.md)) tomorrow.

The research is done and it is unusually favourable. Streamdown is not a fork of anything — its streaming behaviour is a separate 36 KB zero-dependency package, and the other half of the problem was solved independently, and differently, by T3. Both pieces are small and both are readable. [Plan 106](106-boot-weight.md) supplies the before-and-after number. [Root PLAN.md](../PLAN.md) owns scheduling.

## What renders markdown today

| Piece                   | Current state                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer                | `streamdown@2.6.0` in [`assistant-markdown.tsx`](../apps/web/src/features/chat/components/assistant-markdown.tsx), built on `unified` + `remark-parse` + `remark-rehype` + `remark-gfm` + `hast-util-to-jsx-runtime`, with `rehype-harden`/`rehype-sanitize`/`rehype-raw`.                  |
| Streaming behaviour     | `remend@1.3.1`, a streamdown dependency. Self-healing markdown: auto-closes unterminated bold, italic, code, links, images, strikethrough and math. **36 KB on disk, zero dependencies, published standalone**, explicitly documented as usable outside streamdown.                         |
| Code highlighting       | `@streamdown/code@1.1.1`, which hard-depends on `shiki@^3.19.0` → a complete `shiki@3.23.0` install with its own core, both engines, langs and themes (`bun.lock:951`, `bun.lock:2493`). It uses Shiki's `bundledLanguages`/`bundledThemes`, which Rolldown expands to one chunk per entry. |
| Duplication             | 123 chunk basenames emitted twice — the editor's 53 curated grammars plus ~60 themes, at both 4.4.3 and 3.23.0. `typescript-BydbNFcO.js` and `typescript-CkrWeWcv.js` are each exactly 181,146 bytes.                                                                                       |
| Who actually highlights | Not streamdown. `assistant-markdown.tsx` already routes every language except mermaid to its own `AssistantMarkdownCodeBlock`, highlighted by `createStreamdownEditorCodePlugin` on the editor's 4.4.3 highlighter. `@streamdown/code` is reached mainly through `getSupportedLanguages()`. |
| Other plugins           | `@streamdown/math` (Katex), `@streamdown/cjk`, `@streamdown/mermaid`. Mermaid is deferred by Plan 106; the rest are unexamined.                                                                                                                                                             |
| Re-parse cost           | Nothing. Every streamed token re-parses the whole document.                                                                                                                                                                                                                                 |
| Other consumers         | None yet. LSP hover and completion documentation render markdown inside the Editor packages, not here; Plan 108's preview will be the second in-app consumer.                                                                                                                               |

## Prior art

Two projects solved opposite halves of streaming markdown. Neither solution is large.

| Project                                                                           | What it fixes                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [remend](https://github.com/vercel/streamdown/tree/main/packages/remend) (Vercel) | **What incomplete syntax looks like.** Half-typed `**bol` renders as bold, not as literal asterisks. Context-aware: respects code and math blocks, list markers, escaped sequences, word-internal characters. 36 KB, no dependencies.                                                                                        |
| [`markdown-incremental.ts`](https://github.com/pingdotgg/t3code) (T3)             | **What re-parsing costs.** 4.2 KB. Caches the parsed prefix and parses only the new suffix each token, using a closed top-level fence followed by a blank line as the boundary, shifting node positions back, and bailing to a full parse when link/footnote definitions appear or when a `\r`/BOM could straddle the split. |

T3 uses plain `react-markdown` + `remark-gfm` + `remark-breaks` + `rehype-raw` + `rehype-sanitize` and their own `remarkGithubAlerts`, and applies **no** termination healing at all — a repo-wide search for "unterminated" finds nothing in their app code, and `isStreaming` is used only to skip the highlight cache, set `preserveLines`, and gate Mermaid. They accept literal `**bol`. We should not; we want both halves.

## Decisions

| Decision                              | Proposed behavior                                                                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — a workspace package              | `packages/markdown`, exporting from `src/index.ts` per the package-entry-barrel rule in [AGENTS.md § Code Organization](../AGENTS.md#code-organization). Runtime-neutral core, React rendering in a separate entry, so a non-React consumer can parse without pulling React. |
| D2 — build on unified, do not fork    | `remark-parse` + `remark-gfm` + `remark-rehype` + `hast-util-to-jsx-runtime`, the same stack streamdown and react-markdown both sit on. We are replacing a wrapper, not writing a parser.                                                                                    |
| D3 — take both halves of streaming    | Termination healing (remend's behaviour) and incremental prefix parsing (T3's) are both in scope. They are independent and compose: healing rewrites the tail, incremental parsing skips the settled head.                                                                   |
| D4 — vendor or depend, decided by fit | `remend` is Apache-2.0, dependency-free and standalone. Depending on it is legitimate; vendoring buys control over the edge cases we hit. The survey step decides, and records why. T3's incremental parser is a technique to reimplement, not code to copy.                 |
| D5 — one Shiki, ours                  | Highlighting goes through the editor's 4.4.3 highlighter, which the chat already uses. `@streamdown/code` and `shiki@3.23.0` leave the dependency graph entirely.                                                                                                            |
| D6 — every language, still lazy       | The package exposes a supported-language list backed by Shiki's `bundledLanguages` — the full lazy map, ~200 languages, zero boot cost. Breadth was never the problem; a second copy was.                                                                                    |
| D7 — sanitization is not optional     | Assistant output is untrusted. The sanitize/harden stage is part of the package and cannot be configured away by a consumer, only extended.                                                                                                                                  |
| D8 — rendering stays pluggable        | Consumers pass component overrides, as chat does today for links, images, inline code, strong, and code blocks. The package renders markdown; it does not own the chat's visual design.                                                                                      |
| D9 — mermaid stays deferred           | Plan 106's deferral survives the migration unchanged. The package exposes a diagram seam; it does not import a diagram library.                                                                                                                                              |

## Phase 1 — survey and decide

No production change. This phase ends with D4 answered and the API written down.

1. **Read the three implementations.** streamdown's renderer, `remend`, and T3's `markdown-incremental.ts`. Clone them into `/work/projects/references/` per the workspace layout rules; do not vendor blindly.
2. **Inventory what chat actually uses.** Every prop, plugin and component override in `assistant-markdown.tsx` and its siblings, and which of them streamdown supplies versus which we already supply ourselves. The expectation from the current reading is that most of the rendering is already ours.
3. **Confirm the second-consumer list.** Where LSP hover and completion documentation render markdown today, inside the Editor packages, and whether they can move onto this package or must stay where they are. A package with one consumer is a feature-local module by our own layering rule.
4. **Name the edge cases.** Streaming tables, nested fences inside list items, math inside emphasis, CJK width, GitHub alerts, footnote definitions arriving late. These become the test corpus before any code is written.

Completion: an API sketch, a vendor-or-depend decision with its reason, and a written test corpus.

## Phase 2 — the package

1. **Core pipeline.** Parse → heal → transform → sanitize → render, with the healing and incremental stages each individually disableable for non-streaming callers such as Plan 108's preview.
2. **Incremental parser.** T3's technique, reimplemented with our own tests: prefix cache, boundary detection, position shifting, and explicit bail-outs for definitions and for `\r`/BOM at the split. The bail-outs are the correctness surface and get direct tests.
3. **Termination healing.** Either the dependency or our own implementation per D4, with the corpus from Phase 1 as the acceptance test.
4. **Highlighting seam.** The package takes a highlighter, it does not construct one. Chat passes the editor's; Plan 108 passes the same one.
5. **React entry.** `hast-util-to-jsx-runtime` with component overrides (D8). No memoization beyond what a measured problem justifies, per [AGENTS.md § React Code](../AGENTS.md#react-code).

Completion: the package renders the Phase 1 corpus correctly at every prefix length of a streamed document, not just the complete one.

## Phase 3 — migrate chat and delete streamdown

1. Move `assistant-markdown.tsx` and its siblings onto the package, keeping every existing component override.
2. Remove `streamdown`, `@streamdown/code`, `@streamdown/cjk`, `@streamdown/math` and `@streamdown/mermaid` from `apps/web/package.json`, keeping Mermaid itself behind Plan 106's deferred seam.
3. Confirm with Plan 106's report: `shiki` resolves to exactly one version, duplicate chunk basenames drop to zero, and the first-load total falls by the measured amount.
4. Delete the obsolete streamdown-shaped tests rather than adapting them, per [AGENTS.md § Naming And Refactors](../AGENTS.md#naming-and-refactors).

Completion: one Shiki in the graph, zero duplicated grammar chunks, chat visually unchanged, and a recorded first-load delta.

## Verification boundaries

- Streaming correctness is tested by replaying a real assistant message one token at a time and asserting the rendered output at every prefix — the failure mode is a flicker at length 47, not a wrong final render.
- The incremental parser is proven equivalent to a full parse: for each prefix, incremental output and full-parse output must match. A fuzz corpus over fence/definition/CRLF boundaries is the honest test.
- Sanitization gets adversarial input: raw HTML, `javascript:` hrefs, nested raw blocks inside fences.
- Duplicate removal is proven by Plan 106's report, not by reading `bun.lock`.
- Never gate on a bare root `bun run verify`; use the per-workspace baseline delta.

## What this plan does not do

- No editor markdown behaviour. Plan 108 consumes this package; it does not change with it.
- No mermaid work beyond preserving Plan 106's deferral (D9).
- No new markdown _syntax_. GitHub alerts, wiki links and callouts are Plan 108's question, not this package's.
- No composer changes. The Lexical question is downstream of Plan 111.
- No editor-package changes. If LSP hover documentation should move onto this package, that is a follow-up once Phase 1 confirms it can.

## Outcome

Measured with `bun run --cwd apps/web bundle:report` on the same working tree before and after.

| Measure                    | Before           | After                          |
| -------------------------- | ---------------- | ------------------------------ |
| First-load JS              | 2292 KB gz       | 2120 KB gz                     |
| First-load CSS             | 31 KB gz         | 30 KB gz                       |
| `shiki` in the graph       | 3.23.0 and 4.4.3 | 4.4.3                          |
| Duplicated chunk basenames | 123              | 3 (mermaid's d3 forks)         |
| `katex` on first load      | 80 KB gz         | 0, loads on the first `$$`     |
| `parse5` on first load     | 34 KB gz         | 0, loads on the first raw HTML |
| `streamdown` + `marked`    | 27 KB gz         | 0                              |

Decisions recorded while implementing:

- **D4 — depend on `remend`.** Apache-2.0, zero dependencies, 36 KB, published standalone, and the
  edge cases it handles (list markers, escaped sequences, word-internal characters) are exactly the
  ones a vendored copy would drift on. One behaviour it lacks is guarded in `healMarkdown`: remend
  appends closers even when the text ends inside an open fence, so healing is skipped then.
- **Settled blocks, not fence boundaries.** T3 settles only at a closed top-level fence followed by a
  blank line. This package settles every root node but the last, grouped so that raw HTML left open
  keeps the following nodes in one block, and bails to a whole-document parse when a definition or
  footnote appears in the suffix, or a `\r`/BOM could straddle the split. Each settled block keeps its
  transformed mdast and its rendered React element, so a streamed token costs one block's parse,
  hast conversion and reconciliation. `session.test.ts` proves every prefix of the corpus parses the
  same incrementally as from scratch, positions included.
- **Raw HTML and math are deferred stages**, like mermaid. `rehype-raw` (parse5) and `rehype-katex`
  load on the first document that contains raw HTML or math; until then raw HTML is dropped by the
  sanitizer and math stays a code block. Math renders as MathML, so no KaTeX stylesheet ships —
  streamdown never loaded one either, so `$$` output was already unstyled.
- **Dropped with streamdown, deliberately:** the per-word fade-in (`animated`) — its keyframes lived
  in `streamdown/styles.css`, which the app never imported, so it never ran; table copy/download/
  fullscreen controls and the mermaid pan-zoom toolbar — chat had no tests or design for either.
  Tables render in a scrolling wrapper; a diagram has a copy button.
- **One highlighter, lazily built.** `createShikiHighlighter` is one `shiki/core` instance over the
  full lazy `shiki/langs` map with the JavaScript regex engine, created on the first fence, one
  grammar loaded per language. Themes are registration objects, so no bundled theme chunk is ever
  requested.
- **Second consumer.** LSP hover documentation still renders inside the editor packages; moving it
  is a follow-up once Plan 108 has exercised the package from the editor side.
