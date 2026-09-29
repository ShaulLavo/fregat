# E045 one pass per edit call

E045 is complete on 2026-09-17. An edit call now writes with one epoch, walks the tree once per
edit and writes the reverse index once, a replacement hides its range and places its text on the
same descent, and both trees are AVL. Replacements are 6% to 8% faster than the E040 head,
multi-cursor batches 7% to 13%, anchor resolution 17% to 22%. Sequential typing is 7% slower,
27 ns a keystroke: 0.76x the control in the bench's default regime and 1.15x warmed up. Raw reports are in
[`e045-evidence.tar.gz`](e045-evidence.tar.gz).

Inspected baseline: the E040 head, `97555fa`, on branch `e045-one-pass-edits`.

## What changed

- **One epoch and one index pass per call.** The editor edits only through
  `applyBatchToPieceTable`, and each primitive edit inside it used to retain, take a fresh epoch
  and write the reverse index on its own. A replacement's insert therefore re-cloned the path
  its delete had just cloned. `edits.ts` now carries an `EditState` through the call: one epoch,
  one list of changed pieces, one index pass and one snapshot at the end. No snapshot between
  the primitives was ever handed out, so nothing observable changes.
- **A fused replacement.** `hideVisibleRange` takes the pending insert down the side that holds
  the range's first unit and places the text there: before the first hidden piece, or between
  the kept and the hidden part of a piece it cuts. The text always sits between tombstones
  already at that offset and the range being hidden, so bias decides every deleted anchor on
  both sides of it. The old delete-then-insert placed it on whichever side of the tombstones the
  tree's shape led the second descent to.
- **No second snap.** `snapBatchEditRanges` remembers, by identity, the snapshot its result was
  snapped against, and `applyBatchToPieceTable` does not snap that array again. The editor calls
  both on every edit, so it paid four surrogate descents per edit where it now pays two. An array
  snapped against another snapshot is snapped again.
- **The reverse index is an AVL tree.** Heights replace hashed priorities, `priority.ts` and the
  public `prioritySeed` option are gone, and the index is built balanced from sorted pieces. A
  node stores its children's heights, not its own: a rebalance then reads only nodes already on
  the insert's path. Storing the node's own height made every level load a cold sibling, and
  `reverseHeight` was 7% of an insert until that changed.
- **Relabelling carries the index over.** Order normalization moves no key, so
  `relabelReverseIndex` copies the index node for node with the relabelled pieces in place of a
  sort and a rebuild, with the rebuild as the fallback if an entry is missing from the map.
- **No search for a piece without line breaks.** A cut of such a piece skips the line-index
  binary searches.

## Measured results

Standard profile, 9 samples, three seeds, the E040 head in a worktree with the same adapter,
interleaved per seed. The bench's replacement now goes through `applyBatchToPieceTable` with one
edit, which is the call the editor makes; both trees were measured with that adapter. Two
regimes, because the E038 and E043 reports found the default two warmups still inside the JIT
transient: milliseconds per lane, median over seeds, ratio to the control of the same regime.
The control warms up too: an earlier version of this table divided every column by one pooled
control and showed typing at 0.71x with 8 warmups, where it is 1.15x.

| Lane | Control, 2 warmups | E040, 2 warmups | E045, 2 warmups | Control, 8 warmups | E040, 8 warmups | E045, 8 warmups |
| --- | ---: | --- | --- | ---: | --- | --- |
| sequential-typing | 0.61 | 0.42 (0.70x) | 0.46 (0.76x) | 0.37 | 0.39 (1.06x) | 0.42 (1.15x) |
| typing-with-lookups | 0.92 | 0.63 (0.69x) | 0.67 (0.72x) | 0.76 | 0.61 (0.80x) | 0.64 (0.85x) |
| random-insertions | 1.08 | 2.38 (2.19x) | 2.38 (2.20x) | 0.97 | 2.00 (2.06x) | 1.99 (2.05x) |
| random-replacements | 1.37 | 3.97 (2.90x) | 3.75 (2.74x) | 1.23 | 3.56 (2.89x) | 3.26 (2.64x) |
| eight-cursor-batches | 1.18 | 2.85 (2.41x) | 2.47 (2.09x) | 1.04 | 2.47 (2.37x) | 2.30 (2.20x) |
| mixed-edit-churn | 1.23 | 3.82 (3.12x) | 3.75 (3.06x) | 1.03 | 3.18 (3.08x) | 3.07 (2.98x) |
| persistent-history | — | 3.81 | 3.73 | — | 3.34 | 3.27 |
| branch-edits | — | 0.31 | 0.29 | — | 0.28 | 0.25 |
| anchor-resolution-after-churn | — | 0.81 | 0.67 | — | 0.65 | 0.51 |

