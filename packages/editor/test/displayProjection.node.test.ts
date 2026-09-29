import { describe, expect, test, vi } from 'vitest'
import { createDisplayRowsFromLines } from './oracles/displayTransforms'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createFoldMap } from '../src/foldMap'
import { createInlineMap } from '../src/inlineMap'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  type PieceTableEdit,
} from '@singapore-editor/textbuffer'

import {
  DisplayProjection,
  type DisplayProjectionInput,
} from '../src/virtualization/displayProjection'

function input(text: string): DisplayProjectionInput {
  return {
    textSnapshot: createDocumentTextSnapshot(createPieceTableSnapshot(text)),
    foldMap: null,
    inlineMap: null,
    injectedTextRows: [],
    wrapColumn: null,
    tabSize: 4,
  }
}

function oracle(options: DisplayProjectionInput) {
  const snapshot = options.textSnapshot
  const visible: number[] = []
  for (let row = 0; row < snapshot.lineCount; row += 1) {
    if (
      options.foldMap?.ranges.some(
        (range) => row > range.startPoint.row && row <= range.endPoint.row,
      )
    )
      continue
    visible.push(row)
  }
  const end = (row: number) =>
    row + 1 < snapshot.lineCount ? snapshot.lineStart(row + 1) - 1 : snapshot.length
  return createDisplayRowsFromLines({
    visibleLineCount: visible.length,
    bufferRowForVisibleRow: (row) => visible[row]!,
    lineText: (row) => snapshot.readRange(snapshot.lineStart(row), end(row)),
    lineStartOffset: (row) => snapshot.lineStart(row),
    lineEndOffset: end,
    wrapColumn: options.wrapColumn,
    tabSize: options.tabSize,
    injectedTextRows: options.injectedTextRows,
    inlineReplacements: (row) => options.inlineMap?.rowReplacements.get(row) ?? [],
  })
}

function compareWithOracle(projection: DisplayProjection) {
  const expected = oracle({ ...projection.config, textSnapshot: projection.textSnapshot })
  expect(projection.rowCount).toBe(expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    const row = projection.getRow(index)!
    const old = expected[index]!
    expect({ ...row, inlineRow: undefined, measurements: undefined }).toEqual({
      ...old,
      inlineRow: undefined,
      measurements: undefined,
    })
    if (row.source === 'document' && old.source === 'document')
      expect(row.inlineRow?.segments).toEqual(old.inlineRow?.segments)
    expect(projection.getRowMetrics(index)).toMatchObject({
      index,
      source: old.source,
      bufferRow: old.bufferRow,
      startOffset: old.startOffset,
      endOffset: old.endOffset,
      textLength: old.text.length,
    })
  }
}

