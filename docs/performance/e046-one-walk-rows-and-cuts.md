# E046 one-walk rows and cuts

E046 is complete on 2026-09-17. A row's two ends come from one descent, a piece knows where its
line breaks sit in its chunk's index, and a document that never held a surrogate is edited without
looking for one. A single range edit checks its ends for a cut pair on the pass that hides the
range. `position-to-offset` is 46% to 53% faster than the E039 head, line reads 46% to 56%,
`offset-to-position` 40%, replacements 14% to 19% and churn 14% to 18%. The equivalence test written for the folded check found a placement
bug that is older than this plan: replacement text could land ahead of tombstones that precede its
range, depending on the shape of the tree. Raw reports are in
[`e046-evidence.tar.gz`](e046-evidence.tar.gz).

Inspected baseline: `7cafb67`, whose textbuffer is the E039 head `0330aae`, on branch
`e046-one-walk-rows-and-cuts`.

## The premises

Step 1 reran the CPU profile of the baseline at 40 replays. Self time, share of in-workload
samples:

| Lane                         | `firstLineBreakAtOrAfter` | `findOffsetAfterLineBreak` | `splitsSurrogatePair` |
| ---------------------------- | ------------------------: | -------------------------: | --------------------: |
| position-to-offset           |                       14% |                        39% |                     — |
| lines-random-after-churn     |                       11% |                        24% |                     — |
| lines-sequential-after-churn |                        7% |                        21% |                     — |
| random-replacements          |                       14% |                          — |                   11% |
| mixed-edit-churn             |                       14% |                          — |                   10% |

The plan's figures reproduce within run variation, so no premise was corrected.

## What changed

- **`firstLineBreak` on `Piece`.** The position, in the chunk's line index, of the first break at
  or after the piece's start. The original piece has 0, the right part of a cut has the left
  part's position plus the left part's count, and an appended piece has the tail's running count of
  breaks, which each store view now carries because the tail's index is lazy and may not exist. A
  count inside a piece searches `lineBreaks` entries instead of the chunk's 10,000, and the K-th
  break of a piece is an array read. `countBufferLineBreaks` and `findBufferLineBreakOffset`, the
  whole-chunk searches, are gone. The inspector checks the field against the chunk text.
- **`findLineRange`.** One iterative descent to the piece holding the break before the row. The
  break that ends the row is the next entry of the same piece, or the first break after the
  landing: in its right subtree, else at the nearest ancestor the descent turned left at that has
  a break in its piece or to its right. The descent keeps that one ancestor as it goes, so there
  is no stack and no allocation. `pointToOffset`, the new `lineRange` and the new
  `readPieceTableLine` are built on it. A row inside one piece is sliced from that piece's chunk
  with no second descent; a row that spans pieces falls back to the range read.
- **`containsSurrogates` on the buffers.** Set by one `RegExp` test of the ingested text and by a
  test of each appended text, never cleared. While it is false, `snapBatchEditRanges`, the insert
  probe and `splitsSurrogatePair` return at once. The ingestion test is free for a one-byte
  string, which V8 rejects without scanning, stops at the first hit otherwise, and costs 0.29 ns
  per unit for two-byte text that holds none: 0.41 ms for 1.4M units, once per document.
- **The folded check.** A single range edit that nobody snapped checks its ends inside
  `hideVisibleRange`. `from` and `to` now travel down unclamped, so a node can tell the range's own
  end from a subtree's. A pair inside one piece widens the cut on the spot. A pair whose halves sit
  in two pieces needs a unit the pass does not visit: at the start the pass stops before it has
  changed anything, the caller reads that unit and runs the edit again, as the insert probe's
  retry does; at the end the caller hides the other half afterwards. Both are one extra descent on
  a path the fixtures never take. Whether replacement text mends a cut is decided by
  `mendsCutAtStart` and `mendsCutAtEnd`, which the batch path calls too. `snapEditRange` is gone: a
  collapsed single edit snaps at the insert's landing, as `insertIntoPieceTable` always did.
- **`withStore` names every field.** The buffers object is remade on every keystroke, and a
  spread of eleven fields cost typing 2.7% once the flag was added. A literal in
  `createInitialBuffers`' order keeps one shape and brought typing back to the baseline.
