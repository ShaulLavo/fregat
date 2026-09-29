# Input latency measurements

E002 was implemented on 2026-09-07. The optimized candidate passes all 108 blocking timing limits
and the correctness checks across 10,488 measured input events. One screenshot-duration advisory
remains visible. The independent unchanged reference passes, and a real 20 ms delay fails all 36
dispatch groups. Earlier failures and the calibration investigation remain in the recorded results.

The Editor input suite measures native browser events against the built public package.
It uses the E001 seeded ordinary, 500,000-line, and one-megabyte-line fixtures, with either one
view or two visible views plus one hidden view. Each scenario has a fresh browser context.
Warmups and measured repetitions reuse that context; it closes before results are accepted.

[Run and compare the suite](../../examples/stress/README.md#input-latency-budgets).
[Recorded results](../../examples/stress/results/input-latency/README.md).

## The synchronous path

A typed character enters `beforeinput`, synchronizes the selection, and commits text to the
piece table. Shared-buffer subscribers update peer views before the source view finishes its
own change. Each affected view projects existing syntax and folds, updates visible text,
reveals the caret, synchronizes the hidden input, and notifies its contributions and host.
The handler then schedules secondary work and returns.

Ordinary typing and composition commits already defer syntax and feature work with a 150 ms
debounce and 400 ms maximum wait. Paste and undo retain their existing submission policy.
Source and peer work both count toward the initiating event's synchronous duration.

Composition updates draw the preedit overlay without changing the document revision. Composition
commits, paste, and undo change text through the existing input and command owners. The suite
reports each input kind separately, including held-key repetition.

## Observable boundaries

| Metric                   | Start                          | End                                                | Limit                                                                   |
| ------------------------ | ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `inputToApplied`         | Browser event timestamp        | Source `onChange` callback entry                   | Excludes later handler work. Preedit uses the completed overlay update. |
| `dispatch`               | Window capture listener        | Microtask queued inside the source change callback | Includes the rest of the editor handler. Preedit ends at window bubble. |
| `inputToFrame`           | Browser event timestamp        | Next animation-frame callback                      | A rendering opportunity, not a pixel timestamp.                         |
| `burstToPaintUpperBound` | First measured event timestamp | Screenshot completion                              | Includes automation and capture overhead.                               |

A microtask queued by the capture listener can run before the editor's listener for a native
browser event. The suite queues completion from inside the editor callback instead. Its delayed
control pauses after the applied-edit mark and before handler return, proving that `dispatch`
sees work the earlier mark misses. Preedit's delayed control pauses before the bubble completion.

Frame callbacks can observe a later revision when several inputs share a frame. Their operation
identity describes the originating input; only the final screenshot represents the completed burst.

The runner checks exact text and cursor offsets, continuous revisions, the native repeat flag,
and mounted row or chunk text in every view. Chunk text must match its declared start and end,
and the chunks must cover the entire declared horizontal window without gaps or overlaps.
Shortened prefixes and missing chunks fail. Window bounds clear when a row stops using chunks.
The runner reveals the hidden view after timing and checks
its text too. Screenshots must show changed pixels and the edited row or composition overlay must
be visible. Paint observations include the final revision and, when enabled, diagnostic operation.

Chromium's CDP `imeSetComposition` supplies trusted composition updates. In the recorded browser,
`insertText` commits that composition with `compositionend.isTrusted === false`. The suite records
that fact and requires the explicit `cdp-untrusted-compositionend` configuration. That distribution
covers browser emulation of the commit path, not a physical OS IME. Keyboard, repeat, paste and undo
samples require trusted events. [CDP defines these IME emulation methods](https://chromedevtools.github.io/devtools-protocol/tot/Input/).

## Diagnostic identities

The existing `__EDITOR_PERFORMANCE_DIAGNOSTICS__` sink receives timestamps plus scalar operation
and view identities. An operation carries its ID, input kind, and handler start. A view carries
its ID, document ID, document generation, and shared-buffer revision.

- `editor.input` ends after the full input handler or owning operation flush returns.
- `editor.document.committed` observes an already committed edit before that view renders it.
- `editor.view.updated` follows that view's synchronous flush.
- `editor.secondary.*` and syntax request/apply/fail/accepted events retain the originating operation and
  revision across existing asynchronous callbacks. Their durations measure synchronous callback
  work, not the worker round trip.
- Syntax `.accepted` events occur only after the result passes generation and revision checks.
  Their document, generation, revision, and view identities are included in correlation validation.
  An `.apply` event alone means that an apply callback ran, including a rejected attempt.

An explicit `runInOperation` batch uses one `editor.operation` identity through its final flush.
Commands in participating views share that identity while the owning batch collects changes.
A peer view may flush earlier without ending the batch. Commands reentered after the owning batch
starts flushing get a separate identity. Direct commands and native input retain their own labels.
Pass tracking allocates nothing when diagnostics are disabled and holds no editor or session references.

The browser correlates input samples with the complete set of affected views and associates the
frame and screenshot observations with that operation. Saved diagnostic results must reproduce
these correlations from their raw records before the comparison tool accepts them.

The sink holds at most 8,192 diagnostics and the input probe at most 2,048 event samples.
Overflow fails the run. Disabled diagnostics create no new diagnostic payloads or detail factories,
and their deferred wrapper returns the original callback. Records retain no document snapshots.

## Document lifetime

Secondary syntax, feature, and fallback-fold jobs check the captured document generation.
Detaching a session also invalidates their ownership. A replacement document cannot receive the
previous document's pending change. Existing coalescing, deadlines, and worker disposal remain in
place.

Each accepted sample has no active editor, host nodes, pending probe frames, or listener growth
relative to its warmed context. The runner awaits context closure before recording acceptance.
Forced-GC WeakRef counts remain raw observations. A nonzero count is not proof of a strong
retaining path; the composition probe demonstrated that distinction. The suite makes no claim
about a GC deadline, process RSS, or worker heaps.

## Source range indexing

A document's immutable source buffer can contain millions of characters. A measurement request for
one row previously built the source buffer's entire summary tree and then sliced it. Pasting enough
Unicode text to make one ordinary row use indexed measurement exposed that cost.

`TextSourceIndex.range` now follows the existing 256-unit tree boundaries and builds only the
requested branches. Overlapping requests reuse those branches. A later full-range request completes
the same tree without rebuilding measured branches. Tab-size caches remain bounded to four roots;
fully measured sources without tabs can share their index across tab sizes.

The diagnostic proof validates every index range as finite, integral, and consistent with its source
length, then bounds the original-source characters indexed inside a short-line paste to 512.
Missing or malformed lengths fail before summation. This catches the original whole-buffer scan
independently of machine speed. Scalar tests
cover partial-to-full promotion, tabs, split surrogate pairs, and overlapping ranges.

## Local budgets

The 36 fixture/view/input combinations each retain four timing distributions. Input-to-applied,
dispatch, and input-to-frame form 108 blocking comparisons. The 36 screenshot-completion upper
bounds are advisory: three captures per group make their p95 the slowest capture, including
automation and screenshot overhead. Their samples, limits, and exceedances remain in the report.
Exact rendered text, visible edits, and changed screenshot pixels remain mandatory.

Calibration uses at least three unchanged control runs with matching fixture hashes, browser,
hardware, runtime and workload. It preserves raw samples, p50, p95, p99 and maxima.
For each metric group, the limit is the largest control p95 plus a measured noise margin:

`max(3 × range(control p95), 3 × range(control p50), largest control maximum − minimum)`

The within-run term covers the full observed range. The earlier median-to-p95 term rejected an
unchanged holdout in three groups, including frame-phase variation. The revised rule and every
derived limit were recorded before collecting its new validation holdout. Raw samples and the
rejected holdout remain available. This is an empirical local envelope, not a confidence bound.

An independent unchanged rerun must pass, and a real delayed-event run must fail. The saved
calibration includes its controls; comparison recomputes limits and rejects altered thresholds.
Later candidates are checked against those established limits. Comparison allows only a
0.000001 ms floating-point tolerance; it preserves raw timings and does not change the calibrated limits. The reference holdout keeps the
control source hash; the candidate, its delayed control, and its diagnostic run share the new
source hash. Each run has a distinct identity. The report records both the reference holdout and
candidate comparison, and uses the candidate for final distributions and instrumentation deltas.
When only candidate timing limits fail, the proof writes the failed metrics and `passed: false`,
then exits with status 1. Malformed evidence fails before any report is written.
These limits apply to the recorded reference and workload. They are not a universal 4 ms promise
or an unattended CI threshold. Diagnostic-enabled measurements are separate from production controls.

The runner's `--core-directory` option serves a physically frozen package build for reference
controls. Its source hash substitutes that package's actual source tree at the canonical core
path, while retaining the current harness and other package sources. This permits interleaved
old/new runs without restoring files in a working checkout. Source and built exports must both
come from the frozen package. The option cannot be combined with an existing server URL.

## Mounted geometry and chunk reuse

Geometry buffers used to reserve one boundary per character in the entire row, even when horizontal
virtualization mounted only a small window. For a one-megabyte row, the two Float64 boundary arrays
allocated about 16 MiB per geometry build. Their subarrays retained the full backing buffers.
Capacity now comes from mounted text parts, control and widget endpoints, and chunk gaps. The
one-megabyte ASCII, Unicode, and tab regression cases keep those allocations below 138 KB while
preserving endpoint positions and hit testing. The memory bound follows mounted content.

Edits that keep the horizontal window reuse chunk objects and span elements. Simple text updates
change only the affected text nodes; unchanged paint descriptors survive. Changed Unicode or
control chunks use the existing part renderer inside the retained span. Moving the window or
changing render mode keeps the existing rebuild path. Unchanged control glyphs still refresh their
pixel width when font metrics change, and source offsets update after edits in earlier rows.

This removes full-row geometry reservation and avoidable mounted-node replacement. Full row-string
materialization and synchronous browser layout remain in the input path. Eliminating those costs
would require rows backed by snapshot ranges and coordinated rendering across shared views.

## Input layout order

The focused textarea's value setter can force browser layout. Updating it after caret measurement
made the browser lay out the edited source view twice. The controller now refreshes the input
before measuring the caret, so text and input content share that layout. Input placement uses a
translation from the existing zero origin, preserving the logical-to-native scroll correction
without invalidating layout again. Composition still suppresses input content writes.

Both changes are necessary. Translation alone retained 72 layouts for 24 long-line keystrokes
across two visible views. Moving the content write alone reduced synchronous layouts to 48 but
left 24 later layouts from position changes. Together they produce 48 total layouts. Shared-view
callbacks retain their existing order; combining the remaining geometry measurements across
views would require a separate change to that ordering.

Two timing blocks ran in opposite orders through the same harness, with one warmup and three
measured repetitions per group in each block. Long-line typing dispatch p95 fell from 5.0 to
2.7 ms. Ordinary typing and long-line paste were slightly slower, and short-line paste was
unchanged. These local results establish a layout reduction and a long-line typing improvement,
not a speedup across all inputs. No budget limits changed.

The [layout results](../../examples/stress/results/input-layout/README.md) preserve the distributions,
source identities, traces, and rejected experiments. The focused checks passed 134 browser tests,
39 DOM tests, and 10 trace-summary tests. Native timing, trace, composition, and undo runs checked
852 measured events across baseline and candidate, including rendered text and cleanup.

## Delivery checks

The review corrections passed these focused checks:

- 47 diagnostics, document-lifecycle, and operation tests cover batch ownership across views,
  reentrant callbacks, exceptions, disabled sinks, async origins, and stale work.
- Two real-browser long-line tests check text against chunk bounds and clear bounds when wrapping
  replaces chunked rows. A built-browser corruption probe rejects a 2,048-unit chunk shortened to one unit.
- All 170 stress-suite tests passed, including malformed index records, accepted syntax identities,
  incomplete rendered windows, advisory timing, observed-range calibration, and frozen-core selection.
- All 122 real-browser geometry, bidi, and long-line measurement tests passed. The 22 DOM geometry
  tests include three allocation bounds; six focused chunk tests cover node reuse, offsets, control
  metrics, and rendering transitions. Editor and stress typechecks, focused lint, and repository
  formatting passed.

Replay the saved benchmark acceptance proof from the repository root:

```sh
bun run --cwd examples/stress input:proof
```

The [runner instructions](../../examples/stress/README.md#input-latency-budgets) explain how to
collect new controls and a candidate. The [result reference](../../examples/stress/results/input-latency/README.md)
records the measured source hash and retains all raw distributions.
