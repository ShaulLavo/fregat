import { expect, it } from 'vitest'
import { GhosttyRuntime } from '../../core/runtime.js'
import { rowStorage, type RowStorage } from '../../core/row-storage.js'
import { copiedFrameRow } from '../frame-row.js'
import { compactRows } from '../row-compaction.js'
import { FrameObserver } from '../frame-observer.js'
import type { RendererFrameSnapshot, RendererTextFrameRow } from '../renderer.js'

type StoredRow = RendererTextFrameRow & { readonly [rowStorage]?: RowStorage }

function storage(row: StoredRow): RowStorage {
  return row[rowStorage]!
}

it('keeps replacement packets unchanged and compacts pinned rows into one buffer without reading lazy cells', async () => {
  const runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal({ columns: 12, rows: 4 })
  const state = runtime.createRenderState(terminal)
  try {
    terminal.write('\x1b[?2027h\x1b[1;38;2;10;20;30m👩‍💻界é')
    state.update()
    const original = state.readRows({ packed: true }).map((row) => copiedFrameRow(row))
    const expected = state.readRows().map(({ cells }) => cells)
    expect(compactRows(original)).toBe(original)
    for (let frame = 0; frame < 20; frame += 1) {
      terminal.write(`\x1b[H\x1b[2Jreplacement ${frame}`)
      state.update()
      const replaced = state.readRows({ packed: true }).map((row) => copiedFrameRow(row))
      expect(compactRows(replaced)).toBe(replaced)
    }
    // Each retained row now pins a different whole packet.
    const pinned = original.slice()
    for (let y = 1; y < 4; y += 1) {
      terminal.write(`\x1b[${y + 1};1Hchanged${y}`)
      state.update()
      pinned[y] = copiedFrameRow(state.readRows({ packed: true })[y]!)
    }
    const compacted = compactRows(pinned)
    expect(compacted).not.toBe(pinned)
    expect(new Set(compacted.map((row) => storage(row!).packet)).size).toBe(1)
    expect(
      new Set(
        compacted.map((row) => {
          const owned = storage(row!)
          return owned.kind === 'ascii' ? owned.blanks.buffer : owned.words.buffer
        }),
      ).size,
    ).toBe(1)
    expect(compacted.map((row) => row!.text)).toEqual(pinned.map((row) => row.text))
    for (const row of compacted) {
      expect(typeof Object.getOwnPropertyDescriptor(row, 'cells')?.get).toBe('function')
      expect(typeof Object.getOwnPropertyDescriptor(row, 'renderCells')?.get).toBe('function')
    }
    runtime.dispose()
    expect(original.map((row) => row.renderCells)).toEqual(expected)
    expect(compacted[0]!.renderCells).toEqual(original[0]!.renderCells)
  } finally {
    runtime.dispose()
  }
})

it('discards a prepared compaction without replacing accepted rows or mutating a held snapshot', async () => {
  const runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal({ columns: 12, rows: 4 })
  const state = runtime.createRenderState(terminal)
  let published: RendererFrameSnapshot | undefined
  const observer = new FrameObserver({
    rows: 4,
    onFrame: (frame) => {
      published = frame
    },
  })
  try {
    terminal.write('first')
    state.update()
    observer.emit(state, state.readCursor(), undefined, [0, 1, 2, 3])
    terminal.write('\x1b[2;1Haccepted')
    state.update()
    observer.emit(state, state.readCursor(), undefined, [1], [state.readRows({ packed: true })[1]!])
    const held = published!
    for (const y of [2, 3]) {
      terminal.write(`\x1b[${y + 1};1Hchanged`)
      state.update()
      const source = [state.readRows({ packed: true })[y]!]
      const Constructor = Uint32Array
      let copies = 0
      globalThis.Uint32Array = new Proxy(Constructor, {
        construct(target, args, newTarget) {
          if (typeof args[0] === 'number') copies += 1
          return Reflect.construct(target, args, newTarget)
        },
      })
      try {
        const frame = observer.capture(state, state.readCursor(), undefined, [y], source)
        expect(copies).toBe(1)
        frame.discard()
        frame.notify()
      } finally {
        globalThis.Uint32Array = Constructor
      }
    }
    expect(published).toBe(held)
    observer.emit(state, state.readCursor(), undefined, [])
    expect(published!.rows.map((row) => row.text)).toEqual(held.rows.map((row) => row.text))
    runtime.dispose()
    expect(held.rows[0]!.cells.slice(0, 5).join('')).toBe('first')
  } finally {
    runtime.dispose()
  }
})
