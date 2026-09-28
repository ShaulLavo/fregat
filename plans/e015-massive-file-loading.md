# E015: Design bounded loading for massive files

- Status: Approved
- Kind: Research
- Owner: Cross-repo
- Priority: P3
- Effort: XL
- Dependencies: [E001](../examples/stress/README.md), [E007](../docs/performance/e007-consumer-copies.md)
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`

Decided 2026-09-25: owner — this plan and Platform [Plan 112](../../platform/plans/112-large-file-ceiling.md) run as one lane, 112 first. 112's benchmark sets the ceiling this plan's scope and exit are written against.

## Outcome

Determine whether a file larger than the comfortable in-memory editing limit can open, scroll,
and navigate with bounded resident text. Produce a measured architecture decision and a working
read-only proof before promising general editing, saving, or language features for partial files.

## Current code

- [Editor document creation](../packages/editor/src/editor/editorDocument.ts) accepts a complete
  string for both session and static documents. Static mode is not a paged source abstraction.
- [Document sessions](../packages/editor/src/documentSession.ts) and
  [piece-table snapshots](../packages/textbuffer/src/snapshot.ts) assume known document text.
- [Platform reads](../../platform/apps/server/src/fs/read.ts) enforce a byte limit, read the file,
  decode UTF-8, and compute a content version from the resulting text.
- [Host text-snapshot helpers](../../platform/apps/web/src/features/editor/utils/text-snapshot.ts)
  demonstrate the existing chunk-reading API; chunks here are resident text, not file ranges.
- [Tree-sitter sources](../packages/tree-sitter/src/treeSitter/source.ts) avoid some flat copies,
  but still describe resident document content. E007 first measures and removes avoidable copies.

The old 48 MB incident is motivation, not a current maximum. Reproduce limits on current versions
and attribute text, indexes, trees, transport, and host buffers separately before choosing a design.

## Scope

Compare complete resident text with streamed construction and a paged read-only document. Editor
owns document/view semantics; Platform owns range I/O, file identity, authorization, cancellation,
and external-change handling. Streaming one allocation at a time may reduce peak copies but does
not by itself bound steady-state memory. Editable paging is a separate decision after the proof.

## Design

Keep global document identity and positions stable while pages enter and leave memory. Do not
rebase every consumer onto a moving window. Define explicitly how UTF-8 byte ranges map to UTF-16
offsets and line numbers, including multibyte characters, CRLF splits, BOMs, and very long lines.
Compare a sparse line/encoding index built incrementally against a full index; account for its cost.

Model unavailable data as a load state with a cancellable request, not an empty string. Bind every
page and index result to the same file revision. A changed file invalidates that read session; it
must never silently combine pages from different versions. Specify cache capacity and eviction,
range coalescing, backpressure, page pinning, and disposal before adding prefetch heuristics.

Define supported capabilities for each mode. A read-only proof can provide indexed scrolling and
range copy while declaring whole-document replace, undo, semantic analysis, or full copy unavailable.
Any later editable design needs dirty-page ownership, cross-page edits, save atomicity, conflict
checks, history retention, and cancellation; write that follow-up scope rather than hiding it here.

## Steps

1. Use E001 to measure peak and steady-state memory at several file sizes after E007. Identify
   whether text residency, duplicate reads, parsing, or indexes are the first actual ceiling.
2. Write the three candidate contracts and a feature-capability table. Estimate unavoidable index
   and dirty-data growth; reject designs whose supposedly bounded cache has unbounded side tables.
3. Prototype streamed construction and paged read-only viewing against the same range source.
   Use local deterministic data first, then the real Platform read boundary with revision checks.
4. Exercise rapid distant jumps, cancellation, concurrent views, slow range responses, and file
   changes. Measure first useful paint, jump delay, bytes fetched, CPU, and total retained memory.
5. Record a go/no-go result and the smallest production milestone. If resident text remains the
   better tradeoff at supported sizes, retain it and document the measured limit and revisit trigger.

## Verification

Compare every displayed and copied range with a complete decoded reference document. Include
surrogate pairs, combining sequences, split CRLF, no final newline, malformed input, and ranges
outside the current page. Real-browser tests must prove that an unloaded range never looks empty.

Drive Platform's real filesystem routes over temporary files for revision and range behavior;
use delayed boundary responses to verify stale request rejection. During a full scroll sweep,
resident pages must stabilize under the declared cap after pinned references are released.
Acceptance is a reproducible comparison and explicit capability decision, not a partial document
masquerading as a complete `TextSnapshot`. No change to default file limits is implied by the proof.

## Risks and decisions

Random line navigation requires discovery work even when text is paged. Searching, copying all,
and saving may necessarily touch the entire source. Compare total work as well as first paint.
Coordinate with [E016](e016-bounded-structural-parsing.md), but do not make successful bounded parsing
a prerequisite for evaluating a read-only text viewer. Shared memory is optional, not foundational.
