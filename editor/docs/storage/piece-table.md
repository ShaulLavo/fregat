# Storage Engine: Tree-Backed Piece Table

## Status: Implemented and Proven

The editor's storage engine is a piece table on a persistent AVL tree with immutable snapshots through structural sharing. Each mutation returns a new snapshot; previous snapshots remain valid and unmodified.

What each piece costs the garbage collector, and the layouts measured against it, is in [Heap cost per piece](../performance/piece-heap-cost.md).

**Implementation:** `packages/textbuffer/src/`
**Types:** `packages/textbuffer/src/pieceTableTypes.ts`
**Operations:** `packages/textbuffer/src/pieceTable.ts`

## Locked Decisions

- Piece table on a balanced persistent tree as the storage engine
- Persistent (immutable-snapshot) data model for undo
- Opaque buffer identity over an append-only, lineage-shared chunk log with per-snapshot extents
- Buffer chunk storage is exposed as a read-only `get`/`keys`/iterator view at the type boundary; no debug-only accessor layer for now
- UTF-16 code units as the native encoding
- Line-ending normalization to `\n` on load
- Deletion marks pieces invisible in the AVL tree, retaining their identity for anchor resolution

## Capabilities

| Capability            | Complexity   | Notes                                                                   |
| --------------------- | ------------ | ----------------------------------------------------------------------- |
| Insert text at offset | O(log n)     | One descent; the landing places the new node and each ancestor rejoins  |
| Delete text range     | O(log n + d) | Tombstones covered pieces and splits the pieces at the range boundaries |
| Read text range       | O(log n + k) | Tree walk collecting piece slices                                       |
| Snapshot isolation    | O(1)         | Structural sharing; old roots remain valid                              |
| Document length       | O(1)         | Cached in the root's `subtreeVisibleLength`                             |
| Piece count           | O(1)         | Cached in `subtreePieces` aggregate                                     |

Here, `n` is the number of stored pieces, `k` is the returned text length, and `d` is the number of nodes visited in covered subtrees during deletion. Hiding a subtree visits its visible descendants, so deleting the whole document can take O(n).

## The Piece

The editor has one fundamental text-slice record: the **piece**. There is no second slice abstraction. A piece is a descriptor (`buffer`, `start`, `length`) pointing into one of the buffers via a `PieceBufferId`.

A piece's `(buffer, start)` pair serves as its insertion identity — no separate `insertionId` field is needed. The anchor model (see [Anchors](../positions/anchors.md)) builds on this identity without introducing new record types.

## Aggregate Maintenance Pattern (Locked)

All subtree aggregates (`subtreeVisibleLength`, `subtreePieces`, `subtreeLineBreaks`, `subtreeOriginalLength` and the rest) are computed in a single function pattern. `createNode` delegates to aggregate computation; every site that reassigns children recomputes aggregates on the result. There is no separate update that mutates individual fields — partial aggregate updates are structurally impossible. Adding a new aggregate means adding it to the aggregate function and the `PieceTreeNode` type.

## Line breaks and visibility

**Line breaks:**

- Each piece records `lineBreaks`, the newline count in its buffer slice
- Each piece records `firstLineBreak` (E046), the position of its first break in its chunk's line index.
  A chunk only grows at its end, so the position never moves. A cut gives the right part the left
  part's position plus the left part's count, and an appended piece takes the tail's running count
- AVL nodes cache the `subtreeLineBreaks` aggregate
- These aggregates support O(log n) offset-to-row/column conversion

**Visibility and anchor resolution:**

- Each piece records `visible: boolean`
- Deletion marks covered pieces invisible and preserves their buffer identity and position
- AVL nodes cache `subtreeVisibleLength`, maintained in the shared aggregate function
- `subtreeVisibleLength` sums visible pieces and gives the user-facing document length

## Historical design

The original tree was a treap. [E040](../performance/e040-balanced-tree.md) records the completed move to an AVL tree. The earlier line-break and anchor-resolution phases introduced the metadata described above.

Future work is scheduled in Fregat's [root roadmap](../../../PLAN.md).

## Buffer storage

### Opaque BufferId

**Status: complete.** `PieceBufferId` is an opaque branded number.

Anchor resolution treats buffer identity as opaque.

### Chunked Append Buffer

**Status: complete.** Inserted text is stored in append chunks shared by a lineage's snapshots through an append-only log. An insert fills the newest chunk before opening another; each `PieceBufferId` names one contiguous span of one chunk, so several ids share a chunk string.

Pieces reference buffer identity plus a range in that chunk. Appending is O(1) on a linear history; a branch that appends after a sibling copies its visible prefix of the log once. See the [E038 report](../performance/e038-append-only-buffer-store.md).

**Alternatives rejected:**

- Single string: O(n) per insertion. Unacceptable.
- Rope: Unnecessary — the piece table already provides the tree structure.
