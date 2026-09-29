# E032 incremental edit-batch rendering

The inspected baseline is `64926519bfdd39f4afcfae225019a932d3e27785`. E031 had already
removed full-document materialization from the batch fallback. A sparse batch at that revision
calls `VirtualizedTextView.setText` and resets the display projection. It reads bounded viewport
text, but discards all installed tokens and collapsed folds. The before measurements record
that incorrect output explicitly; its timing is not a performance target for preserving those
projections.

## Rendering and publication contract

[`TextEditBatch`](../../packages/editor/src/textEditBatch.ts) carries the original snapshot,
the committed final snapshot, and actual applied edits in original coordinates. One ordered map
describes their offset and line changes. Equal-position insertions use their committed order
from the final snapshot. Adjacent deletions publish undo edits that replay to the same restored
snapshot, including when their inverses insert at the same offset.

[`Editor.renderSessionBatch`](../../packages/editor/src/editor/Editor.ts) projects tokens,
syntax folds, manual folds, and row decorations through that map. Unaffected ranges survive.
Crossed manual folds and tokens follow their existing invalidation rules. Batch token projection
rebuilds its index in one scan and conservatively invalidates live DOM token ranges.

[`VirtualizedTextView.applyEditBatch`](../../packages/editor/src/virtualization/virtualizedTextView.ts)
passes one transition to the existing display projection. Persistent anchors resolve collapsed
folds and inline replacements against the final snapshot. Sparse dirty intervals stay separate;
the renderer does not replace the span between the first and last edit. Layout, dependent
projections, and mounted rows update inside one atomic render. Single edits keep the existing
specialized path. Changes without edit detail still replace the snapshot and clear stale projections.

The buffer publishes committed changes in FIFO order, including to the originating view. A
reentrant listener can commit another batch without making later subscribers render events in
reverse order. The buffer adopts source selections when the edit commits, so queued source delivery cannot
overwrite a newer explicit selection. The source method's return supplies timing and
selection-sync options to the same `EditorOperation`; it does not render the same change again.
`SyntaxController` receives queued changes in order; its provider scheduler may safely coalesce
work. Document replacement and disposal still cancel old work.
Inline suggestions synchronize once at operation flush, after the input controller restores any
unaccepted words and before caret reveal and DOM selection synchronization.

View contributions publish only after atomic rendering and when rendered text matches the current
buffer. If a reentrant commit supersedes a generation before a later view receives it, that view
waits for the current generation before publishing a contribution snapshot. This keeps snapshot
text, sync revision, and selections consistent. The buffer's edit notification stream retains every commit.
Public `getTextSnapshot()` reads the current committed buffer even when a view is still rendering
an earlier queued change. `syncText()` computes its replacement against that same current buffer.
The edit contribution context exposes current text and selections. Find uses these getters for
replacement, navigation, select-all, new selection scopes, and search seeding. Match painting
and rescanning wait for a matching published view. Replacement cursor movement happens
synchronously with the command, so deferred painting cannot overwrite a later explicit selection.

The focused checks cover equal offsets, adjacent edits, line joins, Unicode boundaries, normalized
CRLF text, multi-cursor input, undo and redo, scroll position, inline replacements, injected rows,
folds, decorations, delayed syntax, and three shared views with reentrant edits. The
[`batchRendering`](../../packages/editor/test/batchRendering.test.ts),
[`batchSnapshot`](../../packages/editor/test/batchSnapshot.test.ts),
[`batchSyncText`](../../packages/editor/test/batchSyncText.test.ts), and
[`batchSyntax`](../../packages/editor/test/batchSyntax.test.ts) tests exercise the real Editor owners.
Find's [`shared-view replacement checks`](../../packages/find/test/sharedViewReplacements.test.ts)
cover commands issued during reentrant edits and deferred match painting.

## Verification scope

Targeted checks passed for Find (80 tests), core sync/snapshot behavior (37 tests), and
React/Solid integration (five tests). Typechecks passed for six affected packages; the core and
Find builds passed.
An earlier focused core command reported 227 passes and two existing documentSession failures:

- `takes back an inline suggestion offered against the document it replaced`
- `takes it back when another document is opened over the one it was offered against`

