# E043 one descent per insert

E043 is complete on 2026-09-17. An insert used to walk the tree three times to the same offset:
once to see whether the offset splits a surrogate pair, once to find the piece ending there for
coalescing, and once to split. It now walks once. The split's descent answers the other two
questions at its landing, and where it can extend the piece ending there it replaces that piece
on the way back up instead of splitting. Random insertions are 10% to 12% faster; the other
lanes are flat to slightly better once warm, and the typing lane pays a cold-JIT transient in the
bench's default regime that turns into a gain with more warmups. Raw reports are in
[`e043-evidence.tar.gz`](e043-evidence.tar.gz).

Inspected baseline: the E042 head, `b7fea3c`, on branch `e043-one-descent-insert`.

## What changed

- `SplitContext` carries an optional `InsertProbe` with the text being inserted and whether the
  offset still needs snapping. `insertIntoPieceTable` always sets one; the batch path sets one
  with snapping off, because `snapBatchEditRanges` already applied the sibling-aware rule
  against the original snapshot and a per-edit re-snap would move an insert whose neighbouring
  half a later sibling deletes.
- The descent owns ancestors after recursing, not before. A probe that ends in a coalesce or a
  retry below a node therefore leaves the path above it untouched: no clone is wasted on a split
  that did not happen.
- At the landing the probe reads the code units around the offset. Strictly inside a piece both
  are in its chunk, and a pair split moves the split one unit left within the same piece. At a
  piece's end the unit after is the first visible unit of the right subtree, or of the nearest
  ancestor the descent turned left at (`leftTurns`), or of that ancestor's right side; at a
  piece's start, or on a tombstone, the piece ending there is the rightmost visible one in the
  left subtree. A pair straddling two pieces asks for a retry one unit left, with snapping off
  since the caller already snapped, so it cannot recur.
- The rule is `snapEditToCodePoints`'s collapsed-edit rule verbatim: between the halves of a
  pair, the insert moves left unless the text starts with a low half and ends with a high one.
  The first version checked only the first unit and the fuzz test against the batch path caught
  it.
- The unit after is read first, and the buffer log remembers the tail chunk's last code unit.
  The tail is a fresh concatenation after every keystroke, and `charCodeAt` on it flattens the
  string; the first version read the unit before first and doubled the typing lane's time. The
  `unitAt` accessor serves the tail's last unit from the record and everything else from the
  chunk, and `PieceBufferChunkView.fork` carries the record across.
- On a coalesce the probe returns the extended piece and the split returns the new root as
  `left`. `tryCoalesceInsert` and its own two descents are gone; `insertTextAt` finishes either
  with the extended tail chunk or with the ordinary insertion tree.
- The surrogate predicates moved to `surrogates.ts` so `tree.ts` can use them without importing
  `reads.ts`, which imports `tree.ts`.

## Measured results

Standard profile, 9 samples, three seeds, the E042 head in a worktree and the change in the
checkout, alternating. The default regime is 2 warmups; the warm column is 6 warmups on one
seed. Milliseconds per lane, ratio to the control's median.

| Lane                 | Control | E042 head, 2 warmups | E043, 2 warmups | E042 head, 6 warmups | E043, 6 warmups |
| -------------------- | ------: | -------------------- | --------------- | -------------------- | --------------- |
| sequential-typing    |    0.60 | 0.64 1.06x           | 0.70 1.17x +10% | 0.53 1.50x           | 0.50 1.41x -6%  |
| typing-with-lookups  |    0.93 | 0.89 0.95x           | 0.95 1.02x +7%  | 0.78 1.06x           | 0.76 1.02x -3%  |
| random-insertions    |    1.08 | 3.91 3.63x           | 3.52 3.27x -10% | 3.26 2.96x           | 2.88 2.61x -12% |
| random-replacements  |    1.38 | 6.94 5.04x           | 7.23 5.24x +4%  | 6.60 5.23x           | 6.59 5.22x -0%  |
| eight-cursor-batches |    1.16 | 4.22 3.63x           | 4.05 3.49x -4%  | 3.46 3.27x           | 3.36 3.17x -3%  |
| mixed-edit-churn     |    1.21 | 6.15 5.06x           | 6.12 5.05x -0%  | 5.61 5.22x           | 5.50 5.11x -2%  |
| persistent-history   |       — | 6.21                 | 6.21 -0%        | 5.82                 | 5.70 -2%        |

The warm control is faster too, which is why its ratios move; compare the Singapore columns.
The typing lane at 2 warmups is a JIT transient: the bench times the third replay in a fresh
process, `splitByVisibleOffset` is larger now and typing calls it 1,500 times where it called it
once, and the same lane with 25 samples at 2 warmups reads +9% while 15 samples at 6 warmups
read -5% and the profiler's 24 steady-state replays read -17% (0.30 ms against 0.36). The
E038 report recorded the same third-iteration effect on `large-paste-delete`.

Call counts from the instrumented replay, `random-replacements`: `findVisiblePieceEndingAt`
recursions 20,775 to 2,539, `splitsSurrogatePair` 5,906 to 2,906 (the deletes still snap through
it), `getBufferText` 10,296 to 5,842, with `splitByVisibleOffset`, `merge` and the clone counts
unchanged. `sequential-typing`: three walks per keystroke to one split plus one bounded walk of
the left subtree, `getBufferText` 4,500 to 1,500, and no read of the tail chunk's string.

CPU after the change, `random-insertions`, 24 replays, 441 samples: piece tree 54.2%, reverse
index 24.0%, buffer store and line index 12.2%, edit preparation 7.0%. Inclusive:
`splitByVisibleOffset` 40%, `applyReverseIndexChanges` 24%, `merge` 21%, `updateNode` 19%.
Self: `insertReverseIndexNode` 13.4%, `splitByVisibleOffset` 11.6%, `merge` 8.4%, `cloneNode`
4.3%, `firstLineBreakAtOrAfter` 4.1%.

## What remains

An insert is one descent, one split-and-merge, and three reverse-index writes. The reverse index
is now a quarter of the profile and its keyed insert is the hottest self frame; that is
[E039](e039-reverse-index-cost.md). The split and merges are the other half, and their
cost is the treap's height; that is [E040](e040-balanced-tree.md), whose
join-based split should keep the probe: the landing logic here is independent of how the tree
balances. Deletes still descend for their two snaps and then split twice; folding the snaps into
the two splits the same way is a smaller version of this change.

## Verification

- `bun run verify` in `packages/textbuffer`: 63 tests, including the fuzz comparison of the
  single-edit path against the batch path on a surrogate-rich document, which is what caught the
  first snap rule. `bun run bench:test`: 73 tests, budgets regenerated for the counters this
  removed (`tryCoalesceInsert`, the insert's `snapEditRange` and `splitsSurrogatePair` calls).
- Timing and profiles: `bun run bench -- --profile standard --seed <s> [--warmups 6]
  [--samples 25]` in both trees and `bun run bench:profile -- --modes cpu,counters --repeats 24`,
  under `timing/` and `cpu/` in the evidence tarball.
