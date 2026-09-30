# E042 fixed per-edit overhead

E042 is complete on 2026-09-17. [E041](e041-transient-edits.md) measured that persistence is
about a tenth of the small-edit gap and profiled the rest; this entry takes the three leads that
profile named, each a few lines, and measures them on the same lanes and seeds. Every edit lane
is about a fifth faster: a random insertion goes from 4.62x the mutable control to 3.63x, a
random replacement from 6.44x to 5.05x. Raw reports are in [`e042-evidence.tar.gz`](e042-evidence.tar.gz).

Inspected baseline: the E041 head, `26e805c`, on branch `e042-fixed-edit-overhead`.

## What changed

- `allocateOrdersBetween` in `orders.ts` fills its result with a plain loop instead of
  `Array.from` and a closure. A split, which needs exactly one order for its right half, calls
  a new `allocateOrderBetween(lower, upper)` that returns the number and allocates nothing.
  This was the hottest self frame of the zero-copy profile, 15% to 16% in every mode.
- A split counts line breaks once. The left half's count comes from the chunk's line index as
  before; the right half is the parent piece's count minus that. `createPiece` is no longer
  called from `tree.ts`, and half of the `firstLineBreakAtOrAfter` binary searches per split are
  gone.
- `splitsSurrogatePair` descends once. The unit after the offset locates the piece; the unit
  before is in the same piece unless the offset is that piece's first unit, and only then does a
  second descent run. The read order is unchanged: the unit after is read first, so typing at
  the end of the tail chunk still never touches the string `extendTail` just concatenated.

Nothing about pieces, orders, tombstones, anchors or the reverse index changed in meaning. The
order values a split and an insert produce are the same expressions as before, so tree shapes
and priorities are identical and the counter budgets pass unchanged.

## Measured results

Standard profile, three seeds, 9 samples of 2 warmups, the E041 head timed in a worktree and the
change in the checkout, alternating per seed. Milliseconds per lane, median over seeds with the
range, ratio to the control's median.

| Lane                 | Control | E041 head              | E042                   | Change |
| -------------------- | ------: | ---------------------- | ---------------------- | -----: |
| sequential-typing    |    0.61 | 0.66 [0.54–0.66] 1.08x | 0.64 [0.52–0.65] 1.05x |    -3% |
| typing-with-lookups  |    0.94 | 0.91 [0.74–0.91] 0.97x | 0.89 [0.73–0.90] 0.95x |    -2% |
| random-insertions    |    1.08 | 4.99 [4.95–5.02] 4.62x | 3.92 [3.90–4.00] 3.63x |   -21% |
| random-replacements  |    1.37 | 8.83 [8.69–9.03] 6.44x | 6.93 [6.90–7.47] 5.05x |   -21% |
| eight-cursor-batches |    1.17 | 5.19 [5.08–5.33] 4.45x | 4.21 [3.97–4.23] 3.61x |   -19% |
| mixed-edit-churn     |    1.20 | 7.70 [7.59–8.24] 6.39x | 6.20 [6.13–6.36] 5.14x |   -20% |
| persistent-history   |       — | 7.71 [7.66–7.87]       | 6.34 [6.19–6.35]       |   -18% |

Against unmodified main, before E041's in-edit node reuse, a random insertion is 27% faster and a
random replacement 39%. Per random insertion: 3.6 µs on main, 2.6 µs now, 0.72 µs for the control.

CPU after the change, `random-insertions`, 24 replays, 511 in-workload samples: piece tree
55.4%, reverse index 19.6%, edit preparation 7.6%, buffer store and line index 7.6%, harness
9.8%. Inclusive: `splitByVisibleOffset` 32%, `applyReverseIndexChanges` 20%, `merge` 18%,
`updateNode` 17%, the surrogate snap 14%, `priorityForPiece` 8%. Self: `insertReverseIndexNode`
10.6%, `splitByVisibleOffset` 8.2%, `splitsSurrogatePair` 8.2%, `merge` 6.1%, the summary
getters 5% each, `mixWord` 4.7%, `firstLineBreakAtOrAfter` 3.9%.

## What remains, and the shape of it

The profile is now descents and summaries. An insert descends the tree three times to the same
offset: the surrogate snap, the coalesce lookup `findVisiblePieceEndingAt`, and the split. Each
is a full walk of a treap whose height the [height replay](../../packages/textbuffer/bench/HEIGHT.md)
measured at 25 against 14 for the control. The control does one descent. The structural change
is one descent per edit that answers all three questions, and it is worth more than any
remaining local tweak: the three walks are about a third of the insert profile between them.

- [E040](e040-balanced-tree.md) lowers the cost of every walk by bounding
  height. Its payoff is bounded by the 55% the tree still takes, now that cloning is gone.
- [E039](e039-reverse-index-cost.md) owns the 20% in the reverse index. Its keyed
  insert with a hashed priority per node is now the single hottest self frame.
- A fused descent is not in either plan. It belongs in E040, which already rewrites the split,
  or in a small plan of its own that adds `splitAtVisibleOffsetWithContext` returning the
  neighbouring units and the piece ending at the offset alongside the two halves.

## Verification

- `bun run verify` in `packages/textbuffer`: 63 tests. `bun run bench:test`: 73 tests with the
  counter budgets unchanged. The editor's `pieceTable-orders`, `pieceTable-buffers` and
  `pieceTable-tree` tests pass, and `allocateOrdersBetween` produces the same values as before
  for every case they check.
- Timing: `bun run bench -- --profile standard --seed <s> --only <lanes>` in both trees, under
  `timing/` in the evidence tarball. CPU and counters: `bun run bench:profile -- --modes
  cpu,counters --repeats 24 --only random-insertions,random-replacements`, under `cpu/`.
