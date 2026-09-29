import { describe, expect, test, vi } from 'vitest'
import type { DisplayRow } from '../displayTransforms'
import { createDocumentTextSnapshot } from '../documentTextSnapshot'
import { createFoldMap } from '../foldMap'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createVirtualizedTextViewModel } from './virtualizedTextViewModel'

describe('virtualized text view model', () => {
  test('materializes deterministic wrapped and injected rows from a real snapshot', () => {
    const textSnapshot = createDocumentTextSnapshot(
      createPieceTableSnapshot('alpha\nbravo\ncharlie'),
    )
    const fullRead = vi.spyOn(textSnapshot, 'materializeFullText')
    const input = {
      textSnapshot,
      foldMap: null,
      inlineMap: null,
      injectedTextRows: [{ id: 'hint', anchorBufferRow: 0, placement: 'before', text: 'hint' }],
      wrapColumn: 4,
      tabSize: 4,
    } as const

    const first = createVirtualizedTextViewModel(input)
    const second = createVirtualizedTextViewModel(input)

    expect(rowSummaries(first)).toEqual(rowSummaries(second))
    expect(rowSummaries(first)).toEqual([
      'text:injected:hint:0:0',
      'text:document:alph:0:0',
      'text:document:a:0:1',
      'text:document:brav:1:0',
      'text:document:o:1:1',
      'text:document:char:2:0',
      'text:document:lie:2:1',
    ])
    expect(fullRead).not.toHaveBeenCalled()
    first.projection.dispose()
    second.projection.dispose()
  })

  test('applies folds while preserving snapshot identity on the model', () => {
    const pieceSnapshot = createPieceTableSnapshot('one\ntwo\nthree\nfour')
    const textSnapshot = createDocumentTextSnapshot(pieceSnapshot)
    const foldMap = createFoldMap(pieceSnapshot, [
      { startIndex: 4, endIndex: 13, startLine: 1, endLine: 2, type: 'test' },
    ])
    const model = createVirtualizedTextViewModel({
      textSnapshot,
      foldMap,
      inlineMap: null,
      injectedTextRows: [],
      wrapColumn: null,
      tabSize: 4,
    })

    expect(model.textSnapshot).toBe(textSnapshot)
    expect(model.foldMap).toBe(foldMap)
    expect(model.visibleLineCount).toBe(3)
    expect(rowSummaries(model)).toEqual([
      'text:document:one:0:0',
      'text:document:two:1:0',
      'text:document:four:3:0',
    ])
    model.projection.dispose()
  })

  test('plain model construction and distant geometry do not read row text', () => {
    const textSnapshot = createDocumentTextSnapshot(
      createPieceTableSnapshot('line\n'.repeat(100_000)),
    )
    const rangeRead = vi.spyOn(textSnapshot, 'readRange')
    const fullRead = vi.spyOn(textSnapshot, 'materializeFullText')
    const model = createVirtualizedTextViewModel({
      textSnapshot,
      foldMap: null,
      inlineMap: null,
      injectedTextRows: [],
      wrapColumn: null,
      tabSize: 4,
    })

    expect(model.lineCount).toBe(100_001)
    expect(model.visibleLineCount).toBe(100_001)
    expect(model.projection.rowForOffset(499_995, 'before')).toBe(99_999)
    expect(model.projection.getRowMetrics(99_999)).toMatchObject({
      startOffset: 499_995,
      endOffset: 499_999,
    })
    expect(rangeRead).not.toHaveBeenCalled()
    expect(fullRead).not.toHaveBeenCalled()
    model.projection.dispose()
  })
})

function rowSummaries(model: ReturnType<typeof createVirtualizedTextViewModel>): readonly string[] {
  const result: string[] = []
  for (let index = 0; index < model.visibleLineCount; index += 1) {
    const row = model.projection.getRow(index)
    if (row) result.push(rowSummary(row))
  }
  return result
}

function rowSummary(row: DisplayRow): string {
  return `text:${row.source}:${row.text}:${row.bufferRow}:${row.wrapSegment}`
}