Both failed their initial ghost-text assertion before replacement and reproduced on frozen
baseline `6492651`. The CI follow-up traced them to a happy-dom fixture with zero viewport height.
That fixture now uses the existing `createVisibleEditor` helper, and both tests pass with their
original assertions. No editor runtime or benchmark source changed for that fix.

### CI follow-up source validation

The later CI run exposed redundant BiDi work in offset-only hit queries. Runtime `1d7f7cc`
keeps the existing native offset resolution and skips the caret-affinity geometry that those
queries discarded. Full position queries still resolve affinity. Both offset APIs match the
browser's native offset with zero collapsed-range reads; their regression tests fail on the
earlier runtime with two reads. The full-position query is the positive measurement control.
All 110 BiDi geometry tests and 185 view, geometry, and provisional-paint tests pass.

[Final-source evidence](e032-ci-final-validation.json.gz) records a fresh frozen package from
`1d7f7cc`, 300 source samples and 100 browser samples across all ten E032 groups, and twenty
separate diagnostic samples. The browser runner rebuilt that package before capture. Active
source, frozen source, and rebuilt output match the recorded hashes. All source diagnostics
have zero full-text reads, projection resets, and unchanged-gap reads. All browser diagnostics
have zero synchronous and deferred full-text reads and pass the text and projection gates.
The earlier paired comparisons below retain their original `fe21ebd` source identity.

The same artifact retains three before/after BiDi measurements and the local capture script.
It calls the existing 6,000-character timing helpers, each using seven alternating paired
batches. RTL batches of 100 clicks took 1.5–1.8 ms before and 1.1–1.3 ms after. These are rounded
batch medians; individual internal samples were not saved. The local drag ratio still ranges
from 5.07× to 5.47× after this change, above the unchanged 5× guard. This is a click-query fix;
it does not establish a drag improvement.

## Reproduction

The source proof drives the actual `Editor.edit` method, including session commit, projection,
selection synchronization and mounted DOM reconciliation. It uses happy-dom with a measured
800 × 800 viewport, 20 px rows, 8 px character advances, no wrapping, no syntax provider and no
plugins. Timing samples disable diagnostics; one separate instrumented sample follows each
group. Every sample checks the exact resulting document and all mounted text-node parts.

The seeded E001 fixtures are ordinary code (200 lines), a 1,048,594-code-unit long line, and
500,000 short lines (12,834,064 code units). A single edit inserts `prefix\n` at offset zero.
The sparse batch additionally inserts `\nsuffix` at the original document end. Both edits
address the original snapshot. Decorated ordinary and short-line groups install 199 and
10,000 tokens respectively, plus one collapsed fold over source rows 20 through 30, counting
from zero. Their checks
compare every retained token offset and both fold boundaries with the expected final positions.

Run the source proof from the repository root:

```sh
bun packages/editor/bench/editBatches.mjs --output /work/tmp/e032-source.json --require-incremental
```

It records full-read calls and bytes, range-read count and maximum span, reads spanning the
unchanged middle of the document, source-index scans, view entry points, projection resets,
touched index entries, materialized rows and retained cache/index counters. Candidate checks
reject any full read, projection reset, replacement entry point or unchanged-gap read. These
fixtures allow at most 16 KiB of requested snapshot text, 4,096 code units per range, 64 touched
projection entries, 64 cached rows and one final view notification. Those are work bounds for
these fixtures, not calibrated latency budgets. Source-index scans are reported separately.

The browser companion uses the built package and the existing E001 Playwright request routing.
It opens no listening server. Each sample starts with an already painted editor, performs the
same programmatic edit, then captures the final prefix row. Decorated groups additionally capture
source row 2, which contains a retained token, and require at least 20 chromatic pixels. Protocol 3
measures through completion of both required screenshots for decorated groups, or the prefix
screenshot for plain groups. This is an upper bound on paint latency, not a trusted keyboard-input
measurement. The candidate gate checks tokens and folds both synchronously and after those
screenshots. It also requires zero synchronous and zero deferred full-document reads in each
diagnostic sample. Full-document correctness reads happen after timing and diagnostics.

