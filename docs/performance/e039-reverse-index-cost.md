# E039 reverse-index cost

E039 is complete on 2026-09-17. The reverse index no longer costs more than the edit it follows:
an insert copied 20 of its nodes and now copies a ninth of one. Entries hold only an order, so
deleting and typing write nothing. Anchors into original text are found through the sequence tree
and need no entry. Inserted buffers live in a persistent vector that a new buffer is appended to
without a copy. Random insertions are 30% faster than the E045 head, replacements 28%, anchor
resolution 40%, 500 anchors resolved after every edit 44%, and typing 14%. A deleted anchor in an
insert that was deleted whole no longer resolves to the document's start or end. Raw reports are
in [`e039-evidence.tar.gz`](e039-evidence.tar.gz).

Inspected baseline: the E045 head, `fa46d45`, on branch `e039-reverse-index-cost`.

## The ceiling

The plan's first step was to measure what any design could win. A disposable build returned the
index untouched from `applyReverseIndexChanges` and from the relabel. Milliseconds per lane, 8
warmups, 7 samples, median over three seeds:

| Lane                 | E045 head | No index | Share of the lane |
| -------------------- | --------: | -------: | ----------------: |
| sequential-typing    |      0.43 |     0.36 |               16% |
| random-insertions    |      1.99 |     1.31 |               34% |
| random-replacements  |      3.19 |     2.17 |               32% |
| eight-cursor-batches |      2.30 |     1.67 |               28% |
| mixed-edit-churn     |      3.15 |     2.15 |               32% |

Every random lane is above the plan's stop line of a fifth, so the work went ahead.

## What changed

- **Entries hold an order and nothing else.** An entry used to mirror its piece, so tombstoning a
  piece and extending the piece being typed into each rewrote an entry, and a cut rewrote the
  part that kept its key. Resolution now takes the order from the index and the piece from the
  sequence tree, on the descent it already made for the visible prefix. Only a new key writes:
  inserted text and the later parts of a cut. `EditContext.changes` lists exactly those.
- **The original buffer has no entries.** Its pieces tile the original text in document order,
  so a prefix sum of their lengths finds the piece holding an original offset. That sum is
  `subtreeOriginalLength`, which takes the place of `subtreeLength`, a summary nothing but the
  inspector read. Random edits cut original text, and those cuts now write nothing.
- **A persistent vector for inserted buffers.** Buffer ids are dense and the newest is always
  next, so the index is a 16-way vector keyed by id with a tail. The tail is shared along a
  linear history: a snapshot reads only below its own count, so the first snapshot to append
  after its parent fills the tail's free slot in place. A sibling branch that appends second
  takes a private tail. A full tail becomes a leaf, one short path copy per 16 buffers. A slot is
  the order of the buffer's only piece, or an AVL tree of `start → order` once it has been cut.
- **One gap rule, read off the sequence tree.** A deleted anchor's gap used to end at the
  nearest pieces of the same buffer, found by two more index descents, with infinity standing in
  when there were none. Now it ends at the nearest piece whose buffer is no newer than the
  tombstone's. Between two pieces of one buffer everything is newer, so where the old rule had
  an answer this one gives the same answer. `subtreeMinBuffer` finds that piece in one descent.
- **The relabel rebuilds the index** from one in-order walk of the tree, with no sort: a
  buffer's pieces come out in start order. `relabelReverseIndex` and its piece map are gone.
- **The linear resolver is independent.** It shared the edge code with the indexed resolver,
  which is how the bug below went unseen. It now resolves from the flat piece list alone.

## The anchor bug

An insert deleted whole has no other piece of its buffer, so both of its gap edges were
infinite. A left-biased anchor inside it resolved to 0 and a right-biased one to the document
end. Select a typed word and replace it, and every anchor in the word was thrown to the ends.
The E045 head gives `{offset: 0}` and `{offset: 6}` for anchors in `WORD` after
`abc|WORD|def` loses it; this branch gives 3 and 3, and with replacement text `new` it gives 3
and 6, either side of the text. The linear resolver agreed with the bug because it ran the same
code. There is a test per bias, one for the replacement, and one for text typed into the gap
later.

