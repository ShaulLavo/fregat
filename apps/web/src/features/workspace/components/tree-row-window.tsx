// Modified for Platform from Pierre. Apache-2.0; see packages/tree/LICENSE-pierre and UPSTREAM.md.
/** @jsxImportSource react */
import type { FileTreeVisibleRow } from '@workspace/tree'
import type { JSX, RefObject } from 'react'

import { TreeRow, type TreeRenderRowFrame } from '@/features/workspace/components/tree-row'
import { useTreeWindowPosition } from '@/features/workspace/hooks/use-tree-window-position'

/** A row kept mounted outside the window, invisible, so focus or a drag keeps its element. */
export type TreeParkedRow = { readonly row: FileTreeVisibleRow; readonly offset: number }

/**
 * The viewport clips flowing rows below the pinned folders; overscan keeps it filled while
 * the native scroll position advances ahead of React.
 */
export function TreeRowWindow({
  draggedPrimaryPath,
  frame,
  height,
  listRef,
  offsetTop,
  parkedDraggedRow,
  parkedFocusedRow,
  rangeStart,
  rows,
  stickyOverlayHeight,
  totalHeight,
  viewportHeight,
}: {
  readonly draggedPrimaryPath: string | null
  readonly frame: TreeRenderRowFrame
  readonly height: number
  readonly listRef: RefObject<HTMLDivElement | null>
  readonly offsetTop: number
  readonly parkedDraggedRow: TreeParkedRow | null
  readonly parkedFocusedRow: TreeParkedRow | null
  readonly rangeStart: number
  readonly rows: readonly FileTreeVisibleRow[]
  readonly stickyOverlayHeight: number
  readonly viewportHeight: number
  readonly totalHeight: number
}): JSX.Element {
  const windowRef = useTreeWindowPosition({
    height,
    listRef,
    offsetTop,
    stickyOverlayHeight,
    totalHeight,
    viewportHeight,
  })
  return (
    <div
      ref={listRef}
      data-file-tree-virtualized-list='true'
      style={{ height: `${totalHeight}px` }}
    >
      <div
        data-file-tree-viewport-clip='true'
        className='sticky overflow-clip'
        style={{
          top: stickyOverlayHeight,
          height: Math.max(0, viewportHeight - stickyOverlayHeight),
        }}
      >
        <div
          ref={windowRef}
          data-file-tree-virtualized-sticky='true'
          style={{
            height: `${height}px`,
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
    </div>
  )
}
