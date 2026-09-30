# Input latency reference

The E002 browser runs use Chromium 148.0.7778.96 on Linux 7.1.9, an Intel i7-14700K,
28 logical CPUs and 31.1 GiB RAM, with Node 26.7.0. They consume the built Editor package
and serve the standalone fixture through Playwright routing without a listening socket.
The fixture seed is 60061. The result files record exact source hashes, options, and raw samples.

The current [replay report](verification.json) **passes candidate acceptance** across
10,488 measured input events. It records 0 failed blocking limits
out of 108 and one screenshot timing advisory out of 36. The independent
unchanged reference holdout passes the blocking limits. The real 20 ms delayed control exceeds
dispatch limits in all 36 fixture, view, and input groups. Rendering correctness, diagnostic
correlation, cleanup, and bounded source indexing pass.

The controls and reference holdout retain the frozen core from before the geometry/chunk optimization:
`8b13a7f4fbe7d0c7500ca7a4e34e99fbbd51b9f3eadd1c38951ae12b37f949e3`.
The optimized candidate, delayed control, and diagnostic run share source hash
`9f144217a3e579d909da58619e06092fd199f95f7ab0f96a5f1cda76ef75c9fc`.
These hashes identify source at measurement time. The comparison-only range rule was implemented
after collection; the measured editor code and input delivery stayed unchanged.
These are local limits for the recorded hardware and workload, with no universal 4 ms budget or
unattended CI threshold.

## Gate calibration and history

The run order was control 1, candidate, control 2, initial reference holdout, control 3,
delayed candidate, diagnostic candidate, then a new validation holdout. The task
collected its runs serially; source drift in the shared checkout required the isolated reruns below.
The first holdout exposed three false failures in the
original threshold formula and is retained as `calibration-holdout.json.gz`.
The three controls and holdout used `--core-directory` to serve the physically preserved old core;
the candidate was excluded from calibration. The revised formula and all resulting limits were
recorded in [the investigation](calibration-investigation.json) before the new holdout started.
The new holdout passed the predeclared rule, but unrelated checkout edits changed its source
fingerprint and the diagnostic run's fingerprint. Those artifacts are preserved as `source-drift-*`.
The diagnostic and final validation holdout were repeated from an isolated snapshot whose hashes
exactly match the original candidate and controls. No timing result was used to select those reruns.

The revised formula is largest control p95 plus the maximum of three times the control-p95
range, three times the control-p50 range, and the largest within-control max-minus-min range.
The previous within-run term covered only median to p95, undercounting observed event and frame
phase variation. Limits now use the full observed range, with no candidate-derived constants.
This remains an empirical local envelope, not a statistical confidence bound.
Comparison tolerates only 0.000001 ms of floating-point error and preserves raw durations.
The 108 applied/dispatch/frame groups block acceptance. The 36 screenshot-completion upper bounds
are advisory because they include automation and capture overhead. Exact rendered text, visible
edits, changed screenshot pixels, and revision correctness remain mandatory.

The current screenshot advisories are:

- `ordinary/multiple/composition-commit/burstToPaintUpperBound`: 131.1 ms versus 120.2 ms.

[The previous failed review report and its raw controls](previous-review/README.md) are preserved.
Its six strict timing failures comprised four screenshot upper bounds and two ordinary typing
metrics. Making screenshot timing advisory alone left those two typing failures in place. The revised
range rule uses fresh unchanged controls; it does not rewrite the historical measurements.

## Dispatch latency before and after this optimization

Values are p95 milliseconds from event capture through handler completion. Before is the independent
frozen-core holdout; after is the optimized candidate. Both have three measured repetitions and
one discarded warmup per scenario. Multiple views means two visible views and one hidden view over
the same document. [All distributions and control p95 values](optimization-comparison.json) are retained.

| Fixture             | Views    | Typing before | Typing after | Paste before | Paste after |
| ------------------- | -------- | ------------: | -----------: | -----------: | ----------: |
| Ordinary            | Single   |           2.2 |          1.1 |          6.4 |         6.2 |
| Ordinary            | Multiple |           1.7 |          1.6 |          7.5 |         8.3 |
| 500,000 short lines | Single   |           0.9 |          1.0 |          5.3 |         5.4 |
| 500,000 short lines | Multiple |           1.8 |          1.6 |          6.5 |         5.5 |
| One-megabyte line   | Single   |           2.2 |          1.8 |          8.0 |         5.4 |
| One-megabyte line   | Multiple |           4.1 |          2.7 |          9.8 |         6.9 |

