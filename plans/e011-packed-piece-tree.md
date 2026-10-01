# E011: Evaluate a packed representation of persistent piece trees

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: Approved
- Kind: Research
- Owner: Editor
- Priority: P3
- Effort: L
- Dependencies: [E005](../editor/docs/storage/piece-tree-inspection.md), [E009](099-document-contributions.md)
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`, 2026-09-05.

Decided 2026-09-25: owner — parked under Platform [Plan 112](112-large-file-ceiling.md)'s large-file work. Revive it only if 112 shows piece memory dominates. Its dependency E009 is folded into Platform Plan 099 unit 6.

## Outcome

Determine whether an indexed typed-array tree can reduce retained metadata or enable worthwhile
shared snapshots without slowing editing, walking, anchor resolution, or undo.
The prototype preserves the same document behavior as the object AVL tree on identical edit streams.
A favorable result includes measured tradeoffs and a bounded conversion plan.
A negative result leaves the production representation alone.

## Current code

Rechecked 2026-09-25 at Editor `c23cd30`, after E039, E040, E041, E045 and E006.

- [Piece tree types](../editor/packages/textbuffer/src/pieceTableTypes.ts) store object links,
  floating-point order values, an AVL height (E040 replaced the treap and its priorities),
  piece records, and cached aggregates.
- [Tree operations](../editor/packages/textbuffer/src/tree.ts) apply an edit call in one descent
  (E040, E045) and reuse nodes created inside the same edit (E041).
  [Order allocation](../editor/packages/textbuffer/src/orders.ts) uses fractional numeric gaps above a
  small-integer floor; values below it name E006 stand-ins.
- [The reverse index](../editor/packages/textbuffer/src/reverseIndex.ts) is a persistent vector of
  inserted buffers with thin entries (E039), not a second tree. Anchor work still reads it, so
  packing only the forward tree leaves it unchanged.
- E006 compaction bounds the tree: after 20,000 paragraph replacements it holds 4 pieces instead
  of 20,002. Any memory case for packing is measured against that compacted tree.
- [Buffers](../editor/packages/textbuffer/src/buffers.ts) keep LF offset indexes beside text.
  [The walker](../editor/packages/textbuffer/src/walker.ts) currently traverses object nodes.
- [Public document exports](../editor/packages/editor/src/public/document.ts) and
  [debug exports](../editor/packages/editor/src/debug.ts) need inspection for representation exposure.
  Do not promise an internal swap before checking all consumers.

## Scope

Build an isolated structure-of-arrays prototype using ordinary ArrayBuffer first.
Cover tree operations, reverse lookup, buffer references, line metadata, snapshots, and the walker.
Compare both time and memory with the current implementation under E001 workloads.
E013 owns SAB publication. E012 owns concurrent reuse of arena slots.
Do not use the historical 0.6 ms treap figure as proof of current performance or available headroom.

## Design

Propose opaque node handles with index zero reserved for null.
Candidate arrays include child indexes, buffer handles, piece starts and lengths,
visibility flags, priorities, subtree sums, and order bounds.
Choose field widths from supported limits and actual values.
Current order values are fractional, so `Uint32Array` cannot preserve them without redesign.
Use `Float64Array` for those values in the first correctness prototype.
Document bounds and checked overflow for lengths, aggregate counts, and node indexes.

Path-copy into append-only pages and never mutate published node records.
Represent a snapshot by a tree root, reverse-index root, buffer generation, and associated metadata.
Keep node identity meaningful across snapshots so E005 can show structural sharing.
Measure an array-of-structs candidate if mixed field access makes a structure-of-arrays layout worse.
The goal is the best measured layout for access patterns, not an array format chosen in advance.

Account for buffer-ID mapping, line-index storage, and reverse-index entries in memory totals.
Do not materialize an object wrapper for every node to preserve old internal signatures.
Such wrappers can erase the benefit and retain both trees.
Keep the current object implementation as a test control while the prototype remains isolated.
If promoted, migrate every representation-dependent caller together and remove the old production backend.

## Steps

1. Enumerate consumers of root, buffers, reverse index, and debug piece access.
   Publish the exact semantic contract the packed prototype must preserve.
2. Implement typed-array snapshots and readonly walking using the smallest representative fixture.
   Compare text, offsets, line breaks, and E005 invariant results with the object control.
3. Add path-copy edits, deleted pieces, order normalization, and reverse-index lookup.
   Run deterministic randomized edits and anchor checks against the same control.
4. Replay E001 short-file, million-line, long-line, and churn workloads.
   Measure edit tails, traversal throughput, bytes per live and retained node, and peak growth memory.
5. Write the adoption decision and migration scope, including all changed package exports.
   Record whether the benefit stands alone or depends on E013's shared-reader savings.

## Verification

Use `bun run bench:piece-table`, `bun run bench:walker`, and `bun run bench:anchors`
from `packages/editor` as existing controls, extended to run both representations identically.
Use focused `pieceTable-*` Vitest tests through the package test script for changed operations.
New tests catch integer truncation, incorrect null handles, broken order normalization,
reverse-index disagreement, stale buffer generations, and mutation of retained snapshots.
Compare undo and branch-changing edits with the object representation.
Inspect actual allocation profiles so temporary wrapper objects do not hide behind lower array capacity.

Adopt only if correctness matches the control and a declared memory or end-to-end target
improves beyond run variation without a p95 typing regression. A measured rejection also completes
the research; record the failed target and retain the current representation.
Record a separate conditional result if local packing only makes sense as an E013 prerequisite.
If changing public types, build exports and check React, Solid, syntax, minimap, and LSP consumers.

## Risks and decisions

Object trees already provide GC and cheap references. Manual arenas assume responsibility for both.
Field packing can trade lower memory for extra indirection on hot traversal paths.
Immutable node records do not automatically make mutable buffer indexes safe to share.
Prototype bounded memory first. Defer reuse until E012 proves lifetime safety.
