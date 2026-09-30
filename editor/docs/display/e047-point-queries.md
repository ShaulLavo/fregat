# E047: Point and row queries

Implemented 2026-09-21 in Editor `6656eb7`; Platform Plan 130 Phases 1 and 4 consume it
(`ee6f97e0`). A plugin or host asks the editor what sits under a pointer and gets the answer the
view gives under wrap, folds, injected rows and the gutter band.

- `Editor` and contribution contexts expose `rowAtPoint`, `markerAtPoint` and
  `textOffsetFromPoint`. Point queries and selection positions share `locatePoint`; drag selection
  keeps its outside-viewport clamping and bidi affinity.
- Viewport bounds are cached for one animation frame; queries read current scroll coordinates.
  100 queries in one frame cost one viewport read.
- The hidden-character layer registers each painted marker, including an invisible character's 2px
  width, and clears it when the row is recycled.
- The diff plugin's `rowHitAt` asks `rowAtPoint`. Its DOM attribute read and Y scan are deleted.

Validation: seven Chromium point-query tests (wrapped rows, a folded block and the row below it,
gutter band, markers) and the wrapped diff-row regression. In Platform, the `git-diff-line-comment`
scenario's mousemove dispatches contain no Layout events.
