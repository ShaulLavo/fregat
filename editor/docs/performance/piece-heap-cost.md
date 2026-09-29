# Heap cost per piece

Measured 2026-09-26 on Node 26 (V8, no pointer compression) at Editor `7b61f97`.
The buffer lives on the main thread, so a major GC of a large tree is a dropped frame.

## What a piece costs

A heap snapshot of a 120,000-piece tree held 5.3 heap objects per piece: the node, the `Piece`,
and three boxed `HeapNumber`s. V8 boxes a number field once any value stored in it is fractional,
and orders are fractional (`allocateOrdersBetween` bisects gaps down to `1e-9`). The boxes were
`piece.order` and the node's `subtreeMinOrder` and `subtreeMaxOrder`. A clone allocates fresh
boxes, because a box is mutable and belongs to one object.

Normal typing is unaffected: 20,000 keystrokes into a 100,000-line file, with every snapshot kept,
never paused longer than 6 ms. Piece count is what hurts: a replace-all of 400,000 matches leaves
1.2M pieces, and a full collection of that heap took 62–77 ms.

## Shipped: order bounds are walked, not stored

Orders rise in document order, so a subtree's bounds are its first and last pieces' orders.
The four edit paths that need a neighbour's order walk one spine (`firstOrder`, `lastOrder` in
`node.ts`) once per edit. Inspection recomputes the bounds to check ordering.

| Measure | Before | After |
| --- | --- | --- |
| Boxed numbers per piece | 3 | 1 |
| Bytes per piece | 252 | 204 |
| Live heap, 1.2M pieces | 330 MB | 271 MB |
| Full GC, 1.2M pieces | 62–77 ms | 46–52 ms |
| Retained history per keystroke | 2,021 B | 1,600 B |
| Typing at 1.2M pieces | 0.79–0.83 µs/key | 0.64–0.75 µs/key |

## Rejected: fields of `Piece` on the node

Modelled by copying real trees into each layout with sharing preserved, one layout per process
(field representations are per hidden class and only ever generalise):

| Layout | 1.2M-piece tree | Full GC | History per key | Full GC, 20k keys |
| --- | --- | --- | --- | --- |
| Node + `Piece` (shipped) | 200 B | 21–22 ms | 1,337 B | 2.9 ms |
| Node + `Piece`, integer orders | 200 B | 18–20 ms | 1,337 B | 2.9–3.3 ms |
| Merged | 168 B | 11–12 ms | 2,051 B | 5.6–5.7 ms |
| Merged, integer orders | 152 B | 8–9 ms | 1,910 B | 4.2–4.7 ms |

Merging halves the collection of a huge fragmented tree but makes every retained undo step half
again as large and twice the objects: a persistent keystroke clones about 9 nodes, and a merged
clone copies seven more fields plus a fresh `order` box. At these rates 1.2M pieces break even
with about 90,000 retained keystrokes, so ordinary sessions lose. Integer orders alone gain little
and would relabel the whole tree far more often.

## Rejected: wide-leaf B-tree

A survey of the tree-shape-dependent code (about 1,700 lines) found nothing a B-tree would delete
except the rotations: epochs, orders and relabelling, stand-ins, `subtreeMinBuffer` gap scans and
the one-descent landing rules all carry over, and `hideVisibleRange` with a pending replacement
becomes a multi-leaf rewrite. [E039](e039-reverse-index-cost.md) already found path-copy bytes
lowest for a binary tree; a wide leaf copies its whole row per edit, so retained history grows.
