// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { FileTreeVisibleRow } from '@workspace/tree'
import type { JSX, RefObject } from 'react'

import { TreeRow, type TreeRenderRowFrame } from '@/features/workspace/components/tree-row'

/** A row kept mounted outside the window, invisible, so focus or a drag keeps its element. */
export type TreeParkedRow = { readonly row: FileTreeVisibleRow; readonly offset: number }

/**
 * The windowed rows inside a list as tall as every row. The window sticks with negative insets so
 * a render that falls behind a fast scroll still fills the view in either direction.
 */
export function TreeRowWindow({
  clipTop,
  draggedPrimaryPath,
  frame,
  height,
  listRef,
  offsetTop,
  parkedDraggedRow,
  parkedFocusedRow,
  rangeStart,
  rows,
  stickyBottomInset,
  stickyTopInset,
  totalHeight,
}: {
  readonly clipTop: number
  readonly draggedPrimaryPath: string | null
  readonly frame: TreeRenderRowFrame
  readonly height: number
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly offsetTop: number
  readonly parkedDraggedRow: TreeParkedRow | null
  readonly parkedFocusedRow: TreeParkedRow | null
  readonly rangeStart: number
  readonly rows: readonly FileTreeVisibleRow[]
  readonly stickyBottomInset: number
  readonly stickyTopInset: number
  readonly totalHeight: number
}): JSX.Element {
  return (
    <div
      ref={listRef}
      data-file-tree-virtualized-list='true'
      style={{ height: `${totalHeight}px` }}
    >
      <div
        data-file-tree-virtualized-sticky-offset='true'
        aria-hidden='true'
        style={{ height: `${offsetTop}px` }}
      />
      <div
        data-file-tree-virtualized-sticky='true'
        style={{
          clipPath: clipTop > 0 ? `inset(${clipTop}px 0 0)` : undefined,
          height: `${height}px`,
          top: `${stickyTopInset}px`,
          bottom: `${stickyBottomInset}px`,
        }}
      >
        {rows.map((row, slotIndex) => (
          <TreeRow key={rangeStart + slotIndex} frame={frame} row={row} />
        ))}
        {parkedFocusedRow != null ? (
          <TreeRow
            key={`parked:${parkedFocusedRow.row.path}`}
            frame={frame}
            row={parkedFocusedRow.row}
            options={{
              isParked: true,
              style: {
                left: '0',
                opacity: '0',
                pointerEvents:
                  draggedPrimaryPath === parkedFocusedRow.row.path ? 'none' : undefined,
                position: 'absolute',
                right: '0',
                top: `${parkedFocusedRow.offset}px`,
              },
            }}
          />
        ) : null}
        {parkedDraggedRow != null ? (
          <TreeRow
            key={`parked-drag:${parkedDraggedRow.row.path}`}
            frame={frame}
            row={parkedDraggedRow.row}
            options={{
              isParked: true,
              style: {
                left: '0',
                opacity: '0',
                pointerEvents: 'none',
                position: 'absolute',
                right: '0',
                top: `${parkedDraggedRow.offset}px`,
              },
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
