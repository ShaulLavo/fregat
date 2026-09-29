# E006: Automatic text reclamation

Live buffers now reclaim unused portions of original text and append chunks. Logical piece
coordinates, anchors, snapshots, revision, dirty state and retained undo remain unchanged.
Text reclamation passes the string-storage acceptance checks described below. Position metadata
was the second milestone and is complete: [tombstone compaction](e006-tombstone-compaction.md)
bounds the current tree and leaves about 22 bytes per insertion in the index.

## Ownership and storage

The [collector](../../packages/textbuffer/src/reclamation.ts) groups snapshots by actual append
log identity and unions the visible ranges of all protected roots. Numeric insertion IDs cannot
identify storage across divergent branches. Clean baselines, history, transaction endpoints and
external readers legitimately retain text; dropping an undo entry alone does not release it.

[Storage](../../packages/textbuffer/src/buffers.ts) keeps logical chunk extents while replacing
unused text with independently copied sparse spans. Each copy is at most 16 Ki UTF-16 units,
preserving isolated surrogates as well as pairs. Sorting and unioning ranges also yield.
The original chunk can be reclaimed without any appended text. Writable tails remain dense.
Readers bind to a physical span, and walkers retain direct character reads within that span.

A surviving substring can pin a multi-megabyte paste even when its visible length is tiny.
The append path records chunks made from proper substrings of an insertion. When maintenance
retires text, it detaches those borrowed dense survivors, including the writable tail. Whole
small insertions do not create a cross-chunk backing dependency and remain shared when fully
retained. The borrowing marker survives later writes and forks until copied or retired.
Externally pre-sliced strings remain opaque, as they do for original-text ingestion.
This copies during maintenance, not synchronous insertion. An eager-copy prototype
released the same memory but raised a 16 MiB paste from about 4 ms to 299 ms, so it was rejected.

Line indexes retain numeric offsets and ordinal positions, including metadata for deleted
holes, but no longer retain their source strings. Inspection compares surviving text against
those offsets and validates metadata structurally where text has been released.

[Buffer maintenance](../../packages/editor/src/textStorageMaintenance.ts) retains its existing
128 Ki-unit deletion threshold, 300 ms quiet period, two-second scheduling deadline and
cooperative 2 ms / 32-step slice limit. Publication replaces storage on the same snapshot objects
and never yields halfway through a shared group. Prepared commits, leases and receipt reversal
therefore remain valid. Last-view detach cancels pending work. A large custom history can still
make atomic publication exceed the soft slice target.

External snapshots and walkers keep their old storage until released. Reported retired code
units describe eligible storage, not physical bytes freed while another reader owns it.

## Measurements and workers

[Text measurements](../../packages/editor/src/documentTextSourceCache.ts) borrow pages of at most
16 Ki units, clipped to the requested span. Construction and classification do not copy text.
[Page handles](../../packages/textbuffer/src/textPages.ts) are also held by measured leaves, so
moving backing preserves both unread ranges and already-built indexes. Sparse spans reuse their
existing independent strings.

Each document family shares a weak reader registry across append-log forks. Identical borrowed
ranges reuse one handle, and ranges of a growing chunk share its latest backing cell. After all protected
snapshot groups publish, maintenance detaches pages whose dense owner is no longer protected,
including readers from abandoned predecessor logs. Each detached page copies at most 16 Ki
units. An unchanged original keeps borrowing its existing text; collecting another document
cannot copy it. Detachment preserves content and can survive cancellation; a restarted collector
finishes the sweep even if storage publication already completed. This guarantee applies when
maintenance runs for that document family; disposing every view does not itself drain readers.

Each source page caches at most two clipped variants, allowing both sides of an insertion to
reuse indexes without retaining every historic boundary. Cache-held readers may be detached
during maintenance too; copying is bounded and the old generation is then collectible. The range cache is weakly owned by
storage generation, so republishing a snapshot does not keep unused measurements from its old
storage alive. Previously returned measurements remain readable. Unicode tests include pairs
crossing pages and spans. Bounded code-unit pairing also avoids an observed Node 26.7.0
sliced-string `codePointAt` read beyond the logical end.

