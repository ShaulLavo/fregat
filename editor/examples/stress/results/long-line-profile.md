# Long-line CPU profile

Follow-up: [implemented fixes and before/after measurements](long-line-fix.md).

The one-megabyte line spends most of its edit time in rendering helpers that repeatedly classify
text or count columns. Horizontal chunking bounds the mounted text, but it does not bound those
scans. A small edit invalidates geometry and repeats the work.

The final capture ran on September 5, 2026 with Chromium 148.0.7778.96, an i7-14700K, and core commit
`9abb944f3a2b8d6516953fdec75e8df5e1a94811`. The editor source was unchanged. The benchmark changes,
source hash, environment, per-key timings, and correctness observations are recorded in
[the result](long-line-profile-result.json). The [CPU summary](long-line-profile-summary.json)
records eight profiles with TypeScript locations. Two earlier captures reproduced the dominant
functions; the final capture composes the package source maps through to TypeScript.

## Measured work

The long-line fixture contains 1,048,594 UTF-16 code units on one line. Typing inserts 40 trusted
ASCII keys at column zero in one visible view. Churn performs 100 insert/delete cycles with
`😀é` at offset zero in a shared buffer with two visible views and one hidden view. Syntax
highlighting is disabled in both workloads.

| Workload                 | Ordinary cold | Ordinary warm | Long line cold | Long line warm |
| ------------------------ | ------------: | ------------: | -------------: | -------------: |
| Key to applied edit, p95 |        1.7 ms |        1.0 ms |        28.2 ms |        29.3 ms |
| 100 insert/delete cycles |      115.6 ms |      101.6 ms |    10,747.9 ms |    10,730.9 ms |
| Active typing samples    |       94.1 ms |       73.6 ms |     1,131.2 ms |     1,167.5 ms |
| Active churn samples     |      140.5 ms |      124.5 ms |    10,934.1 ms |    10,920.2 ms |

These are single cold and warm repetitions, each warm repetition following one discarded warmup.
All 24 recorded scenarios passed their existing correctness checks. The eight typing and churn
samples released their tracked buffer and editor objects after disposal and forced GC.

The warm long-line typing profile attributes these **self samples**:

| Function                     | Active samples | Share |
| ---------------------------- | -------------: | ----: |
| `isSimpleRowText`            |       422.7 ms | 36.2% |
| `bufferColumnToVisualColumn` |       412.8 ms | 35.4% |
| `nonWhitespaceBounds`        |       144.2 ms | 12.4% |

Together these functions account for 84% of active samples. The inclusive `renderSessionChange`
stack accounts for 83.4% of typing and 90.5% of churn. Some geometry work also occurs during
interaction setup and selection updates outside that stack. The warm typing profile contains
about 1.1 ms under `applyText`; storage mutation is not where this capture spends its time.

## Why the scans repeat

1. [Horizontal chunk selection](../../../packages/editor/src/virtualization/virtualizedTextViewRows.ts#L1620)
   calls `bufferColumnForEstimatedColumn` for both bounds. Each call first runs
   [isSimpleRowText](../../../packages/editor/src/virtualization/virtualizedTextViewBidi.ts#L30)
   over the entire ASCII line, even when the requested column is near zero. This repeats through
   `horizontalWindowKey`, `rowChunkKey`, and `setChunkedRowText`. Those three caller paths account
   for 279.3 ms of the warm typing classifier samples. The RTL memo also repeats its initial
   ASCII scan after the text revision changes.

2. [Column conversion](../../../packages/editor/src/displayTransforms.ts#L187) starts at zero
   for every query. Whole-row width requests come from `calculatedRowWidth`, `scanVisualColumns`,
   and the unwrapped `fullTextSegment`. Separately,
   [appendCalculatedChunkBoundaries](../../../packages/editor/src/virtualization/virtualizedTextViewGeometry.ts#L1646)
   calls the conversion once for each mounted boundary. That repeatedly scans overlapping
   prefixes even within one chunk. Its inclusive conversion cost is 141.1 ms in warm typing.

3. [Whitespace bounds](../../../packages/editor/src/virtualization/virtualizedTextViewHiddenCharacters.ts#L410)
   walk the entire row to find its first and last non-whitespace characters.
   `appendWhitespaceMarkers` computes those bounds even in the default `show-on-selection`
   mode, whose marker decision does not use them. This work happens before scanning the mounted
   chunks for markers.

4. Churn alternates between ASCII and a line starting with an emoji and a combining mark.
   The non-ASCII row uses measured geometry, with estimated widths when a unit has no measurable
   rectangle. [estimatedLocalRangeWidth](../../../packages/editor/src/virtualization/virtualizedTextViewGeometry.ts#L2951)
   calculates both endpoints by scanning from the line start. The Unicode prefix makes
   `estimatedDisplayCellForColumn` take the code-point estimator on every such prefix query.
   The warm churn profile spends 2,050.6 ms, or 18.8% of active samples, in
   `estimatedDisplayCellsFrom` under `resolveUnit → estimatedUnitWidth`.

JIT compilation moves some self samples between a helper and its caller. In cold churn,
`isSimpleRowText` receives 26.5%; in warm churn, its 6.8% plus
`bufferColumnForEstimatedColumn`'s 19.8% cover the same classification path. Use the stacks and
the source together instead of treating one function's self percentage as a stable boundary.

## Recommended implementation

Make content classification and column summaries incremental at the line or chunk level. Share
content facts across views, while keeping font and measured geometry specific to each view.
Update the changed span after an edit. Prefix queries should combine summaries and scan only the
remaining part of a chunk. Tab alignment and Unicode boundaries must remain correct across chunks.
A cache cleared on every edit would still leave whole-line work on every keypress.

Within that design, calculate consecutive mounted boundaries in one pass instead of rescanning
each prefix. Skip whitespace bounds when the mode does not use them. For boundary or trailing
mode, scan inward from the ends until the first non-whitespace characters are found.

The whitespace change is a small independent fix, but its measured 12.4% share cannot resolve
the other scans. Measure any implementation with the normal benchmark build, then profile again
to find the remaining work. Include ASCII, tabs, Unicode, horizontal positions near both ends,
and shared hidden views in the correctness checks.

## Reproduction and limits

Follow [the profiling commands](../README.md#cpu-profiling) with a fresh output directory.
The raw `.cpuprofile` files and matching build for this capture remain in
`/work/tmp/editor-long-line-profile-final`. The JSON summary includes that path and the run ID.
No editor performance fix or improvement is claimed by this investigation.

The profiler requests one sample per millisecond. Active percentages exclude idle samples;
inclusive percentages overlap. Capture windows include focus, selection setup, screenshots,
correctness checks, and churn's two probe edits. Churn's reported cycle duration excludes those
probe edits. JavaScript CPU samples do not fully attribute native layout and paint work.
Profiles use an unminified build and are intentionally incompatible with the normal calibration.
The recorded latencies describe this machine and capture, not a portable performance guarantee.
