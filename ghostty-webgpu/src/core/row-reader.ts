import { PACKED_CELL_WORDS, PACKED_ROW_WORDS, PackedCells } from './packed-cells.js'
import { copyRowGraphemes } from './row-graphemes.js'
import { SnapshotReader, type ExtractSnapshot } from './snapshot-reader.js'
import type { GhosttyRuntime } from './runtime.js'
import type { ReadRowsOptions, RenderRow, TerminalSize } from './types.js'

export class RowReader {
  private readonly snapshots: SnapshotReader

  constructor(runtime: GhosttyRuntime, extract?: ExtractSnapshot) {
    this.snapshots = new SnapshotReader(runtime, {
      rowWords: PACKED_ROW_WORDS,
      cellWords: PACKED_CELL_WORDS,
      operation: 'bridge_read_rows',
      extract: extract ?? ((...args) => runtime.bridge.readRows(...args)),
    })
  }

  read(
    state: number,
    iterator: number,
    cells: number,
    grid: Pick<TerminalSize, 'columns' | 'rows'>,
    options: ReadRowsOptions,
  ): readonly RenderRow[] {
    if (grid.rows === 0) return []
    const snapshot = this.snapshots.read(state, iterator, cells, grid, options)
    const rows: RenderRow[] = []
    for (let offset = 0; offset < snapshot.rows.length; offset += PACKED_ROW_WORDS) {
      const y = snapshot.rows[offset]!
      const dirty = snapshot.rows[offset + 1]! !== 0
      const start = snapshot.rows[offset + 2]! * PACKED_CELL_WORDS
      const length = snapshot.rows[offset + 3]! * PACKED_CELL_WORDS
      if (!options.packed) {
        const packed = new PackedCells(
          snapshot.cells.subarray(start, start + length),
          snapshot.graphemes,
        )
        rows.push({ y, dirty, cells: packed.materialize() })
        continue
      }
      const records = snapshot.cells.slice(start, start + length)
      const graphemes = copyRowGraphemes(records, snapshot.graphemes, PACKED_CELL_WORDS, 4, 5)
      const packed = new PackedCells(records, graphemes)
      let materialized: RenderRow['cells'] | undefined
      rows.push({
        y,
        dirty,
        packed,
        get cells() {
          return (materialized ??= packed.materialize())
        },
      })
    }
    return rows
  }

  dispose(): void {
    this.snapshots.dispose()
  }
}