- **Editor.** `TextSnapshot.lineRange(row)`, implemented by both snapshots. The display
  projection resolved a run row with six descents, two `lineStart` and two `lineEnd` of two
  descents each across `resolveProjectionRow` and `documentRow`; it is one now. `lineEnd` in
  `displayProjectionText.ts` is gone, and `documentSelectionEdits` takes a row's bounds from
  `lineRange` instead of two `pointToOffset` calls.

## The placement bug

`hideVisibleRange` hides a wholly covered subtree without descending into it, and with a
replacement pending it put the new text ahead of that subtree. When the subtree began with a
tombstone, the text landed before the tombstone instead of before the first unit it replaced.
The text of the document is the same either way, which is why no test saw it. A deleted anchor is
not: a left-biased anchor at the start of the replaced range resolved after the new text instead
of before it, and whether it did depended on where rebalancing had left the pieces. The folded
check and the snapped batch path reach the same range through different descents, and comparing
their anchors over a fuzzed document is what exposed it. The shortcut is now taken only without
pending text; with it, the descent continues to the first visible unit, which costs one path.
`edits.test.ts` sweeps every range of three tombstone-rich documents and asserts that the piece
after the new text is the first unit replaced.

## Measured results

Standard profile, three seeds, one fresh process per sample, the baseline build and this one
interleaved by a throwaway driver that validates between warmups as the bench's worker does.
Milliseconds per lane, median per seed, then median over seeds.

Each step on its own, 8 warmups, 7 samples. Step 2 is `firstLineBreak`, step 3 `findLineRange`,
steps 4 and 5 the flag and the folded check. `ascii-replacements` is a new lane whose document
never holds a surrogate, so its last column is step 4 alone; the two lanes above it are
surrogate-rich, so theirs is step 5 alone.

| Lane                         | Baseline | Step 2 | Step 3 | Steps 4 and 5 |
| ---------------------------- | -------: | -----: | -----: | ------------: |
| position-to-offset           |     0.96 |   0.72 |   0.46 |             — |
| lines-sequential-after-churn |     1.12 |   1.02 |   0.53 |             — |
| lines-random-after-churn     |     1.76 |   1.45 |   0.78 |             — |
| random-replacements          |     2.32 |      — |   2.08 |          1.88 |
| mixed-edit-churn             |     2.31 |      — |   2.07 |          1.89 |
| ascii-replacements           |     2.43 |      — |   2.17 |          1.87 |

Every step moved its lanes beyond run variation, so none was dropped.

Every lane, baseline against the final build, 9 samples:

| Lane                          | 2 warmups    | Change | 8 warmups     | Change |
| ----------------------------- | ------------ | -----: | ------------- | -----: |
| load-short-lines              | 2.17 to 2.14 |    −2% | 1.65 to 1.66  |     0% |
| load-long-line                | 1.08 to 1.08 |     0% | 1.08 to 1.08  |     0% |
| sequential-typing             | 0.40 to 0.40 |    +1% | 0.37 to 0.37  |    −1% |
| typing-with-lookups           | 0.62 to 0.60 |    −2% | 0.60 to 0.57  |    −4% |
| random-insertions             | 1.59 to 1.41 |   −11% | 1.39 to 1.22  |   −12% |
| random-replacements           | 3.20 to 2.75 |   −14% | 2.32 to 1.87  |   −19% |
| eight-cursor-batches          | 1.97 to 1.76 |   −10% | 1.78 to 1.60  |   −10% |
| mixed-edit-churn              | 2.69 to 2.33 |   −14% | 2.31 to 1.89  |   −18% |
| large-paste-delete            | 4.59 to 4.63 |    +1% | 4.49 to 4.47  |     0% |
| lines-sequential-after-churn  | 1.27 to 0.69 |   −46% | 1.11 to 0.54  |   −51% |
| lines-random-after-churn      | 1.92 to 0.92 |   −52% | 1.76 to 0.77  |   −56% |
| ranges-after-churn            | 1.31 to 1.31 |     0% | 1.14 to 1.15  |     0% |
| offset-to-position            | 1.28 to 0.77 |   −40% | 1.01 to 0.60  |   −41% |
| position-to-offset            | 1.09 to 0.59 |   −46% | 0.96 to 0.45  |   −53% |
| full-read-after-churn         | 2.14 to 2.12 |    −1% | 1.68 to 1.74  |    +4% |
| persistent-history            | 2.89 to 2.49 |   −14% | 2.48 to 2.02  |   −18% |
| branch-edits                  | 0.28 to 0.28 |     0% | 0.22 to 0.21  |    −5% |
| anchor-resolution-after-churn | 0.49 to 0.48 |    −1% | 0.31 to 0.31  |    −2% |
| anchor-density                | 10.6 to 10.6 |     0% | 10.1 to 11.2  |   +11% |

