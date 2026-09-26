// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
import type { FileTreeLayoutSnapshot, FileTreeVisibleRow } from '@workspace/tree'

import type { TreeParkedRow } from '@/features/workspace/components/tree-row-window'
import { getParkedFocusedRowOffset } from '@/features/workspace/utils/tree-focus'

/**
 * Where the row window sits in the list, and the rows parked beside it: the focused row while
 * focus or a filter restore needs its element, and the dragged row while it is off screen.
 */
export function treeWindowFrame({
  controller,
  draggedPrimaryPath,
  draggedRowSnapshot,
  focusedIndex,
  focusedPath,
  focusedRowIsMounted,
  itemHeight,
  layoutSnapshot,
  range,
  resolvedViewportHeight,
  shouldRenderParkedFocusedRow,
  stickyOverlayHeight,
  visibleRows,
}: {
  readonly controller: { getVisibleRows(start: number, end: number): readonly FileTreeVisibleRow[] }
  readonly draggedPrimaryPath: string | null
  readonly draggedRowSnapshot: FileTreeVisibleRow | null
  readonly focusedIndex: number
  readonly focusedPath: string | null
  readonly focusedRowIsMounted: boolean
  readonly itemHeight: number
  readonly layoutSnapshot: FileTreeLayoutSnapshot<FileTreeVisibleRow>
  readonly range: { readonly end: number; readonly start: number }
  readonly resolvedViewportHeight: number
  readonly shouldRenderParkedFocusedRow: boolean
  readonly stickyOverlayHeight: number
  readonly visibleRows: readonly FileTreeVisibleRow[]
}) {
  const windowHeight = layoutSnapshot.window.height
  const windowOffsetTop = layoutSnapshot.window.offsetTop
  const windowClipTop =
    stickyOverlayHeight > 0 ? Math.max(0, layoutSnapshot.projected.paneTop - windowOffsetTop) : 0
  // The virtualized window is usually taller than the viewport once overscan
  // is included, so a negative sticky inset lets the overscanned slice hang
  // above and below the scroll container without pinning the element during
  // normal scrolling. Both edges together catch the window when React falls
  // behind a fast scroll in either direction, which is what keeps the list
  // from blanking mid-flick.
  //
  // The bottom edge gets the `stickyOverlayHeight` allowance because sticky
  // folders can bump `windowOffsetTop` below `scrollTop`; loosening only that
  // edge keeps the synced window from being pulled upward. The top edge stays
  // tied to the viewport bottom so a lagging window still fills the view while
  // the user scrolls quickly downward.
  const windowStickyTopInset = Math.min(0, resolvedViewportHeight - windowHeight)
  const windowStickyBottomInset = Math.min(
    0,
    resolvedViewportHeight - windowHeight - stickyOverlayHeight,
  )
  const parkedFocusedRow =
    focusedPath != null && shouldRenderParkedFocusedRow && !focusedRowIsMounted && focusedIndex >= 0
      ? (visibleRows[focusedIndex] ??
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ??
        null)
      : null
  const parkedFocusedRowOffset =
    parkedFocusedRow == null
      ? null
      : getParkedFocusedRowOffset(focusedIndex, itemHeight, range, windowHeight)
  const draggedRowIsMounted =
    draggedPrimaryPath != null &&
    draggedRowSnapshot != null &&
    draggedRowSnapshot.path === draggedPrimaryPath &&
    draggedRowSnapshot.index >= range.start &&
    draggedRowSnapshot.index <= range.end
  const parkedDraggedRow =
    draggedPrimaryPath != null &&
    draggedRowSnapshot != null &&
    draggedRowSnapshot.path === draggedPrimaryPath &&
    !draggedRowIsMounted &&
    draggedRowSnapshot.path !== parkedFocusedRow?.path
      ? draggedRowSnapshot
      : null
  const parkedDraggedRowOffset =
    parkedDraggedRow == null
      ? null
      : getParkedFocusedRowOffset(parkedDraggedRow.index, itemHeight, range, windowHeight)
  const parkedFocused: TreeParkedRow | null =
    parkedFocusedRow != null && parkedFocusedRowOffset != null
      ? { offset: parkedFocusedRowOffset, row: parkedFocusedRow }
      : null
  const parkedDragged: TreeParkedRow | null =
    parkedDraggedRow != null && parkedDraggedRowOffset != null
      ? { offset: parkedDraggedRowOffset, row: parkedDraggedRow }
      : null
  return {
    clipTop: windowClipTop,
    height: windowHeight,
    offsetTop: windowOffsetTop,
    parkedDragged,
    parkedFocused,
    stickyBottomInset: windowStickyBottomInset,
    stickyTopInset: windowStickyTopInset,
  }
}