```sh
TMPDIR=/work/tmp node packages/editor/bench/editBatchesBrowserRunner.mjs \
  --output /work/tmp/e032-browser.json --require-incremental
```

Both runners accept `--core-directory` to compare a frozen package. Before capturing, the browser
runner rebuilds that package with `scripts/build-package.ts`, which replaces its `dist` directory.
The package must contain `src`, `package.json`, and reachable dependencies. An existing build is
not required. The runner checks that source and build-input hashes stay unchanged during the
build, then checks source and output hashes again after capture. Results record the package
manifest, build script, root TypeScript configuration, and lockfile hashes under `buildProvenance`.
The build runs outside all measured intervals. The source runner likewise rejects source changes
during capture. Baseline packages omit `--require-incremental` so their lost-token and lost-fold
verdicts remain inspectable.

Protocol 2 checked only the existence and stability of `src` and `dist`. Those checks did not
establish that the output came from the recorded source. Protocol 3 replaces that assumption with
a fresh build and also adds the deferred-read assertion. Earlier control captures below retain
their original protocol labels and fingerprints.

The browser runner's optional `--group` selects one existing group and records the filter in
the result. For example, `--group ordinary:single-edit:decorated --repetitions 100 --warmups 10`
captures the small decorated single-edit control alone. Omitting `--group` keeps all ten groups.
An unknown group fails before building or capturing results.

The original baseline can be recreated without switching the checkout:

```sh
mkdir -p /work/tmp/e032-baseline
git archive 6492651 packages/editor/src packages/editor/package.json | tar -x -C /work/tmp/e032-baseline
ln -sfn "$(pwd)/packages/editor/node_modules" /work/tmp/e032-baseline/node_modules
bun packages/editor/bench/editBatches.mjs --core-directory /work/tmp/e032-baseline/packages/editor \
  --output /work/tmp/e032-before-source.json
TMPDIR=/work/tmp node packages/editor/bench/editBatchesBrowserRunner.mjs \
  --core-directory /work/tmp/e032-baseline/packages/editor --output /work/tmp/e032-before-browser.json
```

## Results

The frozen reviewed candidate at `/work/tmp/e032-reviewed/packages/editor` passes every
source-work bound and every strengthened browser preservation check. Source capture contains
two runs of 30 measured samples after five warmups per group, or 600 measured samples per
revision. Its baseline captures are retained because the source harness is unchanged; candidate
captures use the E032 runtime at `fe21ebd`. Both browser revisions were recaptured with protocol 3,
in baseline → candidate → candidate → baseline order. Each browser run contains ten measured
samples after two warmups per group, or 200 measured samples per revision. Each run also has
one separate diagnostic sample per group. The machine is an Intel Core i7-14700K with Bun 1.4.0,
Node 26.7.0 and Chromium 148.0.7778.96.

For the 500,000-line sparse batch, both revisions avoid full-document and unchanged-gap reads.
The remaining render reset disappears. Installed tokens and collapsed folds now survive:

| 500,000-line sparse batch        | Plain before | Plain after | Decorated before | Decorated after |
| -------------------------------- | -----------: | ----------: | ---------------: | --------------: |
| Full-text reads                  |            0 |           0 |                0 |               0 |
| Projection resets                |            1 |           0 |                1 |               0 |
| Requested snapshot bytes         |        2,122 |       2,122 |            4,274 |           2,146 |
| Largest range, UTF-16 code units |           21 |          21 |               21 |              21 |
| Rows materialized during edit    |           52 |          52 |              104 |              52 |
| Projection entries touched       |            0 |           2 |                3 |               5 |
| Retained tokens                  |            0 |           0 |                0 |          10,000 |
| Retained collapsed folds         |            0 |           0 |                0 |               1 |

The candidate reads 28 source-index bytes for the two inserted strings. The long-line fixture
still reads 2,097,216 source-index bytes, matching the baseline, while its largest snapshot range
is 2,048 code units. Every decorated candidate browser sample retains correct tokens and folds
both synchronously and after the required screenshots, and records 129 chromatic pixels in
the retained-source row. Baseline decorated batches consistently lose those projections and
record zero chromatic pixels. Baseline decorated single edits retain both projections and color.
No browser diagnostic sample records a full-document read through the screenshot boundary.

