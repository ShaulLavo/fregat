# Hidden retained editor measurements

Measured hidden views now mount zero text rows and register zero CSS highlight ranges. The ordinary
and 500,000-line fixtures previously kept 13 rows mounted. The one-megabyte line kept one row mounted.
The ordinary fixture also registered 65 syntax ranges while hidden. Previously visible views can
keep detached rows in their reuse pool; the row counts below describe mounted DOM.

The [baseline](hidden-rendering-before.json), [unchanged control](hidden-rendering-control.json),
and [candidate](hidden-rendering-after.json) each contain nine samples. They reuse E001's seed
60061, fixture hashes, shared document with three views, and 100 insert/delete cycles.
Each fixture starts in a fresh browser context and then runs two warm repetitions. All samples
verify the shared edits, both visible siblings, updated text after reveal, syntax after reveal,
and disposal. Reveal changes only the host's display state.

The baseline build's virtualizer, view, and row-renderer source maps match commit
`715516cfd631b34c1922b0eba7323e036645e1b8`. Both control runs have the same built-package hash.
The candidate includes E004's source changes. The artifacts record those hashes and the complete
environment: Chromium 148.0.7778.96, Node 26.7.0, Intel Core i7-14700K, and Arch Linux.

## Retention and reveal cost

Counts below were identical in every repetition. DOM nodes count the whole renderer after churn
and forced GC, including both visible views. Hidden ranges count registrations whose start
container belongs to the hidden host.

| Fixture             | Hidden rows before / after | Hidden syntax ranges before / after | Renderer DOM nodes before / after |
| ------------------- | -------------------------: | ----------------------------------: | --------------------------------: |
| Ordinary TypeScript |                     13 / 0 |                              65 / 0 |                         728 / 624 |
| 500,000 short lines |                     13 / 0 |                               0 / 0 |                         727 / 623 |
| One-megabyte line   |                      1 / 0 |                               0 / 0 |                         209 / 160 |

The initial synchronous mount also changes from 13 rows per view to zero, or one to zero for
the long line. Resize measurement then mounts the visible views. Both ordinary siblings retain
28 rows and 140 ranges while the third view is hidden. After reveal, all three have those counts.

Suspension defers row creation until reveal, adding observable work at that point. These ranges
include every recorded repetition and keep the unchanged control visible beside the candidate.

| Fixture     | DOM ready baseline | DOM ready control | DOM ready candidate |
| ----------- | -----------------: | ----------------: | ------------------: |
| Ordinary    |         0.8–0.9 ms |            0.9 ms |        38.6–39.4 ms |
| Short lines |         1.2–8.4 ms |        1.1–8.3 ms |         8.3–17.9 ms |
| Long line   |         0.9–7.6 ms |        0.8–8.2 ms |        24.8–41.2 ms |

DOM ready observes an updated row with positive browser geometry. The first check is immediate;
later checks follow animation frames. It does not measure paint. Raw screenshot timing ends after
text and syntax assertions and capture completion, so it includes transport and capture cost.
There is no claim of faster reveal. The consistent increase for ordinary and long-line views is
the cost of restoring rows that previously stayed mounted.

Main-renderer live heap after churn is 14.66–15.18 MiB in both ordinary control runs and
12.89–13.50 MiB in the candidate. Short-line and long-line heap readings largely overlap the
controls, at about 163 MiB and 13 MiB. Document and undo state remain retained by design.
Long-line churn takes 736–769 ms in the controls and 482–502 ms in the candidate. These are local
observations, not portable performance limits. The 27 saved samples observe zero surviving
tracked buffer and editor objects after disposal and forced GC.

A preceding final-build attempt stopped at the warm short-line cleanup check after four passing
samples. That temporary check required immediate collection of every weak reference after one GC;
the failed attempt did not publish a result, and its error did not record the survivor count.
An unchanged rerun passed all nine samples. The final runner follows E001: active resources must
be zero, while weak-reference survivors remain a recorded observation. No timing sample or
memory value in the saved comparison was replaced with an estimate or retried within a sample.

The [original E001 calibration](README.md) remains provisional. It does not measure hidden rows
or reveal, and its ordinary churn disables syntax. This focused ordinary scenario enables
TypeScript on all three views to measure range cleanup, so its timings cannot use E001's old
thresholds. Worker heaps, renderer process RSS, and user-agent-specific memory remain unsupported.

## Remaining syntax work

Empty mounted rows make `Editor.visibleSyntaxRange` and its prefetch range return `null`.
The syntax controller therefore skips new viewport queries while hidden. Document parsing still
runs on load and edits. Previously scheduled background warming can continue through 120,000
character tiles because its scheduler does not check visibility. E004 suspends DOM rendering;
worker and background-query suspension require a separate lifecycle policy.

The [runner guide](../README.md#hidden-retained-views) contains the reproduction command.
