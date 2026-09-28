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
  shouldRenderParkedFocusedRow,
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
  readonly shouldRenderParkedFocusedRow: boolean
  readonly visibleRows: readonly FileTreeVisibleRow[]
}) {
  const windowHeight = layoutSnapshot.window.height
  const windowOffsetTop = layoutSnapshot.window.offsetTop
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
    height: windowHeight,
    offsetTop: windowOffsetTop,
    parkedDragged,
    parkedFocused,
  }
}
