# textbuffer benchmarks

how to run them, and the last recorded numbers. back to the [readme](../README.md)

## Running

From `packages/textbuffer`, run `bun run bench:check`, then `bun run bench -- --profile standard`. The [benchmark guide](../bench/README.md) documents the pinned Microsoft control, the shared workloads, adapter costs, correctness checks, process isolation, retained-memory measurements and the result format. Results land in `bench/results/`.

`bun run bench:profile` attributes cost with separate CPU, allocation, GC and structural-counter passes; see [`bench/PROFILING.md`](../bench/PROFILING.md) and the [initial attribution](../bench/ATTRIBUTION.md). `bun run bench:height` replays edit traces and samples both trees' shape; see [`bench/HEIGHT.md`](../bench/HEIGHT.md). Persistence and anchors have Singapore-only lanes. The numbers time the standalone buffers on Node.

## Current results

Measured against the pinned `vscode-textbuffer`, which mutates in place and has no snapshots, no anchors and no tombstones. Singapore does that extra work in every row below, so a ratio compares unequal feature sets.

**At a glance.** Faster at loading, typing, large pastes, range reads and offset-to-position. 1.2x to 1.6x slower on line reads and position-to-offset. 1.3x to 2x slower on random edits, where persistence, tombstones and the anchor index cost the most.

How to read the tables:

- **Control** and **Singapore** are milliseconds for the whole workload. **Per operation** is Singapore's time divided by the operation count.
- **Cold** compares the two after 2 warmup runs, the bench's default. **Warm** compares them after 8, closer to a long session. Each compares against the control from the same regime, because the control warms up too. "same" means within 5%.
- The name in `code` is the lane, for `bun run bench -- --only <lane>`.

**Loading**

| Workload                                                  | Control | Singapore | Per operation | Cold            | Warm            |
| --------------------------------------------------------- | ------: | --------: | ------------: | --------------- | --------------- |
| Load 1.5M code units of short lines<br>`load-short-lines` | 3.75 ms |   2.15 ms |       2.15 ms | **1.7x faster** | **1.3x faster** |
| Load 1.3M code units on one line<br>`load-long-line`      | 2.87 ms |   1.06 ms |       1.06 ms | **2.7x faster** | **1.2x faster** |

**Editing**

| Workload                                                                         |  Control | Singapore | Per operation | Cold            | Warm            |
| -------------------------------------------------------------------------------- | -------: | --------: | ------------: | --------------- | --------------- |
| Type 1,500 characters at one caret<br>`sequential-typing`                        |  0.61 ms |   0.40 ms |       0.27 µs | **1.5x faster** | same            |
| The same, with a caret row and column lookup after each<br>`typing-with-lookups` |  0.96 ms |   0.62 ms |       0.21 µs | **1.5x faster** | **1.4x faster** |
| 1,500 inserts at random offsets<br>`random-insertions`                           |  1.09 ms |   1.40 ms |       0.94 µs | 1.3x slower     | 1.3x slower     |
| 1,500 replacements at random offsets<br>`random-replacements`                    |  1.38 ms |   2.74 ms |       1.82 µs | 2.0x slower     | 1.5x slower     |
| The same in an ASCII-only document<br>`ascii-replacements`                       |  1.37 ms |   2.53 ms |       1.69 µs | 1.8x slower     | 1.5x slower     |
| 187 batches of 8 cursors<br>`eight-cursor-batches`                               |  1.16 ms |   1.78 ms |       9.51 µs | 1.5x slower     | 1.5x slower     |
| 1,500 mixed inserts, deletes and replacements<br>`mixed-edit-churn`              |  1.22 ms |   2.36 ms |       1.57 µs | 1.9x slower     | 1.8x slower     |
| Paste 256,000 code units and delete them, 16 times<br>`large-paste-delete`       | 12.67 ms |   4.64 ms |        145 µs | **2.7x faster** | **2.7x faster** |

**Reading, after 1,500 edits**

| Workload                                                 | Control | Singapore | Per operation | Cold            | Warm            |
| -------------------------------------------------------- | ------: | --------: | ------------: | --------------- | --------------- |
| 3,000 lines in order<br>`lines-sequential-after-churn`   | 0.50 ms |   0.69 ms |       0.23 µs | 1.4x slower     | 1.6x slower     |
| 3,000 lines at random<br>`lines-random-after-churn`      | 0.77 ms |   0.93 ms |       0.31 µs | 1.2x slower     | 1.3x slower     |
| 3,000 offset ranges<br>`ranges-after-churn`              | 3.07 ms |   1.31 ms |       0.44 µs | **2.3x faster** | **2.4x faster** |
| 3,000 offsets to row and column<br>`offset-to-position`  | 1.63 ms |   0.77 ms |       0.26 µs | **2.1x faster** | **1.1x faster** |
| 3,000 rows and columns to offset<br>`position-to-offset` | 0.41 ms |   0.59 ms |       0.20 µs | 1.5x slower     | 1.6x slower     |
| The whole document, 12 times<br>`full-read-after-churn`  | 1.29 ms |   2.04 ms |        170 µs | 1.6x slower     | 1.4x slower     |

**What the control cannot do**

| Workload                                                                      |     Cold |     Warm | Per operation |
| ----------------------------------------------------------------------------- | -------: | -------: | ------------: |
| 1,500 edits, keeping 64 old versions alive<br>`persistent-history`            |  2.51 ms |  2.03 ms |       1.67 µs |
| 64 branches from one version, one insert each<br>`branch-edits`               |  0.28 ms |  0.22 ms |       4.31 µs |
| 3,000 anchor resolutions after 1,500 edits<br>`anchor-resolution-after-churn` |  0.49 ms |  0.31 ms |       0.16 µs |
| 300 edits, resolving 500 anchors after each<br>`anchor-density`               | 10.58 ms | 11.22 ms |         35 µs |

Read lanes run after a 1,500-edit churn that leaves about twice as many pieces in Singapore's tree, because deleted text stays as tombstones. Line reads are one `readPieceTableLine` call; the control has a cached `getLineContent`, which is most of what is left of the sequential lane's gap. `anchor-density` has two modes about 10% apart, and which build lands in the slower one changes with the warmup count; see the [row and cut report](../../../docs/performance/e046-one-walk-rows-and-cuts.md).

Setup: 2026-09-17, Node 26.7.0, V8 14.6, Intel Core i7-14700K, Linux. Standard profile: a 380,000 UTF-16 code unit document of 10,000 lines unless the row says otherwise, 9 samples per lane, each a fresh process, median over seeds `20260916`, `7` and `12345`. These are synthetic traces on one machine; rerun before quoting them elsewhere.