These synchronous source timings show the first matched configuration run. Each cell is p50 /
p95 in milliseconds. The raw artifacts retain both runs and every sample.

| Fixture                        | Operation    |    Before, ms |     After, ms |
| ------------------------------ | ------------ | ------------: | ------------: |
| 200 lines                      | Single edit  | 0.658 / 1.109 | 0.678 / 0.966 |
| 200 lines                      | Sparse batch | 0.524 / 0.739 | 0.536 / 0.671 |
| 200 lines, tokens and fold     | Single edit  | 1.313 / 1.555 | 1.287 / 1.514 |
| 200 lines, tokens and fold     | Sparse batch | 1.267 / 4.093 | 1.094 / 2.129 |
| Long line                      | Single edit  | 0.523 / 0.598 | 0.495 / 0.625 |
| Long line                      | Sparse batch | 0.454 / 0.652 | 0.465 / 0.651 |
| 500,000 lines                  | Single edit  | 0.639 / 0.706 | 0.615 / 0.683 |
| 500,000 lines                  | Sparse batch | 0.590 / 0.707 | 0.589 / 0.695 |
| 500,000 lines, tokens and fold | Single edit  | 1.926 / 2.112 | 1.925 / 2.153 |
| 500,000 lines, tokens and fold | Sparse batch | 1.785 / 1.946 | 0.913 / 1.011 |

The 500,000-line decorated batch has candidate source medians of 0.913 and 0.876 ms, versus
1.785 and 1.779 ms before. Its preserved projections also avoid the baseline's second viewport
rebuild. The decorated single-edit medians are 1.925 and 1.982 ms versus 1.926 and 1.967 ms;
the 0.015 ms excess in the second candidate run is smaller than the baseline's 0.041 ms repeat
spread. Other single-edit source medians decrease or remain within the baseline range. The
baseline's lost projections remain a correctness failure regardless of its elapsed time.

The browser's first matched run records these commit times and screenshot bounds. Commit
columns contain p50 / p95. Screenshot columns contain p95 upper bounds, all in milliseconds.
With ten samples, the reported p95 is the largest observation in that run.

| Fixture                        | Operation    | Commit before | Commit after | Screenshot before | Screenshot after |
| ------------------------------ | ------------ | ------------: | -----------: | ----------------: | ---------------: |
| 200 lines                      | Single edit  |     0.9 / 1.2 |    0.9 / 1.4 |              48.8 |             49.1 |
| 200 lines                      | Sparse batch |     0.8 / 1.2 |    0.8 / 1.2 |              48.7 |             49.0 |
| 200 lines, tokens and fold     | Single edit  |     1.4 / 2.2 |    1.4 / 2.2 |              99.2 |             99.3 |
| 200 lines, tokens and fold     | Sparse batch |     1.9 / 3.0 |    1.2 / 1.9 |             100.1 |             99.5 |
| Long line                      | Single edit  |     1.6 / 1.8 |    1.6 / 2.7 |              86.1 |             49.2 |
| Long line                      | Sparse batch |     1.4 / 1.7 |    1.5 / 2.4 |              48.9 |             49.1 |
| 500,000 lines                  | Single edit  |     1.0 / 1.4 |    1.0 / 1.4 |              47.9 |             47.4 |
| 500,000 lines                  | Sparse batch |     0.9 / 1.5 |    0.9 / 1.5 |              48.3 |             48.3 |
| 500,000 lines, tokens and fold | Single edit  |     3.0 / 6.4 |    3.0 / 3.5 |              98.5 |             98.6 |
| 500,000 lines, tokens and fold | Sparse batch |     2.8 / 4.7 |    1.4 / 2.0 |              98.2 |             98.0 |

The small plain single-edit browser median is 0.9 ms in all four runs. The small decorated
single-edit candidate records 1.4 / 2.2 and 1.5 / 2.0 ms, versus baseline 1.4 / 2.2 and
1.3 / 2.1 ms. Ten samples cannot distinguish repeat variation from a small slowdown. The focused
protocol-3 control below examines that case with more samples. Large decorated single edits
record 3.0 / 3.5 and 3.1 / 4.4 ms, versus 3.0 / 6.4 and 3.1 / 3.5 ms. Long-line single-edit
candidate p95 is 2.7 and 1.8 ms, versus 1.8 and 2.1 ms before. These captures do not establish
consistent tail changes. Every sample, including the larger observations, remains in the artifacts.

