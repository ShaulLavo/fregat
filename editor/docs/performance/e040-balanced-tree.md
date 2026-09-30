# E040 an AVL sequence tree edited in one descent

E040 is complete on 2026-09-17. The sequence tree is an AVL tree instead of a treap, and an edit
no longer splits and merges: an insert and a delete each descend once and rejoin the path on the
way back. Every random edit lane is 22% to 34% faster than the E044 head, typing is 17% faster,
every read lane after churn is 7% to 14% faster, and the tree's height is 12 to 15 levels where
the treap's was 26 to 33. The plan's own candidate, a balanced tree driven through split and join,
was measured and rejected: it is slower than the treap. Raw reports are in
[`e040-evidence.tar.gz`](e040-evidence.tar.gz).

Inspected baseline: the E044 head, `55c4cea`, on branch `e040-balanced-tree`.

## The bake-off

The plan proposed the join-based framework of Blelloch, Ferizovic and Sun with split and merge
derived from `join`, weight-balanced first and AVL second. Commit `c9ad15d` holds every candidate
behind environment switches so one build could be measured under each: AVL or weight-balanced
with alpha 0.29, 0.25 and 0.20, each proven for join, and edits either through split and join or
in one descent. Standard profile, 9 samples of 2 warmups, three seeds, configurations interleaved
per seed, milliseconds per lane as the median over seeds with the ratio to the control.

| Lane                 | Control | Treap        | AVL split    | AVL direct   | WB .29 split | WB .29 direct | WB .25 direct | WB .20 direct |
| -------------------- | ------: | ------------ | ------------ | ------------ | ------------ | ------------- | ------------- | ------------- |
| random-insertions    |    1.11 | 3.05 (2.75x) | 3.40 (3.06x) | 2.39 (2.15x) | 3.61 (3.25x) | 2.44 (2.20x)  | 2.46 (2.22x)  | 2.45 (2.21x)  |
| random-replacements  |    1.37 | 6.15 (4.49x) | 6.29 (4.59x) | 4.13 (3.01x) | 6.73 (4.91x) | 4.17 (3.05x)  | 4.36 (3.19x)  | 4.62 (3.38x)  |
| eight-cursor-batches |    1.17 | 3.55 (3.03x) | 3.85 (3.28x) | 2.81 (2.39x) | 4.03 (3.43x) | 2.87 (2.45x)  | 2.91 (2.48x)  | 2.91 (2.48x)  |
| mixed-edit-churn     |    1.21 | 5.24 (4.31x) | 5.94 (4.89x) | 3.85 (3.17x) | 6.27 (5.17x) | 3.95 (3.25x)  | 4.21 (3.47x)  | 4.42 (3.64x)  |
| persistent-history   |       — | 5.25         | 5.98         | 3.84         | 6.38         | 4.02          | 4.22          | 4.44          |
| lines-random         |    0.75 | 2.27 (3.03x) | 1.98 (2.64x) | 1.99 (2.65x) | 1.99 (2.65x) | 1.99 (2.65x)  | 1.91 (2.55x)  | 1.96 (2.62x)  |

Three findings decided the design.

- **Split and join loses to the treap.** A balanced tree halves the height, and the read lanes
  show it, but a split unwinds through a `join` at every level and each of those walks back down
  a spine to restore balance. The treap's split needs no repair at all. Height was never the
  cost of an edit; the number of passes over the path was.
- **One descent wins under either rule.** Tombstones mean the sequence tree only grows, so no
  edit needs a split or a merge. With them gone every random lane is 22% to 34% faster.
- **The balance rule barely matters.** AVL leads weight balance by 1% to 3% at alpha 0.29, and
  looser alphas are slower on replacements and churn. AVL's invariant is also the simpler one to
  validate, so AVL it is.

## What changed

