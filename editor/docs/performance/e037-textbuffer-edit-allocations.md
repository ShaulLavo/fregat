# E037 textbuffer edit allocations

E037 is complete on 2026-09-16. Every edit in `@singapore-editor/textbuffer` stopped paying for
work unrelated to persistence, anchors or tombstones: buffer-id string parsing, string hashing for
node priorities, a range read for a two-unit surrogate probe, a batch pipeline for a single edit, a
redundant reverse-index removal per split, and a whole-chunk prefix compare on every caret lookup
while typing. The structural counters that prove it are a CI gate in `bench:check`.

The inspected baseline was `69dfef7425539165ec05a457bd6f0516fb6607fa`. The work landed as one
commit per step on top of `eabe5a9`, each lowering the budgets it earned. The execution plan has
been removed; the [attribution report](../../packages/textbuffer/bench/ATTRIBUTION.md) that
commissioned it stays as the record of the starting point.

## Contracts that remain

- `PieceBufferId` is a branded `number`: the chunk's sequence in its store. The store indexes its
  pages by it directly. Tree-sitter chunk keys are `N:start`; the inspector prints `buffer=N`.
- Node priorities are signed 32-bit integers from one MurmurHash3 round per word over the seed,
  the index kind, buffer, start, length, order and visibility, then an avalanche. Only their order
  matters. A non-integer order mixes its high word and fraction explicitly.
- `splitsSurrogatePair` descends to the piece holding a unit and reads it from the chunk. It reads
  the unit after the offset first: the unit before it is the tail chunk's last unit while typing,
  and touching that flattens the string `extendTail` just concatenated.
- One edit snaps through `snapEditToCodePoints` with an empty sibling table. `snapBatchEditRanges`
  stays the public reference for hosts that report applied edits, and `edits.test.ts` holds the
  single-edit path to it.
- The reverse index never deletes. Every entry is keyed by `(buffer, start)` and no edit moves a
  piece off its key; a split's left half replaces the original entry in place and keeps its
  priority. `SplitContext.changes` is the list of pieces to write.
- `extendTailChunk` grows the tail's line index from the appended text when the index's text is
  identical to the chunk it replaces. Identity is what tells this chunk from a re-minted id on
  another undo branch; a mismatch leaves the lazy path as it was.
- `bench/budgets.json` holds a ceiling per workload for every structural counter at seed
  `20260916`, for the smoke and standard profiles, with a 2% margin. `bench:check` fails on a count
  over its ceiling, on a budget whose counter no longer exists, and on a structural counter with
  no budget. Regenerate with `node bench/budgets.mjs --write` only after a deliberate change.
- The `typing-with-lookups` workload converts the caret to a row and column after every keystroke.
  It is a shared timing lane and a budgeted counter lane; the height replay excludes it.

## Measured results

Runtime: Node 26.7.0, Linux x64, one machine, baseline and final runs alternated per seed.
Control: `microsoft/vscode-textbuffer` at `fdca8848`. Standard profile, nine samples per lane,
medians averaged over seeds `20260916`, `7` and `42`. Fixture hashes matched across trees.

| Workload                      | Baseline ms | Final ms | Change | Control ms |
| ----------------------------- | ----------: | -------: | -----: | ---------: |
| load-short-lines              |       2.174 |    2.153 |    -1% |      3.714 |
| load-long-line                |       1.079 |    1.064 |    -1% |      2.808 |
| sequential-typing             |       1.951 |    0.613 |   -69% |      0.602 |
| typing-with-lookups           |           — |    1.010 |    new |      0.946 |
| random-insertions             |      10.338 |    6.372 |   -38% |      1.126 |
| random-replacements           |      17.812 |   13.535 |   -24% |      1.359 |
| eight-cursor-batches          |      11.459 |    7.470 |   -35% |      1.168 |
| mixed-edit-churn              |      16.754 |   11.184 |   -33% |      1.174 |
| large-paste-delete            |       4.212 |    3.946 |    -6% |     12.576 |
| lines-sequential-after-churn  |       1.673 |    1.440 |   -14% |      0.476 |
| lines-random-after-churn      |       2.577 |    2.281 |   -11% |      0.757 |
| ranges-after-churn            |       1.709 |    1.486 |   -13% |      3.021 |
| offset-to-position            |       1.469 |    1.347 |    -8% |      1.596 |
| position-to-offset            |       1.419 |    1.291 |    -9% |      0.376 |
| full-read-after-churn         |       2.651 |    2.036 |   -23% |      1.302 |
| persistent-history            |      14.179 |    9.846 |   -31% |          — |
| anchor-resolution-after-churn |       0.987 |    0.823 |   -17% |          — |