The decorated 500,000-line batch has browser medians of 1.4 ms in both candidate runs, versus
2.8 and 2.9 ms before. Its candidate p95 values are 2.0 and 3.5 ms, versus 4.7 and 3.6 ms.
Decorated screenshot bounds are about 99 ms because both revisions include a second required
capture. Plain bounds are usually about 49 ms, with an 86.1 ms baseline long-line observation.
These bounds include validation and screenshot overhead. No timing threshold was installed
or relaxed, and the earlier protocol-1 paint bounds are not compared with these captures.

For the 500,000-line plain batch, forced-GC retained main-renderer heap is 16.88 MiB before
and 16.98 MiB after in both runs. The decorated batch retains 18.30 MiB before and
18.76 to 18.77 MiB after. The candidate keeps the 10,000 projected tokens and collapsed fold that
the baseline discards. Retained DOM nodes are 476 versus 477 for that decorated batch. These
heap figures describe the complete browser benchmark state, including fixture data and editor
history, rather than the incremental projection alone.

The reviewed candidate built-package SHA-256 is
`2a40bd71ad6935ab10c1f293191860d7301e5d94cecd39be9f938719133eec11`.
Its browser source-directory SHA-256 is
`84dc215d3831b5d96bd7ffdb20842f9d7c6b8d4ac8617eccd9c3ac866af2845d`.
The artifacts record benchmark fingerprints, frozen package paths, source/fixture hashes,
browser/runtime versions, raw samples, diagnostic counters and correctness results:

- [Source before](e032-source-before.json) and [source after](e032-source-after.json).
- [Browser before](e032-browser-before.json.gz) and [browser after](e032-browser-after.json.gz).

## Browser guard calibration

`--verify-guards` drives the real Chromium editor through a decorated single edit, then repeats
with four injected failures. It calls the same candidate gate used by timing and diagnostic
samples. Both the baseline single-edit control and the reviewed candidate produce these observations:

| Control                                         | Source-row chromatic pixels | Synchronous token/fold state | After screenshots | Full reads, synchronous / deferred | Gate result                        |
| ----------------------------------------------- | --------------------------: | ---------------------------- | ----------------- | ---------------------------------: | ---------------------------------- |
| Unmodified decorated editor                     |                         129 | Correct                      | Correct           |                              0 / 0 | Accepted                           |
| Clear browser highlight registry                |                           0 | Correct                      | Correct           |                              0 / 0 | Pixel guard rejects                |
| Clear folds on the next animation frame         |                         129 | Correct                      | Fold missing      |                              0 / 0 | Post-screenshot fold guard rejects |
| Full-document read on the next frame, plain     |                         N/A | N/A                          | N/A               |                              0 / 1 | Deferred-read guard rejects        |
| Full-document read on the next frame, decorated |                         129 | Correct                      | Correct           |                              0 / 1 | Deferred-read guard rejects        |

The registry control removes real `CSS.highlights` entries while leaving the editor's token
model intact. The delayed control calls `Editor.setSyntaxFolds([])` from the next animation
frame, after synchronous evidence was captured. The full-read controls call
`Editor.materializeFullText()` on the next animation frame before the post-edit prefix screenshot.
They record one actual deferred read while synchronous reads remain zero, and both plain and
decorated cases fail the gate. The runner also asserts post-screenshot token offsets and count.
[Raw guard evidence](e032-browser-guard-proof.json) records the
observations, benchmark fingerprint, and exact source/build hashes for both revisions.

```sh
TMPDIR=/work/tmp node packages/editor/bench/editBatchesBrowserRunner.mjs \
  --core-directory /work/tmp/e032-reviewed/packages/editor --verify-guards \
  --output /work/tmp/e032-reviewed-guard-proof.json
```

## Build correspondence control

