# E034 snapshot indentation folds

E034 is completed by user acceptance on 2026-09-13. The user accepted the implementation with
the measured performance limitations below, including the unresolved warm prepared input result.
Its p95 is 0.9 ms against 1.0 ms for the pooled controls, with an upper difference bound of +0.1 ms.
Seven of eight primary checks pass. The recorded statistical verdict and thresholds remain unchanged.

The [completion results](#completion-validation) cover all 72 captures, separate preparation costs,
and diagnostic evidence. The execution plan has been removed. Earlier measurements below cover
the original `33e632a` implementation and review
corrections. Those measurements and the first isolated study remain separate from the confirmation.

[Archive replay](e034-completion-replay.json) verified all 939 manifest file hashes and reproduced
both study reports and the direct-input profile analysis byte for byte.

Snapshot indexing removes repeated whole-document scans from fallback folding.
The E034 browser comparison measures fallback folding on the same 500,000-line document before
and after the snapshot index. The baseline core is commit
`88cd55da61e895542cfe248082221cf992be74e5`, exported with `git archive` and rebuilt under
`/work/tmp/editor-e034/baseline-88cd55d-core`. The archive excludes the uncommitted E034 work.
The unrelated LSP changes do not enter this core build.

Earlier pilot runs used `30ae9ec`. Two concurrent viewport fixes, `b4ddbc3` and `6244aca`, then
changed when attachment measures and renders the initial visible rows. Comparing those pilots
with the later candidate would attribute viewport work to E034. The final comparison repeats
the baseline and control at `88cd55d`, which includes both fixes. The earlier runs remain under
`/work/tmp/editor-e034/historical-30ae9` and are excluded from the results below.

The runner is [`examples/stress/first-paint.mjs`](../../examples/stress/first-paint.mjs).
It builds against the selected core package and serves production assets through Playwright
request interception. It starts no server. Each result records source, core build, and browser
bundle hashes. The unchanged control uses the same frozen core.

## Folding contract

[`IndentationFoldIndex`](../../packages/editor/src/editor/indentationFoldIndex.ts) identifies a
generation by its immutable snapshot, language folding rules, and effective tab size. A numeric
revision or document ID alone cannot identify an undo branch. It stores 128-line immutable fact
blocks with stable line references and aggregate lengths. Persistent checkpoints preserve both
the bottom-up folding state and crossing-range rejection state. An edit reuses topology when its
blankness, indentation, and marker classification are unchanged. Semantic changes propagate until
the complete checkpoint state converges.

[`EditorFallbackFoldController`](../../packages/editor/src/editor/fallbackFoldController.ts) owns
the current index and one in-progress generation. Prepared documents own their index until transfer
or disposal. Replacement and cancellation discard unfinished work. Collapse intent stays in each
view's [`EditorFoldState`](../../packages/editor/src/editor/foldState.ts), separate from immutable
facts and topology.

With no structural session, fallback records `no-language` or `no-session`. Unsupported folding
and a terminal structural error also select it. Pending and supported structural sessions suppress
fallback, including supported empty results and incomplete viewport coverage. Explicit synchronous fold commands
finish any work needed for an exact answer. They can demand a complete cold discovery before
scheduled work has finished.

[`prepared.fallbackReady`](../../packages/editor/src/editor/preparedDocument.ts) resolves `true`
when the initial fallback index completes. Before completion, structural takeover, incomplete
transfer, or disposal resolves it `false`. Reading the promise does not force work. Ready compatible
metadata installs atomically. Incomplete metadata transfers its remaining work for deferred completion, and a
structural owner can discard optional fallback work.

Internal `headers`, `ranges`, and `ancestors` queries supply the view and fold commands without
flattening every fold. Explicit complete traversal serves fold-all and related commands. Public
marker arrays remain available through lazy queries. Updating marker coordinates without a changed
fold map refreshes mounted markers and preserves the editor's existing text render.
During a single edit, the view advances text layout, publishes the matching fallback state, and
paints text and markers together. A same-line edit preserves the in-place text patch and token
ordering. Publication skips a separate marker pass while that edit is painting; a changed fold
map queues the normal render.

## Original implementation measurements

`--fallback-cases` adds fixed indentation and explicit regions to the existing seeded E003
fixture. Top-level sections start every 5,000 rows. Nested headers occur every 500 rows, and
region comments span each section. The generator preserves exactly 500,000 rows and records
the fixture's SHA-256, `1e1bd3e405a41e11241ad87baacf631e877dccdef975eef36ee9aa59981ce3c9`.
The document has 14,829,434 UTF-16 code units and 1,200 folds. Browser runs use no language or
syntax provider, fixed tab size 4,
and a 900 by 320 pixel editor in a 1,000 by 1,000 pixel viewport.

Each production run records five cold samples and five warm samples for direct attachment
and prepared attachment. Each warm group first opens one unrecorded document. Direct and
prepared results remain separate because preparation happens before the attachment timer.
The final three production runs use `taskset -c 8,10,12,14`, four physical performance cores.
The runner records the inherited CPU affinity, and the comparison rejects mismatched affinities.

Unrestricted runs showed transient slowdowns in buffer creation, construction, attachment, and
input in both the unchanged control and candidate. Those runs preceded the final removal of unused
caret lookups from fold publication. They are retained as supplementary evidence:
[baseline](e034-unpinned-before.json.gz), [control](e034-unpinned-control.json.gz),
[candidate](e034-unpinned-after.json.gz), [repeated control](e034-unpinned-control-repeat.json.gz),
and [repeated candidate](e034-unpinned-after-repeat.json.gz). No individual samples were removed.
The final comparison reruns all three variants with the same affinity.
Separate host traces record load and CPU pressure every two seconds during the
[unrestricted repeat](e034-host-load-repeat.jsonl.gz) and
[initial pinned batch](e034-host-load-pinned.jsonl.gz), outside the application's timed paths.

The measurements have distinct boundaries.

- `textCallback` ends at the public initial text paint event. The screenshot completion time
  is a separate upper bound for visible text, including browser automation and screenshot work.
- `preparation` includes buffer creation and awaits `prepared.fallbackReady` before attachment.
  It reports preparation wall time. The baseline prepares synchronously and has no promise,
  so the same `await` completes immediately. Direct attachment reports zero preparation and
  includes buffer creation in its opening time.
- The first fold command runs after first text. It must synchronously discover any unfinished
  fallback work. The browser verifies that folding row 0 hides row 1 and reveals row 5,000.
- Each of three input bursts types twelve `x` characters inside an existing nested header,
  using real keyboard events 16 ms apart. `inputApplied` measures `beforeinput` to `onChange`.
  `inputFrame` measures `beforeinput` to the next animation frame requested from `onChange`.
  The browser waits 600 ms after each burst for deferred work.
- Fold-all runs after the bursts. Its displayed result must retain the same outer boundary.
  Unfold-all restores the text before the final screenshot.
- Heap measurements follow forced garbage collection, once after initial fold discovery and
  once after the input bursts. `Runtime.getHeapUsage` measures the browser main-thread JavaScript
  heap. Backing storage for arrays and external strings is reported separately; fixture strings can
  move between those categories. Neither number isolates the index. Index diagnostic byte estimates
  are reported separately.

The exact final text comparison runs after the measured input and commands. That check deliberately
materializes the document. It is benchmark verification, and is excluded from fallback-attributed
materializations. The benchmark also reconstructs its expected source string once after each of
the three bursts, outside the measured input intervals. These reference strings are separate from
index work. Disposal checks use weak references for the editor, buffer, and prepared document
after a worker idle fence and forced garbage collection.

Production timings disable the performance sink. Separate diagnostic runs retain every
`editor.fallbackFoldRanges` work summary and fallback-selection event. Baseline events contain
the old scanner's duration. Candidate summaries report snapshot reads, rebuilt and reused blocks,
propagation, fold count, retained bytes, materializations, and completion outcome.
Counters and `generationDurationMs` cover an index generation. Live `durationMs` covers only the
controller's work on that generation. A prepared adoption can therefore report historical reads
with zero controller duration. `counterScope` and `durationScope` label those boundaries. Preparation
and adoption events must not be summed as separate reads of the same generation.

## Reproduction

From the repository root, with workspace dependencies and the gutter package already built,
create the frozen core build:

```sh
mkdir -p /work/tmp/editor-e034/baseline-88cd55d-core
git archive 88cd55da61e895542cfe248082221cf992be74e5 \
	packages/editor/src packages/editor/package.json packages/editor/tsconfig.json |
	tar -x --strip-components=2 -C /work/tmp/editor-e034/baseline-88cd55d-core
ln -s "$PWD/packages/editor/node_modules" /work/tmp/editor-e034/baseline-88cd55d-core/node_modules
bun scripts/build-package.ts /work/tmp/editor-e034/baseline-88cd55d-core
```

The matched production command is:

```sh
taskset -c 8,10,12,14 bun run --cwd examples/stress bench:first-paint \
	--core-directory /work/tmp/editor-e034/baseline-88cd55d-core \
	--repetitions 5 --fixtures short-lines --plugins none --modes direct,prepared \
	--fallback-cases --output /work/tmp/editor-e034/baseline.json
```

The unchanged control changes only the output to `control.json`. The candidate omits
`--core-directory` and writes `candidate.json`. Diagnostic runs add `--diagnostics`, use one
repetition, omit `taskset`, and write separate files. `--fold-gutter` enables the built gutter package for
marker screenshots. Production runs omit the gutter so commands remain covered when no
gutter is installed.

The summary command is:

```sh
node examples/stress/fallback-compare.mjs \
	docs/performance/e034-before.json.gz \
	docs/performance/e034-control.json.gz \
	docs/performance/e034-after.json.gz
```

The summary rejects mismatched fixtures and incomplete samples. Percentiles use nearest-rank
selection. Each first-paint group has five samples, so its p95 is its maximum. Each input group
has 180 events. These are local observations, not a hardware-independent latency budget.

The browser is Chromium 153.0.8010.12 on Linux, with an Intel Core i7-14700K and 28 logical
CPUs. The machine has 33,369,657,344 bytes of RAM.

## Production latency and memory

The pinned baseline and control have identical source, core build, and browser bundle hashes.
Their core build hash starts `635937030cc7`; the candidate's starts `3ad3f4e5121b`.
Full identities and distributions are in [the comparison](e034-comparison.json), generated from
[baseline](e034-before.json.gz), [control](e034-control.json.gz), and [candidate](e034-after.json.gz).

Each cell below shows the text callback p95 / screenshot completion p95, in milliseconds.

| Attachment     |     Baseline |      Control |    Candidate |
| -------------- | -----------: | -----------: | -----------: |
| Direct, cold   | 56.0 / 128.7 | 58.5 / 131.6 | 59.2 / 136.1 |
| Direct, warm   | 38.9 / 100.7 | 38.7 / 105.6 | 38.8 / 106.9 |
| Prepared, cold |  18.9 / 94.1 |  18.4 / 92.8 |  17.7 / 91.4 |
| Prepared, warm |   8.1 / 72.8 |   8.1 / 76.5 |   8.8 / 74.4 |

Each input cell shows `beforeinput` to `onChange` p95 / next animation frame p95, in milliseconds.

| Attachment     |   Baseline |    Control |  Candidate |
| -------------- | ---------: | ---------: | ---------: |
| Direct, cold   | 1.5 / 10.2 | 1.6 / 12.6 | 1.5 / 15.0 |
| Direct, warm   | 1.0 / 13.7 | 1.0 / 13.3 |  1.1 / 9.9 |
| Prepared, cold | 1.5 / 10.6 | 1.4 / 10.7 | 1.5 / 14.4 |
| Prepared, warm | 0.9 / 13.1 | 0.9 / 12.7 | 0.9 / 10.1 |

Three candidate input application p95 values match the baseline. Warm direct input is 0.1 ms
higher, one observed timer increment. Callback p95 differences from the unchanged control range
from 0.7 ms lower to 0.7 ms higher. Five samples per attachment group cannot establish a small
latency shift or statistical equivalence. All candidate input-to-frame p95 values remain below
16.7 ms; this interval includes the wait for the next frame boundary. The evidence establishes
reduced repeated work, and does not claim a first-text or input speedup.

The following cells show median preparation / first fold command / fold-all, in milliseconds.
Preparation includes the buffer and completes before the attachment timer begins.

| Attachment     |          Baseline |           Control |         Candidate |
| -------------- | ----------------: | ----------------: | ----------------: |
| Direct, cold   |    0 / 81.7 / 6.2 |    0 / 82.4 / 6.2 |   0 / 124.6 / 8.4 |
| Direct, warm   |    0 / 58.2 / 4.8 |    0 / 53.6 / 4.8 |   0 / 116.7 / 6.6 |
| Prepared, cold | 119.1 / 2.2 / 6.1 | 119.3 / 2.2 / 6.2 | 181.6 / 1.5 / 9.0 |
| Prepared, warm |  83.2 / 1.2 / 4.8 |  84.9 / 1.2 / 4.8 | 156.4 / 0.9 / 6.5 |

Cold discovery and fold-all cost more. Ready preparation moves discovery before attachment and
reduces the first command's remaining work. It does not remove that preparation cost.

The memory cells show median initial / edited values in MiB, calculated per sample as JavaScript
`usedSize + backingStorageSize` after forced collection. This combines the categories affected by
external-string representation while preserving their separate values in the raw artifacts.

| Attachment     |      Baseline |       Control |     Candidate |
| -------------- | ------------: | ------------: | ------------: |
| Direct, cold   | 22.16 / 51.40 | 22.16 / 51.40 | 39.84 / 55.07 |
| Direct, warm   | 23.40 / 51.84 | 23.39 / 51.83 | 41.13 / 55.51 |
| Prepared, cold | 24.41 / 53.71 | 24.41 / 53.71 | 42.18 / 57.39 |
| Prepared, warm | 25.68 / 54.17 | 25.70 / 54.18 | 43.50 / 57.84 |

These process-level observations include benchmark reference strings and editor storage. They
show the retained-memory tradeoff without attributing the whole difference to index structures.

## Browser work and visible result

The diagnostic runs exercise the same three input bursts with the fold gutter enabled. The old
scanner performs three complete scans: 1,500,000 rows and 44,488,374 code units. Each scan also
requests an uncached whole-document string. The candidate performs 36 updates reading 36 rows
and 1,458 code units. Every update rebuilds one fact block, reuses 3,906 blocks, and performs zero
topology propagation. Its fallback summaries report zero materializations. The only candidate
whole-text events are the initial cached fixture read and the final verification read.
The 36 updates total 0.8–1.3 ms of index work per diagnostic sample, with no individual update
step exceeding 0.3 ms.

Prepared adoption records the completed generation's 500,000 historical rows with zero controller
work. Its separate preparation event accounts for building those facts. Explicit cold fold commands
are unrestricted synchronous demand, so their diagnostic maximum step is not a background slice.

A separate background control uses the original flat 500,000-line E003 fixture, with 12,834,064
code units and no folds. Baseline cold/warm scans take 41.0/36.8 ms in one task and complete
190.2/186.7 ms after attachment. Candidate cold/warm discovery uses 83.3/95.8 ms of controller
work and completes 242.3/255.0 ms after attachment. The largest candidate background steps are
2.2/4.5 ms. Directory construction and aggregate-tree traversal stay within 1,024 metadata
operations per step. Browser `scheduler.postTask` yields between steps; the timer fallback is used
when that API is unavailable.

The browser checks the outer fold's hidden rows and the exact final text. All samples release their
editor, buffer, and prepared-document roots after disposal. The saved screenshot shows the actual
gutter markers and edited nested header after unfolding:

![Fallback fold markers after thirty-six typed characters](e034-folds.png)

Diagnostic artifacts: [before](e034-diagnostic-before.json.gz),
[after](e034-diagnostic-after.json.gz), [background before](e034-background-before.json.gz),
and [background after](e034-background-after.json.gz). These runs do not enter production latency
percentiles.

## Index work

[`packages/editor/bench/indentationFolds.ts`](../../packages/editor/bench/indentationFolds.ts)
compares the frozen test oracle with the index on the same indented fixture. It runs under Bun,
separately from the browser. The oracle runs twice before its five recorded samples. Cold index
runs use the same 1,024-row and 32,768-code-unit slice limits as the editor's background work.
Work time sums elapsed time inside synchronous steps. It excludes gaps between steps, but includes
garbage collection and thread descheduling; it is not a hardware CPU-time counter.

| Operation                     | Median work time | Median wall time |
| ----------------------------- | ---------------: | ---------------: |
| Baseline full scanner         |         44.15 ms |         44.15 ms |
| Unchanged scanner control     |         47.49 ms |         47.49 ms |
| Cold index discovery          |        142.02 ms |        142.13 ms |
| One content-only index update |        0.0162 ms |        0.0221 ms |

Cold discovery costs about 3.2 times as much timed work as the scanner in this run. The index retains
facts and checkpoints to avoid repeating that work. All twenty measured content-only updates
read one row, rebuild one block, reuse 3,906 blocks, and perform zero topology propagation.
The benchmark compares complete final ranges and marker endpoints with the oracle after those
edits. Explicit enumeration of all 1,200 folds takes 1.64 ms.

Cold construction uses 1,499 bounded steps. The largest measured step is 1.70 ms.
Directory construction and aggregate-tree traversal account for 35,158 metadata operations,
with at most 1,024 per step. The index reports 21,096,192 estimated retained bytes.
That value estimates its structures, and is separate from the browser's measured whole heap.

The benchmark allocates the reference scanner's line array and ranges separately from the index.
Its final materialization and oracle comparison happen after the measured update intervals.
The raw results are in [`e034-index.json`](e034-index.json).

```sh
bun packages/editor/bench/indentationFolds.ts \
	--output /work/tmp/editor-e034/index-benchmark.json
```

## Remaining costs

Cold discovery can visit the whole document. A synchronous fold command can demand that work
before background preparation completes. A region-marker edit or dedentation can also change
arbitrarily distant ancestors. The index must preserve those costs when correctness requires
them. This comparison separates those cases from repeated content-only input inside unchanged
indentation.

Directory construction and tree traversal yield, but native descriptor-array slicing and
concatenation still copy references in proportion to the number of fact blocks. The retained-byte
estimate does not measure garbage-collector overhead or transient allocations.

## Review corrections

The review fixes publish projected syntax and manual folds before updating indentation folds.
Collapse inheritance therefore sees one snapshot for both single edits and edit batches.
Two regressions delete an earlier block beside a manual fold and verify that the surviving
syntax and manual regions remain collapsed.

An ordinary empty result from an unsupported structural provider now schedules fallback work.
It no longer calls the synchronous completion path or reports an explicit-command trigger.
The regression checks that publication performs no index step, the first background slice yields,
and either background completion or an explicit command produces the exact folds.

Deep ancestor removal, dedentation, and checkpoint comparisons now resume between stack nodes.
`stackSteps` and `maxStackStepsPerSlice` count this work. The default stack budget follows the
row budget, and cancellation drops the suspended continuation. Unchanged-topology edits retain
their existing fast path.

The [deep-stack comparison](e034-review-stack.json) uses 250,000 nested regions followed by a
disjoint region: 500,005 rows, 5,750,033 code units, and 250,001 folds. Its baseline is `33e632a`.
Both versions preserve the same fold count and perform zero materializations. Maximum position
resolutions in one 128-row slice fall from 250,006 to 788. Cleanup now spans 1,953 slices that
advance stack work without finishing a block, with at most 128 stack steps in each slice.
The measured maximum slice is 14.40 ms before and 1.06 ms after. These elapsed times include
runtime and host variation; the deterministic work counts establish the bound. The old version
has no stack counter, so its recorded zero stack steps mean unavailable instrumentation.

The current deep-stack case is reproducible with
[`indentationFoldStack.ts`](../../packages/editor/bench/indentationFoldStack.ts):

```sh
bun packages/editor/bench/indentationFoldStack.ts --depth 250000 \
	--output /work/tmp/editor-e034-fixes/deep-stack-after.json
```

The existing index benchmark also ran against frozen `33e632a` and the corrected source with
the same CPU affinity. [Before](e034-review-index-before.json.gz) and
[after](e034-review-index-after.json.gz) cold-work medians are 141.21 and 144.49 ms, a 2.3% increase
in this pair. Content-only edits still read one row with zero topology propagation. This local
index comparison does not establish the browser p95 acceptance gate.

The corrected built core has hash
`8ddb1bce942d6641aa2be0b20a77322107538d92ffab74bd60722c935e206225`.
A separate [Chromium diagnostic run](e034-review-diagnostic.json.gz) checks direct and prepared
attachment, cold and warm, with the fold gutter installed. All four samples pass exact text,
fold-boundary, and disposal checks. Each 36-character typing run reads 36 rows and records zero
fallback materializations. The image below is from that corrected build.

```sh
taskset -c 8,10,12,14 bun run --cwd examples/stress bench:first-paint \
	--repetitions 1 --fixtures short-lines --plugins none --modes direct,prepared \
	--fallback-cases --fold-gutter --diagnostics \
	--output /work/tmp/editor-e034-fixes/browser-diagnostic.json
```

![Corrected fallback markers after thirty-six typed characters](e034-review-folds.png)

The focused fold and rendering regressions, index tests, prepared-document and scheduler checks
pass. Core build, typecheck, scoped lint, workspace format checks, architecture health, and the backlog verifier pass.
Those original production p95 records remain inconclusive and do not substitute for the new
completion experiment.

## Completion validation

The confirmation completed all 24 independent blocks: 72 browser captures, 1,440 recorded
documents, and 51,840 input events. The [confirmation analysis](e034-completion-analysis.json)
reports seven passing primary upper bounds and one unresolved result. Warm prepared input has
difference bounds from -0.1 to +0.1 ms. Warm direct input passes with an upper bound of zero.
No primary endpoint demonstrates a regression, and the unchanged controls show no detected
systematic drift. These findings do not satisfy the declared requirement that all eight upper
bounds pass within one study. The user accepted completion with this unresolved result on 2026-09-13.

The baseline is `88cd55da61e895542cfe248082221cf992be74e5`. The candidate is
`4146ab67e84f0bdae6be3d8e8e0f718406998dc3` with `candidate-acceptance.patch`.
The [evidence archive](e034-completion-evidence.tar.gz) retains raw captures, declarations, source
and build proofs, diagnostics, verification records, and replay instructions. Its reports predate
the user acceptance and retain the open status recorded then. Earlier experiments remain in their
own directories. Frozen build directories are excluded from the archive.

### Completed confirmation

`confirmation-design.json` was preregistered at `2026-09-12T18:39:46.132Z`, with SHA-256
`ba528c9dcfe851306c3eb355828bf170e196708b1fe716089daf33b436a7b2a0`.
The fixed protocol kept the same candidate, baseline, eight primary endpoints, and thresholds.
All observations were fresh. No earlier captures or endpoint passes were pooled into the analysis.
Acceptance was evaluated after all 72 captures. The declared protocol permits no extension or
repeat of this unchanged candidate after the inconclusive result.

All values below are milliseconds. The difference is candidate p95 minus pooled control p95.
Each group contains 120 recorded documents and 4,320 input events per arm. The input measurement
ends at `onChange`; the text callback records the public initial paint event.

| Attachment | Metric | Pooled controls p95 | Candidate p95 | Difference | Lower bound | Upper bound |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Direct, cold | Input to onChange | 1.5 | 1.4 | -0.1 | -0.1 | 0.0 |
| Direct, cold | Text callback | 58.6 | 21.5 | -37.1 | -37.4 | -36.3 |
| Direct, warm | Input to onChange | 1.0 | 0.9 | -0.1 | -0.1 | 0.0 |
| Direct, warm | Text callback | 39.2 | 8.9 | -30.3 | -30.6 | -29.6 |
| Prepared, cold | Input to onChange | 1.5 | 1.5 | 0.0 | -0.1 | 0.0 |
| Prepared, cold | Text callback | 18.6 | 11.8 | -6.8 | -7.0 | -6.7 |
| Prepared, warm | Input to onChange | 1.0 | 0.9 | -0.1 | -0.1 | +0.1 |
| Prepared, warm | Text callback | 8.5 | 3.1 | -5.4 | -5.6 | -5.2 |

Each block ran baseline, unchanged control, and candidate in separate Chromium processes.
All six orders occurred four times. The analyzer used 32,768 seeded resamples of whole paired
blocks, keeping warm documents and their input events together. Bonferroni adjustment across
the eight primary endpoints gives nominal simultaneous 95% coverage for the upper bounds, and
separately for the lower bounds. These percentile-bootstrap bounds are approximate with 24
independent blocks and a tail estimate. Individual keys are not independent experimental samples.

The declared statistical gate requires every primary upper bound at or below zero. The fixed 1e-7 ms epsilon handles
floating-point subtraction only. The observed 0.1 ms clock grid and separate 0.2 ms quantization
envelope do not permit a latency regression. The threshold was not changed after capture.
Each study has its own nominal bound family, with no joint 95% coverage claim across studies.

The secondary frame-callback metric is slower in both cold groups. Direct p95 rises from 10.7 to
15.0 ms, with difference bounds +4.1 to +4.5 ms. Prepared p95 rises from 10.7 to 14.5 ms, with
bounds +3.5 to +4.1 ms. Both warm frame-callback groups improve. Screenshot-completion upper
bounds improve in all four groups. Frame callbacks and screenshots include scheduling or capture
delay, and neither proves physical display presentation. These secondary measurements remain
separate from the declared primary acceptance rule.

### Preparation, commands, and memory

The [confirmation costs](e034-completion-costs.json) record the following descriptive p95 costs
in milliseconds, using 120 samples per cell. These costs have no separate confidence bounds.
Preparation includes buffer creation and completes before the prepared attachment timer starts.
Direct attachment has no preparation stage. The input workload executes its first fold command
before typing, so it measures edits of a ready index rather than input during initial discovery.

| Attachment | Cost | Baseline p95 | Control p95 | Candidate p95 |
| --- | --- | ---: | ---: | ---: |
| Direct, cold | First fold command | 83.2 | 83.2 | 127.1 |
| Direct, cold | Fold-all | 6.4 | 6.4 | 9.4 |
| Direct, warm | First fold command | 69.3 | 69.4 | 120.0 |
| Direct, warm | Fold-all | 5.2 | 5.2 | 8.1 |
| Prepared, cold | Preparation | 122.1 | 122.3 | 153.1 |
| Prepared, cold | First fold command | 2.4 | 2.3 | 1.7 |
| Prepared, cold | Fold-all | 6.4 | 6.4 | 9.3 |
| Prepared, warm | Preparation | 102.1 | 102.3 | 144.0 |
| Prepared, warm | First fold command | 1.4 | 1.4 | 0.9 |
| Prepared, warm | Fold-all | 5.3 | 5.3 | 8.0 |

Buffer creation p95 ranges from 32.4 to 38.7 ms in the baseline groups and from 6.0 to 7.0 ms
in the candidate. Ready preparation and direct first-command discovery still cost more, as does
fold-all. The faster attachment callback does not remove those costs.

The following cells show initial → edited memory p95 in MiB. Each sample sums JavaScript
`usedSize + backingStorageSize` after forced collection. These process-level values include
benchmark reference strings and editor storage, so they do not isolate index allocation.

| Attachment | Baseline | Control | Candidate |
| --- | ---: | ---: | ---: |
| Direct, cold | 22.17 → 51.40 | 22.17 → 51.40 | 39.84 → 55.08 |
| Direct, warm | 23.50 → 51.95 | 23.50 → 51.95 | 41.25 → 55.63 |
| Prepared, cold | 24.41 → 53.71 | 24.41 → 53.71 | 42.19 → 57.41 |
| Prepared, warm | 25.80 → 54.29 | 25.80 → 54.29 | 43.59 → 57.98 |

### Diagnostic evidence

Implementation and correctness checks are complete. The gutter-enabled diagnostic uses the same
core-build and browser-bundle hashes as both completed production studies. Its broad source hash
matches the first isolated study. Adding block-count support to the benchmark tools changed that
source hash before confirmation, while the measured core and browser bundle stayed unchanged.
`completion-diagnostic-proof.json` and the confirmation identity proofs retain those distinctions.

Direct and prepared groups, both cold and warm, pass exact text, fold-boundary, and disposal
checks. Each group records 36 edit events reading 36 rows, with 3,906 unchanged blocks reused per
edit and 1,200 folds. Fallback materializations, retained roots after disposal, and dropped
diagnostics are all zero.

The direct groups force cold discovery through an explicit synchronous fold command. Their
maximum slice contains 35,158 metadata operations and 159 stack steps. Those command counts are
not background slice bounds. Prepared discovery runs in background slices and records maxima of
512 metadata operations and four stack steps per slice. Diagnostic timings do not enter either
production study. `marker-verification.txt` records the 215 passing focused tests covering
rendering, snapshots, prepared documents, and shared fold state. `confirmation-tool-verification.txt`
records the 58 passing benchmark validator tests and scoped lint and formatting checks.

![Candidate fold gutter after thirty-six edits](e034-completion-folds.png)

### Earlier isolated study

`isolated-design.json` completed 12 blocks, 36 captures, 720 recorded documents, and 25,920 input
events. Seven of eight primary upper bounds passed, but warm direct input remained unresolved:
both p95 values were 1.0 ms, with difference bounds -0.1 to +0.2 ms. Warm prepared input passed
in that study. Its `isolated-analysis.json` and `isolated-costs.json` remain in the evidence archive
as historical results. No observations or passing endpoints from that study enter confirmation.
Neither study passes all eight endpoints, and combining their different seven-endpoint successes
would violate the declared acceptance rule.

### Implementation changes

The completion candidate removes repeated work from folding and first text. A compatible ready
index no longer schedules a background callback that would immediately return. Diagnostics are
read once only when a performance sink or logger consumes them. Fold publication still occurs
before scheduling is skipped, so manual projections and view-local collapse reconciliation retain
their previous ordering. Focused controller tests cover scheduler inactivity, no diagnostic reads
without a consumer, and diagnostic-only delivery.

Subtree maximum endpoints are reused when both child endpoints are unchanged. Updating those
branches no longer resolves global line positions to repeat comparisons with unchanged inputs.
Visible fold markers are queried once per consecutive run of primary document rows in an update
pass; hidden gaps and injected/wrapped continuation rows are excluded. The same map serves row
comparison and painting. Without gutters or collapsed folds, rendering skips the marker query.
Installing a gutter or collapsing a fold resumes marker queries. View-local collapse state and
the existing nearest-fold and tie selection are preserved.

The renderer's raw `mountedRows` describe markers used for painting and can contain null markers
when no gutter or collapsed fold needs them. Public `EditorViewSnapshot.visibleRows` retain semantic
fold metadata: an explicit marker read fills one shared lazy batch from the snapshot's captured
source. The captured source remains valid after later edits or disposal.

The first-text investigation also found repeated whole-document work outside fallback discovery.
LF-only text now takes the existing native terminator probe and an LF-presence check instead of
visiting every character to count a line-ending majority that cannot differ. CRLF, mixed endings,
unusual terminators and explicit fallback semantics retain their original results. Original-piece
creation gets its newline count from the existing offset-index builder, removing the independent
counting scan. Initial painting reuses that index. Index construction remains necessary and moves
into buffer creation: direct attachment pays it during creation, while prepared attachment pays it
during preparation before the attachment timer. This move alone is not an eliminated cost.

Headless buffers now retain the original index immediately. For the 500,000-line short-lines
fixture, its 499,999 offsets occupy a 524,288-entry array: exactly 2,097,152 bytes (2 MiB), plus
unmeasured object and map overhead. The original text remains shared. Rendered documents already
retained this index after their first positional read; this change makes that allocation earlier.
Append-buffer indexes remain lazy.

Diagnostic CPU profiles of the initial corrected build found 5.10 ms of fallback scheduling across
180 warm prepared inputs. The hidden-input path consumed essentially the same sampled time in the
baseline and candidate. The endpoint-reuse optimization targets the repeated position resolutions
observed in that profile. The profiles included benchmark-owned expected-string reconstruction
after input, so their garbage-collection samples cannot establish an
Editor allocation regression. Production comparisons use the same minified runner and options
across all three arms, without CPU profiling or a diagnostics sink.

### Two aborted declarations

The first declaration, `final-design.json`, started at 16:07 UTC on 2026-09-12 with the earlier
controller-only optimization. Ten complete blocks and one additional control produced 31 result
files. The next baseline run failed before document capture at 16:44:43 UTC because a Chromium
temporary file disappeared during hashing. The result files and failed log remain in `final/`.
The ten complete blocks were analyzed as exploratory evidence; all eight primary upper bounds
remained positive. The repaired runner separates Vite output from Chromium temporary files.

The second declaration, `acceptance-design.json`, started at 17:22:51 UTC. Five captures passed
before concurrent LSP edits changed hashed source files in the shared checkout. The sixth capture
finished its workload but failed the source guard at 17:30:06 UTC. Its first-text log and two
screenshots remain in `acceptance/`, but it produced no completed result JSON. The five valid
records remain separate, along with `source-drift-abort.md` and its attribution evidence.

`isolated-design.json` declared twelve fresh blocks at 17:35:07 UTC. The completed experiment used
a detached checkout with isolated workspace package outputs and dependency links. Only external
package dependencies shared the existing store. Source, core-build, and browser-bundle hashes
matched the earlier valid baseline and candidate, and the source guard remained enabled.
Neither aborted declaration nor any pilot contributes measurements to the isolated result.