The previous implementation copied eagerly during measurement construction; calling it lazy
was incorrect. Simply copying on first read would move that full copy into first paint because
the RTL classifier reads every page. The
[cold probe](../../examples/stress/reclamation-cold.mjs) exercises real `DisplayProjection`
acquisition and the first classification on a fresh 32 Mi-unit ASCII line, with three isolated
Node processes per variant. [Results](../../examples/stress/results/reclamation/review-cold.json):

| Median, 32 Mi units | Eager-copy reproduction | Borrowed pages |
| --- | ---: | ---: |
| Measurement acquisition | 609.70 ms | 3.05 ms |
| Retained heap after acquisition | 34.93 MB | 2.20 MB |
| First classification and column lookup | 66.52 ms | 80.84 ms |
| Retained heap after classification | 91.83 MB | 58.98 MB |

The reproduction changes only page acquisition in the new handle-based index implementation.
It isolates copying, not all differences from clean HEAD. First classification still scans and
indexes the full line; these are Node phase timings, not a browser first-paint measurement.
The heap figures include indexes and range metadata, and use decimal MB.

[Tree-sitter descriptors](../../packages/tree-sitter/src/treeSitter/source.ts) identify physical
owners and bounded offsets. Unchanged ID and length imply unchanged content. Forked writable
tails and copied spans get new owners; unchanged sparse spans and untouched writable tails
keep theirs. After maintenance shares a tail, either branch acquires a new owner before its
next append, preserving the immutable-prefix contract. Both string and shared
UTF-16 transports are tested. The worker and client ledger retain only chunks used by their
latest descriptor; older responses cannot resurrect stale ownership.

Sparse retained spans were selected over eagerly paging all input. They preserve existing
storage and walker behavior without imposing per-page ingestion cost on every document.
Bounded movable measurement pages address the separate lifetime of rendering caches.

## Mounted browser evidence

The [live harness](../../examples/stress/reclamation-live.mjs) mounts two editors sharing a
buffer. It keeps the default 200 history states, checks revision/dirty/snapshot identity,
traverses retained undo and redo, sends trusted input, verifies peer text and disposal, and
rejects browser errors. Six workloads cover whole chunks, small survivors, mixed deletion,
fixed-size paragraph replacement, original-only deletion and an untouched writable paste tail.

The [first corrected Chromium 153 run](../../examples/stress/results/reclamation/review-live-chromium.json)
contains 30 samples, three per workload/size. All correctness checks pass. The unchanged
experimental 10% median total-heap target was unmet in that run:

| Workload | 500 cycles | 1,000 cycles |
| --- | ---: | ---: |
| Aligned whole chunks | 67.84% | 81.89% |
| 64-unit survivors | 4.46% | 10.74% |
| Mixed deletions | 1.36% | 6.34% |
| Fixed-size paragraph | 3.48% | 13.03% |

The largest observed maintenance slice was 5.20 ms; the 2 ms scheduling target is soft.
Original-text release reduces median absolute heap from 15,464,024 B with
the external snapshot held to 3,472,468 B with only the old measurement
held, then 3,455,652 B after releasing it. The untouched paste-tail case
releases 91.07% of growth, with median residual 759,340 B.
These tests release clean/history and external owners separately. Paste also rotates the sync
segment through its public lease API; writing extra text would accidentally flatten the tail.

## Heap measurement correction

The review found that an immediate CDP GC reading was not a settled heap measurement once weak
readers were introduced. A 1,000-cycle control reported 146.5 MB immediately, then 9.0 MB after
browser task boundaries and GC, before maintenance. The
[calibration evidence](../../examples/stress/results/reclamation/review-registry-calibration-summary.json)
preserves the immediate readings, task-separated observations and a settled heap snapshot.
A WeakRef-only sentinel created in the churn job confirms that the old job's keepalive state
has cleared; maintenance is suspended throughout measurement.

