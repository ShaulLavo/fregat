import { describe, expect, it } from 'vitest'
import type { CellStyle, RenderCell } from '../../core/types.js'
import { canvasRowKey } from './row-key.js'

const cell: RenderCell = { x: 0, text: 'Á👩‍💻', continuation: false, selected: false }
const style: CellStyle = {
  blink: false,
  bold: false,
  faint: false,
  invisible: false,
  inverse: false,
  italic: false,
  overline: false,
  strikethrough: false,
  underline: 0,
}

describe('canvasRowKey', () => {
  it('encodes full domain values without property-name serialization', () => {
    const cells = Array.from({ length: 40 }, (_, x) => ({ ...cell, x }))
    expect(canvasRowKey(cells).length).toBeLessThan(JSON.stringify(cells).length / 2)
    expect(canvasRowKey(cells)).toBe(canvasRowKey(cells.map((value) => ({ ...value }))))
  })

  it('distinguishes each cell field, color channel and optional style', () => {
    const values: RenderCell[] = [
      cell,
      { ...cell, x: 1 },
      { ...cell, text: 'Á👩‍' },
      { ...cell, continuation: true },
      { ...cell, selected: true },
      { ...cell, foreground: { r: 1, g: 2, b: 3 } },
      { ...cell, foreground: { r: 2, g: 2, b: 3 } },
      { ...cell, foreground: { r: 1, g: 3, b: 3 } },
      { ...cell, foreground: { r: 1, g: 2, b: 4 } },
      { ...cell, background: { r: 1, g: 2, b: 3 } },
      { ...cell, background: { r: 2, g: 2, b: 3 } },
      { ...cell, background: { r: 1, g: 3, b: 3 } },
      { ...cell, background: { r: 1, g: 2, b: 4 } },
      { ...cell, style },
    ]
    expect(new Set(values.map((value) => canvasRowKey([value]))).size).toBe(values.length)
  })

  it('distinguishes every style flag and underline value', () => {
    const flags = [
      'blink',
      'bold',
      'faint',
      'invisible',
      'inverse',
      'italic',
      'overline',
      'strikethrough',
    ] as const
    const cells = flags.map((flag) => ({ ...cell, style: { ...style, [flag]: true } }))
    cells.push(
      { ...cell, style },
      { ...cell, style: { ...style, underline: 1 } },
      { ...cell, style: { ...style, underline: 2 } },
    )
    expect(new Set(cells.map((value) => canvasRowKey([value]))).size).toBe(cells.length)
  })

  it('frames text lengths across delimiter content and different cell boundaries', () => {
    const texts = [
      '',
      ':',
      ',',
      ';',
      '\u0000',
      '\n',
      '0,0,-,-,-,1:A',
      'ab',
      'c',
      'a',
      'bc',
      '界',
      'é',
      '👩‍💻',
    ]
    const keys = new Set<string>()
    for (const left of texts) {
      for (const right of texts)
        keys.add(
          canvasRowKey([
            { ...cell, text: left },
            { ...cell, x: 1, text: right },
          ]),
        )
    }
    expect(keys.size).toBe(texts.length ** 2)
    expect(
      canvasRowKey([
        { ...cell, text: 'ab' },
        { ...cell, x: 1, text: 'c' },
      ]),
    ).not.toBe(
      canvasRowKey([
        { ...cell, text: 'a' },
        { ...cell, x: 1, text: 'bc' },
      ]),
    )
    expect(canvasRowKey([])).not.toBe(canvasRowKey([{ ...cell, text: '' }]))
  })
})