No lane is slower than baseline beyond run variation; the load lanes are unchanged within 1%.
The comparison with the control is unchanged in kind: the mutable red-black tree still wins the
small-edit lanes by a wide margin, which is what E038, E039 and E040 address.

Sampled JS-heap allocation per replay, `random-insertions` and `sequential-typing`, 12 replays:

| Step                            | random-insertions | sequential-typing |
| ------------------------------- | ----------------: | ----------------: |
| Baseline                        |         38.43 MiB |          9.34 MiB |
| Integer priorities              |         34.41 MiB |          9.28 MiB |
| Allocation-free probe           |         33.48 MiB |          3.83 MiB |
| Single-edit path                |         32.16 MiB |          1.81 MiB |
| Final (after reverse index fix) |         32.16 MiB |          1.54 MiB |

Priority hashing fell from 632 KiB to 57 KiB per replay of attributed allocation on
`random-insertions`; the residue is sampling attributed to inlined callers. `collectTextInRange`
left the `sequential-typing` allocator list entirely. The `random-insertions` figure did not halve:
what remains is the paged buffer-store copy (`appendChunksToBuffers` and `append`, about 13.5 MiB)
and the two persistent trees, which are E038 and E040 respectively.

`typing-with-lookups` before and after step 7: median replay 6.17 ms to 0.87 ms, sampled
allocation 7.00 MiB to 2.21 MiB, prefix compares 1,524 (2,578,026 code units) to zero. Typing
alone never reads the tail chunk, which is why the earlier workloads could not see this cost.

Structural counters, standard profile, baseline budget to final budget:

| Workload            | Counter                             | Baseline |   Final |
| ------------------- | ----------------------------------- | -------: | ------: |
| random-insertions   | tree.cloneNode.calls                |   51,862 |  48,417 |
| random-insertions   | reverseIndex.cloneReverseIndexNode  |   93,485 |  55,398 |
| random-insertions   | priority.priorityForPiece.calls     |    9,160 |   7,635 |
| random-insertions   | priority.mixString.calls            |   64,118 |    gone |
| random-insertions   | buffers.bufferSequence.calls        |    6,128 |    gone |
| random-insertions   | reads.readPieceTableTextRange.calls |    3,060 |    gone |
| random-insertions   | tree.collectTextInRange.calls       |   39,268 |    gone |
| random-insertions   | edits.snapBatchEditRanges.calls     |    1,530 |    gone |
| random-replacements | tree.cloneNode.calls                |  108,026 | 119,495 |
| random-replacements | reverseIndex.cloneReverseIndexNode  |  191,339 | 121,711 |
| mixed-edit-churn    | reverseIndex.cloneReverseIndexNode  |  183,457 | 117,486 |
| sequential-typing   | tree.collectTextInRange.calls       |   12,234 |    gone |
| sequential-typing   | buffers.bufferSequence.calls        |   10,707 |    gone |

The one counter that rose is `tree.cloneNode.calls` on `random-replacements` (+10.6%). It is a
tree-shape effect of the new hash for that seed, not new work: a smoke height sweep over priority
seeds 0, 1, 7 and 42 kept height over log2(pieces + 1) in the same band (mean 1.95 to 1.98, max
2.74 to 2.65, mean depth 6.10 to 6.09), and the lane is 24% faster. The hash was kept rather than
reseeded; picking a seed for one workload's count would be fitting to the fixture.

## Verification

`bun run verify` and `bun run bench:check` in `packages/textbuffer` pass, as do the editor
package's node and dom projects and the tree-sitter tests. New tests: `reads.test.ts` covers the
probe on every boundary class and a churned emoji document against a string oracle;
`edits.test.ts` checks the single-edit path against `snapBatchEditRanges` including 300 fuzzed
edits; `reverseIndex.test.ts` requires exactly one reverse entry per non-empty piece after a
split and a churn sequence; `bench/budgets.test.mjs` is the counter gate.

## Left for the successors

- The buffer store still copies a page per append and concatenates the tail per keystroke; any
  first reader of that chunk flattens it. That is [E038](e038-append-only-buffer-store.md).
- The reverse index still copies a path per write. That is [E039](e039-reverse-index-cost.md).
- A `Map` per store version is still allocated to retain line indexes for ancestor snapshots
  (`:0:Map`, about 0.3 MiB per 1,500 keystrokes). E038 decides where that record lives.