Structural counters, standard profile, against the E040 budgets:

| Lane                 | Tree nodes cloned | Tree nodes touched | Index nodes cloned |
| -------------------- | ----------------- | ------------------ | ------------------ |
| random-replacements  | 32,066 to 16,177  | 36,775 to 24,498   | 32,611 to 32,997   |
| eight-cursor-batches | 16,563 to 11,793  | 19,606 to 19,610   | 27,947 to 12,428   |
| mixed-edit-churn     | 26,445 to 18,264  | 31,010 to 25,564   | 30,573 to 29,511   |
| random-insertions    | unchanged         | unchanged          | 30,576 to 30,553   |

Height, standard replay, 1,554 samples, 0 failures: both trees peak at 13 to 15 levels on every
trace. The reverse index was 31 to 35 as a treap.

## What the measurements say

- **The reverse index's cost was never its height.** An insert clones 20 index nodes as a treap
  and 20 as an AVL tree. It writes three keys in two unrelated places, the cut piece's buffer and
  the newest buffer, so it copies two full paths whatever the shape, and the treap's mean depth
  was already close to the AVL's. Balance helped the readers: anchor resolution descends the
  index two or three times and is a fifth faster. The writers need
  [E039](e039-reverse-index-cost.md)'s redesign, and these numbers are its baseline.
- **Typing pays for it.** A keystroke rewrites the entry of the piece it extends, which always
  has the largest key, and the largest key of an AVL tree sits at full depth where a treap often
  had it near the top. In steady state that is 0.179 ms against 0.138 ms for 1,500 keystrokes,
  27 ns each. An editor resolves several anchors per keystroke at 47 ns less each, so the trade
  is kept. The structural fix is a slot outside the tree for the entry being typed into, so a
  keystroke writes no index path at all; that belongs to E039's deferred-maintenance option.
- **Order gaps run out sooner than they should.** On the churn trace the smallest gap between
  neighbouring orders falls from 1,024 to 2e-6 within 100 random edits and reaches the 1e-9 floor
  near edit 1,000, which forces a relabel of every piece. The E040 head is on the same
  trajectory and crosses just after the lane's 1,500 edits end, so the first measurement of this
  plan showed churn 6% slower until the relabel stopped rebuilding the index. A relabel is still
  linear in the piece count. Relabelling only the smallest crowded subtree, as order-maintenance
  structures do, would bound it; that is a lead, not part of this plan.

## What remains

- E039: per-buffer index structure or deferred maintenance, plus the typing slot above.
- A replacement still snaps its two ends with two read descents before the edit. The hide
  descent visits both ends anyway and could report a cut pair as a retry, as the insert probe
  does. It is 7% of the replacement lane.
- Local relabelling of orders.
- `firstLineBreakAtOrAfter` is still 8% to 12% of the random lanes for pieces that do hold line
  breaks; bounding the search to the piece's own range needs the index position of its first
  break.

## Verification

- `bun run verify` in `packages/textbuffer`: 82 tests. New: a differential fuzz of the fused
  replacement against delete-then-insert on text, with indexed against linear anchor resolution
  after every edit; deleted anchors on both sides of a replacement under both biases; a
  multi-cursor batch against its edits in turn; same-offset edits keeping their given order,
  which an early version of this change reversed and the editor's `textEditBatch` tests caught;
  snapped ranges reused for their own snapshot and snapped again for another; the index carried
  through a relabel without a rebuild and equal to one; and an edit that runs out of orders.
- `packages/editor`: 2,675 of 2,676 tests. The one failure, the BiDi drag-selection timing probe
  at 5.2x against a 5x threshold, fails identically on the E040 head and performs no edits.
- `bun run bench:test`: 73 tests with the counter budgets regenerated.
  `bun run bench:height -- --profile standard`: 0 failures. The height harness lost its
  priority-seed sweep with the treaps.
- Timing: `drive2.sh` and `summarize.mjs`, the four profile reports and the typing and order-gap
  scripts are in the evidence tarball.
