import { afterEach, expect, it } from 'vitest'
import { GhosttyRuntime } from '../../../core/runtime.js'
import type { ZigFrameBuilder, ZigFrameOptions } from '../../../core/zig-frame.js'
import { defaultRendererTheme } from '../../instances/types.js'

let runtime: GhosttyRuntime | undefined
let builder: ZigFrameBuilder | undefined

afterEach(() => {
  builder?.dispose()
  runtime?.dispose()
  builder = undefined
  runtime = undefined
})

const options: ZigFrameOptions = {
  cellWidth: 7.3,
  cellHeight: 15.7,
  theme: { ...defaultRendererTheme, cursorText: defaultRendererTheme.background },
  full: true,
  overlayRows: new Set(),
}

function ready(current: ZigFrameOptions): void {
  let status = builder!.build(current)
  if (status === 2) {
    for (const key of builder!.missingGlyphs)
      builder!.registerGlyph(key, {
        atlasWidth: 512,
        atlasHeight: 512,
        x: 8,
        y: 12,
        width: 5,
        height: 9,
        offsetX: 1,
        offsetY: 2,
        generation: 1,
        key: 'scalar-fixture',
        layer: 0,
        kind: 'grayscale',
      })
    status = builder!.build(current)
  }
  expect(status).toBe(0)
}

it.each([
  ['scalar scroll', '\r\nrow0004 plain'],
  ['wide owner replacement', '\x1b[1;1H界\x1b[1;1Hab'],
  ['wide tail replacement', '\x1b[1;1H界\x1b[1;2Hx'],
  ['combining owner', '\x1b[1;1Há\x1b[1;1Hà'],
  ['styles', '\x1b[1;1H\x1b[1;3;4;7;9mrow0000\x1b[0m'],
  ['palette', '\x1b[1;1H\x1b[31mrow0000\x1b[0m\x1b]4;1;rgb:00/ff/00\x1b\\'],
  ['scroll region', '\x1b[2;4r\x1b[4;1H\nrow0004'],
  ['insert line', '\x1b[2;1H\x1b[L'],
  ['delete line', '\x1b[2;1H\x1b[M'],
  ['reverse index', '\x1b[H\x1bMrow0004'],
  ['alternate screen', '\x1b[?1049hrow0004\x1b[?1049l'],
])('keeps dirty scalar buffers and upload ranges exact after %s', async (_name, input) => {
  runtime = await GhosttyRuntime.create()
  const terminal = runtime.createTerminal({ columns: 24, rows: 4 })
  const state = runtime.createRenderState(terminal)
  terminal.write('row0000 plain\r\nrow0001 plain\r\nrow0002 plain\r\nrow0003 plain')
  state.update()
  builder = state.createFrameBuilder(24, 4)
  ready(options)
  const replayCells = builder.cellData.slice()
  const replayGlyphs = builder.glyphData.slice()
  state.acknowledge()
  terminal.write(input!)
  state.update()
  ready({ ...options, full: false })
  for (const update of builder.changedRanges()) {
    const cellOffset = update.cell.byteOffset / 4
    const glyphOffset = update.glyph.byteOffset / 4
    replayCells.set(
      builder.cellData.subarray(cellOffset, cellOffset + update.cell.byteLength / 4),
      cellOffset,
    )
    replayGlyphs.set(
      builder.glyphData.subarray(glyphOffset, glyphOffset + update.glyph.byteLength / 4),
      glyphOffset,
    )
  }
  expect(replayCells).toEqual(builder.cellData)
  expect(replayGlyphs).toEqual(builder.glyphData)
  ready(options)
  expect(builder.cellData).toEqual(replayCells)
  expect(builder.glyphData).toEqual(replayGlyphs)
})

it.each(['block', 'bar', 'underline', 'outline'] as const)(
  'keeps %s cursor, selection and geometry changes exact in dirty scalar rows',
  async (style) => {
    runtime = await GhosttyRuntime.create()
    const terminal = runtime.createTerminal({ columns: 24, rows: 4 })
    const state = runtime.createRenderState(terminal)
    terminal.write(
      'row0000 plain\r\nrow0001 plain\r\nrow0002 plain\r\nrow0003 plain\r\nrow0004 plain',
    )
    state.update()
    builder = state.createFrameBuilder(24, 4)
    ready({ ...options, cursor: { style, visible: true, x: 2, y: 2 } })
    for (const step of ['cursor', 'select', 'history', 'clear', 'geometry'] as const) {
      state.acknowledge()
      if (step === 'select') terminal.selectAll()
      if (step === 'history') terminal.scrollBy(-1)
      if (step === 'clear') terminal.clearSelection()
      terminal.write('\x1b[1;1Hrow0000 plain')
      state.update()
      const current = {
        ...options,
        cellHeight: step === 'geometry' ? 31.4 : 15.7,
        cursor: { style, visible: step !== 'clear', x: 3, y: 1 },
        overlayRows: new Set([0, 1, 2, 3]),
      }
      ready({ ...current, full: false })
      const cells = builder.cellData.slice()
      const glyphs = builder.glyphData.slice()
      ready(current)
      expect(builder.cellData).toEqual(cells)
      expect(builder.glyphData).toEqual(glyphs)
    }
  },
)
