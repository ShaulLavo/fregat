import { describe, expect, it } from 'vitest'

import { BUFFER_CHUNK_SIZE } from '@singapore-editor/textbuffer/internal/buffers'
import {
  createPieceTableSnapshot,
  createPieceTableWalker,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from '@singapore-editor/textbuffer'
import type { PieceTableTreeSnapshot } from '@singapore-editor/textbuffer/internal/pieceTableTypes'

const createFragmentedSnapshot = (): { snapshot: PieceTableTreeSnapshot; text: string } => {
  let snapshot = createPieceTableSnapshot('the quick brown fox jumps over the lazy dog')
  snapshot = insertIntoPieceTable(snapshot, 4, 'very ')
  snapshot = deleteFromPieceTable(snapshot, 20, 6)
  snapshot = insertIntoPieceTable(snapshot, 0, 'PRELUDE ')
  snapshot = insertIntoPieceTable(snapshot, snapshot.length, ' EPILOGUE')
  snapshot = deleteFromPieceTable(snapshot, 10, 3)
  return { snapshot, text: materializePieceTableFullText(snapshot) }
}

const walkAll = (snapshot: PieceTableTreeSnapshot): string => {
  const walker = createPieceTableWalker(snapshot)
  const codes: number[] = []
  while (!walker.exhausted()) codes.push(walker.next())
  return String.fromCharCode(...codes)
}

describe('piece table walker', () => {
  it('shares method implementations between walker instances', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const first = createPieceTableWalker(snapshot)
    const second = createPieceTableWalker(snapshot, 1)

    expect(first.offset).toBe(second.offset)
    expect(first.exhausted).toBe(second.exhausted)
    expect(first.remaining).toBe(second.remaining)
    expect(first.charCode).toBe(second.charCode)
    expect(first.next).toBe(second.next)
    expect(first.codePoint).toBe(second.codePoint)
    expect(first.skip).toBe(second.skip)
    expect(first.seek).toBe(second.seek)
    expect(first.chunk).toBe(second.chunk)
    expect(first.nextChunk).toBe(second.nextChunk)
  })

  it('is exhausted immediately on an empty document', () => {
    const walker = createPieceTableWalker(createPieceTableSnapshot(''))

    expect(walker.exhausted()).toBe(true)
    expect(walker.offset()).toBe(0)
    expect(walker.remaining()).toBe(0)
    expect(walker.charCode()).toBe(-1)
    expect(walker.next()).toBe(-1)
    expect(walker.codePoint()).toBe(-1)
    expect(walker.chunk()).toBeNull()
    expect(walker.nextChunk()).toBe(false)
    expect(() => walker.seek(0)).not.toThrow()
    expect(() => walker.seek(1)).toThrow(RangeError)
    expect(() => walker.seek(-1)).toThrow(RangeError)
  })

  it('walks a single-piece document sequentially with read-then-advance semantics', () => {
    const snapshot = createPieceTableSnapshot('abc')
    const walker = createPieceTableWalker(snapshot)

    expect(walker.charCode()).toBe('a'.charCodeAt(0))
    expect(walker.next()).toBe('a'.charCodeAt(0))
    expect(walker.offset()).toBe(1)
    expect(walker.next()).toBe('b'.charCodeAt(0))
    expect(walker.next()).toBe('c'.charCodeAt(0))
    expect(walker.exhausted()).toBe(true)
    expect(walker.offset()).toBe(3)
    expect(walker.next()).toBe(-1)
  })

  it('reproduces the full text of an edited multi-piece document', () => {
    const { snapshot, text } = createFragmentedSnapshot()

    expect(walkAll(snapshot)).toBe(text)
  })

  it('iterates chunks with correct offsets and supports nextChunk', () => {
    const initial = createPieceTableSnapshot('abcdef')
    const edited = insertIntoPieceTable(initial, 3, 'XX')
    const walker = createPieceTableWalker(edited)
    const seen: string[] = []

    for (;;) {
      const chunk = walker.chunk()
      if (!chunk) break
      seen.push(`${chunk.start}:${chunk.end}:${chunk.text}`)
      if (!walker.nextChunk()) break
    }

    expect(seen).toEqual(['0:3:abc', '3:5:XX', '5:8:def'])
    expect(walker.exhausted()).toBe(true)
    expect(walker.offset()).toBe(8)
  })

  it('skips across pieces and to the exact end', () => {
    const { snapshot, text } = createFragmentedSnapshot()
    const walker = createPieceTableWalker(snapshot)

    walker.skip(0)
    expect(walker.offset()).toBe(0)

    walker.skip(7)
    expect(walker.charCode()).toBe(text.charCodeAt(7))

    walker.skip(text.length - 7)
    expect(walker.exhausted()).toBe(true)
    expect(walker.offset()).toBe(text.length)
    expect(() => walker.skip(1)).toThrow(RangeError)
    expect(() => walker.skip(-1)).toThrow(RangeError)
  })

  it('walks documents spanning multiple buffer chunks', () => {
    const long = 'x'.repeat(BUFFER_CHUNK_SIZE + 100)
    let snapshot = createPieceTableSnapshot('ab')
    snapshot = insertIntoPieceTable(snapshot, 1, long)
    const expected = `a${long}b`

    expect(walkAll(snapshot)).toBe(expected)

    const walker = createPieceTableWalker(snapshot)
    let chunkTotal = 0
    for (;;) {
      const chunk = walker.chunk()
      if (!chunk) break
      expect(chunk.start).toBe(chunkTotal)
      chunkTotal += chunk.text.length
      if (!walker.nextChunk()) break
    }
    expect(chunkTotal).toBe(expected.length)
  })

  it('never emits invisible text after deletes', () => {
    let snapshot = createPieceTableSnapshot('hello world')
    snapshot = deleteFromPieceTable(snapshot, 5, 6)

    expect(walkAll(snapshot)).toBe('hello')

    snapshot = deleteFromPieceTable(snapshot, 0, 5)
    const walker = createPieceTableWalker(snapshot)
    expect(walker.exhausted()).toBe(true)
    expect(walker.offset()).toBe(0)
  })

  it('seeks to every offset and reads the right character', () => {
    const { snapshot, text } = createFragmentedSnapshot()
    const walker = createPieceTableWalker(snapshot)

    for (let offset = 0; offset < text.length; offset += 1) {
      walker.seek(offset)
      expect(walker.charCode()).toBe(text.charCodeAt(offset))
      expect(walker.offset()).toBe(offset)
    }

    walker.seek(text.length)
    expect(walker.exhausted()).toBe(true)
    expect(walker.offset()).toBe(text.length)

    walker.seek(3)
    walker.seek(4)
    expect(walker.charCode()).toBe(text.charCodeAt(4))
    walker.seek(1)
    expect(walker.charCode()).toBe(text.charCodeAt(1))
  })

  it('reads surrogate pairs as code points, including across piece boundaries', () => {
    const single = createPieceTableSnapshot('a😀b')
    const walker = createPieceTableWalker(single)
    walker.seek(1)
    expect(walker.codePoint()).toBe('😀'.codePointAt(0))

    let split = createPieceTableSnapshot('a')
    split = insertIntoPieceTable(split, 1, '\ud83d')
    split = insertIntoPieceTable(split, 2, '\ude00')
    const text = materializePieceTableFullText(split)
    const splitWalker = createPieceTableWalker(split)
    for (let offset = 0; offset < text.length; offset += 1) {
      splitWalker.seek(offset)
      expect(splitWalker.codePoint()).toBe(text.codePointAt(offset))
    }
  })

  it('returns the bare code unit for unpaired surrogates and pairs at document end', () => {
    const cases = ['a\ud83d', '\ude00b', 'x\ud83dz', 'end😀']
    for (const sample of cases) {
      const snapshot = createPieceTableSnapshot(sample)
      const walker = createPieceTableWalker(snapshot)
      for (let offset = 0; offset < sample.length; offset += 1) {
        walker.seek(offset)
        expect(walker.codePoint()).toBe(sample.codePointAt(offset))
      }
    }
  })

  it('honors the startOffset constructor argument', () => {
    const { snapshot, text } = createFragmentedSnapshot()

    const middle = createPieceTableWalker(snapshot, 5)
    expect(middle.offset()).toBe(5)
    expect(middle.charCode()).toBe(text.charCodeAt(5))

    const end = createPieceTableWalker(snapshot, text.length)
    expect(end.exhausted()).toBe(true)

    expect(() => createPieceTableWalker(snapshot, text.length + 1)).toThrow(RangeError)
    expect(() => createPieceTableWalker(snapshot, -1)).toThrow(RangeError)
  })
})