The final harness uses the same immediate-GC, timer-task/GC, timer-task/GC procedure for baseline,
before, after and external-owner stages. It records every reading and the difference between
settled rounds, checks the sentinel, and asserts that maintenance did not run during capture.
Only the final settled reading enters total-heap observations. This calibration did not change
the threshold. The later string-category acceptance change is recorded separately below.

There was also real allocation waste: 500/1,000 cycles registered 250,852/1,001,821 handles for
repeated requests of the same ranges. Interning by owner and exact range reduces that to at most
1,003/2,003 in the final run. Ranges of a growing owner share its latest backing cell; retaining
one early tail prefix per range would reproduce the undo-string retention problem in measurement
storage. Older-view reads never shrink that cell, and detaching a page replaces only its own cell.

Intermediate [weak-index-cache](../../examples/stress/results/reclamation/review-live-weak-cache.json)
and [uninterned](../../examples/stress/results/reclamation/review-live-uninterned.json) runs use the
old immediate-GC instrument. The spike persisted after reverting the weak index cache, so that
cache alone was not its explanation. Those percentages are not reclamation evidence. The
[interned-prefix candidate](../../examples/stress/results/reclamation/review-live-interned-prefixes.json)
uses the calibrated instrument but retains historical tail prefixes; it was replaced by shared
backing cells. The final index cache remains bounded to two strong variants per physical page.

The [pre-review run](../../examples/stress/results/reclamation/partial-live-chromium.json) and
[acceptance history](../../examples/stress/results/reclamation/partial-heap-acceptance-history.json)
remain intact. The latter records two earlier exploratory threshold changes and a failed output
that was overwritten, including what was recoverable. Earlier whole-chunk, storage-only and Bun
results remain historical observations. The review preserves those losses and the failed total-heap target.

Heap readings include main-thread editor/history, not worker heaps or process RSS. Peaks sample
CDP every 10 ms and can miss transients; registry counters separately exposed synchronous churn
allocation. Slice timings are observations, not universal bounds.

## Heap retainers found during review

Before position metadata work, two 500-cycle captures took heap snapshots before churn and
after maintenance, before any undo traversal or typing probe. These are diagnostic single
samples of the pre-review bundle, not new acceptance runs. The
[attribution report](../../examples/stress/results/reclamation/partial-pre-review-heap.json)
records bundle identity, exact retaining paths, raw-snapshot checksums and reproduction commands.
Four compressed snapshots and the
[portable analyzer](../../examples/stress/reclamation-live-heap.py) are stored beside it.

| Post-maintenance growth above mounted baseline | Mixed | Survivors |
| --- | ---: | ---: |
| Total browser JS heap growth | 3,976,816 B | 4,458,884 B |
| Newly compiled code and compiler metadata | 2,012,208 B | 2,124,868 B |
| Flat string allocations | 1,144,316 B | 1,028,688 B |
| Piece-tree node objects | 219,840 B | 274,980 B |
| Piece objects | 76,760 B | 115,960 B |
| Reverse-index split objects | 0 B | 89,312 B |

Those allocation rows are disjoint shallow-size categories, not a complete partition. Tree
counts include historical and live states and omit supporting arrays; they are not a tombstone
total. Newly compiled code accounts for about half the remaining growth.

The actionable retainer is `history.nodes → transaction.inverseEdits[0].text → sliced-string parent`.
Mixed undo payloads require 88,064 UTF-16 units but retain 86 distinct backing strings occupying
782,344 B. Survivors require 96,000 units but retain 100 parents occupying 847,024 B. Small deletes
thus retain separate growing append-tail prefixes. `invertTextEdits` obtains these strings from
`readPieceTableTextRange`; the storage collector cannot free backing still owned by those undo
strings. The follow-up below copies small inverse payloads at creation, while avoiding
synchronous copies of arbitrary large payloads.