## Measured results

Standard profile, 9 samples, three seeds, milliseconds per lane, median over seeds, ratio to the
pinned vscode-textbuffer control, which has no anchors and no persistence. Two regimes, as in the
E045 report. The 2-warmup columns are the bench itself: E045's are the figures its report
recorded on this machine the same day, E039's are this build. The 8-warmup columns are the E045
head's build and this one interleaved by a throwaway driver.

The ratios in the 8-warmup columns divide by the single control column, which is the 2-warmup
control. The control warms up too, so those ratios flatter both builds: measured against its own
8-warmup control, this build's typing is 0.97x, not 0.60x. The milliseconds and the E045 to E039
comparison stand. The textbuffer [README](../../packages/textbuffer/README.md#current-results)
holds the per-regime ratios for this commit.

| Lane                          | Control | E045, 2 warmups | E039, 2 warmups | E045, 8 warmups | E039, 8 warmups |
| ----------------------------- | ------: | --------------- | --------------- | --------------- | --------------- |
| sequential-typing             |    0.61 | 0.46 (0.76x)    | 0.40 (0.66x)    | 0.43 (0.70x)    | 0.37 (0.60x)    |
| typing-with-lookups           |    0.98 | 0.67 (0.73x)    | 0.62 (0.63x)    | 0.66 (0.68x)    | 0.59 (0.61x)    |
| random-insertions             |    1.09 | 2.38 (2.23x)    | 1.59 (1.46x)    | 2.00 (1.84x)    | 1.39 (1.28x)    |
| random-replacements           |    1.38 | 3.75 (2.77x)    | 3.22 (2.34x)    | 3.17 (2.29x)    | 2.29 (1.66x)    |
| eight-cursor-batches          |    1.15 | 2.47 (2.17x)    | 1.95 (1.71x)    | 2.28 (1.99x)    | 1.77 (1.54x)    |
| mixed-edit-churn              |    1.21 | 3.75 (3.29x)    | 2.72 (2.25x)    | 3.12 (2.58x)    | 2.31 (1.91x)    |
| large-paste-delete            |   12.53 | —               | 4.60 (0.37x)    | 4.49            | 4.47            |
| persistent-history            |       — | 3.73            | 2.90            | 3.28            | 2.42            |
| branch-edits                  |       — | 0.29            | 0.29            | 0.25            | 0.21            |
| anchor-resolution-after-churn |       — | 0.67            | 0.50            | 0.52            | 0.31            |
| anchor-density                |       — | —               | 10.56           | 18.33           | 10.22           |

The E045 ratios in the 2-warmup columns are its report's, against that run's control. The
driver's own 2-warmup run is colder than the bench's, because it does not validate between
warmups, and there the batch lane is flat, 2.42 to 2.49 ms, while every other lane improves.
The cause was not chased; both runs are in the evidence.

Structural counters, standard profile, first replay. Index copies are vector nodes, private
tails and cut-buffer tree nodes; before, they were index tree nodes cloned and created.

| Lane                 | Index copies    | Appends | Sequence-tree copies |
| -------------------- | --------------- | ------: | -------------------: |
| sequential-typing    | 3,002 to 0      |       2 |                1,503 |
| random-insertions    | 32,949 to 164   |   1,500 |               18,444 |
| random-replacements  | 36,786 to 212   |   1,500 |               20,296 |
| eight-cursor-batches | 15,169 to 226   |   1,865 |               14,546 |
| mixed-edit-churn     | 32,847 to 192   |   1,676 |               21,821 |
| branch-edits         | 1,614 to 72     |      65 |                  883 |

The acceptance bar was index copies at or below sequence-tree copies on both random lanes. They
are under a hundredth of them. An append is one slot write, not a copy. Batches and churn append
more than they insert because each relabel rebuilds the index by appending.

## The decision

The plan offered three designs and asked for the choice to be measured.

- **Option 1, a per-buffer structure inside a persistent map, as planned: measured and
  rejected.** The build kept the vector and the thin entries but indexed the original buffer
  like any other, as a tree of its pieces in slot 0. Random insertions 1.89 ms against 2.00 for
  the E045 head and 1.39 for the retained design; replacements 3.10 against 3.17 and 2.29; churn
  3.18 against 3.12 and 2.31; anchor resolution 0.45 against 0.52 and 0.31. The plan expected a
  buffer to hold a handful of pieces. That is true of inserts and false of the original buffer,
  which is the one random edits cut: its tree is as deep as the old index was.
- **Option 2, deferred maintenance: not built.** It changes when the work happens, not how
  much, and an editor resolves its selections after every edit, so there is nothing to batch.
  With the writes gone there is nothing to defer either. The slot outside the tree that E045
  proposed for the entry being typed into is not needed: typing writes no entry at all.
- **Option 3, derivation from the sequence tree: taken for the original buffer only.** A
  summary can order one buffer's pieces, not every buffer's, and the original is the buffer
  worth it. The cost the plan feared, a field on every sequence node, came to nothing:
  `subtreeOriginalLength` replaced a field that was there already. `subtreeMinBuffer` is one new
  field and one comparison per child in `summarize`.

What is left of the ceiling: random insertions are at 1.39 ms against 1.33 with no index at
all, and that 5% also pays for the new summary. Replacements 2.29 against 2.16.

## What the measurements say

- **Path-copy bytes are lowest for a binary tree.** A wider node copies more slots on a
  shorter path, and the product is smallest near fan-out e. A B-tree over the same keys would
  have cut the copy count and not the bytes, so it was not built. What pays is writing fewer
  keys, and making the common write an append.
- **One object shape per structure.** The first build of the vector made its header at four
  sites with two property orders. `finishEdit` deoptimised on every fresh document and the
  insert lane read 1.68 ms; one constructor function brought it to 1.39.
- **A pre-existing deopt remains.** `retainPieceTableSnapshot`, `editingEpoch`,
  `insertIntoPieceTable` and `finishEdit` are each deoptimised once per fresh document with
  "dependent field type changed", on the E045 head too. It costs the first edits of a document.
  A lead, not part of this plan.
- **The harness has a call-site trap.** A worker that runs its warmups in a loop and the
  measured run at a second call site reads 4x slower for typing. The bench's own worker loops
  over one site; the throwaway driver used here had to be fixed to do the same.

## What remains

- Order gaps still run out under random edits, and a relabel is linear. E045's lead stands:
  relabel the smallest crowded subtree.
- The deopt above.
- A buffer cut many times, a large paste edited heavily, pays a path in its own small tree and
  a path in the vector per cut. Nothing in the fixtures does this enough to measure.
- Tombstone reclamation, [E006](../storage/e006-tombstone-compaction.md), must keep the two
  facts resolution relies on: a buffer's pieces tile it in document order, and nothing older
  sits between two pieces of one buffer. The inspector now checks both.

## Verification

- `bun run verify` in `packages/textbuffer`: 94 tests. New: anchors resolved after every edit
  against the linear resolver over six seeds, with anchors made throughout; a deleted anchor
  across a relabel; the whole-insert bug per bias, under replacement and under later typing; two
  branches of one snapshot appending to a shared tail without seeing each other; an older
  snapshot reading its entries after a newer one cut the buffer; the vector grown past 4,096
  buffers through every level; and typing, deleting and cutting original text leaving the index
  object untouched.
- `packages/editor`: 2,675 of 2,676 tests. The one failure is the BiDi drag-selection timing
  probe, which fails identically on the E045 head and performs no edits.
- `bun run bench:check`: 73 tests with the counter budgets regenerated, and the new
  `anchor-density` lane in every harness test. `bun run bench:profile:check`: 8 tests, which run
  every smoke lane on the clean and the probed build. The lane resolves 500 live anchors after
  each of 300 edits and checks the digest of all 150,000 resolutions against a plain-string
  model.
- The height harness no longer samples the reverse index, which has no height.
- Timing: `drive.mjs`, `lane.mjs` and the per-lane JSONL files are in the evidence tarball, with
  the no-index and option 1 builds' patches.