- [`join.ts`](../../packages/textbuffer/src/join.ts) holds the AVL `join` and the two rotations,
  path-copying through `own`. It is the only code that knows the balance rule.
  [`node.ts`](../../packages/textbuffer/src/node.ts) holds the node: `own`, `summarize`, which now
  also maintains `height`, and the summary getters. `priority` is gone from the sequence node and
  `priorityForPiece` from `priority.ts`; `prioritySeed` stays because the reverse index is still
  a treap.
- `insertAtVisibleOffset` descends once. The landing runs the E043 probe, then places the new
  pieces before, after or inside its piece, and each ancestor rejoins once. A rejoin joins two
  subtrees whose heights differ by at most two, so it is constant work per level. Orders come
  from the landing's neighbours, carried down the descent as a lower and an upper bound.
- `hideVisibleRange` descends once over the range. Subtrees wholly inside it are tombstoned in
  place, subtrees with no visible text are skipped, and only the pieces the two ends fall inside
  are cut. The cut keeps the first part on the node, so its reverse-index key stands.
- `splitByVisibleOffset`, `merge`, `markTreeInvisible` and `createTreeFromPieces` are deleted.
- The inspector checks the stored height and the AVL rule under a new `balance` issue kind; the
  heap check remains for the reverse index. An inspection node reports `rank`: height in the
  sequence tree, priority in the reverse index.
- Where an insert lands among tombstones at a piece boundary depended on the tree's shape before
  and still does. Text, positions and live anchors do not depend on it.

## A bug found on the way

`PieceBufferChunkView.unitAt` served a view's last tail unit from the log's record of it
whenever the index matched, including for an older view whose tail chunk was no longer the log's
last chunk. Inserting into an older snapshot after a newer one had opened a chunk could then
miss a surrogate pair and cut it. This shipped with E043. The shortcut now requires the chunk to
be the log's last, and `reads.test.ts` holds the regression test. The editor's
`pieceTable-edits` surrogate sweep is what caught it.

## Measured results

The final code against the E044 head in a worktree, same method, three seeds.

| Lane                          | Control | E044 head    | E040         | Change |
| ----------------------------- | ------: | ------------ | ------------ | -----: |
| sequential-typing             |    0.61 | 0.52 (0.85x) | 0.43 (0.70x) |   -17% |
| typing-with-lookups           |    0.93 | 0.73 (0.79x) | 0.63 (0.68x) |   -14% |
| random-insertions             |    1.12 | 3.15 (2.80x) | 2.36 (2.10x) |   -25% |
| random-replacements           |    1.37 | 6.14 (4.49x) | 4.06 (2.97x) |   -34% |
| eight-cursor-batches          |    1.18 | 3.53 (3.00x) | 2.75 (2.33x) |   -22% |
| mixed-edit-churn              |    1.22 | 5.25 (4.31x) | 3.80 (3.12x) |   -28% |
| large-paste-delete            |   12.54 | 4.63 (0.37x) | 4.69 (0.37x) |    +1% |
| lines-sequential-after-churn  |    0.49 | 1.44 (2.97x) | 1.28 (2.63x) |   -11% |
| lines-random-after-churn      |    0.77 | 2.28 (2.98x) | 1.97 (2.57x) |   -14% |
| ranges-after-churn            |    3.04 | 1.48 (0.49x) | 1.33 (0.44x) |   -10% |
| offset-to-position            |    1.61 | 1.32 (0.82x) | 1.22 (0.76x) |    -8% |
| position-to-offset            |    0.40 | 1.27 (3.19x) | 1.12 (2.81x) |   -12% |
| full-read-after-churn         |    1.29 | 2.19 (1.70x) | 2.00 (1.55x) |    -9% |
| load-short-lines              |    3.77 | 2.16 (0.57x) | 2.13 (0.57x) |    -1% |
| persistent-history            |       — | 5.22         | 3.81         |   -27% |
| branch-edits                  |       — | 0.34         | 0.31         |    -9% |
| anchor-resolution-after-churn |       — | 0.79         | 0.82         |    +4% |

Anchor resolution is within run variation of the treap; it is bounded by the reverse index, which
this plan did not touch.

