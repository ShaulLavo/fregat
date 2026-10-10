import { expect, it } from 'vitest'
import { PackedCells } from '../packed-cells.js'
import type { RenderCell } from '../types.js'

it('materializes independent cells with stable optional fields and grapheme continuations', () => {
  const words = new Uint32Array([
    65,
    0x030201,
    0x060504,
    4 | 8 | 16 | (3 << 12),
    0,
    0,
    0,
    0x090807,
    0x0c0b0a,
    8 | 32,
    0,
    2,
    0,
    0xffffffff,
    0xffffffff,
    2,
    0,
    0,
  ])
  const packed = new PackedCells(words, new Uint32Array([101, 0x301]))
  const cells = packed.materialize()
  expect(cells).toHaveLength(3)
  expect(
    cells.map(({ text, x, continuation, selected }) => ({ text, x, continuation, selected })),
  ).toEqual([
    { text: 'A', x: 0, continuation: false, selected: true },
    { text: 'é', x: 1, continuation: false, selected: false },
    { text: '', x: 2, continuation: true, selected: false },
  ])
  expect(cells[0]!.foreground).toEqual({ r: 1, g: 2, b: 3 })
  expect(cells[1]!.background).toEqual({ r: 10, g: 11, b: 12 })
  expect(cells[0]!.style).toMatchObject({ bold: true, italic: false, underline: 3 })
  expect(cells[1]!.style).toMatchObject({ bold: false, italic: true, underline: 0 })
  expect(cells[2]).toMatchObject({ foreground: undefined, background: undefined, style: undefined })
  for (const cell of cells) {
    expect(Object.keys(cell)).toEqual([
      'continuation',
      'selected',
      'text',
      'x',
      'foreground',
      'background',
      'style',
    ])
  }
  const repeated = packed.materialize()
  expect(repeated).toEqual(cells)
  for (let index = 0; index < cells.length; index += 1)
    expect(repeated[index]).not.toBe(cells[index])
  expect(cells[0]!.foreground).not.toBe(cells[1]!.foreground)
  expect(cells[0]!.style).not.toBe(cells[1]!.style)
  expect(repeated[0]!.foreground).not.toBe(cells[0]!.foreground)
  expect(repeated[0]!.style).not.toBe(cells[0]!.style)
  words.fill(0)
  expect(cells[0]!.text).toBe('A')
  expect(cells[1]!.text).toBe('é')
})

it('materializes an empty packed row as a dense empty array', () => {
  expect(new PackedCells(new Uint32Array(), new Uint32Array()).materialize()).toEqual([])
})

it('reuses private cell buffers without changing independent rows and their serialized keys', () => {
  const first = new PackedCells(
    new Uint32Array([65, 0x030201, 0x060504, 8 | 16, 0, 0, 0, 0xffffffff, 0xffffffff, 2, 0, 0]),
    new Uint32Array(),
  )
  const target: RenderCell[] = []
  const retained = first.materialize()
  const borrowed = first.readInto(target)
  expect(borrowed).toBe(target)
  expect(borrowed).toEqual(retained)
  expect(JSON.stringify(borrowed)).toBe(JSON.stringify(retained))
  const cell = target[0]!
  const foreground = cell.foreground
  const style = cell.style
  const next = new PackedCells(
    new Uint32Array([66, 0x090807, 0x0c0b0a, 8 | 32 | (3 << 12), 0, 0]),
    new Uint32Array(),
  )
  expect(next.readInto(target)).toEqual(next.materialize())
  expect(target).toHaveLength(1)
  expect(target[0]).toBe(cell)
  expect(cell.foreground).toBe(foreground)
  expect(cell.style).toBe(style)
  expect(cell).toMatchObject({
    text: 'B',
    foreground: { r: 7, g: 8, b: 9 },
    style: { bold: false, italic: true, underline: 3 },
  })
  expect(retained[0]).toMatchObject({
    text: 'A',
    foreground: { r: 1, g: 2, b: 3 },
    style: { bold: true, italic: false },
  })
  expect(first.materialize()).toEqual(retained)
  const plain = new PackedCells(
    new Uint32Array([67, 0xffffffff, 0xffffffff, 0, 0, 0]),
    new Uint32Array(),
  )
  plain.readInto(target)
  expect(cell).toMatchObject({
    text: 'C',
    foreground: undefined,
    background: undefined,
    style: undefined,
  })
  expect(JSON.stringify(target)).toBe(JSON.stringify(plain.materialize()))
  first.readInto(target)
  expect(target).toHaveLength(2)
  expect(target[0]).toBe(cell)
  expect(target).toEqual(retained)
  new PackedCells(new Uint32Array(), new Uint32Array()).readInto(target)
  expect(target).toEqual([])
})