[`editBatchesBuildProof.mjs`](../../packages/editor/bench/editBatchesBuildProof.mjs) deliberately
pairs baseline source with candidate output in a temporary package. The ordinary package loader
accepts that pair, reproducing the review finding. The control invokes the same rebuild function
as the browser runner and verifies unchanged baseline source, exact clean baseline output, and
removal of an extra stale output file. It compares clean and repaired builds at the same path
because the bundler embeds package paths in output comments. No hash normalization is used.
[Raw build evidence](e032-browser-build-proof.json) records both revisions, the mismatched pair,
the clean reference build, and the repaired build.

```sh
node packages/editor/bench/editBatchesBuildProof.mjs \
	--baseline-core-directory /work/tmp/e032-baseline/packages/editor \
	--candidate-core-directory /work/tmp/e032-reviewed/packages/editor \
	--output /work/tmp/e032-build-proof.json
```

## Small single-edit control

The protocol-3 control repeats `ordinary:single-edit:decorated` with 100 measured samples and ten
warmups per run, in baseline → candidate → candidate → baseline order. All four runs rebuild the
selected package before capturing. The [control artifact](e032-browser-small-single-control.json.gz)
retains all 400 samples, four diagnostic samples, build provenance, and benchmark fingerprints.
Each sample preserves text, tokens, folds, and 129 chromatic source-row pixels. Each diagnostic
sample records zero synchronous and zero deferred full-document reads.

| Run | Revision  | p50 | p95 | p99 | Maximum |
| --- | --------- | --: | --: | --: | ------: |
| A1  | Baseline  | 1.0 | 1.3 | 1.6 |     1.7 |
| B1  | Candidate | 1.0 | 1.6 | 1.7 |     1.7 |
| B2  | Candidate | 1.0 | 1.3 | 1.7 |     1.8 |
| A2  | Baseline  | 1.0 | 1.4 | 1.7 |     1.7 |

Times are milliseconds. Both revisions have pooled p50 of 1.0 ms, p95 of 1.4 ms, and p99 of
1.7 ms. The small median increase in the ten-sample matrix does not recur here. B1 still has a
higher p95 than either baseline run, while B2 matches A1. These repeats do not establish a
consistent slowdown or prove equal tails. The longer warmup and larger sample count make this
a separate comparison from the ten-group matrix.

```sh
e032_control() {
	TMPDIR=/work/tmp node packages/editor/bench/editBatchesBrowserRunner.mjs \
		--group ordinary:single-edit:decorated --repetitions 100 --warmups 10 "$@"
}
e032_control --core-directory /work/tmp/e032-baseline/packages/editor --output /work/tmp/e032-control-a1.json
e032_control --core-directory /work/tmp/e032-reviewed/packages/editor --output /work/tmp/e032-control-b1.json --require-incremental
e032_control --core-directory /work/tmp/e032-reviewed/packages/editor --output /work/tmp/e032-control-b2.json --require-incremental
e032_control --core-directory /work/tmp/e032-baseline/packages/editor --output /work/tmp/e032-control-a2.json
```

## Earlier large single-edit control

This historical protocol-2 capture predates the rebuild requirement and deferred-read gate.
It retains its original fingerprint and does not validate the protocol-3 changes above.
The protocol-2 ten-sample runs left a small p95 difference for the decorated 500,000-line
single edit. A separate control repeats only `short-lines:single-edit:decorated`, with 100
measured samples and ten warmups per run, in baseline → candidate → candidate → baseline order.
Both sample count and warmup changed, so its tail estimates remain separate from the ten-group
captures. The [historical control artifact](e032-browser-large-single-control.json.gz) retains all
400 samples, exact configurations, capture order, benchmark fingerprint, and source/build hashes.

| Run | Revision  | p50 | p95 | p99 | Maximum |
| --- | --------- | --: | --: | --: | ------: |
| A1  | Baseline  | 2.7 | 3.2 | 4.1 |     4.1 |
| B1  | Candidate | 2.7 | 3.0 | 3.6 |     4.1 |
| B2  | Candidate | 2.7 | 3.0 | 3.2 |     3.4 |
| A2  | Baseline  | 2.7 | 2.9 | 3.3 |     4.2 |

