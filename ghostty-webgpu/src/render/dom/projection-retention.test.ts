import { expect, it, vi } from 'vitest'
import { GhosttyRuntime } from '../../core/runtime.js'
import type { RenderRow } from '../../core/types.js'
import { CanvasColorCache } from '../canvas/colors.js'
import { canonicalRendererTheme, mergeRendererTheme } from '../config.js'
import { renderRowRuns, RowProjection } from './html.js'
import { probeFont, probeInput } from './tests/probe.js'

it('retains two appearances and completed run widths across packed row edits', async () => {
  const runtime = await GhosttyRuntime.create()
  const foreground = vi.spyOn(CanvasColorCache.prototype, 'foreground')
  try {
    const terminal = runtime.createTerminal({ columns: 12, rows: 1 })
    const state = runtime.createRenderState(terminal)
    const theme = canonicalRendererTheme(mergeRendererTheme({}))
    const projection = new RowProjection(probeFont, theme)
    for (const [index, text] of ['AAAAAAAAAAAA', 'BBBBBBBBBBBB', 'CCCCCCCCCCCC'].entries()) {
      terminal.write(`\x1b[?25l\r\x1b[31m${text.slice(0, 6)}\x1b[32m${text.slice(6)}`)
      state.update()
      const row = state.readRows({ packed: true })[0]!
      const actual = projection.project(row, undefined)
      expect(foreground).toHaveBeenCalledTimes(index === 0 ? 2 : 0)
      foreground.mockClear()
      const expected = renderRowRuns(row, undefined, probeFont, theme)
      expect(actual).toEqual(expected)
      foreground.mockClear()
      if (index === 0) continue
      expect(actual.map((run) => run.text).join('')).toBe(text)
    }
  } finally {
    foreground.mockRestore()
    runtime.dispose()
  }
})

it('retains both ordinary run widths separated by the visible cursor', async () => {
  const runtime = await GhosttyRuntime.create()
  try {
    const terminal = runtime.createTerminal({ columns: 12, rows: 1 })
    const state = runtime.createRenderState(terminal)
    const theme = canonicalRendererTheme(mergeRendererTheme({}))
    let widthReads = 0
    const font = {
      ...probeFont,
      get cssCellWidth() {
        widthReads += 1
        return probeFont.cssCellWidth
      },
    }
    const projection = new RowProjection(font, theme)
    const cursor = { style: 'block' as const, visible: true, x: 6, y: 0 }
    terminal.write('AAAAAAAAAAAA')
    state.update()
    projection.project(state.readRows({ packed: true })[0]!, cursor)
    widthReads = 0
    terminal.write('\rBBBBBBBBBBBB')
    state.update()
    const row = state.readRows({ packed: true })[0]!
    const actual = projection.project(row, cursor)
    expect(widthReads).toBe(0)
    expect(actual).toEqual(renderRowRuns(row, cursor, probeFont, theme))
  } finally {
    runtime.dispose()
  }
})

it('retains the single-cell cursor appearance across text and cursor-position edits', async () => {
  const runtime = await GhosttyRuntime.create()
  const foreground = vi.spyOn(CanvasColorCache.prototype, 'foreground')
  try {
    const terminal = runtime.createTerminal({ columns: 12, rows: 1 })
    const state = runtime.createRenderState(terminal)
    const theme = canonicalRendererTheme(mergeRendererTheme({}))
    let widthReads = 0
    const font = {
      ...probeFont,
      get cssCellWidth() {
        widthReads += 1
        return probeFont.cssCellWidth
      },
    }
    const projection = new RowProjection(font, theme)
    terminal.write('AAAAAAAAAAAA')
    state.update()
    projection.project(state.readRows({ packed: true })[0]!, {
      style: 'outline',
      visible: true,
      x: 6,
      y: 0,
    })
    foreground.mockClear()
    widthReads = 0
    terminal.write('\rBBBBBBBBBBBB')
    state.update()
    const row = state.readRows({ packed: true })[0]!
    const cursor = { style: 'outline' as const, visible: true, x: 5, y: 0 }
    const actual = projection.project(row, cursor)
    expect(foreground).not.toHaveBeenCalled()
    expect(widthReads).toBe(0)
    expect(actual).toEqual(renderRowRuns(row, cursor, probeFont, theme))
  } finally {
    foreground.mockRestore()
    runtime.dispose()
  }
})

it('matches cold projection through packed scratch mutations, selections, wide glyphs and cursors', async () => {
  const runtime = await GhosttyRuntime.create()
  try {
    const terminal = runtime.createTerminal({ columns: 40, rows: 3 })
    const state = runtime.createRenderState(terminal)
    const theme = canonicalRendererTheme(mergeRendererTheme({ minimumContrast: 7 }))
    const projection = new RowProjection(probeFont, theme)
    const previous = []
    for (const [index, input] of [
      probeInput,
      '\x1b[?25l\x1b[2J\x1b[H' + '\x1b[31mA\x1b[32mB'.repeat(15),
      '\x1b[2J\x1b[H\x1b[1;2;3;4:3;7;9;53mA界é👩‍💻\x1b[0mB',
      '\x1b[2J\x1b[H\x1b[8mhidden\x1b[0m 日本語 中文 🧪 👨‍👩‍👧‍👦',
      '\x1b[2J\x1b[H\x1b[38;2;12;24;36mF\x1b[48;2;50;60;70mG\x1b[0mH',
      '\x1b[2J\x1b[Hplain\r\nplain\r\nplain',
    ].entries()) {
      terminal.write(input)
      if (index % 2 === 0) terminal.selectAll()
      else terminal.clearSelection()
      state.update()
      for (const row of state.readRows({ packed: true })) {
        const packedOnly: RenderRow = {
          ...row,
          get cells() {
            return expect.fail('Retained projection materialized packed cells')
          },
        }
        for (const style of ['block', 'bar', 'underline', 'outline'] as const) {
          const cursor = { style, visible: true, x: 2, y: row.y }
          const runs = projection.project(packedOnly, cursor)
          expect(runs).toEqual(renderRowRuns(packedOnly, cursor, probeFont, theme))
          previous.push({ runs, snapshot: structuredClone(runs) })
        }
      }
      for (const { runs, snapshot } of previous) expect(runs).toEqual(snapshot)
    }
  } finally {
    runtime.dispose()
  }
})
