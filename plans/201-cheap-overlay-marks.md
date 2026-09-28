# Plan 201: One-frame typing in large files, starting with cheap underlines

Status: proposed 2026-09-28, requested by the owner after [Plan 112](112-large-file-ceiling.md)
closed. Implementation has not started. Owners: Editor for overlay painting and the text-snapshot
diagnostics hook; Platform for the benchmark, the tier thresholds and the language-server policy.

## Why

Plan 112 made plain text usable (10 MiB two-byte text reads 16 ms p95, 200 MiB 27 ms, on a metric
that cannot go below one 60 Hz frame; see step 0) and set the analysis tier to 10 Mi code units.
With analysis on, typing is still slow with **either**
highlighter, so the highlighter is not the cause:

| TypeScript file | Shiki key p95 | Tree-sitter key p95 | Plain text, same size |
| --------------- | ------------: | ------------------: | --------------------: |
| 1 MiB           |         56 ms |               48 ms |                     — |
| 5 MiB           |        150 ms |              183 ms |                     — |
| 10 MiB          |        254 ms |              241 ms |                 16 ms |

Rows are from `bun run bench:large-file --ext ts --highlighting shiki,tree-sitter` (30 keys,
80 ms apart); evidence and method are in
[the 112 results report](../docs/large-file-ceiling/results/resident-20260928.md#final-highlighting-validation).

The 5 MiB typing profiles are nearly identical for both engines. The top main-thread costs are:

1. **Overlay marks are rebuilt for the whole document on every text change.** Underline,
   strike-through and dim marks (LSP unnecessary/deprecated diagnostics, spellcheck) are
   `overlay` range highlights. Every other highlight kind paints only mounted rows and skips work
   when its signature is unchanged (`renderPaintGroup` in Editor
   `packages/editor/src/virtualization/virtualizedTextViewHighlights.ts`). Overlays do not:
   `renderTokenHighlights` calls `refreshHighlightOverlayMask` whenever the text snapshot changed,
   and that rebuilds the flattened mask over every overlay range in the document
   (`buildHighlightOverlayMask`, `highlightOverlay.ts`). It also clears and re-renders every paint
   group, re-splits colour twins, re-orders the registry and rewrites the style rules. The cost
   scales with the number of diagnostics and misspellings in the whole file, once per keystroke and
   again on each diagnostics publish.
2. **The mask reads one code unit per range edge** through `TextSnapshot.readRange` to avoid
   splitting surrogate pairs, and each read runs the performance-diagnostics hook
   (`recordEditorPerformanceDiagnostic('textSnapshot.read', …)` in `documentTextSnapshot.ts`).
   The hook's sink lookup alone took 532 ms of the 30-key window at 5 MiB.

Memory is a separate limit: the TypeScript language server's process tree reaches 3 GB at 10 MiB
and 4–5.6 GB at 15 MiB, and Shiki's worker holds 258 MB at 10 MiB against Tree-sitter's 13 MB.

## Goal

A keystroke fits in one frame. Owner direction, 2026-09-28: 10 MiB is a small file, and the bar is
a 120 Hz frame (8.3 ms), with a 60 Hz frame (16.7 ms) as the floor that must never be missed.

Targets, on the same benchmark and fixture, with the frame-accurate metric from step 0:

- 10 MiB TypeScript with analysis on, both engines: main-thread work per keystroke p95 under
  8.3 ms; no keystroke over 16.7 ms.
- Plain text meets the same budget at every size up to the 200 MiB open limit.
- A keystroke's work does not grow with the number of diagnostics, misspellings or tokens outside
  the mounted rows: profiles at 1 and 10 MiB show the same cost.
- 10 MiB is the floor for the analysis tier, not its ceiling. Raise it to the largest size that
  still meets the frame budget and the memory scope.

Overlay marks are the first and largest cost to remove. Whatever the step 0 profiles show next in
the per-keystroke path belongs to this plan too, until the budget holds.

## Steps

### 0. A metric that can see under one frame, then attribution (Platform)

Today's metric cannot show a 120 Hz result. `scripts/large-file/run.ts` times `keydown.timeStamp`
to the next `requestAnimationFrame` in headless Chromium, which runs at 60 Hz, so every keystroke
reads 8–17 ms however little work it does. Plain text's 16 ms p95 is that interval, not the
editor's cost. Replace it with the main-thread time a keystroke causes: input event processing
plus the rAF and style/layout/paint it triggers, taken from the trace (Event Timing
`processingEnd`, the frame's main-thread tasks), and run Chromium unthrottled
(`--disable-frame-rate-limit`, `--disable-gpu-vsync`) so frames are not quantized. Keep the old
number in the rows for comparison, and prove the new metric on plain text first: a 1 MiB file
should read well under 8.3 ms.

Then re-run 10 MiB TypeScript with, in turn, the language server off, spellcheck off, and both off,
for both engines. This splits the typing cost between LSP overlays, spelling overlays and
everything else, and checks that the overlay path is the one worth fixing first. Record the rows
in the results report. Add the switches to `scripts/large-file` if the benchmark cannot select
them yet.

### 1. Viewport-scoped overlay painting (Editor, the main item)

Treat overlays like other range highlights:

- Keep each overlay group's ranges sorted, as `setRangeHighlight` already does, and flatten
  overlaps only for the ranges that intersect the mounted rows, when those rows paint. The
  document-wide `highlightOverlayMask` goes away, along with `highlightOverlaySnapshot` and the
  snapshot-changed trigger in `renderTokenHighlights`.
- Give overlay paint groups the same signature check as `renderPaintGroup`, so scrolling or an
  unrelated edit repaints only rows whose overlay parts changed.
- Split token and colour twins against the overlay parts of mounted rows only.
- Check surrogate edges only for ranges being painted, reading the mounted row text the view
  already holds.
- Rewrite style rules only when the set of distinct overlays changes (a new decoration kind),
  never per edit.

Keep what the mask gives today: overlapping overlays combine (dim plus a decoration), colour
highlights inside an overlay keep both styles, and paint order is stable across mount cycles.
Existing tests in `highlightOverlay` and the virtualized-view suites cover those; add one that
counts the ranges touched per keystroke with 10,000 overlay ranges outside the viewport.

### 2. Free text-snapshot reads when diagnostics are off (Editor)

Resolve whether the performance-diagnostics sink is active once per operation or per frame,
not per `readRange`, so the per-read cost is a branch. This alone removes 532 ms per 30 keys at
5 MiB, and it helps every other path that reads snapshot ranges.

### 3. Language-server cost above the analysis tier (Platform, owner decision)

The TypeScript server sets the memory ceiling. After steps 1–2, measure whether syntax and folding
can go higher than language services. If they can, split the tier: syntax to the new analysis
limit, language services to a lower limit of their own. This needs the owner's call, because a
file between the two limits would show colours with no diagnostics or navigation.

### 4. Shiki at large sizes (owner decision)

Shiki paints first colours in 18.6 s at 10 MiB (Tree-sitter: 3.0 s) and is what crashes at
15 MiB. Options: tokenize the viewport first and the rest in the background, or use Tree-sitter
highlighting above a size when the theme allows it. Measure after steps 1–2 and bring the
numbers to the owner before choosing.

### 5. Re-measure and raise the tier (Platform)

Re-run `bench:large-file` at 1/10/20/50 MiB TypeScript for both engines, and plain text through
200 MiB, on a clean committed build. Set `editor.largeFile.analysisLimitMiCodeUnits` to the
largest size that meets the frame budget and the memory scope, update the results report, and
ship. If the language server's memory is what stops the tier, step 3's split applies.

## Out of scope

- Plain-text and paged-viewer work; Plan 112 closed those.
- Minimap token memory: an in-place token projection measured no gain at 10 MiB (Plan 112).
- Changing how diagnostics or spelling are computed. This plan changes how their marks are painted.
