# E038 append-only buffer store

E038 is complete on 2026-09-16. Inserting text into `@singapore-editor/textbuffer` costs the text
itself: the chunk store is one append-only log per lineage, appended in place on a linear history
and copied once per branch point, and an insert fills the newest chunk before it opens another, so
chunk count follows text volume rather than edit count. The structural counters that prove it gate
`bench:check`, and a branch-heavy lane measures the one copy that remains.

The inspected baseline was `69dfef7425539165ec05a457bd6f0516fb6607fa`, on top of the E037 commits
at `16736ad`. The execution plan has been removed; the
[E037 report](e037-textbuffer-edit-allocations.md) records the starting point and the
[ablation](#measured-results) below records the ceiling the plan asked for first.

## Contracts that remain

- `PieceBufferId` still names one contiguous span of one chunk, minted per insert and per chunk
  opened by a large insert. Several ids share a chunk string once inserts fill it, but an id never
  spans two chunks, so `(buffer, start)` is still the insertion identity the reverse index and
  anchors are keyed by. This is what keeps the deleted-anchor edge rules, which read same-buffer
  neighbours as the gap edges, meaning the same thing they meant with one chunk per insert. The
  plan's "keys per chunk grow" premise for E039 did not happen; its plan is corrected.
- The log is `{ chunks, chunkOfBuffer, lineIndexes }`, shared by every snapshot of a lineage and
  internal to `buffers.ts`. A snapshot's `PieceBufferChunkView` holds its extent: chunk count,
  tail length and buffer count. `get` resolves an id below the extent through `chunkOfBuffer` and
  slices the tail to the extent when a newer snapshot has grown it.
- Only the view whose extent matches the log exactly writes in place. `writableStore` forks
  otherwise, copying the visible chunk strings, the id map and the line indexes it can keep.
  Undo re-minting an id is the same case: the log is longer than the undone snapshot's extent.
  `fork` is the only copy path and `PieceBufferChunkView.fork.copiedArraySlots` counts it.
- Chunk 0 is the original text and is never extended. An insert fills the tail only while the
  tail is an append chunk with room, holds back a trailing CR or high surrogate at the chunk
  limit exactly as opening a chunk does, and opens a new chunk for the rest.
- Coalescing is unchanged in meaning: the piece must be the newest buffer and end at the end of
  its chunk. `extendTailChunk` and a fill both grow the tail's line index from the appended text
  when that index is up to date, so a caret lookup after a keystroke never rescans the tail.
- Line indexes are one per chunk string, keyed by chunk sequence on the log and exposed as
  `buffers.lineIndexes`. A chunk only grows at its end, so an index scanned for a shorter version
  is a valid prefix and a longer one serves shorter extents by clamping. A fork shares an index
  only when the chunk string is final and fully scanned, and trims a copy otherwise. The text
  identity check and the per-store-version retention map from E037 are gone; the log's contract
  replaces them.
- The inspector checks the store extent against `nextBufferSequence` and `chunks.size` and that
  no append chunk exceeds `BUFFER_CHUNK_SIZE`, next to its per-chunk line-index checks.
- `bench/budgets.json` has a `branch-edits` lane: one insert on each of 64 branches from one
  churned root. The first branch continues the root's log; the other 63 fork it.

## Measured results

Runtime: Node 26.7.0, Linux x64, one machine, baseline and final runs alternated per seed.
Control: `microsoft/vscode-textbuffer` at `fdca8848`. Standard profile, nine samples per lane,
medians averaged over seeds `20260916`, `7` and `42`. The baseline is `16736ad` in a worktree.

| Workload                      | Baseline ms | Final ms | Change | Control ms |
| ----------------------------- | ----------: | -------: | -----: | ---------: |
| load-short-lines              |       2.149 |    2.145 |     0% |      3.765 |
| load-long-line                |       1.077 |    1.070 |    -1% |      2.882 |
| sequential-typing             |       0.615 |    0.598 |    -3% |      0.604 |
| typing-with-lookups           |       1.009 |    0.836 |   -17% |      0.939 |
| random-insertions             |       6.516 |    5.512 |   -15% |      1.116 |
| random-replacements           |      13.554 |   12.398 |    -9% |      1.378 |
| eight-cursor-batches          |       7.486 |    5.820 |   -22% |      1.171 |
| mixed-edit-churn              |      11.351 |    8.403 |   -26% |      1.195 |
| large-paste-delete            |       4.057 |    4.761 |   +17% |     12.669 |
| lines-sequential-after-churn  |       1.481 |    1.440 |    -3% |      0.484 |
| lines-random-after-churn      |       2.339 |    2.212 |    -5% |      0.807 |
| ranges-after-churn            |       1.499 |    1.515 |    +1% |      3.054 |
| offset-to-position            |       1.365 |    1.296 |    -5% |      1.610 |
| position-to-offset            |       1.296 |    1.228 |    -5% |      0.387 |
| full-read-after-churn         |       2.032 |    2.199 |    +8% |      1.316 |
| persistent-history            |       9.887 |    9.183 |    -7% |          — |
| anchor-resolution-after-churn |       0.819 |    0.767 |    -6% |          — |
| branch-edits                  |           — |    0.439 |    new |          — |

Two lanes read slower and both were chased before acceptance:

- `large-paste-delete` is a warm-up artefact of the harness, not steady-state cost. Per-iteration
  timing in one process shows the baseline at 5.5, 3.9, 3.9 ms and then 4.6 ms for every later
  iteration; the final build goes 5.6, 4.1, 4.7 ms and stays at 4.6 ms. The harness measures the
  third iteration, which for the baseline is a transient before the JIT settles. Steady state is
  equal within 2%, and with the lane run after `random-insertions` in one process the final build
  is 20% faster (3.6 ms against 4.5 ms). The CPU profile is 89% `countLineBreaks` on both builds
  with the same sample count.
- `full-read-after-churn` is a real 5% to 8% steady-state cost, about 40 ns per piece. The 3,900
  pieces of the churned document now cut short slices from one 4.5K-unit chunk that V8 flattened
  in place from a cons string, where before each came from its own small flat chunk. Holding the
  log's arrays directly on the view did not move it, so it is the string representation, not the
  lookup. Twelve full reads of a 400 KB document pay 0.17 ms for it; the edit lanes above are
  the trade.

Ablation ceiling from step 1, measured in-process on the E037 build with the page copies stubbed
to in-place mutation (linear lanes only): `random-insertions` 22%, `eight-cursor-batches` 20%,
`sequential-typing` 6%, `mixed-edit-churn` 5%, `large-paste-delete` 0%. The final result beats
the ceiling on churn (-26%) because filling also removes a chunk object, a line index and a map
entry per insert, which the ablation kept.

Sampled JS-heap allocation per replay, 12 replays:

| Workload            |  Baseline |     Final |
| ------------------- | --------: | --------: |
| random-insertions   | 30.72 MiB | 17.13 MiB |
| sequential-typing   |  1.75 MiB |  1.54 MiB |
| typing-with-lookups |  2.34 MiB |  1.74 MiB |
| branch-edits        |         — |  2.60 MiB |

Structural counters, standard profile, baseline budget to final budget (2% over measured):

| Workload            | Counter                                           | Baseline |  Final |
| ------------------- | ------------------------------------------------- | -------: | -----: |
| random-insertions   | PieceBufferChunkStore.append.copiedArraySlots     |  653,109 |   gone |
| random-insertions   | PieceBufferChunkView.fill.calls                   |        — |  1,529 |
| random-insertions   | PieceBufferChunkView.open.calls                   |        — |      2 |
| random-insertions   | chunks after the workload                         |    1,501 |      2 |
| random-replacements | PieceBufferChunkStore.append.copiedArraySlots     |  653,109 |   gone |
| mixed-edit-churn    | PieceBufferChunkStore.append.copiedArraySlots     |  516,651 |   gone |
| mixed-edit-churn    | chunks after the workload                         |    1,006 |      2 |
| sequential-typing   | PieceBufferChunkStore.extendTail.copiedArraySlots |    4,587 |   gone |
| large-paste-delete  | PieceBufferChunkView.open.calls                   |        — |    263 |
| large-paste-delete  | chunks after the workload                         |      273 |    258 |
| branch-edits        | PieceBufferChunkView.fork.calls                   |        — |     65 |
| branch-edits        | PieceBufferChunkView.fork.copiedArraySlots        |        — | 64,775 |

`fork.copiedArraySlots` is absent from every linear lane: the counter is emitted only when a
fork runs. On `branch-edits` the 63 forks copy about 1,008 slots each, of which two are chunk
strings and the rest is the id map, one slot per buffer id minted since the document opened.

The height replay (`bench:height`, singapore, trace seeds 20260916 and 7, priority seeds 0, 1, 7, 42) has identical piece counts at every sample on every workload: filling does not change which
inserts coalesce. Heights moved within the existing band because piece fields feed the priority
hash; height over log2(pieces + 1) stayed between 2.0 and 2.8 on both sides.

## Verification

`bun run verify` and `bun run bench:check` in `packages/textbuffer` pass, as do the editor
package's node and dom projects (one pre-existing failure in `theme.test.ts` that asks V8 for
`gc` under Bun) and the tree-sitter tests. The platform web app typechecks against the rebuilt
package.

