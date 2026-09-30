import { CellData, CellWide, GhosttyResult, PointTag, RowData } from './abi.js'
import { assertGhosttyResult, createGhosttyError } from './error.js'
import { requireLayout } from './memory.js'
import type { SelectionCoordinates } from './selection.js'
import type { GhosttyTerminal } from './terminal.js'
import type { ReadLinesOptions, TerminalLine, TerminalSelectionFormatOptions } from './types.js'

// Screen-index lookups traverse history pages; bound synchronous work and decoded allocations.
export const TERMINAL_READ_LINES_MAX_ROWS = 1024
const graphemeCapacity = 64

interface GridTextRow {
  cells: readonly (string | undefined)[]
  wrapped: boolean
  continuation: boolean
  skipped: boolean
}

class GridTextReader {
  private readonly runtime
  private readonly pointLayout
  private readonly coordinateLayout
  private readonly refLayout
  private readonly storage: number
  private readonly storageSize: number
  private readonly point: number
  private readonly ref: number
  private readonly scalar: number
  private readonly codepoints: number
  private readonly length: number
  private readonly coordinate: number

  constructor(private readonly terminal: GhosttyTerminal) {
    this.runtime = terminal.runtime
    this.pointLayout = requireLayout(this.runtime.layouts, 'GhosttyPoint')
    this.coordinateLayout = requireLayout(this.runtime.layouts, 'GhosttyPointCoordinate')
    this.refLayout = requireLayout(this.runtime.layouts, 'GhosttyGridRef')
    const union = requireLayout(this.runtime.layouts, 'GhosttyPointValue')
    const refOffset = Math.ceil(this.pointLayout.size / 8) * 8
    const scalarOffset = Math.ceil((refOffset + this.refLayout.size) / 8) * 8
    this.storageSize = scalarOffset + 16 + graphemeCapacity * 4
    this.storage = this.runtime.memory.allocate(this.storageSize)
    this.point = this.storage
    this.ref = this.storage + refOffset
    this.scalar = this.storage + scalarOffset
    this.length = this.scalar + 8
    this.codepoints = this.scalar + 16
    this.coordinate =
      this.point + this.pointLayout.fields.value!.offset + union.fields.coordinate!.offset
    this.runtime.memory.view.setInt32(
      this.point + this.pointLayout.fields.tag!.offset,
      PointTag.Screen,
      true,
    )
    this.runtime.memory.view.setUint32(
      this.ref + this.refLayout.fields.size!.offset,
      this.refLayout.size,
      true,
    )
  }

  dispose(): void {
    this.runtime.memory.free(this.storage, this.storageSize)
  }

  read(row: number, start = 0, end = this.terminal.size.columns): GridTextRow {
    this.resolve(row, start)
    const wrapped = this.readRowFlag(RowData.Wrap)
    const continuation = this.readRowFlag(RowData.WrapContinuation)
    const wide = this.readWide()
    if (start > 0 && wide === CellWide.SpacerHead) {
      return { cells: [], wrapped, continuation, skipped: true }
    }
    const first = start > 0 && wide === CellWide.SpacerTail ? start - 1 : start
    const cells: Array<string | undefined> = []
    for (let x = first; x < end; x += 1) {
      this.runtime.memory.view.setUint16(this.ref + this.refLayout.fields.x!.offset, x, true)
      const cellWide = this.readWide()
      if (cellWide === CellWide.SpacerHead || cellWide === CellWide.SpacerTail) continue
      cells.push(this.readGrapheme())
    }
    return { cells, wrapped, continuation, skipped: false }
  }

  endsOnSpacerHead(row: number, column: number): boolean {
    this.resolve(row, column)
    return this.readWide() === CellWide.SpacerHead
  }

  private resolve(row: number, column: number): void {
    this.runtime.memory.view.setUint16(
      this.coordinate + this.coordinateLayout.fields.x!.offset,
      column,
      true,
    )
    this.runtime.memory.view.setUint32(
      this.coordinate + this.coordinateLayout.fields.y!.offset,
      row,
      true,
    )
    assertGhosttyResult(
      'ghostty_terminal_grid_ref(SCREEN)',
      this.runtime.exports.ghostty_terminal_grid_ref(this.terminal.handle, this.point, this.ref),
    )
  }

  private readWide(): CellWide {
    assertGhosttyResult(
      'ghostty_grid_ref_cell',
      this.runtime.exports.ghostty_grid_ref_cell(this.ref, this.scalar),
    )
    const cell = this.runtime.memory.view.getBigUint64(this.scalar, true)
    assertGhosttyResult(
      'ghostty_cell_get(WIDE)',
      this.runtime.exports.ghostty_cell_get(cell, CellData.Wide, this.scalar),
    )
    return this.runtime.memory.view.getInt32(this.scalar, true) as CellWide
  }

