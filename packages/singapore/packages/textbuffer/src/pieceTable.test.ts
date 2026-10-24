import { describe, expect, test } from 'vitest'
import {
  Anchor,
  anchorAfter,
  anchorAt,
  anchorBefore,
  applyBatchToPieceTable,
  compareAnchors,
  createPieceTableSnapshot,
  createPieceTableWalker,
  deleteFromPieceTable,
  diffPieceTableSnapshots,
  streamPieceTableTextChunks,
  readPieceTableTextRange,
  insertIntoPieceTable,
  debugPieceTable,
  lineRange,
  materializePieceTableFullText,
  offsetToPoint,
  pieceTableContainsUnusualLineTerminators,
  pieceTableSnapshotsHaveSameText,
  pointToOffset,
  readPieceTableLine,
  resolveAnchor,
  resolveAnchorLinear,
} from './index'
import { BUFFER_CHUNK_SIZE } from './buffers'
import { validatePieceTreeInvariants } from './inspection'

type PieceTableSnapshot = ReturnType<typeof createPieceTableSnapshot>
type Random = () => number

const FUZZ_ALPHABET = ['a', 'b', 'c', 'd', 'e', 'f', '\n', ' ', '\t']

const countLineBreaks = (text: string): number => [...text].filter((char) => char === '\n').length

const createRandom = (seed: number): Random => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const randomInt = (random: Random, maxExclusive: number): number =>
  Math.floor(random() * maxExclusive)

const randomText = (random: Random): string => {
  const length = 1 + randomInt(random, 12)
  let text = ''

  for (let index = 0; index < length; index++) {
    text += FUZZ_ALPHABET[randomInt(random, FUZZ_ALPHABET.length)]
  }

  return text
}

const randomChar = (random: Random): string =>
  FUZZ_ALPHABET[randomInt(random, FUZZ_ALPHABET.length)]!

const expectSnapshotText = (snapshot: PieceTableSnapshot, text: string) => {
  expect(materializePieceTableFullText(snapshot)).toBe(text)
  expect(snapshot.length).toBe(text.length)
  expect(snapshot.root?.subtreeLineBreaks ?? 0).toBe(countLineBreaks(text))
}

// A row's bounds, its text and a clamped column against the split string.
const expectRow = (snapshot: PieceTableSnapshot, lines: readonly string[], row: number) => {
  let start = 0
  for (let index = 0; index < row; index++) start += lines[index]!.length + 1
  const line = lines[row]!
  expect(lineRange(snapshot, row)).toEqual({ start, end: start + line.length })
  expect(readPieceTableLine(snapshot, row)).toBe(line)
  expect(pointToOffset(snapshot, { row, column: line.length >> 1 })).toBe(
    start + (line.length >> 1),
  )
  expect(pointToOffset(snapshot, { row, column: line.length + 3 })).toBe(start + line.length)
}

const expectRows = (snapshot: PieceTableSnapshot, text: string, random: Random) => {
  const lines = text.split('\n')
  expectRow(snapshot, lines, 0)
  expectRow(snapshot, lines, lines.length - 1)
  for (let index = 0; index < 8; index++)
    expectRow(snapshot, lines, randomInt(random, lines.length))
  expect(lineRange(snapshot, lines.length)).toEqual({ start: text.length, end: text.length })
  expect(readPieceTableLine(snapshot, lines.length)).toBe('')
}

const expectRandomRanges = (snapshot: PieceTableSnapshot, text: string, random: Random) => {
  for (let index = 0; index < 10; index++) {
    const start = randomInt(random, text.length + 1)
    const end = start + randomInt(random, text.length - start + 1)
    expect(readPieceTableTextRange(snapshot, start, end)).toBe(text.slice(start, end))
  }
}

const applyRandomEdit = (
  snapshot: PieceTableSnapshot,
  text: string,
  random: Random,
): { snapshot: PieceTableSnapshot; text: string } => {
  const shouldInsert = text.length === 0 || random() < 0.62

  if (shouldInsert) {
    if (random() < 0.25) return applyRandomInsertRun(snapshot, text, random)
    return applyRandomInsertion(snapshot, text, random)
  }

  const start = randomInt(random, text.length)
  const length = 1 + randomInt(random, text.length - start)
  return {
    snapshot: deleteFromPieceTable(snapshot, start, length),
    text: text.slice(0, start) + text.slice(start + length),
  }
}

