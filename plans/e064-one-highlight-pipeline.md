# E064: One highlight pipeline for tokens and range highlights

- Status: Approved
- Kind: Design
- Owner: Editor
- Priority: P2
- Effort: L
- Dependencies: none
- Related: [Platform Plan 197](../../platform/plans/197-editor-highlighting-service.md) owns
  _computing_ highlights (one service over Shiki and tree-sitter); this plan owns _painting_ them.
  [Platform Plan 201](../../platform/plans/201-cheap-overlay-marks.md) owns the overlay underline
  mask, which this plan leaves out of scope.
- Inspected baseline: `6d8269f39eb40e38d0e8b1de90f353923396bc8c` (main)

## Outcome

The view paints coloured spans through two separate pipelines. Syntax tokens have one:
per-row reconcile, `StaticRange`s, a same-line edit record and a live-range carry-over.
Range highlights have another: live `Range`s rebuilt per group, with no knowledge of edits. Find,
diagnostics, spellcheck, links, occurrences, bracket colours, diff and semantic tokens all paint
through the second, and semantic tokens paint token-shaped data through it one group per colour.

We want one pipeline that every painter uses, so an improvement made for one reaches all of them.
For example, moving range highlights from live `Range` to `StaticRange` should be one change to
the shared layer, not a second copy of the token machinery.

## Current code

- `packages/editor/src/virtualization/virtualizedTextViewHighlights.ts` (1786 lines) holds both
  paths. Tokens: `renderTokenHighlights`, `reconcileTokenHighlightsAfterSameLineEdit`,
  `addTokenSegmentsForRow`, `canKeepLiveTokenRanges`. Range highlights: `setRangeHighlight`,
  `renderPaintGroup`, `rangeHighlightSignature`, `addRangeHighlightToChunk`.
- `addTokenRangeToChunk` (`virtualizedTextViewHelpers.ts`) builds a `StaticRange`, falling back to
  a live `Range`. `addRangeHighlightToChunk` always builds a live `Range` via
  `createDomRangeForChunkRange`.
- Same-line edits patch the row's text node with `replaceData` (`virtualizedTextViewRows.ts`).
  Live range highlights shift with that patch; nothing projects `rangeHighlightGroups` through an
  edit. A re-render before the owner re-pushes (multi-line edit, rows mounting on scroll) rebuilds
  from pre-edit offsets. This is a latent bug today, separate from the range type.
- `packages/editor/src/semanticTokenLayer.ts` maps semantic tokens onto range-highlight groups,
  one per resolved style.
- `test/semanticTokenRepaintCost.test.ts` reports "GATE 2" as a known failure: repainting about
  16 semantic groups per keystroke against find's 3. That ratio is structural and not a target.

Measured 2026-09-29 in Chromium through a temporary browser probe of the same loop (200 rows,
20-row viewport, 20 ranges per group, best of five rounds). Per keystroke, live `Range` versus
`StaticRange`: 3 groups 0.51 vs 0.074 ms, 16 groups 1.3–1.6 vs 0.21 ms. happy-dom has no
`StaticRange`, so the dom-project numbers mostly measure happy-dom's `Range.setStart`.

## Scope

- A single paint layer abstraction inside the view: styled spans in document offsets, projected
  through every edit, reconciled per mounted row, painted with `StaticRange`, styled by shared rules.
- Tokens, range highlights and the semantic layer as clients of it. Painter-facing APIs
  (`setRangeHighlight`, `setTokens`/`adoptTokens`, `EditorSemanticTokensContribution`) keep their
  shape unless a step shows a change is needed.
- Out of scope: selection and caret painting, overlay masks, and Platform. Hosts only see the
  existing APIs.

## Design

The decision that needs evidence is how far the two paths merge:

1. **Shared projection and range building only.** Range highlights gain edit projection and use
   the token path's `StaticRange` builder. Two render loops stay.
2. **One layer type, two front ends.** Tokens and range groups both become layers with per-row
   reconcile; the token store stays the token front end.
3. **Semantic tokens as tokens.** The semantic layer feeds the token store (or a second token
   layer) and stops using one range group per colour.

Edit projection is shared by all three: a span entirely before the edit is unchanged, one after it
shifts by the length delta, and one that overlaps it follows the rules row decorations already use
(`projectRowDecorationMapThroughEdits`). After projection, an owner's re-push of identical spans
hits `canSkipRangeHighlightUpdate` and costs nothing.

## Steps

1. Inventory every painter's contract: when it re-pushes, whether it relies on live-range shifting,
   and its z-order and overlay rules. Evidence: a table in this plan.
2. Add edit projection for range groups behind the current live `Range`s, with tests that re-render
   between edit and re-push. Evidence: the latent stale-offset bug fixed with no paint change.
3. Switch range groups to `StaticRange`. Evidence: the Chromium probe committed as a browser
   benchmark, compared before and after under the same conditions.
4. Choose design 1, 2 or 3 from steps 1–3 and the size of the merged code; record the decision.
5. Implement the chosen merge, deleting whichever path it replaces.

## Verification

- Browser tests (`*.browser.test.ts`) for find and diagnostics while typing in the matched row:
  the span stays on the same characters between keystroke and re-push. Catches unprojected static
  ranges.
- A test that scrolls new rows in between an edit and a re-push. Catches the stale-offset rebuild.
- `highlightPaint.browser.test.ts` in Chromium, Firefox and WebKit. Catches the repaint nudge and
  z-order regressions.
- The committed Chromium benchmark. Acceptance: no configuration gets slower, and 16 groups stay
  well inside the 8.3 ms keystroke budget.

## Risks and decisions

- Merging can exceed today's complexity. Stop at design 1 if 2 or 3 does not delete more code than
  it adds.
- Overlapping spans under edits: the projection rules must match what live ranges did, or the
  change becomes a visible behaviour change. Record any difference and ask before shipping it.
- Firefox and WebKit handle `StaticRange` highlights differently (the Gecko repaint nudge exists
  for this). Step 3 runs all three engines.
