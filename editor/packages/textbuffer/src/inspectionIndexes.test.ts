import { describe, expect, test } from 'vitest'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  readPieceTableLine,
} from './index'
import { validatePieceTreeInvariants } from './inspection'
import { reclaimPieceTableText } from './reclamation'

describe('inspecting retained newline indexes', () => {
  test('compares actual dense newlines with recorded offsets and count, not capacity', () => {
    const snapshot = createPieceTableSnapshot('a\nb')
    const index = { offsets: new Uint32Array([1, 99, 99]), count: 1, scannedLength: 3 }
    const cached = {
      ...snapshot,
      buffers: { ...snapshot.buffers, lineIndexes: new Map([[0, index]]) },
    }
    expect(validatePieceTreeInvariants(cached).issues).toEqual([])
    index.offsets[0] = 2
    expect(validatePieceTreeInvariants(cached).issues).toContainEqual(
      expect.objectContaining({ kind: 'line-index', field: 'offsets[0]', expected: 1, actual: 2 }),
    )
    index.offsets[0] = 1
    index.count = 0
    expect(validatePieceTreeInvariants(cached).issues).toContainEqual(
      expect.objectContaining({
        kind: 'line-index',
        field: 'offsets[0]',
        expected: 1,
        actual: undefined,
      }),
    )
    expect(validatePieceTreeInvariants(cached).issues).toContainEqual(
      expect.objectContaining({ kind: 'line-index', field: 'count', expected: 1, actual: 0 }),
    )
  })

  test('checks sparse retained newlines exactly and treats reclaimed holes as metadata', () => {
    const original = createPieceTableSnapshot('a\nDELETED\nz\n')
    const snapshot = reclaimPieceTableText(deleteFromPieceTable(original, 2, 8))
    const oldIndex = snapshot.buffers.lineIndexes.get(0)!
    const index = { ...oldIndex, offsets: oldIndex.offsets.slice() }
    const cached = {
      ...snapshot,
      buffers: { ...snapshot.buffers, lineIndexes: new Map([[0, index]]) },
    }
    expect(validatePieceTreeInvariants(cached).issues).toEqual([])
    index.offsets[1] = 8
    expect(validatePieceTreeInvariants(cached).issues).toEqual([])
    index.offsets[0] = 0
    expect(validatePieceTreeInvariants(cached).issues).toContainEqual(
      expect.objectContaining({ kind: 'line-index', field: 'offsets[0]', expected: 1, actual: 0 }),
    )
    expect(validatePieceTreeInvariants(original).issues).toEqual([])
  })

  test('does not require a lazy dense index to cover a newer snapshot tail', () => {
    const original = createPieceTableSnapshot('')
    const first = insertIntoPieceTable(original, 0, 'a\n')
    const second = insertIntoPieceTable(first, first.length, 'b\n')
    expect(readPieceTableLine(first, 0)).toBe('a')
    const index = second.buffers.lineIndexes.get(1)!
    expect(index.scannedLength).toBe(first.length)
    expect(validatePieceTreeInvariants(second).issues).toEqual([])
  })
})