  private readRowFlag(data: RowData): boolean {
    assertGhosttyResult(
      'ghostty_grid_ref_row',
      this.runtime.exports.ghostty_grid_ref_row(this.ref, this.scalar),
    )
    const row = this.runtime.memory.view.getBigUint64(this.scalar, true)
    assertGhosttyResult(
      'ghostty_row_get',
      this.runtime.exports.ghostty_row_get(row, data, this.scalar),
    )
    return this.runtime.memory.view.getUint8(this.scalar) !== 0
  }

  private readGrapheme(): string | undefined {
    const result = this.runtime.exports.ghostty_grid_ref_graphemes(
      this.ref,
      this.codepoints,
      graphemeCapacity,
      this.length,
    )
    if (result === GhosttyResult.OutOfSpace) return this.readLargeGrapheme()
    assertGhosttyResult('ghostty_grid_ref_graphemes', result)
    return this.decodeGrapheme(this.codepoints)
  }

  private readLargeGrapheme(): string | undefined {
    const count = this.runtime.memory.view.getUint32(this.length, true)
    const buffer = this.runtime.memory.allocate(count * 4)
    try {
      assertGhosttyResult(
        'ghostty_grid_ref_graphemes',
        this.runtime.exports.ghostty_grid_ref_graphemes(this.ref, buffer, count, this.length),
      )
      return this.decodeGrapheme(buffer)
    } finally {
      this.runtime.memory.free(buffer, count * 4)
    }
  }

  private decodeGrapheme(buffer: number): string | undefined {
    const count = this.runtime.memory.view.getUint32(this.length, true)
    if (count === 0) return undefined
    let text = ''
    for (let index = 0; index < count; index += 1) {
      text += String.fromCodePoint(this.runtime.memory.view.getUint32(buffer + index * 4, true))
    }
    return text
  }
}

function clampIndex(value: number, count: number): number {
  if (typeof value !== 'number' || Number.isNaN(value))
    throw createGhosttyError('terminal.readLines', 'Row index must be a number')
  return Math.max(0, Math.min(count, Math.trunc(value)))
}

export function readTerminalLines(
  terminal: GhosttyTerminal,
  start: number,
  end: number,
  options: ReadLinesOptions,
): readonly TerminalLine[] {
  const count = terminal.totalRows
  const first = clampIndex(start, count)
  const last = Math.min(clampIndex(end, count), first + TERMINAL_READ_LINES_MAX_ROWS)
  if (last <= first) return []
  const reader = new GridTextReader(terminal)
  try {
    const lines: TerminalLine[] = []
    for (let index = first; index < last; index += 1) {
      const row = reader.read(index)
      let text = row.cells.map((cell) => cell ?? ' ').join('')
      if (options.trimRight ?? true) text = text.replace(/ +$/, '')
      lines.push({ text, wrapped: row.wrapped })
    }
    return lines
  } finally {
    reader.dispose()
  }
}

export function readPlainSelection(
  terminal: GhosttyTerminal,
  selection: SelectionCoordinates,
  options: TerminalSelectionFormatOptions,
): string {
  const reader = new GridTextReader(terminal)
  try {
    return formatPlainSelection(reader, terminal, selection, options)
  } finally {
    reader.dispose()
  }
}

function formatPlainSelection(
  reader: GridTextReader,
  terminal: GhosttyTerminal,
  selection: SelectionCoordinates,
  options: TerminalSelectionFormatOptions,
): string {
  const { start, rectangle } = selection
  let { end } = selection
  const unwrap = options.unwrap ?? true
  const trim = options.trim ?? true
  if (
    unwrap &&
    !rectangle &&
    end.y + 1 < terminal.totalRows &&
    reader.endsOnSpacerHead(end.y, end.x)
  ) {
    end = { x: 0, y: end.y + 1 }
  }
  let text = ''
  let blankRows = 0
  let blankCells = 0
  for (let y = start.y; y <= end.y; y += 1) {
    const first = rectangle || y === start.y ? start.x : 0
    const last = rectangle || y === end.y ? end.x + 1 : terminal.size.columns
    const row = reader.read(y, first, last)
    if (row.skipped) continue
    if (row.cells.every((cell) => cell === undefined)) {
      blankRows += 1
      continue
    }
    text += '\n'.repeat(blankRows)
    blankRows = 0
    if (!row.wrapped || !unwrap) blankRows += 1
    if (!row.continuation || !unwrap) blankCells = 0
    for (const cell of row.cells) {
      if (cell === undefined || (trim && cell.startsWith(' '))) {
        blankCells += 1
        continue
      }
      text += ' '.repeat(blankCells) + cell
      blankCells = 0
    }
  }
  return text
}