New tests in `buffers.test.ts`: unrelated inserts share the tail under distinct ids with the right
text and chunk count; a fill that would split a surrogate pair or CRLF at the chunk limit opens
the next chunk instead; chunk count is bounded by text volume over 800 random inserts; two random
insert sequences from one snapshot never see each other and every retained ancestor on every
branch still reads exactly; an undone branch re-minting an id leaks neither text nor line index;
an older snapshot keeps its own extent after newer appends; sequential typing keeps one piece in
place; and deleted anchors inside a shared chunk take their gap edges from their own insert. With
`writableStore` changed to never fork, the two branch tests and the chunk-limit test fail.

## Found on the way

A deleted anchor whose tombstone has no same-buffer neighbour resolves to 0 with left bias and to
the document end with right bias, on the E037 build as much as here, because the edge rules fall
back to infinite orders when no neighbour exists. Every deletion of a whole insert hits it, and
the linear resolver shares the code, so no test sees it. It is unchanged by E038 and recorded in
[E039](e039-reverse-index-cost.md), which redesigns the neighbour lookup.

## Left for the successors

- The tail chunk is a cons string while it grows and V8 flattens it on the first read after each
  append, one copy of up to 16K units per read-after-write. Typing already paid this in E037; the
  fill path now pays it for every insert. It is the cost behind the full-read lane above.
- A fork copies the id map, one slot per buffer id in the lineage. A paged map would make that
  logarithmic; the branch lane is the place to see whether it ever matters.
- [E006](../storage/e006-tombstone-compaction.md) needs to swap the log for a compacted one. The
  log is internal to `buffers.ts` and every read goes through a view, so a generation swap is a
  new log plus new views, not a second copy path.
- The reverse index still copies a path per write and now keys one small range per insert, not
  per chunk. That is [E039](e039-reverse-index-cost.md).