describe('indexed display projection', () => {
  test.each(['', '\n', 'one\n', 'alpha\nbravo\ncharlie', 'a\tb\tlonger\n\t\tx', '🙂é中אבג\ntext'])(
    'matches eager rows and wrap boundaries for %j',
    (text) => {
      for (const width of [null, 1, 2, 4, 9]) {
        const projection = new DisplayProjection({ ...input(text), wrapColumn: width })
        compareWithOracle(projection)
        projection.dispose()
      }
    },
  )

  test('answers no buffer row for a display row it does not have', () => {
    const projection = new DisplayProjection(input('a\nb'))
    expect(projection.bufferRowForRow(1)).toBe(1)
    expect(projection.bufferRowForRow(2)).toBeNull()
    expect(projection.bufferRowForRow(-1)).toBeNull()
  })

  test('combines folds, atomic inline replacements and ordered injected wraps', () => {
    const text = 'a **bold** b\nhidden\nstill hidden\nlast\n'
    const piece = createPieceTableSnapshot(text)
    const projection = new DisplayProjection({
      ...input(text),
      textSnapshot: createDocumentTextSnapshot(piece),
      wrapColumn: 3,
      foldMap: createFoldMap(piece, [
        {
          startIndex: 0,
          endIndex: text.indexOf('last') - 1,
          startLine: 0,
          endLine: 2,
          type: 'test',
        },
      ]),
      inlineMap: createInlineMap(piece, [
        { id: 'open', startIndex: 2, endIndex: 4, text: '' },
        { id: 'close', startIndex: 8, endIndex: 10, text: '' },
        { id: 'hint', startIndex: 2, endIndex: 2, text: 'TYPE', insertion: true },
      ]),
      injectedTextRows: [
        { id: 'after', anchorBufferRow: 0, placement: 'after', text: '\tmore' },
        { id: 'before', anchorBufferRow: 0, placement: 'before', text: 'intro' },
        { id: 'hidden', anchorBufferRow: 1, placement: 'after', text: 'invisible' },
      ],
    })
    compareWithOracle(projection)
    expect(projection.rowForBufferRow(1)).toBe(projection.rowForBufferRow(0))
    expect(projection.nextDocumentRow(-1, 1)).toBe(2)
    expect(
      projection.getRowMetrics(projection.nextDocumentRow(projection.rowCount, -1)!),
    ).toMatchObject({ source: 'document' })
  })

  test('constructs 500k plain lines as one run, bounds distant windows and splices a top edit', () => {
    const piece = createPieceTableSnapshot('line\n'.repeat(500_000))
    const before = createDocumentTextSnapshot(piece)
    const reads = vi.spyOn(before, 'readRange')
    const full = vi.spyOn(before, 'materializeFullText')
    const projection = new DisplayProjection({ ...input(''), textSnapshot: before })
    expect(projection.diagnostics).toMatchObject({
      materializedRows: 0,
      cachedRows: 0,
      indexNodes: 1,
      sourceBytesRead: 0,
    })
    expect(projection.rowForOffset(before.length - 2)).toBe(499_999)
    expect(projection.getRowMetrics(499_999)).toMatchObject({ startOffset: 2_499_995 })
    expect(reads).not.toHaveBeenCalled()
    for (let start = 0; start < 500_000; start += 50_000)
      projection.materializeWindow(start, start + 40)
    expect(projection.diagnostics.cachedRows).toBe(40)
    expect(projection.diagnostics.cachedTextBytes).toBeLessThan(1024 * 1024)
    const edits = [{ from: 1, to: 2, text: 'x\ny' }]
    const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, edits))
    const afterReads = vi.spyOn(after, 'readRange')
    projection.update({ before, after, edits })
    expect(projection.rowCount).toBe(500_002)
    expect(projection.diagnostics.indexEntriesTouched).toBeLessThan(10)
    expect(projection.diagnostics.indexNodes).toBe(1)
    expect(afterReads).not.toHaveBeenCalled()
    expect(full).not.toHaveBeenCalled()
    expect(projection.getRow(500_000)?.text).toBe('line')
    projection.dispose()
    expect(projection.diagnostics).toMatchObject({
      cachedRows: 0,
      cachedTextBytes: 0,
      indexNodes: 0,
    })
    expect(projection.textSnapshot.length).toBe(0)
  })

  test('splices batched common-coordinate edits without changing untouched wrap summaries', () => {
    let piece = createPieceTableSnapshot('first line\nsecond\nthird long line\nfourth\nlast')
    let snapshot = createDocumentTextSnapshot(piece)
    const projection = new DisplayProjection({
      ...input(''),
      textSnapshot: snapshot,
      wrapColumn: 4,
    })
    const batches: readonly (readonly PieceTableEdit[])[] = [
      [
        { from: 0, to: 0, text: 'hello\n' },
        { from: 26, to: 30, text: 'REPLACED' },
      ],
      [{ from: 1, to: 12, text: 'x' }],
      [
        { from: 0, to: 0, text: '\n' },
        { from: 20, to: 20, text: '\ny\n' },
      ],
    ]
    for (const edits of batches) {
      const nextPiece = applyBatchToPieceTable(piece, edits)
      const after = createDocumentTextSnapshot(nextPiece)
      projection.update({ before: snapshot, after, edits })
      compareWithOracle(projection)
      piece = nextPiece
      snapshot = after
    }
  })

  test.each([
    {
      edits: [
        { from: 2, to: 2, text: 'first\n' },
        { from: 2, to: 2, text: 'second\n' },
        { from: 6, to: 6, text: 'last\n' },
      ],
    },
    {
      edits: [
        { from: 0, to: 2, text: 'head\n' },
        { from: 2, to: 2, text: 'middle\n' },
        { from: 2, to: 4, text: 'next\n' },
      ],
    },
    {
      edits: [
        { from: 0, to: 2, text: '' },
        { from: 2, to: 4, text: 'next\n' },
        { from: 4, to: 4, text: 'middle\n' },
      ],
    },
  ])('maps touching batch boundaries against the committed snapshot: %j', ({ edits }) => {
    const piece = createPieceTableSnapshot('a\nb\nc\nd\nend')
    const before = createDocumentTextSnapshot(piece)
    const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, edits))
    const projection = new DisplayProjection({ ...input(''), textSnapshot: before, wrapColumn: 3 })

    projection.update({ before, after, edits })

    compareWithOracle(projection)
  })

  test('local wrap edits do not remeasure distant inline or hidden rows', () => {
    const piece = createPieceTableSnapshot('alpha\n**bold**\nhidden\nstill hidden\nomega')
    const before = createDocumentTextSnapshot(piece)
    const projection = new DisplayProjection({
      ...input(''),
      textSnapshot: before,
      wrapColumn: 3,
      inlineMap: createInlineMap(piece, [{ id: 'marker', startIndex: 6, endIndex: 8, text: '' }]),
      foldMap: createFoldMap(piece, [
        { startIndex: 14, endIndex: 34, startLine: 2, endLine: 3, type: 'test' },
      ]),
    })
    const count = projection.diagnostics.summaryLinesMeasured
    const edits = [{ from: 1, to: 2, text: 'LONG\nNEW' }]
    const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, edits))
    projection.update({ before, after, edits })
    expect(projection.diagnostics.summaryLinesMeasured - count).toBe(2)
    compareWithOracle(projection)
    const revision = projection.revision
    projection.reconfigure(projection.config)
    expect(projection.revision).toBe(revision)
  })

  test('range-backs giant rows and counts the exact wrapped extent', () => {
    const options = input('a'.repeat(200_000) + '\tEND')
    const reads = vi.spyOn(options.textSnapshot, 'readRange')
    const projection = new DisplayProjection(options)
    const row = projection.getRow(0)!
    expect(typeof row.text).toBe('object')
    expect(reads).not.toHaveBeenCalled()
    expect(row.text.slice(199_998, 200_004)).toBe('aa\tEND')
    expect(projection.diagnostics.cachedTextBytes).toBe(0)
    projection.reconfigure({ wrapColumn: 80 })
    expect(projection.rowCount).toBe(2501)
    expect(projection.getRow(projection.rowCount - 1)?.text).toBe('\tEND')
    expect(reads.mock.calls.every(([start, end]) => end - start <= 16384)).toBe(true)
  })
  // Each of the 90 mutations compares every wrapped row with the eager oracle.
  test(
    'keeps AVL ranks and splices correct across deterministic edits and fold toggles',
    { timeout: 20_000 },
    () => {
      let piece = createPieceTableSnapshot('alpha\tbeta\nplain text\n'.repeat(140))
      let snapshot = createDocumentTextSnapshot(piece)
      const projection = new DisplayProjection({
        ...input(''),
        textSnapshot: snapshot,
        wrapColumn: 5,
      })
      let seed = 31
      for (let step = 0; step < 90; step += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        const from = seed % (snapshot.length + 1)
        const to = Math.min(snapshot.length, from + (step % 7))
        const edits = [{ from, to, text: ['x', '\nnew\n', '', '\t'][step % 4]! }]
        const next = applyBatchToPieceTable(piece, edits)
        const after = createDocumentTextSnapshot(next)
        projection.update({ before: snapshot, after, edits })
        if (step % 9 === 0)
          projection.reconfigure({
            foldMap: createFoldMap(next, [
              {
                startIndex: after.lineStart(10),
                endIndex: after.lineStart(20),
                startLine: 10,
                endLine: 20,
                type: 'test',
              },
            ]),
          })
        if (step % 9 === 4) projection.reconfigure({ foldMap: null })
        compareWithOracle(projection)
        piece = next
        snapshot = after
      }
    },
  )

  test('edits inside an unchanged fold do not remeasure visible wrapping', () => {
    const piece = createPieceTableSnapshot('header\ninside one\ninside two\ntail')
    const before = createDocumentTextSnapshot(piece)
    const projection = new DisplayProjection({
      ...input(''),
      textSnapshot: before,
      wrapColumn: 3,
      foldMap: createFoldMap(piece, [
        {
          startIndex: 0,
          endIndex: before.lineStart(2) + 4,
          startLine: 0,
          endLine: 2,
          type: 'test',
        },
      ]),
    })
    const measured = projection.diagnostics.summaryLinesMeasured
    const edits = [{ from: 9, to: 11, text: 'changed\ninside' }]
    const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, edits))
    projection.update({ before, after, edits })
    expect(projection.diagnostics.summaryLinesMeasured).toBe(measured)
    compareWithOracle(projection)
  })

  test('measures giant inline replacements without joining source or projected lines', () => {
    const piece = createPieceTableSnapshot('a'.repeat(100_000))
    const snapshot = createDocumentTextSnapshot(piece)
    const reads = vi.spyOn(snapshot, 'readRange')
    const projection = new DisplayProjection({
      ...input(''),
      textSnapshot: snapshot,
      inlineMap: createInlineMap(piece, [
        { id: 'middle', startIndex: 50_000, endIndex: 50_005, text: 'TYPE' },
      ]),
    })
    const row = projection.getRow(0)!
    expect(row.text.length).toBe(99_999)
    expect(projection.getRowMeasurements(0)?.length).toBe(99_999)
    expect(reads).not.toHaveBeenCalled()
    expect(projection.getLineText(0).slice(49_998, 50_006)).toBe('aaTYPEaa')
    expect(reads.mock.calls.every(([start, end]) => end - start <= 8)).toBe(true)
  })
  test('bounds retained bytes independently of row count during explicit distant queries', () => {
    const projection = new DisplayProjection(input(('x'.repeat(3000) + '\n').repeat(400)))
    for (let row = 0; row < 400; row += 1) projection.getRow(row)
    expect(projection.diagnostics.cachedRows).toBeLessThan(256)
    expect(projection.diagnostics.cachedTextBytes).toBeLessThanOrEqual(1024 * 1024)
    projection.retainWindow(399, 400)
    expect(projection.diagnostics.cachedRows).toBe(1)
    projection.retainWindow(0, 0)
    expect(projection.diagnostics.cachedTextBytes).toBe(0)
  })

  test('resolves wrap edge bias without reading text or selecting injected rows', () => {
    const options = input('abcdefgh\nz')
    const reads = vi.spyOn(options.textSnapshot, 'readRange')
    const projection = new DisplayProjection({
      ...options,
      wrapColumn: 4,
      injectedTextRows: [
        { id: 'intro', anchorBufferRow: 0, placement: 'before', text: 'long hint' },
      ],
    })
    reads.mockClear()
    expect(projection.rowForOffset(0)).toBe(3)
    expect(projection.rowForOffset(4, 'before')).toBe(3)
    expect(projection.rowForOffset(4, 'nearest')).toBe(3)
    expect(projection.rowForOffset(4, 'after')).toBe(4)
    expect(projection.rowForBufferRow(1)).toBe(5)
    expect(reads).not.toHaveBeenCalled()
  })
  test('matches caret row affinity when inline insertions and replacements cross wraps', () => {
    const piece = createPieceTableSnapshot('abcd')
    const cases = [
      [{ id: 'hint', startIndex: 0, endIndex: 0, text: 'TYPE', insertion: true }],
      [{ id: 'replace', startIndex: 0, endIndex: 2, text: 'LONGREPLACEMENT' }],
      [{ id: 'hide', startIndex: 1, endIndex: 3, text: '' }],
    ]
    for (const specs of cases) {
      const options = {
        ...input(''),
        textSnapshot: createDocumentTextSnapshot(piece),
        wrapColumn: 3,
        inlineMap: createInlineMap(piece, specs),
      }
      const projection = new DisplayProjection(options)
      const expected = oracle(options)
      for (let offset = 0; offset <= piece.length; offset += 1) {
        const first = expected.find(
          (row) =>
            row.source === 'document' && row.startOffset <= offset && row.endOffset >= offset,
        )!
        const following = expected.slice(first.index + 1).find((row) => row.source === 'document')
        const after =
          first.endOffset === offset && following?.startOffset === offset
            ? following.index
            : first.index
        expect(projection.rowForOffset(offset, 'before')).toBe(first.index)
        expect(projection.rowForOffset(offset, 'nearest')).toBe(first.index)
        expect(projection.rowForOffset(offset, 'after')).toBe(after)
      }
    }
  })
})
