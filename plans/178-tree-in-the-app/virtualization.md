# Plan 178: virtualization on VirtualList

- Status: PROPOSED. Size L. After [app-owned-state](app-owned-state.md) and
  [Plan 181](../181-chat-timeline-end-anchoring.md) (TanStack upgrade, stable key, chat on end
  anchoring); before [keyboard-and-selection](keyboard-and-selection.md) and
  [drag-and-drop](drag-and-drop.md).
- Owns: teaching `VirtualList` what the tree's windowing does, then deleting the tree's windowing.

## Outcome

The tree windows through `VirtualList`. `VirtualList` gains sticky ancestor chains, several kept
rows, a count-based mode for very large lists, scroll padding under sticky rows, and a reveal
settlement signal. Search results, git changes, diagnostics and references can then pin their group
headers with the same feature.

## Owner direction

2026-09-26: TanStack Virtual is the app's one virtualizer. The tree's windowing ideas move into
`VirtualList`; no second, hand-rolled virtualizer is kept for fixed-height lists. The full search
view keeps its own windowing ([Plan 182](../182-search-view-rendering.md)); the sidebar search list
is already a `VirtualList` consumer. The chat fix runs first as Plan 181.

Measured the same day (latest `virtual-core`, Bun, core only, 20px rows): a row-count change costs
0.10 ms at 10k rows, 0.81 ms at 100k and 4.0 ms at 500k; a scroll step 3–5 µs at any size. The tree
rebuilds its own visible projection on every expand anyway (`#rebuildVisibleProjection`, a full
pass), so TanStack's pass adds under a millisecond at 100k. The browser `trace` below stays the proof.

## Today

**The tree** (`utils/model/layout.ts`, `virtualization.ts`, `FileTreeView.tsx:77-165, 702-900`):

- Fixed row height from `useRowHeight()`, overscan 10, ResizeObserver viewport.
- The controller produces rows lazily: `getVisibleRows(start, end)` (`FileTreeController.ts:524`),
  `getStickyRowCandidates(scrollTop, itemHeight)` (`:626`).
- Sticky folders: every open ancestor, as a translated window of mirrored `aria-hidden` rows; the
  next folder pushes the last sticky row up with clipping; flowing rows under the overlay are cut
  with `clip-path`; the overlay is pre-mounted and hidden at scrollTop 0, revealed on the first
  wheel, touch or key.
- Parked rows: the focused row and the dragged row stay mounted, invisible, outside the window.
- Scroll restore (`initialScrollTop`, `onScrollTopChange`); `scrollToPath` with `nearest | top |
center`, measured below the sticky rows; smooth falls back to `auto` under reduced motion.
- Settlement: a cancelled smooth reveal is re-applied on a late scroll; wheel, pointer, touch or a
  key drops it; a newer request makes it stale (`useFileTreeFocusSync.ts:144-203`).
- A 50ms `data-is-scrolling` flag suppresses hover and menus.

**`VirtualList`** (`packages/ui/src/patterns/virtual-list.tsx`, TanStack Virtual 3.14.2):

- Needs a full `items` array; `'use no memo'`. It passed a new `getItemKey` each render, which
  rebuilt every position per render (0.9 ms at 100k); Plan 181 makes the key stable.
- Keeps one extra row mounted (`activeIndex`, `:94-104`).
- No sticky rows; `rangeExtractor` is not exposed.
- `scrollToIndex` with `auto | start | center | end`; no completion signal, no `scrollPaddingStart`.
- Scroll restore by `initialOffset` + `onScroll` (the git changes pattern).

## Extensions

1. **Count mode.** `count` + `getItem(index)` beside `items`, on the stable `getItemKey` from
   Plan 181. The tree feeds it from `getVisibleRows` without materializing 100k rows.
2. **Kept rows.** `keepMounted: number[]` replaces the single `activeIndex`. The tree keeps the
   cursor row and the dragged rows.
3. **Sticky chain.** `getStickyChain(firstVisibleIndex) → indices` rendered as an overlay with
   push-off, clipping, and the first-frame reveal. The tree's controller supplies the chain; a group
   list supplies its current header. Overlay rows are `aria-hidden` mirrors.
4. **Scroll padding.** `scrollPaddingStart` equal to the sticky overlay's height, used by
   `scrollToIndex` and by the cursor's keep-in-view.
5. **Reveal settlement.** `scrollToIndex` returns or signals completion; the tree's settlement rule
   (re-apply on late scroll, drop on user input) lives in `VirtualList` or a small hook beside it.
6. **Scrolling flag.** A `data-scrolling` attribute on the scroller, set during scroll and 50ms after,
   so rows and menus can suppress hover the way the tree does.
7. **Hidden panes.** Re-apply the saved offset when a pane is shown again. This also unblocks
   Plan 128's `Activity` for `sidebar-panel.tsx`.

## Parity

Parity spec "Scroll and virtualization" and the sticky lines under "Row states": every open ancestor
pinned, push-off, clipping, hidden at the top, no hover while scrolling, reveal with nearest /
top / center under the sticky rows, density change keeps the anchor, collapse clamps scrollTop.

## Delete

`utils/model/layout.ts` (rendering half), `virtualization.ts` defaults, the window and overlay code
in `FileTreeView.tsx`, parked-row code in `focusHelpers.ts`, `scrollTarget.ts`, the settlement in
`useFileTreeFocusSync.ts`. `getStickyRowCandidates` stays in the controller as the chain source.

## Verification

- `trace tree-sticky-scroll --compare` and `trace` on `workspace-open-large-root` against the
  baseline. Count mode is expected to land within about a millisecond of the tree per expand at
  100k rows, and to match it per scroll frame. `directDomUpdates` follows Plan 181's verdict.
- `renders` per scroll frame.
- Harness sticky states. Existing `VirtualList` consumers: `look` and their scenarios
  (`git-changes-scroll`, chat, logs, search).
- A first adopter of the sticky chain outside the tree (the sidebar search results' file group rows) proves the
  feature is general.
