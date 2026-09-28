# E063: More editor features from tree-sitter queries

- Status: Proposed
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: M
- Dependencies: none (ShaulLavo/singapore#61 moves to tree-sitter-x; this plan works with either runtime)
- Inspected baseline: `8def2ec2163b15f3ad02779515841eb94305c55c` (main), with #61 applied

## Outcome

Singapore ships three query kinds per language: `highlights`, `folds` and `injections`. Zed builds
most of its language-aware features from further query files per language. Each new kind is a
file per language plus one consumer, reusing the parse the worker already keeps. For example, an
`outline.scm` for TypeScript yields the function and class list for breadcrumbs and sticky scroll,
without a language server.

## Current code

- `packages/tree-sitter/src/treeSitter/treeSitter.worker.ts` parses in a worker and already uses
  `getChangedRanges`, included ranges (injections) and parse timeouts. The performance ideas in
  the original proposal are done; this plan is about features only.
- `packages/tree-sitter-languages` holds `*-highlights.scm` (7), `*-folds.scm` (8) and
  `*-injections.scm` (6). No other query kinds exist.
- Error and missing nodes are already modelled (`isMissing` in `packages/editor/src/syntax/session.ts`).
  Check whether they are rendered before starting step 4.
- Symbols today come only from the TypeScript language server (`packages/typescript-lsp/src/worker/symbols.ts`).
- Sticky scroll exists in `packages/editor` but is not driven by syntax. Check its data source first.

## Scope

Add query kinds one at a time, each with its consumer and tests:

1. `outline`: symbols for breadcrumbs, sticky scroll and a symbol picker, for any language with a grammar.
2. `textobjects`: select or move by function, class, parameter, comment. Includes expand/shrink selection by node.
3. `overrides`: scope-aware behaviour, such as no auto-closing quotes inside strings and comments,
   and the comment token of the embedded language inside injections.
4. Syntax error squiggles from `ERROR`/missing nodes, for files without a language server.
5. `runnables` (optional, host-owned): marks test functions so a host such as Fregat can show run buttons.

Not in scope: replacing LSP features where a server is running; `redactions`.

## Design

- Query source: start from Zed's per-language query files (MIT) and adapt the capture names.
  Record the source commit in each file header.
- Queries run in the worker over the visible range (`QueryCursor` byte range) with a match limit,
  like highlights, and are cached per tree version.
- One provider per kind in `packages/tree-sitter`, exposed through the same session API as folds.
- Decision needing evidence: whether `outline` should replace LSP symbols when both exist. Prefer
  LSP when a server answers and fall back to the query.

## Steps

1. `outline` for TypeScript, JavaScript and Markdown. Evidence: breadcrumbs update while typing in a 5,000-line file within the existing frame budget (`bench:input`).
2. `textobjects` + expand/shrink selection. Evidence: tests select the enclosing function, parameter and comment in each language.
3. `overrides`. Evidence: typing `'` inside a string inserts one quote; comment toggle inside a Markdown code block uses the code language's comment.
4. Research, then error squiggles. First record how Zed and VS Code handle syntax errors next to
   LSP diagnostics: whether tree-sitter errors show at all when a server is running, how duplicates
   are merged or suppressed, how long they wait after typing, and how they treat recoverable
   errors versus a genuinely missing token. Decide our rules from that write-up. Evidence: the
   write-up in this plan, then a missing `}` shows one diagnostic (never a duplicate of the
   server's) and it disappears after the fix without a full reparse.
5. `runnables`, only if a host asks for it.

## Verification

- Unit tests per query kind in `packages/tree-sitter-languages/test`. Each covers one construct per
  language and catches a query that stops matching after a grammar bump.
- Worker tests in `packages/tree-sitter/test` check that results follow edits. They catch stale
  results after incremental reparse.
- `bun run bench:input` shows no regression in keystroke latency.

## Risks and decisions

- Zed's capture names differ per kind; adapting them is the main cost, and grammar version skew can
  make a query fail to compile. Compile every query in tests.
- Queries over large ranges can stall the worker. Bound them to the viewport and use match limits.
- Syntax errors and LSP diagnostics overlap, and the right interaction is not obvious; step 4
  starts with research into Zed and VS Code, and does not ship squiggles before that decision.
- Stop after step 2 if the outline and text objects do not get used; the rest are refinements.
