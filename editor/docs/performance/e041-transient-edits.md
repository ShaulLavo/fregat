# E041 transient edits between retained snapshots

E041 is complete on 2026-09-17. The question was how much of the small-edit gap against
`microsoft/vscode-textbuffer` is persistence itself. The answer is about a tenth: with every path
copy removed from both trees, a random insertion still costs 4.35x the mutable control and a
random replacement 6.2x. The plan's decision rule said no-go above 3x, so transient snapshots do
not become an editor contract. What does ship from the prototype is the ownership check itself in
the default mode, where it reuses the nodes one edit has already cloned and removes most of the
cloning without any retain point outside the library.

The inspected baseline was `b6a265a786b08c61318a3e02b666f17cb7ef50fc`, on top of the E038
commits. The execution plan has been removed; the [E038 report](e038-append-only-buffer-store.md)
records the starting point. Raw timing, counter and CPU reports are in
[`e041-evidence.tar.gz`](e041-evidence.tar.gz); the branch is `e041-transient-edits`.

## What was built

- `PieceTreeNode` and `PieceTableReverseIndexNode` carry an integer `epoch`. `PieceTableBuffers`
  carries a `lineage` cell `{ epoch, autoRetain }` shared by every snapshot of a document, the way
  the buffer log is. `cloneNode` became `own(node, epoch)`: the node itself when its epoch is the
  lineage's current one, a clone stamped with that epoch otherwise. The reverse index has the
  same `ownReverseIndexNode`. Nothing else in `merge`, `splitByVisibleOffset`,
  `replacePieceEndingAt`, `markTreeInvisible`, `normalizePieceOrders` or the reverse-index insert
  and rotations changed. A caller without a lineage passes `PERSISTENT_EPOCH`, which is `NaN`, so
  it clones every node it touches and stamps the copies unownable.
- `retainPieceTableSnapshot(snapshot)` advances the lineage epoch when the snapshot was created
  in the current one. After it, every existing node reads as foreign and the next edit clones its
  path once, as before. A snapshot older than the lineage epoch is already persistent.
- `editingEpoch(snapshot)` runs at the start of every edit. With `autoRetain`, the default, it
  retains first: today's behaviour, every edit clones the path it touches. With
  `createPieceTableSnapshot(text, { transient: true })` it instead marks a current-epoch snapshot
  `consumed`, and a second edit of a consumed snapshot throws, because its nodes were mutated by
  the first. The bench never hits it; the audit below lists where the editor would.
- The adapter takes a retention: `always` (retain before every primitive edit, the default),
  `transaction` (before every `edit()` and `batch()` call, so a replacement's insert and a batch's
  later edits reuse the nodes the earlier ones created) and `history` (only where a lane retains
  explicitly, which the edit lanes never do). `bench`, `bench:profile` and the workers take
  `--retention`, and every smoke workload validates under all three, including `branch-edits` and
  the retained-text hashes of `persistent-history`.
- Counters: `tree.own.calls` and `reverseIndex.ownReverseIndexNode.calls` count nodes touched;
  `cloneNode.calls` and `cloneReverseIndexNode.calls` count the ones actually copied. The
  difference is the in-place count. Both are structural counters with budgets.

## Measured results

Standard profile, 10,000 lines, 1,500 edits per lane, 9 samples of 2 warmups, three seeds
(20260916, 7, 12345). Each cell is the median over seeds of the per-run median in milliseconds
for the whole lane, with the range across seeds, and the ratio to the control's median.
`main` is unmodified main timed in a worktree on the same seeds; `always` is this branch in its
default mode.

| Lane                 | Control | main               | always             | transaction        | history            |
| -------------------- | ------: | ------------------ | ------------------ | ------------------ | ------------------ |
| sequential-typing    |    0.61 | 0.64 [0.51–0.64] 1.06x | 0.66 [0.53–0.67] 1.09x | 0.67 [0.54–0.70] 1.10x | 0.64 [0.52–0.65] 1.05x |
| typing-with-lookups  |    0.94 | 0.89 [0.73–0.89] 0.95x | 0.91 [0.74–0.91] 0.97x | 0.92 [0.75–0.93] 0.97x | 0.89 [0.73–0.90] 0.95x |
| random-insertions    |    1.09 | 5.39 [5.33–5.56] 4.94x | 5.05 [4.97–5.29] 4.62x | 5.19 [5.09–5.31] 4.75x | 4.76 [4.68–4.90] 4.35x |
| random-replacements  |    1.38 | 11.35 [11.23–13.36] 8.25x | 8.76 [8.74–9.42] 6.37x | 8.88 [8.46–8.89] 6.46x | 8.56 [8.45–8.67] 6.23x |
| eight-cursor-batches |    1.18 | 5.77 [5.48–6.23] 4.88x | 5.32 [5.29–5.47] 4.50x | 5.23 [5.06–5.26] 4.42x | 5.07 [5.03–5.21] 4.29x |
| mixed-edit-churn     |    1.23 | 8.68 [8.54–9.11] 7.05x | 8.14 [7.99–8.15] 6.61x | 7.65 [7.63–7.81] 6.22x | 7.09 [7.06–7.23] 5.76x |
| persistent-history   |       — | 9.46 [9.35–10.01]  | 7.92 [7.74–8.46]   | 7.66 [7.60–7.83]   | 7.60 [7.47–7.69]   |
| branch-edits         |       — | 0.45 [0.44–0.45]   | 0.45 [0.43–0.53]   | 0.45 [0.44–0.48]   | 0.44 [0.44–0.45]   |

