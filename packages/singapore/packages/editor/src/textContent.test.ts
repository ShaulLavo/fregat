import { describe, expect, it } from 'vitest'
import { createDocumentTextSnapshot, measureTextSnapshotRange } from './documentTextSnapshot'
import { createPieceTableSnapshot, insertIntoPieceTable } from '@singapore-editor/textbuffer'
import { RangeText, sliceTextContent } from './textContent'
import { TextMeasurements } from './textMeasurements'

describe('range-backed text', () => {
  it('reads only requested slices and accesses code points across pieces without strings', () => {
    const original = createPieceTableSnapshot('a'.repeat(100_000) + '😀e\u0301z')
    const snapshot = createDocumentTextSnapshot(insertIntoPieceTable(original, 50_000, 'middle'))
    const reads: Array<readonly [number, number]> = []
    const text = new RangeText(
      snapshot.length,
      (start, end) => {
        reads.push([start, end])
        return snapshot.readRange(start, end)
      },
      measureTextSnapshotRange(snapshot, 0, snapshot.length),
    )
    expect(text.length).toBe(100_011)
    expect(text.charCodeAt(50_000)).toBe('m'.charCodeAt(0))
    expect(text.charAt(50_005)).toBe('e')
    expect(text.codePointAt(100_006)).toBe(0x1f600)
    expect(text.codePointAt(text.length)).toBeUndefined()
    expect(Number.isNaN(text.charCodeAt(-1))).toBe(true)
    expect(reads).toEqual([])
    expect(text.slice(49_998, 50_008)).toBe('aamiddleaa')
    const tail = sliceTextContent(text, -5, text.length)
    expect(typeof tail).toBe('object')
    expect(tail.length).toBe(5)
    expect(tail.codePointAt(0)).toBe(0x1f600)
    expect(tail.slice(2, 4)).toBe('e\u0301')
    expect(reads).toEqual([
      [49_998, 50_008],
      [100_008, 100_010],
    ])
  })

  it('combines measurement ranges without joining their strings', () => {
    const first = createDocumentTextSnapshot(createPieceTableSnapshot('a\t'))
    const second = createDocumentTextSnapshot(createPieceTableSnapshot('😀\tb'))
    const combined = TextMeasurements.concat([
      measureTextSnapshotRange(first, 0, first.length),
      measureTextSnapshotRange(second, 0, second.length),
    ])
    expect(combined.length).toBe(6)
    expect(combined.codeUnitAt(2)).toBe(0xd83d)
    expect(combined.codeUnitAt(3)).toBe(0xde00)
    expect(combined.codeUnitAt(5)).toBe('b'.charCodeAt(0))
    expect(combined.columnAt(combined.length, 4, 'estimated')).toBe(9)
    expect(combined.slice(2, 4).columnAt(2, 4, 'estimated')).toBe(2)
  })
})
