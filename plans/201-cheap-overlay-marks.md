# Plan 201: Cheap underlines, and typing that stays fast with analysis on

Status: proposed 2026-09-28, requested by the owner after [Plan 112](112-large-file-ceiling.md)
closed. Implementation has not started. Owners: Editor for overlay painting and the text-snapshot
diagnostics hook; Platform for the benchmark, the tier thresholds and the language-server policy.

## Why

Plan 112 made plain text fast (10 MiB two-byte text types at 16 ms p95, 200 MiB at 27 ms) and set
the analysis tier to 10 Mi code units. With analysis on, typing is still slow with **either**
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

Overlay marks cost what the other highlight kinds cost: work proportional to the rows on screen
and to the ranges that changed, never to the whole document per keystroke. Then raise the
analysis tier as far as the measurements allow.

Targets, on the same benchmark and fixture:

- 10 MiB TypeScript with analysis on types at p95 under 50 ms with both engines.
- A keystroke's main-thread overlay work does not grow with the number of diagnostics or
  misspellings outside the mounted rows (a profile at 1 and 10 MiB shows the same order of cost).
- The analysis tier moves up from 10 Mi to the largest size that passes the scope with the new
  numbers; 20 Mi is the aim.

## Steps

### 0. Attribute before changing (Platform)

Re-run 10 MiB TypeScript with, in turn, the language server off, spellcheck off, and both off,
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

Re-run `bench:large-file` at 1/5/10/15/20 MiB TypeScript for both engines on a clean committed
build. Set `editor.largeFile.analysisLimitMiCodeUnits` from the new rows, update the results
report, and ship.

## Out of scope

- Plain-text and paged-viewer work; Plan 112 closed those.
- Minimap token memory: an in-place token projection measured no gain at 10 MiB (Plan 112).
- Changing how diagnostics or spelling are computed. This plan changes how their marks are painted.