Times are milliseconds. Pooled medians are 2.7 ms for both revisions; pooled p95 is 3.1 ms
before and 3.0 ms after. Baseline p95 varies from 2.9 to 3.2 ms across repeats. All samples
retain correct text, token/fold projections, and 129 chromatic source-row pixels. The apparent
small-sample slowdown does not recur in this matched control. This is evidence against a
consistent candidate regression in this fixture, not proof of equal tails or a latency guarantee.
The slower observations remain in the artifact, including the 4.2 ms baseline maximum.

```sh
e032_large_control() {
  TMPDIR=/work/tmp node packages/editor/bench/editBatchesBrowserRunner.mjs \
    --group short-lines:single-edit:decorated --repetitions 100 --warmups 10 "$@"
}
e032_large_control --core-directory /work/tmp/e032-baseline/packages/editor --output /work/tmp/e032-large-a1.json
e032_large_control --core-directory /work/tmp/e032-reviewed/packages/editor --output /work/tmp/e032-large-b1.json --require-incremental
e032_large_control --core-directory /work/tmp/e032-reviewed/packages/editor --output /work/tmp/e032-large-b2.json --require-incremental
e032_large_control --core-directory /work/tmp/e032-baseline/packages/editor --output /work/tmp/e032-large-a2.json
```

## Earlier single-edit control

Before the review fixes, the small decorated browser group's higher p95 in the initial
ten-sample runs prompted a separate matched control. This historical capture uses browser
protocol 1 and the earlier `/work/tmp/e032-final` candidate; it does not validate the final
reviewed source or protocol 2 highlighted-source paint checks. The sequence is baseline, candidate, candidate, baseline, with
100 measured samples and ten warmups in each run. It uses only
`ordinary:single-edit:decorated`. The larger sample count and longer warmup change the tail
estimate, so these values remain separate from the earlier ten-group captures.

All 400 measured samples record correct text and token/fold projections. Their pixel check
covers the prefix row only. The
[ABBA control artifact](e032-browser-single-control.json.gz) retains every sample, exact
configuration, filter, source and build hashes, capture order, and pooled summaries.
Commit times below are milliseconds.

| Run | Revision  | p50 | p95 | p99 | Maximum |
| --- | --------- | --: | --: | --: | ------: |
| A1  | Baseline  | 1.0 | 1.2 | 1.6 |     1.8 |
| B1  | Candidate | 1.0 | 1.2 | 1.4 |     1.6 |
| B2  | Candidate | 1.1 | 1.9 | 3.5 |     5.4 |
| A2  | Baseline  | 1.0 | 1.6 | 1.7 |     1.8 |

Pooled medians are both 1.0 ms. Pooled p95 is 1.4 ms for the baseline and 1.7 ms for the
candidate. That 0.3 ms difference is smaller than the 0.4 ms change between the baseline
runs' p95 values, and B1 matches A1. This repeat-control comparison does not establish a
consistent candidate slowdown. B2's unexplained spikes remain in the results, including its
5.4 ms maximum. The measurements do not prove equal tails or a calibrated latency guarantee.

The current small control above repeats this group with protocol 3 and the reviewed candidate.
Protocol 3 has a later decorated screenshot boundary, so its paint bounds cannot be compared
directly with these historical values.

## Measurement limits

The source proof measures synchronous model and DOM work; happy-dom cannot measure browser
layout or paint. Its retained row text and index counters are payload estimates, not heap sizes.
The browser proof records Chromium main-renderer heap bytes and DOM counters after forced GC,
both with the final editor retained and after disposal. Paint upper bounds include projection
inspection, browser automation, and screenshot work. They do not identify the first painted
frame; decorated groups wait for two screenshots. The harness retains fixture/source data while
the editor is live, and clears its fixture/projection references on disposal. Browser process,
GPU and worker memory are outside those numbers.

The browser diagnostics separate synchronous editing from deferred events through completion
of the required screenshots. No syntax provider or plugin runs in this configuration, so these results do not
measure syntax throughput, indentation-fold fallback, injected text or wrapped-layout rebuilds.
Token projection still scans the installed token list. The pathological long-line edit also
rebuilds source measurement metadata; the baseline records about 2 MiB of source-index reads
even though its requested text ranges remain bounded. These costs must remain visible when
interpreting zero full-text reads.
