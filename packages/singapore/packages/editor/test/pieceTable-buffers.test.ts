import { describe, expect, it } from 'vitest'

import {
  appendChunksToBuffers,
  BUFFER_CHUNK_SIZE,
  bufferSpanAt,
  countLineBreaks,
  createInitialBuffers,
  createOriginalPiece,
  createPiece,
  extendTailChunk,
  getBufferText,
  pieceLineBreakOffsets,
} from '@singapore-editor/textbuffer/internal/buffers'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  type PieceTableSnapshot,
  pointToOffset,
} from '@singapore-editor/textbuffer'

describe('piece table buffers', () => {
  it('counts line breaks inside an optional range', () => {
    expect(countLineBreaks('a\nb\nc')).toBe(2)
    expect(countLineBreaks('a\nb\nc', 2, 4)).toBe(1)
    expect(countLineBreaks('a\nb\nc', 4, 5)).toBe(0)
  })

  it('creates original pieces with line-break metadata', () => {
    const buffers = createInitialBuffers('alpha\nbeta')
    const piece = createOriginalPiece(buffers)

    expect(getBufferText(buffers, buffers.original)).toBe('alpha\nbeta')
    expect(piece).toMatchObject({
      buffer: buffers.original,
      start: 0,
      length: 10,
      lineBreaks: 1,
      visible: true,
    })
    const index = buffers.lineIndexes?.get(buffers.original)
    expect(index).toMatchObject({ count: 1, scannedLength: 10 })
    expect(index?.offsets[0]).toBe(5)
  })

  it('creates sliced pieces and reads their backing buffer', () => {
    const buffers = createInitialBuffers('alpha\nbeta')
    const piece = createPiece(buffers, buffers.original, 6, 4, 20, false)

    expect(piece).toMatchObject({ start: 6, length: 4, lineBreaks: 0, visible: false })
    expect(bufferSpanAt(buffers, piece.buffer, piece.start).text).toBe('alpha\nbeta')
  })

  it('splits appended text into bounded chunks', () => {
    const buffers = createInitialBuffers('')
    const text = 'x'.repeat(16 * 1024) + 'tail'
    const appended = appendChunksToBuffers(buffers, text)
    const pieces = appended.pieces

    expect(pieces).toHaveLength(2)
    expect(pieces.map((piece) => piece.length)).toEqual([16 * 1024, 4])
    expect(pieces.map((piece) => getBufferText(appended.buffers, piece.buffer))).toEqual([
      'x'.repeat(16 * 1024),
      'tail',
    ])
  })

  it('appends with copy-on-write buffer maps', () => {
    const buffers = createInitialBuffers('')
    const appended = appendChunksToBuffers(buffers, 'abc')
    const piece = appended.pieces[0]!

    expect(appended.buffers.chunks).not.toBe(buffers.chunks)
    // `get` is the membership question PieceBufferChunks declares: no text for the id means the
    // pre-append map never carried the appended chunk.
    expect(buffers.chunks.get(piece.buffer)).toBeUndefined()
    expect(getBufferText(appended.buffers, piece.buffer)).toBe('abc')
  })

  it('emits one chunk when the text ends exactly on a chunk boundary', () => {
    // The pull-back only applies to a split, and text of exactly one chunk has
    // none. Testing the boundary from the other side too: a CR or high surrogate
    // as the final unit of an exactly-full chunk must not be held back into a
    // second chunk of one orphaned code unit.
    const buffers = createInitialBuffers('')

    for (const tail of ['\r', '\ud834', 'z']) {
      const text = 'x'.repeat(BUFFER_CHUNK_SIZE - 1) + tail
      const appended = appendChunksToBuffers(buffers, text)
      const chunks = appended.pieces.map((piece) => getBufferText(appended.buffers, piece.buffer))

      expect(chunks).toEqual([text])
    }
  })

  it('never splits a surrogate pair across two chunks', () => {
    const buffers = createInitialBuffers('')
    // The pair straddles the natural boundary: its high half is the last unit
    // of chunk 0 unless the split point is pulled back.
    const text = `${'x'.repeat(BUFFER_CHUNK_SIZE - 1)}\u{1d11e}${'y'.repeat(10)}`
    const appended = appendChunksToBuffers(buffers, text)
    const chunks = appended.pieces.map((piece) => getBufferText(appended.buffers, piece.buffer))

    expect(chunks.join('')).toBe(text)
    expect(chunks[0]).toBe('x'.repeat(BUFFER_CHUNK_SIZE - 1))
    expect(chunks[1]).toBe(`\u{1d11e}${'y'.repeat(10)}`)
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
    expect(appended.pieces.map((piece) => piece.length)).toEqual(
      chunks.map((chunk) => chunk.length),
    )
  })

  it('never splits a CRLF across two chunks', () => {
    const buffers = createInitialBuffers('')
    const text = `${'x'.repeat(BUFFER_CHUNK_SIZE - 1)}\r\n${'y'.repeat(10)}`
    const appended = appendChunksToBuffers(buffers, text)
    const chunks = appended.pieces.map((piece) => getBufferText(appended.buffers, piece.buffer))

    expect(chunks.join('')).toBe(text)
    expect(chunks.some((chunk) => chunk.endsWith('\r'))).toBe(false)
    expect(chunks[1]).toBe(`\r\n${'y'.repeat(10)}`)
    expect(appended.pieces.map((piece) => piece.lineBreaks)).toEqual([0, 1])
  })

  it('answers line-break queries from a grown typed-array index', () => {
    const lineCount = 5000
    const text = Array.from({ length: lineCount }, (_, line) => `line ${line}`).join('\n')
    const buffers = createInitialBuffers(text)
    const buffer = buffers.original

    // A piece is how the index is read: its breaks are the entries from
    // `firstLineBreak` on, so each slice is checked against a scan of the text.
    const breakOffsets = (start: number, end: number): number[] => {
      const piece = createPiece(buffers, buffer, start, end - start, 0)
      const first = piece.firstLineBreak
      return [...pieceLineBreakOffsets(buffers, piece).subarray(first, first + piece.lineBreaks)]
    }

    for (let start = 0; start <= text.length; start += 97) {
      for (const candidate of [start, start + 1, start + 500, text.length]) {
        const end = Math.min(candidate, text.length)
        const found = breakOffsets(start, end)
        expect(found).toHaveLength(countLineBreaks(text, start, end))
        for (const ordinal of [1, 2, 3, Math.max(1, found.length)]) {
          expect(found[ordinal - 1] ?? null).toBe(
            ordinal <= found.length ? nthLineBreakOffset(text, start, ordinal) : null,
          )
        }
      }
    }

    // Boundaries the sweep above steps over: the very first break, the very
    // last one, and a start beyond every break.
    const every = breakOffsets(0, text.length)
    expect(every).toHaveLength(lineCount - 1)
    expect(every[0]).toBe(text.indexOf('\n'))
    expect(every.at(-1)).toBe(text.lastIndexOf('\n'))
    expect(breakOffsets(text.lastIndexOf('\n') + 1, text.length)).toEqual([])

    const index = buffers.lineIndexes?.get(buffer)
    expect(index?.count).toBe(lineCount - 1)
    // The one representation fact worth pinning, because it is the whole point
    // of the index: four bytes per break, not the eight a boxed double costs.
    expect(index?.offsets.BYTES_PER_ELEMENT).toBe(4)
  })

  it('grows the line index while the tail chunk is extended in place', () => {
    const appended = appendChunksToBuffers(createInitialBuffers(''), 'a\n')
    let buffers = appended.buffers
    const buffer = appended.pieces[0]!.buffer
    let text = 'a\n'

    const whole = () => createPiece(buffers, buffer, 0, text.length, 0)
    expect(whole().lineBreaks).toBe(1)

    for (let round = 0; round < 200; round += 1) {
      const added = `line ${round}\n`
      buffers = extendTailChunk(buffers, added, 1)
      text += added
      expect(whole().lineBreaks).toBe(countLineBreaks(text))
    }

    const offsets = pieceLineBreakOffsets(buffers, whole())
    for (const ordinal of [1, 2, 100, 201]) {
      expect(offsets[ordinal - 1]).toBe(nthLineBreakOffset(text, 0, ordinal))
    }

    const index = buffers.lineIndexes?.get(buffer)
    expect(index?.count).toBe(201)
    expect(index?.scannedLength).toBe(text.length)
  })

  it('reallocates the line-break index a logarithmic number of times', () => {
    // Growing by one slot per break would satisfy every other assertion here
    // while turning the index build over a large file quadratic, so the growth
    // policy is pinned by counting how often the backing store is replaced.
    const pushes = 2000
    const appended = appendChunksToBuffers(createInitialBuffers(''), 'seed\n')
    let buffers = appended.buffers
    const buffer = appended.pieces[0]!.buffer
    let text = 'seed\n'
    let reallocations = 0
    let backing: Uint32Array | undefined

    const observeBacking = (): void => {
      const offsets = buffers.lineIndexes?.get(buffer)?.offsets
      if (offsets === backing) return

      reallocations += 1
      backing = offsets
    }

    createPiece(buffers, buffer, 0, text.length, 0)
    observeBacking()

    for (let round = 0; round < pushes; round += 1) {
      const added = `line ${round}\n`
      buffers = extendTailChunk(buffers, added, 1)
      text += added
      createPiece(buffers, buffer, 0, text.length, 0)
      observeBacking()
    }

    expect(buffers.lineIndexes?.get(buffer)?.count).toBe(pushes + 1)
    expect(reallocations).toBeLessThanOrEqual(Math.ceil(Math.log2(pushes)) + 2)
  })
})