The long-line multiple-view p95 improves from 4.1 to 2.7 ms for typing and from 9.8 to 6.9 ms for paste.
Across the three calibration runs, reference p95 ranges provide a separate check on variation.
Ordinary typing medians are unchanged; this run does not establish an ordinary-typing speedup.
Some small-workload tails increase, as the table shows. Acceptance compares every blocking group
against the reference-derived limits.

These measurements isolate mounted geometry capacity and chunk reuse. The older `before.json.gz`
precedes the separate source-range indexing fix and is retained as E002 history. Its 151.8 ms
multiple-view short-line paste p95 must not be attributed to this optimization.

## Allocation and profiling evidence

One-megabyte ASCII, Unicode, and tab regression cases reduced Float64 geometry-buffer allocation
from about 16 MiB to below 138 KB per measured geometry build. Capacity now follows mounted text
parts, control/widget endpoints, and chunk gaps. Same-window simple edits preserve chunk spans and
text nodes; changed complex text uses the existing part renderer. Window and render-mode changes
keep their rebuild behavior.

[The profile record](optimization-profile.json) contains raw CDP metrics, source-tree identities,
and medians from three profiled repetitions. Long-line multiple-view typing script time fell from
48.37 to 40.79 ms per 24-key batch; paste fell from 43.75 to 36.52 ms per eight-paste batch.
These profiles identify reduced work; they are separate from latency acceptance measurements.
`Nodes` and `LayoutObjects` are net counter changes affected by garbage collection, not allocation
counts. They establish neither allocation volume nor a retained-memory trend.

Typing still triggers 73 layout passes per 24-key batch, and paste triggers 44 per eight-paste
batch. Coordinating DOM writes and geometry reads across shared views is the next measured
structural opportunity. Snapshot-backed display rows would separately remove whole-row string
materialization; these changes do not implement either redesign.

In both diagnostic short-line paste cases, the first Unicode paste indexes 256 UTF-16 units of the
12,834,064-unit original source. The structural proof limits that work to 512 units independently
of elapsed time. Diagnostic-enabled versus production distributions remain in `verification.json`;
their differences include run variation and do not isolate instrumentation overhead.

## Files and reproduction

- `control-1.json.gz`, `control-2.json.gz`, and `control-3.json.gz` contain unchanged frozen-core controls.
- `rerun.json.gz` is the new independent frozen-core validation holdout; `candidate.json.gz` is the optimized build.
- `calibration-holdout.json.gz` and `calibration-investigation.json` preserve the initial false failures and the
  revised rule declared before collecting the new holdout.
- `delayed.json.gz` inserts a real 20 ms pause inside each input operation and must fail all dispatch groups.
- `diagnostic.json.gz` enables the existing sink for one repetition and retains raw operation/view identities.
- `calibration.json.gz` contains raw controls and derived limits; `verification.json` records the acceptance proof.
- `optimization-comparison.json` compares the holdout and candidate with equal sample counts.
- `optimization-profile.json` records the separate before/after profiling observations.
- `isolation-proof.json` records exact source hashes, runtime checksums, and source-map matches
  for the rebuilt isolated packages.
- `source-drift-diagnostic.json.gz` and `source-drift-validation-holdout.json.gz` preserve the runs
  excluded because concurrent checkout edits changed their source fingerprints.
- `previous-review/` preserves the previous failed review candidate, controls, and report.
- `before.json.gz` and `pilot-after.json.gz` preserve the original source-index investigation.
- `failed-first-candidate.json.gz`, `failed-first-comparison.json.gz`, and the two `paired-*-investigation.json`
  files retain earlier failures and focused investigations, described in the historical reference.

The reference reports warm runtime behavior. Each repetition opens a fresh document; it does not
reuse the preceding repetition's buffer or indexes. Ordinary files enable Tree-sitter; the large
fixtures isolate core editing. Paste inserts eight 1,536-unit Unicode payloads, separately from
24-key typing/repeat bursts, 12 composition updates or commits, and 12 undo operations.

Text, cursor offsets, revisions, and mounted text must match in every view. The hidden view is
revealed after timing to verify catch-up. Frame callbacks are rendering opportunities, not pixel
timestamps. Composition commits use explicitly labeled CDP emulation; other measured native events
must be trusted. Listener counts must not grow, hosts and pending frames must clear, and scenario
contexts must close. Forced-GC WeakRef observations do not claim a collection deadline.

Reproduce the complete evidence check from the repository root:

```sh
bun run --cwd examples/stress input:proof
```

See the [runner instructions](../../README.md#input-latency-budgets) for collecting new runs and
[measurement reference](../../../../docs/performance/input-latency.md) for timing boundaries.