Per random insertion that is 3.6 µs on main, 3.4 µs in `always`, 3.2 µs in `history` and
0.73 µs for the control. Removing every clone buys 0.4 µs of a 2.9 µs gap.

Structural counters for the same lanes, one replay each. Tree and reverse-index nodes touched
(`own`) do not change with retention; the copied share does.

| Lane                 | Tree touched | Tree copied: main → always → transaction → history | Reverse touched | Reverse copied: main → always → transaction → history |
| -------------------- | -----------: | -------------------------------------------------- | --------------: | ----------------------------------------------------- |
| sequential-typing    |        4,499 | 4,497 → 4,497 → 4,497 → 0                          |           3,003 | 1,500 + 1,500 replaced → 2,999 → 2,999 → 0            |
| random-insertions    |       47,401 | 47,401 → 17,988 → 17,988 → 0                       |          57,336 | 55,841 → 29,576 → 29,576 → 0                          |
| random-replacements  |      112,848 | 112,848 → 40,380 → 20,921 → 0                      |         125,888 | 121,397 → 36,567 → 34,184 → 0                         |
| eight-cursor-batches |       47,456 | 47,456 → 18,393 → 12,259 → 0                       |          67,395 | 65,908 → 27,642 → 13,155 → 0                          |
| mixed-edit-churn     |       90,602 | 90,602 → 31,663 → 19,655 → 0                       |         116,365 | 111,947 → 28,911 → 27,499 → 0                         |
| persistent-history   |       90,602 | 90,602 → 31,663 → 19,655 → 9,710                   |         116,365 | 111,947 → 28,911 → 27,499 → 10,376                    |
| branch-edits         |        2,375 | 2,375 → 913 → 913 → 913                            |           2,682 | 2,620 → 1,357 → 1,357 → 1,357                         |

On main every touched node was a copy. In `always` the second and third passes of one edit,
the merges after a split and the later reverse-index writes of one change list, land on nodes
the first pass already cloned, so 62% of tree copies and 47% to 70% of reverse-index copies
disappear with no change in what a snapshot promises. `transaction` mode removes the clones
between a replacement's delete and insert and between a batch's edits, another 1% to 8% of the
lane time. `history` mode removes the rest and is worth 5% to 13% of lane time. The main-column
reverse-index counts include the replacement writes that were an object spread before and go
through `own` now; allocations are the same, the counter moved.

CPU attribution in `history` mode, where no clone remains, `random-insertions`, 24 replays,
644 in-workload samples: piece tree 50.5%, edit preparation and boundary policy 14.9%, buffer
store and line index 13.7%, reverse index 12.3%, harness 8.7%. The hottest self frames are
`allocateOrdersBetween` 16.5%, `insertReverseIndexNode` 8.2%, `firstLineBreakAtOrAfter` 6.8%,
`codeUnitAt` 6.5%, `splitByVisibleOffset` 6.2% and `merge` 5.7%. `random-replacements` reads the
same way with the tree at 59.5% and `allocateOrdersBetween` at 14.4%. The `always` profiles
differ by one or two points per category. The control spends 61% to 73% in its buffer and line
index and the rest in its red-black tree, on one third of the samples.

## Decision

No-go on transient snapshots as an editor contract. Persistence is not the cost: at zero copies
the insert lane is still 4.35x the control, and the plan's rule put the line at 3x. The time is
fixed per-edit work, and the profile names it:

