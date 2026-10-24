import { describe, expect, it } from 'vitest'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  type PieceTableSnapshot,
} from '@singapore-editor/core/document'
import { reclaimPieceTableText } from '@singapore-editor/core/testing'
import { DocumentWorkerReader } from '@singapore-editor/core/internal/document-worker'
import { createDocumentTextSnapshot } from '@singapore-editor/core/document'
import { createTreeSitterInput, readTreeSitterInputRange } from '../src/treeSitter/source.ts'

const CHUNK_SIZE = 16 * 1024
function resolveText(snapshot: PieceTableSnapshot): string {
  const reader = new DocumentWorkerReader()
  const identity = {
    documentId: 'reclaimed',
    documentGeneration: 1,
    endpointGeneration: 1,
    registrationId: 1,
  }
  const point = { segment: 'reclaimed', revision: 0, textVersion: 0 }
  const text = createDocumentTextSnapshot(snapshot)
  const chunks: string[] = []
  text.forEachTextChunk((chunk) => chunks.push(chunk))
  reader.apply({ kind: 'register', identity })
  expect(
    reader.apply({
      kind: 'reset',
      identity,
      base: null,
      target: point,
      chunks,
      lineEnding: '\n',
      byteOrderMark: '',
      containsUnusualLineTerminators: false,
    }),
  ).toMatchObject({ kind: 'applied' })
  const loan = reader.acquire({ identity, point })!
  const input = createTreeSitterInput(loan)
  try {
    return readTreeSitterInputRange(input, 0, input.length)
  } finally {
    input.dispose()
    reader.dispose()
  }
}
function expectReclaimedSource(snapshot: PieceTableSnapshot): void {
  const expected = materializePieceTableFullText(snapshot)
  expect(resolveText(snapshot)).toBe(expected)
  const compact = reclaimPieceTableText(snapshot)
  expect(compact.buffers).not.toBe(snapshot.buffers)
  expect(resolveText(compact)).toBe(expected)
  expect(resolveText(compact)).toBe(expected)
}

describe('physical source reclamation', () => {
  it('reads reclaimed sparse spans and the unchanged writable tail', () => {
    const original = createPieceTableSnapshot('x'.repeat(200000))
    const appended = insertIntoPieceTable(original, original.length, 'tail')
    const first = reclaimPieceTableText(deleteFromPieceTable(appended, 90000, 10))
    expect(resolveText(first)).toBe('x'.repeat(199990) + 'tail')
    const second = reclaimPieceTableText(deleteFromPieceTable(first, 180000, 10))
    expect(resolveText(second)).toBe('x'.repeat(199980) + 'tail')
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
    expect(resolveText(left)).toBe('prefixLEFToriginal\n')
    expect(resolveText(right)).toBe('prefixRITEoriginal\n')
    expect(resolveText(left)).toBe('prefixLEFToriginal\n')
  })
})
