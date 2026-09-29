# E016: Evaluate bounded structural parsing

- Status: Approved
- Kind: Research
- Owner: Editor
- Priority: P2
- Effort: L
- Dependencies: [E001](../examples/stress/README.md)
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`

Decided 2026-09-25: owner — kept, and moved under Platform [Plan 112](../../platform/plans/112-large-file-ceiling.md) and [E015](e015-massive-file-loading.md): it runs in their lane, after 112's ceiling is measured.

## Outcome

Find a defensible way to limit Tree-sitter memory and work on huge documents while keeping the
visible syntax and structural actions honest. Determine which grammars and features can support
bounded parsing; a reduced-memory result with silently wrong scopes is a failed experiment.

## Current code

- [The worker](../packages/tree-sitter/src/treeSitter/treeSitter.worker.ts) parses complete source,
  retains reusable trees, and answers range queries afterward. A small query window is not a small tree.
- [Source callbacks](../packages/tree-sitter/src/treeSitter/source.ts) read resident chunks in
  batches; they reduce transport/materialization cost, not necessarily parser tree memory.
- [Request types](../packages/tree-sitter/src/treeSitter/types.ts) carry revision, generation,
  runtime-session identity, cancellation buffers, and degraded optional-phase outcomes.
- [Structural selection](../packages/tree-sitter/src/structuralSelection.ts) relies on meaningful
  syntax ranges. [Editor](../packages/editor/src/editor/Editor.ts) already windows syntax requests.
- [Worker tests](../packages/tree-sitter/test/treeSitter-worker.test.ts) and
  [the syntax benchmark](../packages/tree-sitter/bench/treeSitter-syntax.ts) provide the controls.

Recheck parse reuse, injection retention, cancellation, and peak allocation before introducing a
new mode. A leak or duplicate full parse should be fixed directly, not concealed by a feature cap.

## Scope

Keep complete text resident for this experiment. Compare current parsing, bounded query/retention
improvements, and bounded parse candidates. Report behavior for highlighting, folds, brackets,
indentation, selection expansion, and injections separately. File paging belongs to E015.

## Design

A viewport can begin inside a multiline string, comment, nested construct, or injected language.
Parsing an arbitrary slice as a file changes its grammar context. Fixed overlap does not establish
correctness; neither do included ranges automatically reconstruct omitted syntax context.

Evaluate candidates against the full parse: whole-tree parsing with reduced auxiliary retention;
grammar-specific safe regions with an explicit context strategy; or an explicit degraded mode
that supplies limited highlighting and disables unsupported structural answers. Pin the grammar
versions and document the admissible cases for every candidate. No universal safety claim is required.

Represent availability and freshness explicitly. Query results identify the parsed coverage and
revision; consumers must not interpret missing folds or brackets as proof none exist. Preserve
session ownership and cancel work for stale windows. Place a bound on caches and retained prior
trees, including injection trees, rather than limiting only the newest response size.

## Steps

1. Establish per-phase CPU and peak/retained-memory baselines for representative languages,
   huge lines, deeply nested source, and injected languages. Separate WASM memory from JS text.
2. Record the feature contract for complete, partial, stale, and unavailable syntax. Identify
   which existing consumers would need changes before they can accept a partial result.
3. Prototype at least two viable candidates beside the current implementation. Start with a
   language having clear region boundaries and include one with hostile cross-window context.
4. Compare captures and structural answers inside the visible range with a full-parse oracle.
   Shift windows and edit both inside and outside them; record discrepancies, not just timing wins.
5. Measure switching cost, retained trees after repeated moves, cancellation, and disposal.
   Select a bounded feature/language scope, retain current parsing, or reject the approach.

## Verification

Run targeted worker and structural-selection tests through `packages/tree-sitter`'s `test` script;
run `test:browser` for actual worker lifecycle and cancellation. Add fixtures with comments and
strings starting far outside the viewport, nested HTML/script injections, syntax errors, Unicode,
and edits that change the interpretation of distant text.

The proof must catch a deliberately context-truncated parse, reject stale generations, and show
correct behavior when a structural feature is unavailable. Compare total WASM/JS retention after
many window moves and a final dispose. A go decision requires a measured resource benefit and an
explicitly supported semantic envelope. A no-go closes the research with reproducible evidence of
the failed resource or correctness bounds. Reject designs that only look correct on nearby code.

## Risks and decisions

WASM heaps may retain their high-water allocation even after trees are released; distinguish live
objects from process RSS and allocator capacity. A useful outcome may be lower auxiliary retention
or a language-specific large-file mode. Do not promise a general windowed Tree-sitter parser or
silently enable partial structural behavior in ordinary files.