Overlapping ownership views show history retaining 1.16/1.40 MB, a mounted row's measurements
235/238 KB, and the sync chain only 7,996 B in each case. Do not add these to the allocation rows.
The analyzer excludes weak edges and approximates the strong object graph rather than reproducing
DevTools ephemeron handling. The snapshots do not support attributing the remaining heap mainly
to position metadata. The previously recorded failures remain intact.

## Follow-up: repeated maintenance and undo slices

`copyRange` now reuses every fully covered physical span. Only trimmed spans receive new
strings and owners. This keeps existing measurement indexes and worker chunk IDs for untouched
text. The [50 Mi-unit probe](../../examples/stress/reclamation-repeat.mjs) reclaims an original,
then deletes ten more units near its end and reclaims again. It preserves the prefix span and
tail ID, sends only 16,364 units in two replacement worker chunks, and takes 0.97 ms for the
second maintenance pass in one Node 26 observation. This is not a calibrated latency limit.

All three transaction paths share `invertTextEdits`. It now copies inverse text of at most
1,024 UTF-16 units, so typing-sized deletions cannot retain whole append-tail prefixes. Larger
payloads retain their existing path. Tests cover both sides of the cutoff, undo/redo, prepared
transactions and isolated surrogates. The cutoff bounds each inverse edit, not an entire batch.

Fresh 500-cycle mixed/survivor heap snapshots find zero sliced-string parents reachable from
inverse edit texts. Their complete string graphs occupy 89,096 B / 97,200 B, compared with the
earlier 782,344 B / 847,024 B in slice parents alone. The logical undo payloads remain unchanged.
The [follow-up heap report](../../examples/stress/results/reclamation/followup-heap.json) and
compressed snapshots retain the evidence and the analyzer's ownership caveats.

`copyTextRange` uses `Reflect.apply(String.fromCharCode, null, units)` to avoid the typed-array
iterator while preserving arbitrary UTF-16. The [copy probe](../../examples/stress/reclamation-copy.mjs)
compares both implementations with alternating order and seven samples per size. The initial
Node 26 observation for 16 Ki units was 0.263 ms with spread and 0.051 ms with apply.

## String-storage acceptance

The review requested separating text reclamation from compiled code. The earlier snapshots
showed about 2 MB of new code/metadata in roughly 4 MB of total heap growth. Consequently the
live harness now gates on actual string-category bytes and logical retained code units, with
total heap kept as an observation. This changes the measured quantity, not the recorded old
results. The 10% fraction remains the same.

Each settled stage takes a heap snapshot and sums `self_size` for `string`, `concatenated string`
and `sliced string` nodes, including backing strings. Churn acceptance requires more than 10%
median reduction in baseline-subtracted string bytes and fewer retained code units in every
sample. These are whole-isolate categories, not exclusive document retained sizes. Original
and paste-tail external-owner checks also use string bytes. Timing and total heap remain
observational; heap snapshots make this run unsuitable for input-latency comparisons.

The [follow-up Chromium 153 run](../../examples/stress/results/reclamation/followup-live.json)
passes all 30 mounted samples with gates enabled:

| Workload | String reduction, 500 / 1,000 cycles | Total-heap reduction, 500 / 1,000 cycles |
| --- | ---: | ---: |
| Aligned whole chunks | 79.93% / 89.96% | 67.36% / 81.66% |
| 64-unit survivors | 48.01% / 63.10% | 4.99% / 12.13% |
| Mixed deletions | 26.57% / 35.87% | 1.99% / 7.29% |
| Fixed-size paragraph | 31.50% / 55.43% | 5.41% / 16.94% |

The paste-tail case releases 99.83% of string growth. At 500 cycles, retained code units fall
from 512,014 to 128,014 for survivors and to 217,102 for mixed edits. Paragraph storage falls
from 512,013 to 217,101. Protected history legitimately retains some deleted text.

## Paste and input cost

