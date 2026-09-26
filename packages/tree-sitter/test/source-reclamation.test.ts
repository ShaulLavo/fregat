import { describe, expect, it } from 'vitest'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  type PieceTableSnapshot,
} from '@singapore-editor/core/document'
import { reclaimPieceTableText } from '@singapore-editor/core/testing'
import {
  createTreeSitterSourceDescriptor,
  readTreeSitterInputRange,
  resolveTreeSitterSourceDescriptor,
  type TreeSitterSourceCache,
  type TreeSitterSourceDescriptor,
} from '../src/treeSitter/source.ts'

const CHUNK_SIZE = 16 * 1024

function payloadLengths(descriptor: TreeSitterSourceDescriptor): Map<string, number> {
  return new Map(descriptor.chunks.map((chunk) => [chunk.chunkId, chunk.text.length]))
}

function resolveText(cache: TreeSitterSourceCache, descriptor: TreeSitterSourceDescriptor): string {
  const input = resolveTreeSitterSourceDescriptor(cache, 'doc', descriptor)
  return readTreeSitterInputRange(input, 0, input.length)
}

function expectReclaimedSource(snapshot: PieceTableSnapshot): void {
  const expected = materializePieceTableFullText(snapshot)
  const cache: TreeSitterSourceCache = new Map()
  const before = createTreeSitterSourceDescriptor(snapshot)
  expect(resolveText(cache, before)).toBe(expected)

  const compact = reclaimPieceTableText(snapshot)
  expect(compact.buffers).not.toBe(snapshot.buffers)
  const after = createTreeSitterSourceDescriptor(compact, {
    sentChunkLengths: payloadLengths(before),
  })
  expect(after.chunks.length).toBeGreaterThan(0)
  expect(resolveText(cache, after)).toBe(expected)
  expect(Array.from(cache.get('doc')!.keys()).sort()).toEqual(
    Array.from(new Set(after.pieces.map((piece) => piece.chunkId))).sort(),
  )
  expect(Array.from(payloadLengths(after).values()).every((length) => length <= CHUNK_SIZE)).toBe(
    true,
  )
  const unchanged = createTreeSitterSourceDescriptor(compact, {
    sentChunkLengths: new Map([...payloadLengths(before), ...payloadLengths(after)]),
  })
  expect(unchanged.chunks).toEqual([])
  expect(resolveText(cache, unchanged)).toBe(expected)
}

describe('physical source reclamation', () => {
  it('resends only trimmed sparse spans and reuses the unchanged writable tail', () => {
    const original = createPieceTableSnapshot('x'.repeat(200000))
    const appended = insertIntoPieceTable(original, original.length, 'tail')
    const first = reclaimPieceTableText(deleteFromPieceTable(appended, 90000, 10))
    const before = createTreeSitterSourceDescriptor(first)
    const cache: TreeSitterSourceCache = new Map()
    expect(resolveText(cache, before)).toBe('x'.repeat(199990) + 'tail')
    const second = reclaimPieceTableText(deleteFromPieceTable(first, 180000, 10))
    const after = createTreeSitterSourceDescriptor(second, {
      sentChunkLengths: payloadLengths(before),
    })
    expect([...payloadLengths(after).values()].reduce((sum, size) => sum + size, 0)).toBeLessThan(
      CHUNK_SIZE,
    )
    expect(after.pieces[0]!.chunkId).toBe(before.pieces[0]!.chunkId)
    expect(after.pieces.at(-1)!.chunkId).toBe(before.pieces.at(-1)!.chunkId)
    expect(resolveText(cache, after)).toBe('x'.repeat(199980) + 'tail')
  })

  it('reads retained original spans across reclaimed holes and source boundaries', () => {
    const prefix = `const 名前 = "🎉";\n${'x'.repeat(CHUNK_SIZE + 10)}\uD800`
    const deleted = 'deleted\n'.repeat(CHUNK_SIZE)
    const suffix = '\uDC00\nconst last = "🚀";'
    const original = createPieceTableSnapshot(prefix + deleted + suffix)
    const snapshot = deleteFromPieceTable(original, prefix.length, deleted.length)
    expectReclaimedSource(snapshot)
  })

  it('reads partial closed append chunks and keeps the writable tail', () => {
    const text = `kept 🎉\n${'x'.repeat(CHUNK_SIZE - 8)}`
    const inserted = insertIntoPieceTable(createPieceTableSnapshot('original\n'), 0, text)
    const partial = deleteFromPieceTable(inserted, 8, text.length - 8)
    const snapshot = insertIntoPieceTable(partial, partial.length, 'tail 🚀')
    expectReclaimedSource(snapshot)
  })

  it('sends distinct equal-length fork contents and can revisit the earlier branch', () => {
    const base = insertIntoPieceTable(createPieceTableSnapshot('original\n'), 0, 'prefix')
    const left = insertIntoPieceTable(base, 6, 'LEFT')
    const right = insertIntoPieceTable(base, 6, 'RITE')
    const first = createTreeSitterSourceDescriptor(left)
    const cache: TreeSitterSourceCache = new Map()
    expect(resolveText(cache, first)).toBe('prefixLEFToriginal\n')
    const second = createTreeSitterSourceDescriptor(right, {
      sentChunkLengths: payloadLengths(first),
    })
    expect(second.chunks.length).toBeGreaterThan(0)
    expect(resolveText(cache, second)).toBe('prefixRITEoriginal\n')
    const revisited = createTreeSitterSourceDescriptor(left, {
      sentChunkLengths: payloadLengths(second),
    })
    expect(resolveText(cache, revisited)).toBe('prefixLEFToriginal\n')
  })
})