- `allocateOrdersBetween` builds its result with `Array.from` and a closure, twice per insert
  (the split's right half and the inserted pieces), and is the single hottest frame at 15% of
  self time in every mode. A plain loop with a one-element fast path is the first lead E037's
  successors should take.
- `createPiece` counts line breaks for both halves of a split by binary-searching the chunk's
  line index (`firstLineBreakAtOrAfter`, 7%), when the parent's count minus one half is the other.
- The surrogate snap reads a code unit by tree descent twice per edit (`codeUnitAt`, 6.5%).
- Priority hashing (`mixWord`, 3.3%) runs per created node, and the reverse index at 12% is
  E039's subject with the clone half of it already gone.

What ships from the branch is the `always` mode: the epoch check with `autoRetain` on. It keeps
every snapshot persistent exactly as today, needs no retain point anywhere in the editor, and
measures 6% faster on insertions, 23% on replacements, 8% on batches, 6% on churn and 16% on
the history lane against main, with the counter budgets lowered to match. `transaction` mode
would add a few percent on batches and replacements for a per-transaction retain the session
could place in `applyEdits` and `commitPrepared`, but the audit below shows it is not free, and
the number does not justify it.

E039 and E040 keep their shape, with their expected payoff bounded by this measurement. E040's
height bound lowers descent and summary work in `splitByVisibleOffset` and `merge`, which is 12%
of the zero-copy profile, not the 40% clone share it was framed around. E039's reverse index is
12% at zero copies. The fixed-overhead leads above are cheaper than either and come first.

## Editor audit

Every holder of a previous snapshot after the next edit begins, from `documentSession.ts`,
`history.ts`, the syntax and highlighter sessions and the text snapshot. The retain point is
where transient adoption would have to place `retainPieceTableSnapshot` for that holder to keep
reading correctly.

| Holder                                                                | Needs the old root                                                                                       | Retain point under adoption                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `history.ts` nodes, up to 200                                         | Until pruned: undo restores the node's snapshot                                                          | `commitEditorHistory`. `amendEditorHistory` replaces a typing run's leaf, so a run's intermediates need none.    |
| `DocumentTransaction.snapshotBefore` on every transaction             | For the transaction's lifetime: `reverseReceipt`, `canReverse` identity checks, `restoreHistoryForReverse`, `Editor.renderSessionChange` | Per transaction. Barrier receipts are external commits, so this is a retain per prepared commit, not per keystroke. |
| `createTransaction`: `invertTextEdits(this.history.current, edits)`   | Only until the inverse is computed, but it runs after `applyBatchToPieceTable` has already produced the next snapshot | Compute the inverse before applying, or retain. Today's order reads the before-snapshot after the edit.           |
| `cleanSnapshot` for `isDirty`                                         | Until the next `markClean`: compared by text                                                             | `markClean` and the constructor.                                                                                 |
| `textSnapshot` and the views' `TextSnapshot`                          | Until every view has swapped: a view may read the previous text snapshot in a later frame, after another keystroke | Per transaction unless every view is shown to drop a superseded text snapshot synchronously on change.           |
| Highlighter session `this.snapshot` (`shiki/workerClient.ts`)          | Until the next change is processed, and it re-applies `change.edits` to the held snapshot to verify the change | Per transaction, or replace the replay check with a revision check. Editing a consumed snapshot throws here.      |
| Tree-sitter session snapshot (`syntax/session.ts`, `syntaxController`) | Until the next refresh; range queries read the snapshot it parsed                                        | Per transaction unless range queries are pinned to the current snapshot.                                         |
| `diffPieceTableSnapshots(from, next.current)` on checkout             | Both are history nodes                                                                                   | Covered by the history retain.                                                                                   |

Four holders force per-transaction retention today: the inverse-edit order, the barrier receipt,
the highlighter's replay check and the views' text snapshots. The first two are local changes;
the last two need every consumer audited. That is the `transaction` column above, worth a few
percent, and it is why the decision does not depend on the audit's outcome.

## Verification

- `bun run verify` in `packages/textbuffer`: 63 tests including `transient.test.ts`, which
  checks in-place reuse, the consumed error, retained roots reading their own text through forty
  later in-place edits, and branches from a retained root.
- `bun run bench:test`: 73 tests, with every smoke workload validated under all three retentions
  and the counter budgets regenerated at a 2% margin over the lowered counts.
- Timing: `bun run bench -- --profile standard --seed <s> --retention <mode> --only <lanes>`
  for each mode and seed, main timed from a worktree at `5469b37`; two runs that overlapped with
  other work on the machine were discarded and repeated. Reports and JSON are in the evidence
  tarball under `timing/`.
- Counters: `bun run bench:profile -- --modes counters --retention <mode>`, under `counters/`.
- CPU: `bun run bench:profile -- --modes cpu --retention <mode> --repeats 24 --only
  random-insertions,random-replacements`, under `cpu/`. Raw `.cpuprofile` files are not kept;
  the command reproduces them.