// A buffer id is a sequence number, and undo rolls that sequence back, so an id
// minted on a branch the user walked away from is minted again for different
// text on the branch they kept. These pin that the '\n' index describes the
// buffer the snapshot in hand actually holds, not the one a discarded branch
// put under the same id.
describe('piece table line index across a branched history', () => {
  it('re-scans a buffer id re-minted on another branch', () => {
    const base = createPieceTableSnapshot('one\ntwo\nthree')
    renderEveryOffset(base)

    const abandoned = insertIntoPieceTable(base, 8, 'x\ny')
    renderEveryOffset(abandoned)

    // Undo: the earlier snapshot comes back, rolling the buffer sequence back
    // with it, and the next edit re-mints the id the abandoned branch used.
    const kept = insertIntoPieceTable(base, 9, 'QQQ')

    expect(materializePieceTableFullText(kept)).toBe('one\ntwo\ntQQQhree')
    expect(offsetToPoint(kept, 11)).toEqual({ row: 2, column: 3 })
    renderEveryOffset(kept)
  })

  // The deterministic case above is one path through a much larger space: any
  // undo followed by an edit re-mints ids. Seeded rather than random so a
  // failure names the exact history that produced it.
  it('keeps every offset mapped after a fuzzed history of edits and undos', () => {
    const nextRandom = seededRandom(0x5eed)
    let undone: PieceTableSnapshot[] = []
    let redoable: PieceTableSnapshot[] = []
    let snapshot = createPieceTableSnapshot('alpha\nbeta\ngamma\n')
    renderEveryOffset(snapshot)

    for (let step = 0; step < 200; step += 1) {
      const roll = nextRandom()
      const at = Math.floor(nextRandom() * (snapshot.length + 1))

      if (roll < 0.4) {
        undone.push(snapshot)
        redoable = []
        snapshot = insertIntoPieceTable(snapshot, at, INSERTIONS[at % INSERTIONS.length]!)
      } else if (roll < 0.6 && snapshot.length > 0) {
        undone.push(snapshot)
        redoable = []
        const from = Math.min(at, snapshot.length - 1)
        const length = Math.min(1 + Math.floor(nextRandom() * 3), snapshot.length - from)
        snapshot = deleteFromPieceTable(snapshot, from, length)
      } else if (roll < 0.85) {
        const previous = undone.pop()
        if (!previous) continue

        redoable.push(snapshot)
        snapshot = previous
      } else {
        const next = redoable.pop()
        if (!next) continue

        undone.push(snapshot)
        snapshot = next
      }

      renderEveryOffset(snapshot)
    }
  })
})

