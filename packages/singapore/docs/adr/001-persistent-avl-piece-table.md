# 001. Store text in a persistent piece table on an AVL tree

Status: accepted
Date: 2026-09-17

Recorded on 2026-10-24 from the design records linked below. The piece-table design predates the 2026-09-29 monorepo import. The date is when the AVL tree replaced the treap.

## Context

The editor keeps old versions readable: undo, branches, and workers that parse a snapshot while the user types on. Storage has to make a snapshot cheap to keep, make an edit cheap at any offset, and answer offset-to-row queries without scanning.

## Decision

Text lives in a piece table. A piece is a slice of an append-only buffer. A persistent AVL tree orders the pieces and caches aggregates (visible length, piece count, line breaks) for logarithmic offset and row lookup. An edit copies the nodes on one root-to-leaf path and shares the rest. Deleting text marks pieces invisible instead of removing them.

## Alternatives considered

- **One string.** An insert costs O(n), which fails on large files.
- **A rope.** The piece table already supplies the tree, so a rope adds a second structure for no gain.
- **A treap edited through split and merge.** This was the first tree. It had no repair step on split, but its height was 26 to 33 levels at the measured sizes.
- **A balanced tree edited through split and join,** the brief's own candidate. [The bake-off](../performance/e040-balanced-tree.md) measured it slower than the treap, because each split unwinds through a join at every level.
- **Weight-balanced instead of AVL.** AVL led by 1% to 3% at alpha 0.29, and its invariant is simpler to validate.

## Consequences

An edit descends once and rejoins the path on the way back, with no split or merge. Against the treap, random edit scenarios are 22% to 34% faster, typing is 17% faster, and tree height is 12 to 15 levels. The measurements are in [balanced tree](../performance/e040-balanced-tree.md).

Deleted pieces stay in the tree, so the tree only grows. The cost is memory per piece: [heap cost per piece](../performance/piece-heap-cost.md) measures what a piece costs the garbage collector, and [tombstone compaction](../storage/e006-tombstone-compaction.md) shrinks the position metadata of the current snapshot. Deleting a whole document can take O(n), because hiding a subtree visits its visible descendants.

See also [Piece table](../storage/piece-table.md) and [ADR 002](002-anchors-into-immutable-buffers.md).