Inserts and batches gain from `firstLineBreak` alone: every cut counted the left part's breaks
with two searches of the whole chunk. `offset-to-position` gains for the same reason, which the
plan did not list. `full-read-after-churn` rerun at 4, 8 and 12 warmups reads −1%, +2% and 0%,
which is run variation.

Against the pinned control, `bun run bench`, each regime against its own control, before and
after: `position-to-offset` 2.64x to 1.45x and 3.29x to 1.56x, sequential line reads 2.57x to
1.39x and 3.38x to 1.64x, random line reads 2.51x to 1.20x and 2.88x to 1.25x,
`offset-to-position` 0.77x to 0.47x and 1.50x to 0.88x, replacements 2.31x to 1.98x and 1.87x to
1.51x, churn 2.13x to 1.93x and 2.18x to 1.82x. The textbuffer
[README](../../packages/textbuffer/README.md#current-results) holds the full table.

### `anchor-density` has two modes

The lane reads either about 10.0 ms or about 11.2 ms, and which build lands in the slower mode
depends on the warmup count, not on the build. Five seeds, 7 samples, baseline to final:

| Warmups | 20260916     | 7            | 12345        | 42           | 99          |
| ------: | ------------ | ------------ | ------------ | ------------ | ----------- |
|       4 | 10.1 to 10.1 | 10.1 to 10.1 | 10.3 to 10.3 | 10.0 to 10.1 | 9.8 to 9.8  |
|       8 | 10.1 to 11.2 | 10.0 to 11.1 | 10.1 to 11.4 | 10.0 to 11.2 | 9.8 to 10.9 |
|      12 | 11.3 to 10.0 | 11.4 to 9.9  | 10.1 to 10.0 | 11.3 to 10.1 | 10.0 to 9.7 |

The step builds place the switch at step 2, but the baseline with an unused seventh field on every
piece reads 10.1 ms at 8 warmups, so it is not the size of a piece. Every live piece has one
hidden class in both builds. The CPU profile is the same in both: 54% of the lane is
`findOriginalPiece`, a pointer chase this plan did not touch, and under the profiler the two
builds read 10.2 and 10.4 ms. The likeliest cause is where the collector leaves the tree after a
given number of warmups. It is recorded as a property of the lane, not as a cost of this change,
and the README quotes the lane with that caveat.

### Work counted

Structural counters, standard profile, first replay, before to after:

| Lane                         | Row descents | Range reads  | `splitsSurrogatePair` |
| ---------------------------- | ------------ | ------------ | --------------------- |
| position-to-offset           | 6,000 to 3,000 | —          | —                     |
| lines-random-after-churn     | 6,000 to 3,000 | 3,000 to 412 | —                   |
| lines-sequential-after-churn | 6,000 to 3,000 | 3,000 to 375 | —                   |
| random-replacements          | —            | —            | 2,906 to 0            |
| mixed-edit-churn             | —            | —            | 2,872 to 0            |
| ascii-replacements           | —            | —            | 0                     |

A line read was three descents and is 1.14 on the random lane: one row lookup, and a range read
for the 14% of rows that span pieces after the churn. `codeUnitAt`, which only the two-piece
paths of the folded check call, is never entered by any lane. The batch lane still snaps up
front, about 3,000 calls, as the plan's limits say. `bench/budgets.json` is regenerated with these
counts, `edits.snapEditRange.calls` is gone with its function, `positions.findLineRange.calls` is
budgeted, and `reads.codeUnitAt.calls` is a structural counter, so a lane that starts to enter it
fails the gate as unbudgeted.

Self time after, share of in-workload samples at 40 replays: `findLineRange` is 39% of
`position-to-offset`, 29% and 21% of the line lanes, and it is the whole lookup where
`findOffsetAfterLineBreak` and `firstLineBreakAtOrAfter` together were 53%, 34% and 28% of lanes
twice as long. `countPieceLineBreaksBefore` is 4% of replacements and churn where
`firstLineBreakAtOrAfter` was 14%.

### Memory

Retained heap after the churned read lanes, about 3,900 pieces: 1,049 KB to 1,074 KB at 8
warmups, 1,052 KB to 1,091 KB at 2. That is one 8-byte field per piece on this Node build, which
has no pointer compression: a piece goes from 72 to 80 bytes, 2% to 4% of the retained tree. The
plan's fallback, a bounded search from a hint, would keep the row-lookup gain and lose the cuts',
which is where inserts, batches and `offset-to-position` gained; the field stays.

### Editor

`bun run bench:virtualization` and `bun run bench:walker` in `packages/editor`, median of 9 runs,
before and after the adoption. The window lanes open unedited documents, one piece, where a
descent is one node, so the six-to-one reduction shows as a few percent:

| Lane                          | Before (ms) | After (ms) |
| ----------------------------- | ----------: | ---------: |
| cold-open-first-window, 100k  |        3.58 |       3.40 |
| warm-distant-windows, 100k    |        3.97 |       3.77 |
| top-newline-edit, 100k        |        1.47 |       1.29 |
| warm-distant-windows, 500k    |        3.50 |       3.35 |
| top-newline-edit, 500k        |        0.64 |       0.61 |
| wrap-enable, 500k             |       41.10 |      39.86 |
| walker, 5,000 random seeks    |        1.52 |       1.52 |

The other virtualization lanes and the walker lanes are within ±2%, except the two chunk-wise
walks at 0.06 to 0.08 ms, too short to read anything into.

## What remains

- The sequential line lane is 1.39x to 1.64x the control, which caches the last line. The plan
  ruled a cache out at this layer.
- A row that spans pieces pays a second descent for its text. After the churn that is one row in
  seven. Collecting the text on the walk from the landing to the row's end would remove it.
- A document that once held an emoji pays the batch path's two descents per range for the rest
  of its history. Clearing the flag belongs to
  [E006](../storage/e006-tombstone-compaction.md).
- `findOriginalPiece` is 54% of `anchor-density` and reads a piece per node on its path; the two
  modes above say the lane is bound by memory, not by instructions.
- A multi-edit batch still snaps up front. Folding it would need the sibling rules inside the
  pass.

## Verification

- `bun run verify` in `packages/textbuffer`: 101 tests. New: `lineRange`, `readPieceTableLine`
  and a clamped `pointToOffset` against a split string after every edit of the position fuzz,
  with the first and last rows, a row past the end and negative rows; a row whose end lies three
  pieces on, past two tombstones; the inspector run on every fuzzed snapshot, which is what checks
  `firstLineBreak`; two branches filling one tail chunk with different breaks at the same index
  positions, then a cut in each; every range of a document with pairs split across pieces, six
  replacement texts each, against `snapBatchEditRanges`, comparing text, invariants and the
  resolution of an anchor at every offset under both biases; the same sweep on a transient
  snapshot, which proves the retry changes nothing before it runs again; the flag derived, forced,
  gained by insert, kept through a delete and absent from the older snapshot; and the placement
  sweep. Each new test was run against a mutation of the code it guards and failed.
- `packages/editor`: 2,677 of 2,678 tests. The one failure is the BiDi drag-selection timing
  probe, which fails identically on the baseline. `pieceTable-positions.test.ts` asserted that
  `pointToOffset` reads the tree twice as much as `offsetToPoint`; it now asserts that it reads
  within 1.5x of one `lineStartOffset` descent, and measures 1.02x. `pieceTable-buffers.test.ts`
  reads the line index through pieces now that the whole-chunk searches are gone. The surrogate
  sweep in `pieceTable-edits.test.ts` runs with the flag found at load, forced on and gained by
  insert.
- The rest of the workspace: every package's tests pass except one `typescript-lsp` hover test,
  which fails identically on the baseline.
- `bun run bench:check`: 75 tests with the regenerated budgets and the new lane in every harness
  test. `bun run bench:profile:check`: 8 tests. `bun run typecheck`, `bun run lint` and
  `bun run format:check` at the root. `bun run knip` reports the 26 exports it reported before.
- Timing: `drive.mjs`, `lane.mjs`, the per-step and final JSONL files, the two CPU and counter
  reports, the official runs' summaries, the editor bench medians and `budgets-before.json` are in
  the evidence tarball.
