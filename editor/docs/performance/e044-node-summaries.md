# E044 node summaries in one pass, priorities from identity

E044 is complete on 2026-09-17. Two fixed costs paid on every node an edit touches are cut:
the six subtree summaries are computed in one pass over the two children, and the priority hash
covers only what identifies a node. Every edit lane is 11% to 27% faster than the E043 head.
Sequential typing is now faster than the mutable control. Raw reports are in
[`e044-evidence.tar.gz`](e044-evidence.tar.gz).

Inspected baseline: the E043 head, `19670e4`, on branch `e044-node-updates`.

## What changed

- `summarize(node)` in `tree.ts` replaces six `computeSubtree*` functions. `createNode` and
  `updateNode` both go through it. It reads each child once, adds the four totals, and compares
  the order bounds inline instead of through `Math.min` and `Math.max` with three arguments.
  The E043 profile had `updateNode` at 19% inclusive of an insert; the six separate functions
  read `left` and `right` twelve times and called into `Math` twice per node.
- `priorityForPiece` hashes the seed, the buffer, the start and the order. Length and
  visibility are gone from it: `(buffer, start)` is the insertion identity and the order places
  the piece, so together they name the node, and a split's left half, which keeps all three,
  keeps its parent's priority and the spot the parent held. The reverse index's priority is
  `priorityForReverseKey(buffer, start, seed)`: a rewrite on the same key already kept its
  node's priority, so the key was all that priority ever depended on. Four and three mixes per
  node instead of seven.
- Priorities change, so tree shapes change and the counter budgets were regenerated. The height
  replay on the standard profile, 4,662 samples over four seeds, passes every invariant, and the
  maximum sequence-tree height per workload and seed stays where it was: 26 to 33 levels after
  against 26 to 35 before, on the same piece counts, with the control at 14 for the random
  lanes. E040's premise is unchanged.

## Measured results

Standard profile, 9 samples of 2 warmups, three seeds, the E043 head in a worktree and the
change in the checkout, alternating per seed. Milliseconds per lane, median over seeds with the
range, ratio to the control's median.

| Lane                 | Control | E043 head              | E044                   | Change |
| -------------------- | ------: | ---------------------- | ---------------------- | -----: |
| sequential-typing    |    0.60 | 0.70 [0.57–0.70] 1.16x | 0.51 [0.51–0.51] 0.85x |   -27% |
| typing-with-lookups  |    0.93 | 0.95 [0.78–0.96] 1.02x | 0.73 [0.73–0.74] 0.78x |   -23% |
| random-insertions    |    1.09 | 3.51 [3.49–3.55] 3.21x | 3.13 [3.04–3.18] 2.87x |   -11% |
| random-replacements  |    1.37 | 7.25 [7.23–7.35] 5.28x | 6.11 [5.92–6.33] 4.45x |   -16% |
| eight-cursor-batches |    1.16 | 4.08 [3.85–4.13] 3.53x | 3.55 [3.41–3.63] 3.07x |   -13% |
| mixed-edit-churn     |    1.21 | 6.15 [6.14–6.25] 5.07x | 5.16 [5.10–5.60] 4.26x |   -16% |
| persistent-history   |       — | 6.21 [6.12–6.29]       | 5.23 [5.07–5.76]       |   -16% |

The typing lane's gain is larger than the hashing and summaries explain. Its counters show the
reason: with the left half of a split keeping its parent's priority, the three-piece typing tree
lands the tail piece at the root instead of one level down, so a keystroke touches one node
instead of three (`tree.own.calls` 4,499 to 1,500 for 1,500 keystrokes) and the E043 cold-JIT
transient on the split function no longer shows. Against unmodified main the lane is now 20%
faster and against the control 15% faster; a random insertion is 2.1 µs against 3.6 µs on main
and 0.73 µs for the control.

CPU after the change, `random-insertions`, 24 replays, 381 samples: piece tree 48.0%, reverse
index 23.6%, buffer store and line index 18.6%, edit preparation 8.1%. Self:
`insertReverseIndexNode` 18.1%, `splitByVisibleOffset` 12.6%, `summarize` 10.0%,
`firstLineBreakAtOrAfter` 8.9%, `merge` 6.8%, `cloneNode` 4.7%, `unitAt` 4.2%.

## What remains

- The reverse index is a quarter of an insert and its keyed insert is the hottest self frame at
  18%. Three writes per insert, each a keyed treap descent with rotations and path copies. That
  is [E039](e039-reverse-index-cost.md), and the numbers here are its baseline.
- The split and merges are the other half and their cost is the treap's height, twice the
  control's. That is [E040](e040-balanced-tree.md).
- `firstLineBreakAtOrAfter` at 9% is the line-index binary search a split's left half still
  pays, twice per search, on a chunk index that is mostly chunk 0. A split of the original piece
  could bound the search to the piece's own range instead of the chunk's.
- `summarize` at 10% is now the floor for path work: six fields per touched node. The only way
  below it is fewer touched nodes, which is E040 again.

## Verification

- `bun run verify` in `packages/textbuffer`: 63 tests. The editor's `pieceTable-tree` and
  `pieceTable-inspection` tests pass; inspection checks the heap order, not the hash values, so
  the priority change is invisible to it. `bun run bench:test`: 73 tests with the counter
  budgets regenerated for the new tree shapes.
- `bun run bench:height -- --profile standard` in both trees for the height comparison.
- Timing and profiles: `bun run bench -- --profile standard --seed <s>` in both trees and
  `bun run bench:profile -- --modes cpu,counters --repeats 24`, under `timing/` and `cpu/` in the
  evidence tarball.