// Same length, different break positions: a re-minted id whose replacement text
// is the same size is the case a length comparison cannot notice.
const INSERTIONS = ['z\nz', 'zzz', '\nzz', 'zz\n', 'zzzz\n']

// xorshift32: enough spread for a mix of insert/delete/undo/redo, and the same
// mix on every machine that runs the suite.
const seededRandom = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 100000) / 100000
  }
}

// Every offset mapped both ways, checked against the text itself: a stale index
// shows up as a row that does not exist, a column that does not add up, or a
// point that no longer names the offset it came from.
const renderEveryOffset = (snapshot: PieceTableSnapshot): void => {
  const text = materializePieceTableFullText(snapshot)

  let row = 0
  let lineStart = 0
  for (let offset = 0; offset <= text.length; offset += 1) {
    const point = { row, column: offset - lineStart }
    const mapped = offsetToPoint(snapshot, offset)
    const back = pointToOffset(snapshot, point)

    // Compared by hand, and handed to expect() only when they disagree. This runs for every
    // offset of every snapshot in a 200-step history, so an expect() per offset is ~60k
    // assertions — enough to put the fuzzed case over its timeout on a loaded runner, which is
    // how it first failed. A mismatch still reports through expect(), so a failure reads the
    // same; it just costs nothing while there is nothing to say.
    if (mapped.row !== point.row || mapped.column !== point.column) {
      expect({ offset, point: mapped }).toEqual({ offset, point })
    }
    if (back !== offset) expect({ point, offset: back }).toEqual({ point, offset })

    if (text.charCodeAt(offset) === 0x0a) {
      row += 1
      lineStart = offset + 1
    }
  }
}

// Independent scan the indexed binary search is checked against.
const nthLineBreakOffset = (text: string, start: number, ordinal: number): number | null => {
  let at = text.indexOf('\n', start)
  let remaining = ordinal

  while (at !== -1 && remaining > 1) {
    at = text.indexOf('\n', at + 1)
    remaining -= 1
  }

  return at === -1 ? null : at
}
