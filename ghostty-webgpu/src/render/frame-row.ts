import type { RenderCell, RenderRow } from '../core/types.js'
import type { RendererFrameCell, RendererFrameRow } from './renderer.js'

function copiedCells(cells: readonly RenderCell[]): readonly RendererFrameCell[] {
  return Object.freeze(
    cells.map((cell) =>
      Object.freeze({
        ...cell,
        background: cell.background ? Object.freeze({ ...cell.background }) : undefined,
        foreground: cell.foreground ? Object.freeze({ ...cell.foreground }) : undefined,
        style: cell.style ? Object.freeze({ ...cell.style }) : undefined,
      }),
    ),
  )
}

export function copiedFrameRow(row: RenderRow): RendererFrameRow {
  return ownedFrameRow(row)
}

export function paintedFrameRow(row: RenderRow, readText: () => string): RendererFrameRow {
  return ownedFrameRow(row, readText)
}

function ownedFrameRow(row: RenderRow, readText?: () => string): RendererFrameRow {
  const packed = row.packed
  const length = packed?.length ?? row.cells.length
  let cells: readonly string[] | undefined
  let continuations: readonly boolean[] | undefined
  let text = ''
  if (!readText) {
    for (let index = 0; index < length; index += 1) {
      const cell = packed ? packed.text(index) : row.cells[index]!.text
      const continuation = packed ? packed.continuation(index) : row.cells[index]!.continuation
      text += continuation ? '' : cell || ' '
    }
  }
  // Packed records own detached storage; styled cells decode only for snapshot consumers.
  let renderCells = packed ? undefined : copiedCells(row.cells)
  const result = {
    get renderCells(): readonly RendererFrameCell[] {
      return (renderCells ??= copiedCells(packed!.materialize()))
    },
    get cells(): readonly string[] {
      return (cells ??= Object.freeze(
        Array.from({ length }, (_, index) =>
          packed ? packed.text(index) : renderCells![index]!.text,
        ),
      ))
    },
    get continuations(): readonly boolean[] {
      return (continuations ??= Object.freeze(
        Array.from({ length }, (_, index) =>
          packed ? packed.continuation(index) : renderCells![index]!.continuation,
        ),
      ))
    },
    text,
    y: row.y,
  }
  if (readText) {
    let paintedText: string | undefined
    Object.defineProperty(result, 'text', {
      enumerable: true,
      get() {
        return (paintedText ??= readText())
      },
    })
  }
  return Object.freeze(result)
}