The [follow-up input run](../../examples/stress/results/reclamation/followup-input-summary.json)
passes all 108 correctness samples with the same manifests, options, browser, hardware and
runtime as the previous borrowed-page run. Of 36 input-to-applied p95 rows, 16 improve, 10 worsen
and 10 are unchanged. Long-line/multiple-view composition commit is 3.8 → 3.2 ms; ordinary
multiple-view paste-to-frame remains 16.8 ms. This is one observational run, not the calibrated
E002 gate. Report analysis near startup and artifact compression during part of the long-line
section add a further reason not to infer small performance gains.

The [portable Node probe](../../examples/stress/reclamation-paste.md) uses three fresh processes
per scenario. [Its comparison](../../examples/stress/results/reclamation/partial-paste-summary.json)
isolates survivor detachment within the sparse implementation, rather than comparing clean HEAD:

| 16 Mi-unit paste survivor | Before detachment | Final retained heap | Before / final insertion |
| --- | ---: | ---: | ---: |
| 64-unit writable tail | 17,336,136 B | 581,800 B | 3.976 / 4.034 ms |
| Complete 16 Ki closed chunk | 17,332,000 B | 592,744 B | 3.943 / 4.082 ms |

Median stage-sampled peak grew from 18.65 MB to 18.98–19.13 MB. A partially retained closed
chunk already released the parent through sparse copying and remains the control. These are
cold Node storage operations, not mounted-editor input latency.

The first 256-unit measurement design rebuilt 4,098 range objects for an edited 1 Mi-unit
line. Larger clipped blocks reduce that to 66. The
[real-class comparison](../../examples/stress/results/reclamation/partial-measurement-pages.json)
measured warmed measurement construction, classification and column lookup after each edit:
p95 fell from 0.70–0.79 ms to 0.023–0.024 ms across three processes. The
[probe instructions](../../examples/stress/reclamation-measurements.md) explain its limits.

[The pre-review same-browser input comparison](../../examples/stress/results/reclamation/partial-input-summary.json)
validates all 108 final samples and matches the clean `b31e22e` control's fixtures, options,
Chromium 153, machine and Node version. Input-to-applied p95 observations:

| Case | Before | Final |
| --- | ---: | ---: |
| Long line, one view, typing | 1.9 ms | 1.1 ms |
| Long line, multiple views, typing | 1.8 ms | 1.7 ms |
| Long line, multiple views, paste | 8.7 ms | 6.2 ms |
| Long line, multiple views, composition commit | 3.2 ms | 4.9 ms |

The last case's median stays 1.7 ms; its first commit is slower in two final repetitions.
That tail is retained in the report, not dismissed as noise. These are observations from one
baseline run and one final run, not a newly calibrated E002 gate or proof that every latency
improved. Raw compressed baseline, intermediate small-page and final artifacts are kept beside
the summary.

The [review rerun](../../examples/stress/results/reclamation/review-input-summary.json) adds a
second independent clean `b31e22e` baseline and the corrected borrowed-page build. Each passes
all 108 correctness samples; manifests, options, Chromium 153, hardware and Node match. The
baseline source hashes also match. The two flagged p95 rows are:

| Metric, multiple views | Original baseline | Eager pages | Repeated baseline | Borrowed pages |
| --- | ---: | ---: | ---: | ---: |
| Long-line composition, input to applied | 3.2 ms | 4.9 ms | 4.0 ms | 3.8 ms |
| Ordinary paste, input to frame | 16.0 ms | 18.0 ms | 19.4 ms | 16.8 ms |

“Multiple” in this harness means views, not multiple carets. The repeat baseline's own movement
shows why the earlier pair alone cannot establish a regression. This still is not a calibrated
pass: of 36 input-to-applied rows, 10 improved, 13 slowed and 13 were unchanged versus the repeat
baseline (treating sub-0.0001 ms timestamp differences as equal). All 144 metric distributions
and compressed raw runs are retained. The corrected
[warm measurement probe](../../examples/stress/results/reclamation/review-warm-measurements.json)
reports 0.022–0.023 ms p95 across three processes.