Structural counters, standard profile, from the regenerated budgets against the E044 budgets:

| Lane                | Nodes touched (`own`) | Nodes cloned     | Nodes created |
| ------------------- | --------------------- | ---------------- | ------------- |
| random-insertions   | 46,069 to 18,629      | 17,265 to 15,758 | 4,580 to 3,055 |
| random-replacements | 112,832 to 36,775     | 40,529 to 32,066 | 7,520 to 4,525 |
| mixed-edit-churn    | 92,506 to 31,010      | 31,838 to 26,445 | 6,960 to 3,993 |

The plan expected clones to fall with height. They fell 9% to 21%, because E041's epochs had
already stopped an edit cloning a node twice. What fell by 60% to 67% is the nodes an edit
touches and re-summarizes: 12 per insert against 31. An insert performs 0.43 rotations.

Height, standard replay, 4,662 samples, every invariant passing. Maximum sequence-tree height per
workload, with the treap's figures from the E044 replay:

| Trace               | Pieces | Treap | E040 | Control |
| ------------------- | -----: | ----: | ---: | ------: |
| random-insertions   |  2,498 | 26–33 |   14 |      14 |
| random-replacements |  4,437 | 26–33 |   15 |      14 |
| mixed-edit-churn    |  2,631 | 26–33 |   14 |      14 |
| prepend             |  4,097 |     — |   13 |      22 |
| fixed-middle        |  4,098 |     — |   13 |      22 |
| alternating-ends    |  4,097 |     — |   13 |      21 |

`height / log2(P + 1)` peaks at 1.28 over every trace, inside AVL's 1.44 bound and below the
control's red-black tree on the adversarial traces.

CPU after the change, `random-insertions`, 24 replays, 308 samples: piece tree 46.8%, reverse
index 27.9%, buffer store and line index 20.8%. Self: `insertReverseIndexNode` 16%,
`firstLineBreakAtOrAfter` 10%, `insertAtVisibleOffset` 8%, `summarize` 7%, `insertAtLanding` 6%,
`cloneReverseIndexNode` 5%.

## What remains

- The reverse index is now the largest single cost of an insert at 28%, with the hottest self
  frame and a treap 31 to 35 levels tall. [E039](e039-reverse-index-cost.md) is next,
  and if it keeps a keyed tree the AVL `join` here applies to it directly.
- `firstLineBreakAtOrAfter` at 10% is the line-index search a cut pays on chunk 0. Bounding it to
  the piece's own range is a small change.
- A replacement still descends twice, once to hide and once to insert, and a range delete snaps
  its two ends with two more descents before it starts. Fusing those is the same move E043 made
  for inserts.
- A random insertion is 2.1x the mutable control and a replacement 3.0x. The tree itself is no
  longer the gap: the control's tree work and ours are now the same height and one path each.

## Verification

- `bun run verify` in `packages/textbuffer`: 75 tests. New in `balance.test.ts`: a model fuzz
  over four document sizes and seeds checking text, positions, the invariants including balance,
  indexed against linear anchor resolution after every edit, and every retained snapshot's text;
  five adversarial insert traces held to the height bound; an old snapshot edited on two branches
  after the tree rebalanced; and order normalization under balance. The fuzz was calibrated by
  breaking `join`'s rebalance threshold, which failed 10 of its 11 tests.
- All of the above also ran green under all four bake-off configurations at `c9ad15d`.
- `packages/editor`: 2,676 tests, including the rewritten `pieceTable-tree` and
  `pieceTable-inspection` tests and the two browser suites after rebuilding the editor `dist`.
- `bun run bench:test`: 73 tests with the counter budgets regenerated; `probes.mjs` instruments
  `node.js` and `join.js`. `bun run bench:height -- --profile standard`: 0 failures.
- Timing: `drive.sh` for the bake-off and `final.sh` for the final comparison, both in the
  evidence tarball with `summarize.mjs`, the profile report and the height samples.
