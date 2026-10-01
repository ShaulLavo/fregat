# E052: Wrap and horizontal extent from measured advances when the font is not monospace

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: Approved
- Kind: Implementation
- Owner: Editor
- Priority: P3
- Effort: L
- Dependencies: [E036](../editor/docs/display/e036-monaco-geometry-comparison.md), [E001](../editor/examples/stress/README.md)
- Inspected baseline: `40d841583659d2889fc03f61979e607f56df4c86`, 2026-09-24.

**Proportional part implemented 2026-09-26** (wave 2 lane E2, branch `w2/e2-e052`), see
[As landed](#as-landed-2026-09-26). The compact blank lines absorbed from E022 remain proposed.

Decided 2026-09-25: owner — E052 absorbs E022 (compact blank lines): both are variable row geometry, and they share
the fixed-stride assumption in `virtualizedTextViewLayout.ts`. E022's plan is kept whole in
[Compact blank lines](#compact-blank-lines-absorbed-from-e022) below; its baseline was
`9abb944f3a2b8d6516953fdec75e8df5e1a94811`. Its E001 dependency now belongs to this plan.

## Outcome

A proportional editor font lays out like a monospace one does today. Soft wrap breaks where the
text actually reaches the viewport edge. Long rows keep their left spacer under the text they
stand in for. The horizontal scroll width fits the widest line.

For example, in Noto Sans at 13px, `iiiiiiii` is about a third as wide as `WWWWWWWW`, yet today
both count as eight columns. A line of `i` wraps far short of the edge, a line of `W`
overflows it, and scrolling into the middle of a 2,000-character line jumps sideways by the
difference.

E036 made clicks and carets correct for proportional fonts: `view.monospace` demotes rows to DOM
geometry. Everything the view estimates from `characterWidth` before any row is measured is
still column arithmetic. Monospace fonts must not pay anything for this work.

## Current code

- **Wrap** is column counts end to end.
  - `horizontalViewportColumns` ([rows](../editor/packages/editor/src/virtualization/virtualizedTextViewRows.ts))
    turns the viewport width into `ceil(width / characterWidth)`. `refreshWrapWidth` in
    [virtualizedTextView.ts](../editor/packages/editor/src/virtualization/virtualizedTextView.ts) passes
    that to the projection as `wrapColumn`.
  - [displayProjectionWrap.ts](../editor/packages/editor/src/virtualization/displayProjectionWrap.ts)
    scans whole-document spans in 256-line blocks and counts cells (tabs expand to stops).
  - [displayProjectionText.ts](../editor/packages/editor/src/virtualization/displayProjectionText.ts)
    summarizes one line as `uniform` (`k × width`) or `indexed` (explicit row ends, only when the
    line has tabs). `wrapRange` and `wrapSegmentForColumn` read both shapes.
- **Long rows:** rows over `MAX_SINGLE_NODE_ROW_LENGTH` (512) render a window of chunks. The
  left spacer is `estimatedDisplayCellForColumn(window.start) × characterWidth`, both in the
  plain path and in the inline-run path (`virtualizedTextViewRows.ts`).
- **Horizontal extent:** `applyContentWidth` multiplies `maxVisualColumnsSeen` by
  `characterWidth`. The columns come from `estimatedDisplayRowColumns`.
- **The monospace verdict:** `measureTextMetrics` in
  [browserMetrics.ts](../editor/packages/editor/src/virtualization/browserMetrics.ts) sets it, and it is
  re-read whenever the rendered face changes.
- **Control:** VS Code's `wrappingStrategy: 'advanced'`
  (`references/vscode/src/vs/editor/browser/view/domLineBreaksComputer.ts`, under Platform)
  renders lines into a hidden container at the wrap width and reads the breaks back from the DOM.
  It is exact, but it needs layout per line.

Drift to check again: whether wrap gained word-boundary breaking, and whether the projection
summaries still carry only `uniform` and `indexed` shapes.

## Scope

- **Deliverables:**
  - A per-face advance table.
  - A pixel-width wrap path taken only when `monospace` is false.
  - Pixel prefixes for the long-row spacer and the content width on the same condition.
  - Measurements against real layout.
- **Limits:**
  - No word-boundary wrapping. Breaks stay at code units, as today.
  - No change to monospace behavior or cost.
  - No kerning or ligature shaping beyond what the error budget below allows.
- **Platform:** nothing. `editor.fontFamily` already reaches the editor, and demotion is automatic.

## Design

The decision that needs evidence is whether a cached advance table is accurate enough, or whether
only DOM line breaking (VS Code's approach) is.

- **Advance table (proposed `glyphAdvances.ts`):** an `OffscreenCanvas` 2D context set to the
  computed font shorthand of the scroll element. It is keyed like the metrics cache, and cleared
  by the same face observer. `advance(codePoint)` fills a `Float32Array` for BMP code points
  lazily and a `Map` above that. Tabs keep tab stops, measured in space advances.
- **Wrap:** when `monospace` is false, the projection is configured with
  `wrapWidthPx` and the table instead of `wrapColumn`. Lines use a new summary shape `measured`
  that holds explicit row ends, like `indexed`. Breaks are placed where the running advance would
  exceed the width minus a safety margin (proposed 0.5 px per 100 glyphs, tuned in step 1). The
  margin makes the error one-sided: a line may wrap a glyph early, never overflow.
- **Spacer and extent:** a pixel prefix sums advances up to `window.start`. That is O(window
  start) per mount, so keep a per-row prefix cache keyed by text version and face. The content
  width uses the same per-row sum in place of `maxVisualColumnsSeen × characterWidth`.
- **Ownership:** the view owns the table and its lifetime, and the projection only reads it. No
  DOM access enters the projection.

## Steps

1. **Accuracy gate.** Using `examples/stress/geometry.mjs --font-check`, compare table-summed
   widths with `Range` widths for 2,000 real lines (Platform sources, Markdown, CJK) in Noto Sans,
   Liberation Sans and a CJK face. Evidence: the error distribution in px per line length, and the
   margin that keeps overflow at zero.
2. **Cost gate.** Wrap the 500,000-line fixture with the table and with the column path, and
   record build time and memory. Evidence: both numbers. If the table path is more than 3× the
   column path, prototype DOM line breaking for mounted rows only before going further.
3. **Wrap path.** Add the `measured` summary and the configuration switch. Evidence: projection
   unit tests and the browser tests below.
4. **Spacer and extent.** Evidence: browser tests below, and `bench:virtualization` unchanged for
   monospace.
5. **Monospace control.** Run the E002 input-latency gate and the first-paint matrix with a
   monospace font, before and after. Evidence: no regression beyond the gates' tolerance.

## Verification

- **Wrap:** a browser test that fails when a proportional wrapped row's DOM width exceeds the
  viewport (overflow), or falls short of it by more than one glyph advance (early wrap).
- **Spacer:** a browser test that scrolls to the middle of a 2,000-character proportional line
  and fails when the glyph under a fixed x differs from the one before scrolling (spacer drift).
- **Extent:** a browser test that fails when `scrollWidth` does not reach the end of the widest
  proportional line, or leaves more than one advance of slack.
- **Face changes:** a test that swaps a monospace face for a proportional one and back on a
  mounted editor. It fails if wrap, spacer or extent keep the old face's numbers.
- **Existing suites:** `bun run test` in `packages/editor`. The proportional-font, projection and
  geometry suites must stay green with monospace fonts.

## Risks and decisions

- **Canvas and CSS disagree:** font-feature settings, `letter-spacing` and synthetic styles may
  shape text differently from `measureText`. Step 1's margin must absorb this. If it cannot
  without visible early wraps, use DOM line breaking.
- **Kerning:** pair kerning makes widths context dependent. Summing single glyphs is
  approximate, and the margin exists for that.
- **Late fonts:** a web font arriving late must rebuild the table and the projection together.
  The E036 face observer already signals it; wire both to the same signal.
- **Stop condition:** if step 1 shows no margin under 2 px per line prevents overflow, record a
  no-go for the table and leave proportional wrap on DOM measurement of mounted rows only.

## As landed (2026-09-26)

Drift since the baseline: word-boundary wrap landed first (`wordWrapBreak: 'word'`, Plan 171 phase 2),
so the "no word-boundary wrapping" limit is gone and the measured path serves both break modes.

- **Step 1, accuracy gate** (`test/glyphAdvances.browser.test.ts`, Chromium, 13px, 2,000 real lines of
  this repo's docs and source plus CJK and Hangul prose): layout ran wider than the summed table by at
  most 0.53 px per line in Noto Sans, 0.02 px in Liberation Sans and 0.63 px in Noto Sans CJK JP, and
  narrower by at most 6.2, 5.8 and 9.4 px. A constant 1 px margin (`PROPORTIONAL_WRAP_MARGIN_PX`) keeps
  overflow at zero, well under the 2 px stop condition; the per-glyph margin was not needed.
- **Step 2, cost gate** (`bun run bench:transforms`, 500k lines with folds, stand-in advance table,
  shared machine at load 17–29): column wrap 82–118 ms, word wrap 161–165 ms, measured wrap
  197–208 ms, under the 3× limit. No DOM line breaking was prototyped.
- **Step 3, wrap path:** `glyphAdvances.ts` reads advances from a 2D canvas set to the scroll element's
  face (BMP in a lazily filled `Float32Array`, astral in a `Map`), cached per face and dropped with the
  metrics cache. The view holds them only while the face is not monospace (`view.glyphs`) and hands the
  projection a `wrapAdvance` (row width in px minus the margin, plus the table). The projection
  summaries and the block scan share one breaker (`wordWrap.ts`) for word breaks and measured widths;
  plain monospace column wrap keeps its own loop. Rows that break are stored as explicit ends, the
  `measured` shape the design proposed being the existing `indexed` one.
- **Step 4, spacer and extent:** `proportionalRows.ts` keeps pixel prefixes every 512 code units per
  long row. The left spacer, the window a scroll offset mounts (`proportionalChunkWindow`) and the
  content-width scan read them when `view.glyphs` is set. Rows holding rendered widgets use the same
  pixel window, adjusting both its bounds and the spacer for each measured widget width.
- **Step 5, monospace control:** `bench:virtualization` A/B against the word-wrap branch, three
  alternating rounds at load 17: wrap-enable 35.6–38.7 ms before, 35.4–39.4 after; wrap-resize
  34.4–42.5 before, 35.5–40.6 after. The E002 input-latency gate and the first-paint matrix were
  **not run**: they need a quiet machine, and eight lanes shared it. The monospace path is unchanged in
  code: every new branch is behind `view.glyphs`, which is null for a monospace face.
- **Tests:** `test/proportionalWrap.browser.test.ts` (character and word wrap fill each row to the edge
  without passing it; a face swap rewraps), `test/proportionalRows.browser.test.ts` (extent reaches the
  widest line within two advances; the text under the viewport after scrolling a 20,000-character row
  is what a full-width layout puts there). Four of the five fail on the column path.
- **Not done:** Firefox and WebKit runs of the new browser tests; kerning or ligature shaping beyond
  the margin.

### PR #46 review fixes (2026-09-26)

- Widget rows now choose their horizontal window from measured text advances, with measured widget
  widths replacing placeholder advances in both the window lookup and the left spacer.
- Applying changed font metrics resets the grow-only content-width scan even with wrapping disabled.
- `proportionalRows.browser.test.ts` reproduces the blank viewport on a 20,000-character proportional
  row with 40px and 800px widgets, and the stale extent after a monospace-to-proportional face swap.
  Both fail before these fixes and pass after. The reverse face swap is covered too. The face test
  uses `VirtualizedTextView` directly because the full Editor can refresh projection state separately.

## Compact blank lines (absorbed from E022)

From E022, "Prove compact blank lines with correct geometry" (Research, P2, M), as it stood on
2026-09-25. Its horizontal and vertical halves meet in one row-geometry authority; design that
authority once.

### Outcome

Determine whether optional shorter empty lines can show more code while preserving accurate caret, scroll, and pointer behavior.
An empty row may occupy half the normal line height, but the file text and logical line numbers remain identical.
The result is a measured prototype and a go/no-go implementation decision, including the chosen row-height representation.
It does not promise that compact layout is cheap or production-ready before the geometry work is measured.

### Current code

- [fixedRowVirtualizer.ts](../editor/packages/editor/src/virtualization/fixedRowVirtualizer.ts) already accepts `rowSizes`
  and can derive virtual rows from a variable-height index.
- [rowHeightIndex.ts](../editor/packages/editor/src/virtualization/rowHeightIndex.ts) stores dense sizes and prefix starts.
  Updating scans for the first change and rewrites the suffix. Its update transfers ownership of previous offset storage.
  A one-line change near the top can therefore do work proportional to the document's row count.
- [virtualizedTextViewLayout.ts](../editor/packages/editor/src/virtualization/virtualizedTextViewLayout.ts) currently passes
  only count, row gap, and uniform height to the virtualizer. `rowTop` multiplies row by stride.
  Pointer-row lookup also uses fixed-stride arithmetic. Wiring `rowSizes` alone would leave hit testing inconsistent.
- [virtualizedTextViewGeometry.ts](../editor/packages/editor/src/virtualization/virtualizedTextViewGeometry.ts),
  [selection painting](../editor/packages/editor/src/virtualization/virtualizedTextViewSelectionLayer.ts), and
  [displayTransforms.ts](../editor/packages/editor/src/displayTransforms.ts) are downstream geometry consumers.
- Existing [virtualizer tests](../editor/packages/editor/test/fixedRowVirtualizer.test.ts) cover the retained index path.
  Text-view geometry has both happy-dom and real-browser tests.
  The wishlist correctly says no production text-row producer feeds variable sizes today.

### Scope

Compare a dense variable-height prototype with a representation that stores compact-row exceptions or runs.
Include real text-row layout, caret rendering, pointer mapping, scroll anchoring, and toggling in the Editor demo.
Use strictly empty logical lines initially. Whitespace-only lines introduce wrap and indentation-display choices that need separate evidence.
Do not fake compaction by squashing glyphs while retaining the original scroll footprint; that cannot show more code.
Editor owns reusable layout options. Platform owns any eventual preference registration and app setting UI.
Do not redesign the entire display-transform stack unless the measurements identify a necessary shared contract.
[E031](../editor/docs/performance/e031-projection.md) has landed: prototype against its projection/geometry
owner; do not reintroduce an eager display-row array for compact heights. Row geometry is still a
fixed stride (`virtualizedTextViewLayout.ts`), which it shares with E052.

### Design

Proposed `BlankLineLayout` is disabled or enabled with a validated height ratio.
The ratio scales the measured normal line height and stays positive to preserve navigable rows and caret visibility.
Define eligible rows from document content after folding/wrapping projection, with provenance back to the logical line.
Fold placeholders, injected text, diff-only rows, and wrapped continuations keep their declared normal height in the first prototype.
The viewport model owns the projected geometry for its own document/layout revision.
Two views sharing a buffer can use different blank-line policies without altering each other's line maps.

Prototype A uses the existing dense `RowHeightIndex` as the correctness baseline.
Pass the same geometry authority to virtualizer windowing, row top lookup, hit testing, selection painting, and reveal calculations.
Do not reuse an index after `updateRowHeightIndex` has transferred its mutable prefix storage.
Keep normal layout on its existing arithmetic path when compaction is disabled.

Prototype B stores height exceptions or runs with prefix aggregates and explicit edit ranges.
Compare memory, lookup cost, insertion/deletion cost, and blank/nonblank transitions against the dense baseline.
An unchanged line must not trigger a whole-document blank-line scan on every keystroke.
Track eligibility incrementally from document edits; rebuild only when projection or policy invalidates the relevant representation.
Measure initial classification separately from typing updates and scroll lookup.
Choose the simplest representation that satisfies the measured budget, including ordinary files.

All consumers answer vertical positions from the chosen row geometry.
An empty row gets a visible, unclipped caret and a pointer target covering its actual smaller rectangle.
Vertical navigation still moves by displayed rows. Page navigation uses viewport pixels and the geometry lookup.
When toggling, preserve a document anchor and its intra-row pixel position, then recompute and clamp scroll.
Font/zoom changes invalidate scaled heights. Pending layouts publish only if their document and projection revisions still match.
Disposal releases indexes and pending classification work.

Keep minimap line density uniform in the first prototype, but calculate its viewport indicator and click mapping consistently.
If the minimap contract assumes editor pixels are proportional to logical rows, record the required adapter change.
Decide whether mirrored compaction improves navigation only after comparing the two visuals in the same fixture.

### Steps

1. Add compact-layout scenarios to [E001](../editor/examples/stress/README.md)'s fixtures and record the normal-layout baseline.
   Include alternating empty lines, long blank runs, huge files, folds, wraps, injected rows, and edits near the top.
2. Build prototype A and route all vertical mapping through one row geometry contract.
   Prove a click, caret rectangle, and virtualized row agree before benchmarking it.
3. Build prototype B behind the same demo picker and compare results on the same document revisions.
   Record classification cost, update cost, retained bytes, scroll lookup, and paint correctness.
4. Exercise interactions in a real browser, including toggle during typing, zoom, split views, and scrolling at the bottom.
   Inspect the actual caret and row rectangles rather than relying on the height-index unit test.
5. Write a decision record with raw benchmark artifacts, chosen eligibility/minimap policies, and the required production edits.
   If neither representation meets the measured budget, keep uniform layout and state the specific blocking cost.

### Verification

- Extend `fixedRowVirtualizer.test.ts` with boundary offsets, row gaps, fractional heights, and changed prefix geometry.
  These catch off-by-one visible windows and reuse of retired index storage.
- Add model tests for one line changing between empty/nonempty, line insertion/deletion, and policy changes.
  Count classification work to catch a hidden full-document scan on each edit.
- Extend `virtualizedTextViewGeometry.browser.test.ts` and the view browser tests with compact-line fixtures.
  Verify pointer hits, caret bounds, selection bands, reveal/page navigation, and scroll anchoring against actual rectangles.
- Test folded and wrapped content, selection spanning compact rows, IME at an empty line, zoom, and a minimap-enabled demo.
  Assert logical text and document line numbers remain unchanged when compaction toggles.
- Use `bun run bench:virtualization` and `bun run bench:transforms` in `packages/editor` as existing measurement entry points.
  Run focused browser files through `bun run test --project browser`, reusing the current development environment.
- Acceptance is a measured go/no-go decision with reproducing fixtures, correct geometry, and a bounded update design.
  A production public option additionally requires built-export checks and framework consumer typechecks when implemented.

### Risks and decisions

The retained variable-height index does not make the text view variable-height ready. Fixed-stride assumptions are the main correctness risk.
Sparse indexes may save memory while making every scroll lookup slower. Measure both before choosing one.
Whitespace-only line compaction can hide meaningful indentation or wrap into several rows; keep it outside the first eligibility policy.
If caret legibility requires a minimum pixel height, derive and verify that rule in the browser rather than selecting an arbitrary ratio.