const applyRandomInsertion = (
  snapshot: PieceTableSnapshot,
  text: string,
  random: Random,
): { snapshot: PieceTableSnapshot; text: string } => {
  const offset = randomInt(random, text.length + 1)
  const inserted = randomText(random)

  return {
    snapshot: insertIntoPieceTable(snapshot, offset, inserted),
    text: text.slice(0, offset) + inserted + text.slice(offset),
  }
}

const applyRandomInsertRun = (
  snapshot: PieceTableSnapshot,
  text: string,
  random: Random,
): { snapshot: PieceTableSnapshot; text: string } => {
  const offset = randomInt(random, text.length + 1)
  const length = 2 + randomInt(random, 8)
  let nextSnapshot = snapshot
  let inserted = ''

  for (let index = 0; index < length; index++) {
    const char = randomChar(random)
    nextSnapshot = insertIntoPieceTable(nextSnapshot, offset + index, char)
    inserted += char
  }

  return {
    snapshot: nextSnapshot,
    text: text.slice(0, offset) + inserted + text.slice(offset),
  }
}

const runRandomEditScenario = (seed: number): void => {
  const random = createRandom(seed)
  let snapshot = createPieceTableSnapshot(randomText(random))
  let text = materializePieceTableFullText(snapshot)

  for (let operation = 0; operation < 250; operation++) {
    const result = applyRandomEdit(snapshot, text, random)
    snapshot = result.snapshot
    text = result.text
    expectSnapshotText(snapshot, text)
    expectRandomRanges(snapshot, text, random)
    expectRows(snapshot, text, random)
    expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
  }
}

const expectWalkerMatchesText = (
  snapshot: PieceTableSnapshot,
  text: string,
  random: Random,
): void => {
  const walker = createPieceTableWalker(snapshot)
  let walked = ''
  while (!walker.exhausted()) walked += String.fromCharCode(walker.next())
  expect(walked).toBe(text)

  for (let index = 0; index < 10; index++) {
    const offset = randomInt(random, text.length + 1)
    walker.seek(offset)
    expect(walker.offset()).toBe(offset)
    if (offset < text.length) {
      expect(walker.charCode()).toBe(text.charCodeAt(offset))
      expect(walker.codePoint()).toBe(text.codePointAt(offset))
    } else {
      expect(walker.charCode()).toBe(-1)
    }
    const skipLength = randomInt(random, text.length - offset + 1)
    walker.skip(skipLength)
    expect(walker.offset()).toBe(offset + skipLength)
  }
}

const runRandomWalkerScenario = (seed: number): void => {
  const random = createRandom(seed)
  let snapshot = createPieceTableSnapshot(randomText(random))
  let text = materializePieceTableFullText(snapshot)

  for (let operation = 0; operation < 120; operation++) {
    const result = applyRandomEdit(snapshot, text, random)
    snapshot = result.snapshot
    text = result.text
    expectWalkerMatchesText(snapshot, text, random)
  }
}

const runRandomDiffScenario = (seed: number): void => {
  const random = createRandom(seed)
  let snapshot = createPieceTableSnapshot(randomText(random))
  let text = materializePieceTableFullText(snapshot)

  for (let operation = 0; operation < 40; operation++) {
    const base = snapshot
    const baseText = text
    const editCount = 1 + randomInt(random, 5)
    for (let editIndex = 0; editIndex < editCount; editIndex++) {
      const result = applyRandomEdit(snapshot, text, random)
      snapshot = result.snapshot
      text = result.text
    }

    expect(pieceTableSnapshotsHaveSameText(base, snapshot)).toBe(baseText === text)

    const edit = diffPieceTableSnapshots(base, snapshot)
    if (edit === null) {
      expect(text).toBe(baseText)
    } else {
      expect(baseText.slice(0, edit.from) + edit.text + baseText.slice(edit.to)).toBe(text)
    }
  }
}

