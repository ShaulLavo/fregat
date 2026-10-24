import { afterEach, expect, test, vi } from 'vitest'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createFoldMap } from '../src/foldMap'
import { createInlineMap } from '../src/inlineMap'
import { applyBatchToPieceTable, createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { createTextEditBatch } from '../src/textEditBatch'
import type { TextEdit } from '../src/tokens'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'

const views: VirtualizedTextView[] = []

afterEach(() => {
  for (const view of views) view.dispose()
  views.length = 0
})

function batchView(text: string, edits: readonly TextEdit[]) {
  const piece = createPieceTableSnapshot(text)
  const before = createDocumentTextSnapshot(piece)
  const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, edits))
  const view = new VirtualizedTextView(document.createElement('div'), {
    rowHeight: 20,
    overscan: 0,
    textMetrics: { rowHeight: 20, characterWidth: 8 },
  })
  views.push(view)
  view.setText(before)
  return { view, piece, before, after, batch: createTextEditBatch(before, after, edits) }
}

test('a sparse batch paints the viewport without reading the unchanged gap', () => {
  const text = 'line\n'.repeat(99_999) + 'last'
  const { view, after, batch } = batchView(text, [
    { from: 0, to: 0, text: 'top\n' },
    { from: text.length, to: text.length, text: '\nend' },
  ])
  view.setScrollMetrics(0, 60, 640)
  const full = vi.spyOn(after, 'materializeFullText')
  const reads = vi.spyOn(after, 'readRange')

  view.applyEditBatch(batch)

  expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['top', 'line', 'line'])
  expect(view.getState().lineCount).toBe(100_002)
  expect(full).not.toHaveBeenCalled()
  expect(reads.mock.calls.every(([from, to]) => to - from < 100)).toBe(true)
  expect(view['view'].model.projection.diagnostics.indexNodes).toBeLessThan(20)
})

test('an atomic batch publishes mounted rows only after the final transition', () => {
  const { view, after, batch } = batchView('one\ntwo\nthree', [
    { from: 0, to: 3, text: 'ONE' },
    { from: 8, to: 13, text: 'THREE\nfour' },
  ])
  view.setScrollMetrics(0, 80, 640)

  view.runAtomicRender(() => {
    view.applyEditBatch(batch)
    expect(view.isRenderingAtomically).toBe(true)
    expect(view['view'].model.textSnapshot).toBe(after)
    expect(view.getState().mountedRows.map((row) => row.text)).toEqual(['one', 'two', 'three'])
  })

  expect(view.isRenderingAtomically).toBe(false)
  expect(view.getState().mountedRows.map((row) => row.text)).toEqual([
    'ONE',
    'two',
    'THREE',
    'four',
  ])
})

test('a batch invalidates cached wrapped rows across replacements and line splits', () => {
  const { view, after, batch } = batchView('abcdefghij\nmiddle\nklmnopqrst', [
    { from: 1, to: 2, text: 'XYZ' },
    { from: 20, to: 22, text: '\nUV' },
  ])
  view.setScrollMetrics(0, 240, 56)
  view.setWrapEnabled(true)
  const beforeRows = view.getState().mountedRows.map((row) => row.text)
  const full = vi.spyOn(after, 'materializeFullText')

  view.applyEditBatch(batch)

  const { view: reference } = batchView('aXYZcdefghij\nmiddle\nkl\nUVopqrst', [])
  reference.setScrollMetrics(0, 240, 56)
  reference.setWrapEnabled(true)
  const rows = view.getState().mountedRows
  expect(view.getState().wrapActive).toBe(true)
  expect(rows.map((row) => row.text)).not.toEqual(beforeRows)
  expect(rows.map(wrappedRowGeometry)).toEqual(
    reference.getState().mountedRows.map(wrappedRowGeometry),
  )
  expect(view.getState().lineCount).toBe(4)
  expect(full).not.toHaveBeenCalled()
})

function wrappedRowGeometry(
  row: ReturnType<VirtualizedTextView['getState']>['mountedRows'][number],
) {
  return {
    text: row.text,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    bufferRow: row.bufferRow,
  }
}

test('a batch keeps collapsed folds, controls and decorated source rows aligned', () => {
  const { view, piece, batch } = batchView('a\nheader\ninside\ntail\nend', [
    { from: 0, to: 0, text: '\n' },
    { from: 10, to: 10, text: 'X\n' },
  ])
  view.setFoldState(
    [{ key: 'fold', startOffset: 2, endOffset: 15, startRow: 1, endRow: 2, collapsed: true }],
    createFoldMap(piece, [{ startIndex: 2, endIndex: 15, startLine: 1, endLine: 2, type: 'test' }]),
  )
  view.setRowDecorations(new Map([[3, { className: 'tail' }]]))

  view.applyEditBatch(batch)

  expect(view['view'].foldMarkers[0]).toMatchObject({ startRow: 2, endRow: 4, collapsed: true })
  expect(view['view'].model.foldMap?.ranges[0]).toMatchObject({
    startPoint: { row: 2, column: 0 },
    endPoint: { row: 4, column: 5 },
  })
  expect(view['view'].rowDecorations.get(5)).toEqual({ className: 'tail' })
})

test('a boundary edit retains syntax fold controls until the owner refreshes them', () => {
  const { view, batch } = batchView('a\nheader\ninside\ntail', [
    { from: 0, to: 4, text: 'new' },
    { from: 19, to: 19, text: '!' },
  ])
  view.setFoldMarkers([
    { key: 'fold', startOffset: 2, endOffset: 15, startRow: 1, endRow: 2, collapsed: false },
  ])

  view.applyEditBatch(batch)

  expect(view['view'].foldMarkers).toEqual([
    { key: 'fold', startOffset: 2, endOffset: 15, startRow: 1, endRow: 2, collapsed: false },
  ])
  expect(view['view'].foldMarkerByKey.size).toBe(1)
})

test.each([false, true])('a batch rebases the complete inline map with reveal %j', (revealed) => {
  const { view, piece, after, batch } = batchView('head\n**bold**\ntail', [
    { from: 0, to: 0, text: 'X\n' },
    { from: 15, to: 15, text: 'Y\n' },
  ])
  view.setInlineMap(
    createInlineMap(piece, [
      { id: 'open', startIndex: 5, endIndex: 7, text: '', groupId: 'bold' },
      { id: 'close', startIndex: 11, endIndex: 13, text: '', groupId: 'bold' },
    ]),
  )
  if (revealed) view.setSelection(9, 9)

  view.applyEditBatch(batch)

  const projection = view['view'].model.projection
  expect(projection.getRow(projection.rowForBufferRow(2))?.text).toBe(
    revealed ? '**bold**' : 'bold',
  )
  view.setSelection(after.length, after.length)
  expect(projection.getRow(projection.rowForBufferRow(2))?.text).toBe('bold')
  expect(view['view'].inlineMapBase?.snapshot).toBe(after.snapshot)
})
