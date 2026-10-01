import { renderCursorState } from './cursor.js'
import type { RenderRow } from '../core/types.js'
import type { RendererFrameRow, RendererFrameSnapshot, RenderStateSource } from './renderer.js'

export function copiedFrameRow(row: RenderRow): RendererFrameRow {
  const renderCells = Object.freeze(
    row.cells.map((cell) =>
      Object.freeze({
        ...cell,
        background: cell.background ? Object.freeze({ ...cell.background }) : undefined,
        foreground: cell.foreground ? Object.freeze({ ...cell.foreground }) : undefined,
        style: cell.style ? Object.freeze({ ...cell.style }) : undefined,
      }),
    ),
  )
  const cells = Object.freeze(renderCells.map((cell) => cell.text))
  const continuations = Object.freeze(renderCells.map((cell) => cell.continuation))
  const text = cells.map((cell, index) => (continuations[index] ? '' : cell || ' ')).join('')
  return Object.freeze({ cells, continuations, renderCells, text, y: row.y })
}

export function snapshotRenderState(state: RenderStateSource): RendererFrameSnapshot {
  state.update()
  const cursor = state.readCursor()
  return Object.freeze({
    cursor: Object.freeze({
      ...cursor,
      viewport: cursor.viewport ? Object.freeze({ ...cursor.viewport }) : undefined,
    }),
    paintedCursor: renderCursorState(cursor, true),
    rows: Object.freeze(state.readRows().map(copiedFrameRow)),
  })
}