const runRandomAnchorScenario = (seed: number): void => {
  const random = createRandom(seed)
  let snapshot = createPieceTableSnapshot(randomText(random))
  let text = materializePieceTableFullText(snapshot)
  const anchors = [anchorBefore(snapshot, 0), anchorAfter(snapshot, snapshot.length)]

  for (let operation = 0; operation < 80; operation++) {
    if (anchors.length < 60) {
      const offset = randomInt(random, text.length + 1)
      anchors.push(anchorAt(snapshot, offset, random() < 0.5 ? 'left' : 'right'))
    }

    const result = applyRandomEdit(snapshot, text, random)
    snapshot = result.snapshot
    text = result.text

    for (const anchor of anchors) {
      expect(resolveAnchor(snapshot, anchor)).toEqual(resolveAnchorLinear(snapshot, anchor))
    }
  }
}

describe('piece table', () => {
  test('basic insert/delete round-trip', () => {
    let snapshot = createPieceTableSnapshot('hello')
    expectSnapshotText(snapshot, 'hello')

    snapshot = insertIntoPieceTable(snapshot, 5, ' world')
    expectSnapshotText(snapshot, 'hello world')

    snapshot = deleteFromPieceTable(snapshot, 5, 1)
    expectSnapshotText(snapshot, 'helloworld')
  })

  test('keeps previous snapshots readable after later edits', () => {
    const initial = createPieceTableSnapshot('abc')
    const inserted = insertIntoPieceTable(initial, 1, 'XX')
    const deleted = deleteFromPieceTable(inserted, 2, 2)

    expectSnapshotText(initial, 'abc')
    expectSnapshotText(inserted, 'aXXbc')
    expectSnapshotText(deleted, 'aXc')
  })

  test('iterates text chunks with document offsets', () => {
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot('ac'), 1, 'b')
    const chunks: string[] = []

    streamPieceTableTextChunks(snapshot, (text, start, end) => {
      chunks.push(`${start}:${end}:${text}`)
    })

    expect(chunks).toEqual(['0:1:a', '1:2:b', '2:3:c'])
  })

  test('compares snapshot text without requiring identical piece layouts', () => {
    const left = createPieceTableSnapshot('alpha beta gamma')
    const right = insertIntoPieceTable(createPieceTableSnapshot('alpha gamma'), 6, 'beta ')
    const changed = insertIntoPieceTable(right, right.length, '!')

    expect(pieceTableSnapshotsHaveSameText(left, right)).toBe(true)
    expect(pieceTableSnapshotsHaveSameText(left, changed)).toBe(false)
  })

  test('handles empty documents', () => {
    let snapshot = createPieceTableSnapshot('')
    expectSnapshotText(snapshot, '')
    expect(readPieceTableTextRange(snapshot, 0, 0)).toBe('')
    expect(offsetToPoint(snapshot, 0)).toEqual({ row: 0, column: 0 })
    expect(pointToOffset(snapshot, { row: 0, column: 10 })).toBe(0)

    snapshot = insertIntoPieceTable(snapshot, 0, 'a\n')
    expectSnapshotText(snapshot, 'a\n')

    snapshot = deleteFromPieceTable(snapshot, 0, 2)
    expectSnapshotText(snapshot, '')
  })

  test('handles trailing newline documents', () => {
    const snapshot = createPieceTableSnapshot('alpha\nbeta\n')
    expectSnapshotText(snapshot, 'alpha\nbeta\n')
    expect(offsetToPoint(snapshot, 10)).toEqual({ row: 1, column: 4 })
    expect(offsetToPoint(snapshot, 11)).toEqual({ row: 2, column: 0 })
    expect(pointToOffset(snapshot, { row: 1, column: 99 })).toBe(10)
    expect(pointToOffset(snapshot, { row: 2, column: 99 })).toBe(11)
  })

  test('handles very long single-line documents', () => {
    const text = 'x'.repeat(120_000)
    const snapshot = createPieceTableSnapshot(text)
    expectSnapshotText(snapshot, text)
    expect(readPieceTableTextRange(snapshot, 60_000, 60_010)).toBe('x'.repeat(10))
    expect(offsetToPoint(snapshot, 120_000)).toEqual({ row: 0, column: 120_000 })
    expect(pointToOffset(snapshot, { row: 0, column: 200_000 })).toBe(120_000)
  })

  test('coalesces sequential inserts at the moving end into one piece', () => {
    let snapshot = createPieceTableSnapshot('')

    for (let index = 0; index < 1000; index++) {
      snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'x')
    }

    const pieces = debugPieceTable(snapshot)
    const buffers = new Set(pieces.map((piece) => piece.buffer))
    expect(pieces).toHaveLength(1)
    expect(buffers.size).toBe(1)
    expectSnapshotText(snapshot, 'x'.repeat(1000))
  })

  test('refuses coalescing after an insert at a different document location', () => {
    let snapshot = createPieceTableSnapshot('abc')
    snapshot = insertIntoPieceTable(snapshot, 1, 'x')
    snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'y')

    const insertedBuffers = new Set(
      debugPieceTable(snapshot)
        .filter((piece) => piece.buffer !== snapshot.buffers.original)
        .map((piece) => piece.buffer),
    )

    expect(insertedBuffers.size).toBe(2)
    expectSnapshotText(snapshot, 'axbcy')
  })

  test('refuses coalescing when a trailing tombstone owns the chunk tail', () => {
    let snapshot = insertIntoPieceTable(createPieceTableSnapshot(''), 0, 'ab')
    snapshot = deleteFromPieceTable(snapshot, 1, 1)
    snapshot = insertIntoPieceTable(snapshot, 1, 'c')

    const visiblePieces = debugPieceTable(snapshot).filter((piece) => piece.visible)
    expect(visiblePieces).toHaveLength(2)
    expectSnapshotText(snapshot, 'ac')
  })

  test('refuses coalescing when the newest chunk is full', () => {
    let snapshot = insertIntoPieceTable(
      createPieceTableSnapshot(''),
      0,
      'x'.repeat(BUFFER_CHUNK_SIZE),
    )
    snapshot = insertIntoPieceTable(snapshot, snapshot.length, 'y')

    const visiblePieces = debugPieceTable(snapshot).filter((piece) => piece.visible)
    expect(visiblePieces).toHaveLength(2)
    expectSnapshotText(snapshot, 'x'.repeat(BUFFER_CHUNK_SIZE) + 'y')
  })

  test('keeps old snapshots readable after extending a newer buffer chunk', () => {
    const first = insertIntoPieceTable(createPieceTableSnapshot(''), 0, 'a')
    const second = insertIntoPieceTable(first, 1, 'b')

    expectSnapshotText(first, 'a')
    expectSnapshotText(second, 'ab')
  })

  test('keeps coalesced anchor resolution aligned with the linear oracle', () => {
    const initial = insertIntoPieceTable(createPieceTableSnapshot(''), 0, 'ab')
    const inside = anchorAt(initial, 1, 'left')
    const rightEnd = anchorAfter(initial, initial.length)
    const extended = insertIntoPieceTable(initial, initial.length, 'c')

    expect(resolveAnchor(extended, inside)).toEqual(resolveAnchorLinear(extended, inside))
    expect(resolveAnchor(extended, rightEnd)).toEqual(resolveAnchorLinear(extended, rightEnd))
  })

  test('splits large inserts across bounded chunks', () => {
    const text = 'x'.repeat(40_000)
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot(''), 0, text)
    const pieces = debugPieceTable(snapshot)

    expect(pieces.length).toBeGreaterThan(1)
    expectSnapshotText(snapshot, text)
  })

  test('keeps line-break counts correct across inserts, deletes, and splits', () => {
    let snapshot = createPieceTableSnapshot('ab\ncd\nef')
    snapshot = insertIntoPieceTable(snapshot, 4, 'X\nY\n')
    snapshot = deleteFromPieceTable(snapshot, 1, 5)

    expectSnapshotText(snapshot, 'aY\nd\nef')
    expect(
      debugPieceTable(snapshot).reduce(
        (sum, piece) => sum + (piece.visible ? piece.lineBreaks : 0),
        0,
      ),
    ).toBe(2)
  })

  test('converts offsets to points at line boundaries', () => {
    const snapshot = createPieceTableSnapshot('ab\ncde\n\nf')

    expect(offsetToPoint(snapshot, 0)).toEqual({ row: 0, column: 0 })
    expect(offsetToPoint(snapshot, 2)).toEqual({ row: 0, column: 2 })
    expect(offsetToPoint(snapshot, 3)).toEqual({ row: 1, column: 0 })
    expect(offsetToPoint(snapshot, 6)).toEqual({ row: 1, column: 3 })
    expect(offsetToPoint(snapshot, 7)).toEqual({ row: 2, column: 0 })
    expect(offsetToPoint(snapshot, 8)).toEqual({ row: 3, column: 0 })
    expect(offsetToPoint(snapshot, 9)).toEqual({ row: 3, column: 1 })
  })

  test('converts points to offsets and clamps columns to line ends', () => {
    const snapshot = createPieceTableSnapshot('ab\ncde\n\nf')

    expect(pointToOffset(snapshot, { row: 0, column: 99 })).toBe(2)
    expect(pointToOffset(snapshot, { row: 1, column: 2 })).toBe(5)
    expect(pointToOffset(snapshot, { row: 1, column: 99 })).toBe(6)
    expect(pointToOffset(snapshot, { row: 2, column: 99 })).toBe(7)
    expect(pointToOffset(snapshot, { row: 3, column: 1 })).toBe(9)
    expect(pointToOffset(snapshot, { row: 99, column: 0 })).toBe(9)
    expect(pointToOffset(snapshot, { row: -1, column: -1 })).toBe(0)
  })

  test('finds both ends of every row, whatever pieces they fall in', () => {
    for (const text of ['', 'one', '\n', 'ab\ncde\n\nf', 'ab\ncde\n\nf\n']) {
      const snapshot = createPieceTableSnapshot(text)
      const lines = text.split('\n')
      for (let row = 0; row < lines.length; row++) expectRow(snapshot, lines, row)
      expect(lineRange(snapshot, -2)).toEqual(lineRange(snapshot, 0))
      expect(lineRange(snapshot, lines.length + 5)).toEqual({
        start: text.length,
        end: text.length,
      })
    }
  })

  test('a row ends in a later piece, past the tombstones between its breaks', () => {
    // Row 1 starts in the original piece, crosses an insert, two tombstones
    // and a breakless piece, and ends at a break three pieces further on.
    let snapshot = createPieceTableSnapshot('aa\nbbbbbbbb\ncc\ndd')
    snapshot = insertIntoPieceTable(snapshot, 6, 'XYZ')
    snapshot = deleteFromPieceTable(snapshot, 7, 1)
    snapshot = deleteFromPieceTable(snapshot, 9, 2)
    const text = 'aa\nbbbXZbbb\ncc\ndd'
    expect(materializePieceTableFullText(snapshot)).toBe(text)
    expect(debugPieceTable(snapshot).filter((piece) => !piece.visible)).toHaveLength(2)

    const lines = text.split('\n')
    for (let row = 0; row < lines.length; row++) expectRow(snapshot, lines, row)

    // Hiding the break that ended row 1 moves its end into the next piece.
    const joined = deleteFromPieceTable(snapshot, text.indexOf('\ncc'), 1)
    const joinedLines = text.replace('\ncc', 'cc').split('\n')
    for (let row = 0; row < joinedLines.length; row++) expectRow(joined, joinedLines, row)
  })

  test('round-trips every offset through point conversion', () => {
    let snapshot = createPieceTableSnapshot('ab\ncde\n\nf')
    snapshot = insertIntoPieceTable(snapshot, 3, 'XX\n')
    snapshot = deleteFromPieceTable(snapshot, 1, 2)

    for (let offset = 0; offset <= snapshot.length; offset++) {
      expect(pointToOffset(snapshot, offsetToPoint(snapshot, offset))).toBe(offset)
    }
  })

  test('matches string-model readback across randomized insert/delete sequences', () => {
    for (let seed = 1; seed <= 25; seed++) {
      runRandomEditScenario(seed)
    }
  }, 30_000)

  test('walker matches string-model reads across randomized edit sequences', () => {
    for (let seed = 1; seed <= 25; seed++) {
      runRandomWalkerScenario(seed)
    }
  }, 30_000)

  test('diff and equality match the string model across randomized histories', () => {
    for (let seed = 1; seed <= 25; seed++) {
      runRandomDiffScenario(seed)
    }
  }, 30_000)

  test('keeps deleted pieces invisible and out of user-facing text', () => {
    const snapshot = deleteFromPieceTable(createPieceTableSnapshot('ab\ncd'), 1, 3)
    const pieces = debugPieceTable(snapshot)

    expectSnapshotText(snapshot, 'ad')
    expect(pieces.some((piece) => !piece.visible)).toBe(true)
    expect(snapshot.root?.subtreeVisibleLength ?? 0).toBe(2)
    expect(snapshot.root?.subtreeOriginalLength ?? 0).toBe(5)
    expect(snapshot.root?.subtreeLineBreaks ?? 0).toBe(0)
  })

  test('indexes inserted buffers only, and a deletion writes nothing', () => {
    const initial = createPieceTableSnapshot('abc')
    const inserted = insertIntoPieceTable(initial, 1, 'XX')
    const deleted = deleteFromPieceTable(inserted, 1, 2)

    expect(initial.reverseIndex.count).toBe(0)
    expect(inserted.reverseIndex.count).toBe(1)
    expect(deleted.reverseIndex).toBe(inserted.reverseIndex)
  })

  test('resolves sentinel anchors in every snapshot', () => {
    let snapshot = createPieceTableSnapshot('abc')
    expect(resolveAnchor(snapshot, Anchor.MIN)).toEqual({ offset: 0, liveness: 'live' })
    expect(resolveAnchor(snapshot, Anchor.MAX)).toEqual({ offset: 3, liveness: 'live' })

    snapshot = deleteFromPieceTable(snapshot, 0, 3)
    expect(resolveAnchor(snapshot, Anchor.MIN)).toEqual({ offset: 0, liveness: 'live' })
    expect(resolveAnchor(snapshot, Anchor.MAX)).toEqual({ offset: 0, liveness: 'live' })
  })

  test('creates boundary anchors using bias', () => {
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot('ac'), 1, 'b')
    const left = anchorBefore(snapshot, 1)
    const right = anchorAfter(snapshot, 1)

    expect(left.buffer).not.toBe(right.buffer)
    expect(resolveAnchor(snapshot, left)).toEqual({ offset: 1, liveness: 'live' })
    expect(resolveAnchor(snapshot, right)).toEqual({ offset: 1, liveness: 'live' })
    expect(compareAnchors(snapshot, left, right)).toBeLessThan(0)
  })

  test('reports deleted liveness after deletion', () => {
    const initial = createPieceTableSnapshot('abc')
    const anchor = anchorAfter(initial, 1)
    const deleted = deleteFromPieceTable(initial, 1, 1)

    expect(resolveAnchor(deleted, anchor)).toEqual({ offset: 1, liveness: 'deleted' })
  })

  test('applies replacement bias around inserted text', () => {
    const initial = createPieceTableSnapshot('abc')
    const left = anchorAt(initial, 2, 'left')
    const right = anchorAt(initial, 1, 'right')
    const deleted = deleteFromPieceTable(initial, 1, 1)
    const replaced = insertIntoPieceTable(deleted, 1, 'XX')

    expectSnapshotText(replaced, 'aXXc')
    expect(resolveAnchor(replaced, left)).toEqual({ offset: 1, liveness: 'deleted' })
    expect(resolveAnchor(replaced, right)).toEqual({ offset: 3, liveness: 'deleted' })
  })

  test('snaps anchors inside surrogate pairs to the start of the code point', () => {
    const snapshot = createPieceTableSnapshot('a😀b')

    expect(resolveAnchor(snapshot, anchorAfter(snapshot, 2))).toEqual({
      offset: 1,
      liveness: 'live',
    })
    expect(anchorAfter(snapshot, 1)).toMatchObject({ kind: 'anchor' })
    expect(anchorAfter(snapshot, 3)).toMatchObject({ kind: 'anchor' })
  })

  test('resolves anchors in empty snapshots without returning sentinels', () => {
    const snapshot = createPieceTableSnapshot('')
    const anchor = anchorAfter(snapshot, 0)

    expect(anchor.kind).toBe('anchor')
    expect(resolveAnchor(snapshot, anchor)).toEqual({ offset: 0, liveness: 'live' })
  })

  test('preserves empty-document anchor bias after first insert', () => {
    const snapshot = createPieceTableSnapshot('')
    const left = anchorBefore(snapshot, 0)
    const right = anchorAfter(snapshot, 0)
    const inserted = insertIntoPieceTable(snapshot, 0, 'abc')

    expect(resolveAnchor(inserted, left)).toEqual({ offset: 0, liveness: 'live' })
    expect(resolveAnchor(inserted, right)).toEqual({ offset: 3, liveness: 'live' })
  })

  test('indexed anchor resolution matches the linear baseline across edits', () => {
    let snapshot = createPieceTableSnapshot('alpha\nbeta\ngamma')
    const anchors = [
      anchorBefore(snapshot, 0),
      anchorAfter(snapshot, 5),
      anchorAfter(snapshot, 6),
      anchorBefore(snapshot, snapshot.length),
    ]

    snapshot = insertIntoPieceTable(snapshot, 6, 'INSERT\n')
    anchors.push(anchorAfter(snapshot, 8))
    snapshot = deleteFromPieceTable(snapshot, 2, 10)
    snapshot = insertIntoPieceTable(snapshot, 2, 'xy')
    snapshot = deleteFromPieceTable(snapshot, snapshot.length - 3, 2)

    for (const anchor of anchors) {
      expect(resolveAnchor(snapshot, anchor)).toEqual(resolveAnchorLinear(snapshot, anchor))
    }
  })

  test('indexed anchor resolution matches linear across randomized edit patterns', () => {
    for (let seed = 1; seed <= 10; seed++) {
      runRandomAnchorScenario(seed)
    }
  }, 10_000)

  test('reports the unusual line terminators ingestion folded away', () => {
    // The fold is deliberate — U+2028 is a forced break to CSS and not a row to
    // us — but it edits the document at a spot nobody typed at, here putting a
    // hard break inside a string literal. A host cannot warn about that unless
    // the snapshot says it happened.
    const folded = createPieceTableSnapshot('const a = "x\u2028y";\r\nconst b = 1;\r\n')

    expectSnapshotText(folded, 'const a = "x\ny";\nconst b = 1;\n')
    expect(pieceTableContainsUnusualLineTerminators(folded)).toBe(true)
    expect(
      pieceTableContainsUnusualLineTerminators(createPieceTableSnapshot('const b = 1;\r\n')),
    ).toBe(false)
  })

  test('carries an already-ingested answer through a pre-normalized snapshot', () => {
    // Folded text no longer holds the evidence, so a caller that normalized the
    // document itself has to hand its own finding in with the text.
    const snapshot = createPieceTableSnapshot('a\nb', {
      normalized: true,
      containsUnusualLineTerminators: true,
    })

    expect(pieceTableContainsUnusualLineTerminators(snapshot)).toBe(true)
  })

  test('applies non-overlapping batch edits against the original snapshot', () => {
    const snapshot = createPieceTableSnapshot('abcdef')
    const edited = applyBatchToPieceTable(snapshot, [
      { from: 1, to: 3, text: 'XX' },
      { from: 4, to: 6, text: 'Y' },
    ])

    expectSnapshotText(edited, 'aXXdY')
    expectSnapshotText(snapshot, 'abcdef')
  })
})