## Correctness and verification

The pre-review sparse implementation checks were:

- Textbuffer: 138 tests, typecheck, build and package smoke pass. Sparse tests cover protected
  unions, original-only deletion, partial append chunks, line ordinals, Unicode, branches,
  subsequent writes and physical owner reuse. Existing cancellation and atomic publication
  tests remain in place.
- Core: 180 focused tests pass, including a prepared commit and receipt reversal
  across partial reclamation, clean/history ownership and cache replacement. Snapshot, anchor,
  read and buffer suites pass. The full run's inspector regression was corrected and its
  19-test suite passes. The other four failures reproduce on clean baseline `b31e22e`: three
  Shiki worker-cache tests and the BiDi 6,000-character click/drag ratio probe.
- Tree-sitter: 90 unit tests and 57 browser tests pass, including sparse original
  text followed by edits and divergent equal-length branches.
- Platform: 73 linked WorkspaceEdit, prepared-document and retention tests pass.

Targeted core, textbuffer, Tree-sitter and stress typechecks and lint pass; root formatting and
format checks pass. The workspace-wide typecheck still fails at `indentationGuess.ts:83`
(possibly undefined array entry) and the TypeScript-LSP `markdownTooltip.test.ts:21` mock
(missing `addSource`). Both also reproduce on a clean isolated `b31e22e` checkout. No unrelated
fix is included. [Validation metadata](../../examples/stress/results/reclamation/partial-validation.json)
records these limits and the focused check counts.

Review verification passes 145 textbuffer tests, 202 focused core tests, 18 source/worker unit
checks, 57 real-worker browser tests, and 73 linked Platform tests. It adds coverage for unread
readers, already-built Unicode roots, abandoned branches, protected sibling owners, cancellation
after publication, pages created during a yielded sweep, shared tail growth and independent
page detachment. Construction and classification both assert borrowed backing in the cache test. Targeted typechecks, lint, builds,
package smoke, root formatting and format checks pass; the same two lint warnings remain.
[Review validation](../../examples/stress/results/reclamation/review-validation.json) records the
selected checks and limitations. Full-workspace baseline failures above were not re-tested.

Follow-up verification passes 147 textbuffer tests, 121 focused core tests, 20 source/worker
unit tests, 57 real-worker browser tests and 73 linked Platform tests, 418 in total. New coverage
checks sparse-span and measurement reuse, worker payload bounds, divergent writes after tail
sharing, and undo text around the copy cutoff. Thirty mounted samples and two additional heap
captures pass the string-storage gates. Targeted typechecks, lint, package smoke, builds and
format checks pass. The two existing core lint warnings and prior full-suite limitations remain.
[Follow-up validation](../../examples/stress/results/reclamation/followup-validation.json)
records source digests and evidence files.

Reproduce after building workspace dependencies:

```sh
bun run --cwd packages/textbuffer build
bun run --cwd packages/editor build
bun run --cwd examples/stress bench:reclamation-live
node examples/stress/reclamation-repeat.mjs
node examples/stress/reclamation-copy.mjs
node examples/stress/reclamation-paste.mjs --output /work/tmp/e006-paste.json
bun run --cwd examples/stress bench:input --output /work/tmp/e006-input.json --repetitions 3
bun run --cwd packages/textbuffer test
bun run --cwd packages/editor test --project node test/storageMaintenance.node.test.ts src/textMeasurements.test.ts
bun run --cwd packages/tree-sitter test
bun run --cwd packages/tree-sitter test:browser
```

Small undo-payload backing and string-storage acceptance are addressed. Removing tombstones needed
an equivalent compact position representation; [tombstone compaction](e006-tombstone-compaction.md)
is that representation. The [initial investigation](e006-reclamation-investigation.md) records
counterexamples to unsafe compaction.
