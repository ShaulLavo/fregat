# Long-line performance fixes

All four repeated-scan paths from [the CPU investigation](long-line-profile.md) are fixed.
On this machine, the one-megabyte line's warm key-to-edit p95 fell from **30.4 ms to 2.5 ms**.
The 100 insert/delete cycles across two visible views and one hidden view fell from **10,577 ms
to 774 ms** at p95.

## Before and after

Both normal production builds ran on September 5, 2026 with Chromium 148.0.7778.96, Node 26.7.0,
and an i7-14700K. Each recorded three cold and three warm repetitions, with one discarded warmup
for each warm scenario. Each typing repetition used 40 trusted keys. Fixture hashes, workload
options, browser, hardware, and runtime match exactly.

The [baseline](long-line-fix-before.json) and [candidate](long-line-fix-after.json) each contain
108 passing samples. Their commit, dirty-tree source hash, raw timings, correctness observations,
and memory readings are retained. The [comparison](long-line-fix-comparison.json) covers every
latency metric; the table selects warm p95 values.

| Fixture   | Measurement              |      Before |      After |
| --------- | ------------------------ | ----------: | ---------: |
| Long line | Key to applied edit      |     30.4 ms |     2.5 ms |
| Long line | 100 insert/delete cycles | 10,576.9 ms |   774.0 ms |
| Long line | Attach                   |     36.6 ms |    11.1 ms |
| Ordinary  | Key to applied edit      |      1.1 ms |     1.0 ms |
| Ordinary  | 100 insert/delete cycles |    104.8 ms |    99.2 ms |
| Ordinary  | Attach                   |      2.5 ms |     2.7 ms |
| Unicode   | Key to applied edit      |      2.7 ms |     2.6 ms |
| Unicode   | 100 insert/delete cycles |  1,416.2 ms | 1,159.9 ms |
| Unicode   | Attach                   |      7.2 ms |     8.3 ms |

Long-line typing p50 fell from 28.2 ms to 1.1 ms. The animation-frame callback p95 fell from
30.6 ms to 15.5 ms; the applied-edit measurement does not measure painted pixels. These are local
observations, not CI limits. The earlier [calibration remains provisional](README.md).

## What changed

- Immutable source buffers own 256-unit summary trees for ASCII/RTL classification, tabs, UTF-16
  columns, and estimated Unicode widths. Views share snapshot-range handles. Unchanged source
  trees survive edits, undo, and redo; exact source text guards against buffer-ID reuse on an undo
  branch. Short display rows do not allocate an index.
- Prefix queries and inverse column lookups descend summaries and inspect at most one partial
  block. Uniform spans use arithmetic. Tab transforms compose at piece boundaries, including
  surrogate pairs split between pieces. Each cache retains at most four tab-size roots; text
  without tabs shares one source root. Live handles can retain an evicted root.
- Consecutive calculated boundaries advance through the mounted chunk once. Unwrapped display
  row construction no longer calculates an unused full-line width.
- Whitespace bounds are computed only for modes that use them. Boundary/trailing modes scan
  inward from the ends.
- Long lines now use the existing same-line edit path. Their measurement handles update with
  the edited snapshot instead of rebuilding the display model after every key.
- A browser regression exposed CSS tab-stop drift after a horizontal spacer. Tabbed rows now
  use existing on-demand DOM geometry, keeping caret placement and hit testing on the rendered
  text while the summary index supplies offscreen estimates.

## Verification and remaining costs

450 focused tests passed: 129 real-browser checks, 201 display/geometry/whitespace checks,
116 storage/session checks, five index tests, and nine stress-runner tests. The new browser
coverage edits near the start, middle, and end of a one-megabyte line in two tab sizes; it checks
DOM caret rectangles, hit testing, undo/redo, line splitting/joining, and wrapping. Index tests
bound character reads as line length grows and verify shared-source reuse and tab-cache behavior.
An independent deterministic probe also passed 1,445,808 scalar-equivalence comparisons.

Another [24 normal-build samples](long-line-fix-other-fixtures.json) passed for 500,000 short
lines and mixed line endings. Typecheck and formatting pass. Lint reports only the two existing
`packedTokens.ts` warnings; targeted Knip reports existing unrelated findings and no new exports.

The index trades live memory for less repeated computation. After churn and forced GC, warm
long-line live heap peaked at **13.34 MiB**, versus **6.51 MiB** before. After disposal, it peaked
at **4.46 MiB**, versus **4.53 MiB** before. Every recorded long-line typing/churn sample released
all tracked editor and buffer objects. These are CDP JavaScript heap readings, not process RSS.

The [follow-up CPU summary](long-line-fix-profile-summary.json) and
[profile run](long-line-fix-profile-result.json) are separate from normal timing results.
The dominant remaining work is text-node creation, browser rectangle/layout reads, and garbage
collection. Further reduction would require changing mounted-text construction and allocation;
the original full-line classifier, width, and whitespace scans are no longer dominant.
Warm active typing samples fell from 1,167.5 ms in the original profile to 101.1 ms; churn fell
from 10,920.2 ms to 815.7 ms. The final eight traces and matching source maps remain in
`/work/tmp/editor-long-line-fixed-profile-retry`. A prior capture was rejected because Chromium
returned one negative sampling interval; the replacement capture passed the summary validator.

## Reproduce

From the repository root:

```sh
bun run bench:stress --fixtures ordinary,long-line,unicode --repetitions 3 --output /work/tmp/editor-long-line-candidate.json
node examples/stress/test/summarize-change.mjs examples/stress/results/long-line-fix-before.json /work/tmp/editor-long-line-candidate.json
bun run --cwd packages/editor test --project node src/textMeasurements.test.ts
bun run --cwd packages/editor test --project browser test/longLineMeasurements.browser.test.ts
```

The comparison command validates every sample and rejects differing fixture hashes, workloads,
build modes, browsers, hardware, or runtimes before printing measured ratios. It does not impose
an uncalibrated pass/fail timing threshold. See [CPU profiling](../README.md#cpu-profiling) to
capture another profile; use a fresh directory each time.
