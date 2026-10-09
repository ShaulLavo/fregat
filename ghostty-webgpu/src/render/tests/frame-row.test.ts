import { expect, it, vi } from 'vitest'
import { GhosttyRuntime } from '../../core/runtime.js'
import { copiedFrameRow, paintedFrameRow } from '../frame-row.js'

it.each([
  '',
  '\x1b[?2027h\x1b[1;3;38;2;10;20;30mAé界👩‍💻é\x1b[0m\r\nplain\x1b[8mhidden',
  '\x1b]8;;https://example.com\x1b\\linked界\x1b]8;;\x1b\\\r\ne' + '́'.repeat(60),
])('copies frame text and continuations without materializing packed cells (%#)', async (text) => {
  const runtime = await GhosttyRuntime.create()
  try {
    const terminal = runtime.createTerminal({ columns: 24, rows: 3 })
    const state = runtime.createRenderState(terminal)
    terminal.write(text)
    terminal.selectAll()
    state.update()
    const packed = state.readRows({ packed: true })
    const decoded = state.readRows()
    const expected = decoded.map((row) => {
      const cells = row.cells.map((cell) => cell.text.slice())
      const continuations = row.cells.map((cell) => cell.continuation)
      const text = cells.map((cell, index) => (continuations[index] ? '' : cell || ' ')).join('')
      return { cells, continuations, text, y: row.y }
    })
    for (const row of packed) {
      Object.defineProperty(row, 'cells', {
        get() {
          throw new TypeError('Frame text extraction materialized packed cells')
        },
      })
    }
    const materialize = packed.map((row) => vi.spyOn(row.packed!, 'materialize'))
    const actual = packed.map(copiedFrameRow)
    for (const spy of materialize) expect(spy).not.toHaveBeenCalled()
    const projection = (rows: typeof actual) =>
      rows.map(({ cells, continuations, text, y }) => ({ cells, continuations, text, y }))
    expect(projection(actual)).toEqual(expected)
    expect(projection(decoded.map(copiedFrameRow))).toEqual(expected)
    for (const row of actual) {
      expect(Object.isFrozen(row)).toBe(true)
      expect(Object.isFrozen(row.cells)).toBe(true)
      expect(Object.isFrozen(row.continuations)).toBe(true)
    }
    const styledExpected = decoded.map((row) => copiedFrameRow(row).renderCells)
    runtime.exports.memory.grow(1)
    terminal.resize({ columns: 4, rows: 1 })
    terminal.write('changed')
    state.update()
    state.readRows({ packed: true })
    expect(projection(actual)).toEqual(expected)
    expect(projection(packed.map(copiedFrameRow))).toEqual(expected)
    expect(actual.map((row) => row.renderCells)).toEqual(styledExpected)
    for (const row of actual) {
      expect(Object.isFrozen(row.renderCells)).toBe(true)
      for (const cell of row.renderCells) {
        expect(Object.isFrozen(cell)).toBe(true)
        if (cell.style) expect(Object.isFrozen(cell.style)).toBe(true)
      }
    }
  } finally {
    runtime.dispose()
  }
})

it('retains painted text lazily with owned cell and continuation storage', async () => {
  const runtime = await GhosttyRuntime.create()
  try {
    const terminal = runtime.createTerminal({ columns: 24, rows: 1 })
    const state = runtime.createRenderState(terminal)
    terminal.write('A界👩‍💻é')
    state.update()
    const source = state.readRows({ packed: true })[0]!
    const expected = copiedFrameRow(source)
    const saved = JSON.stringify(expected)
    const textReads = vi.spyOn(source.packed!, 'text')
    const readText = vi.fn(() => expected.text)
    const actual = paintedFrameRow(source, readText)
    expect(textReads).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
    runtime.exports.memory.grow(1)
    terminal.resize({ columns: 5, rows: 1 })
    terminal.write('other')
    state.update()
    expect(actual.text).toBe(expected.text)
    expect(actual.text).toBe(expected.text)
    expect(readText).toHaveBeenCalledTimes(1)
    expect(textReads).not.toHaveBeenCalled()
    expect(JSON.stringify(actual)).toBe(saved)
    expect(Object.isFrozen(actual)).toBe(true)
    expect(Object.isFrozen(actual.cells)).toBe(true)
    expect(Object.isFrozen(actual.continuations)).toBe(true)
  } finally {
    runtime.dispose()
  }
})
