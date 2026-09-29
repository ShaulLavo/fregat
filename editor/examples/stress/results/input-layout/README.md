# Input layout comparison

The controller updates hidden-input content before caret geometry, then positions the input with
a transform. The unchanged baseline and candidate were isolated from the same working tree.
The final runs used one harness with the selected core package's exports.

The long-line typing trace contains 24 keystrokes across two visible views:

| Layout callsite       | Before | After |
| --------------------- | -----: | ----: |
| Row geometry          |     48 |    24 |
| Focused input content |     24 |    24 |
| Total                 |     72 |    48 |

The input-content layouts now include the source view's text changes. Raw trace counts match
Chromium's `LayoutCount` in both runs. Translation alone retained 72 layouts. Refreshing content
first, with the old position writes, left 24 additional layouts without JavaScript stacks.

Uninstrumented timing ran in before/after/after/before order, with three measured repetitions per
group and one warmup in each run. The table pools six measured repetitions per version. All groups
use multiple views. Values are dispatch p95 in milliseconds, using the nearest-rank percentile.

| Workload         | Before | After |
| ---------------- | -----: | ----: |
| Ordinary typing  |    1.6 |   1.8 |
| Long-line typing |    5.0 |   2.7 |
| Long-line paste  |    7.4 |   8.3 |
| Short-line paste |    5.7 |   5.7 |

This is a targeted layout reduction, with mixed latency results outside long-line typing.
These focused artifacts are not a full budget acceptance run. Thresholds remain unchanged.

[comparison.json](comparison.json) contains the source hashes, raw-artifact checksums, percentile
distributions, trace summaries, and isolated experiment counts. The compressed timing results
contain all 768 timing events and their correctness, rendering, and cleanup observations. Two
trace runs add 48 events, and the composition/undo probe adds 36. All 852 measured events passed.
The exploratory CPU-sampled metrics are retained separately from uninstrumented timing.
The [build proof](build-proof.json) verifies all 144 mapped core sources against each package build
and the selected core in the saved browser bundles.

The [runner instructions](../../README.md#native-input-layout-profiles) describe `profile:input`,
including frozen-core selection and trace versus timing modes. Raw traces and their summaries
are saved here; matching readable builds and CPU profiles remain in
`/work/tmp/editor-layout/final-trace-before` and `/work/tmp/editor-layout/final-trace-after`.
