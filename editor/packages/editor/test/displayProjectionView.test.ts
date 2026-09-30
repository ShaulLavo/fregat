import { expect, test } from 'vitest'
import { createDocumentTextSnapshot } from '../src/documentTextSnapshot'
import { createFoldMap } from '../src/foldMap'
import { createInlineMap } from '../src/inlineMap'
import { applyBatchToPieceTable, createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { VirtualizedTextView } from '../src/virtualization/virtualizedTextView'

test.each([
  { to: 0, revealed: false },
  { to: 1, revealed: false },
  { to: 0, revealed: true },
  { to: 1, revealed: true },
])('selection reveal rebases the complete inline map: %j', ({ to, revealed }) => {
  const piece = createPieceTableSnapshot('head\n**bold**\ntail')
  const before = createDocumentTextSnapshot(piece)
  const view = new VirtualizedTextView(document.createElement('div'))
  try {
    view.setText(before)
    view.setInlineMap(
      createInlineMap(piece, [
        { id: 'open', startIndex: 5, endIndex: 7, text: '', groupId: 'bold' },
        { id: 'close', startIndex: 11, endIndex: 13, text: '', groupId: 'bold' },
      ]),
    )
    expect(view['view'].model.projection.getRow(1)?.text).toBe('bold')
    if (revealed) view.setSelection(9, 9)
    const edit = { from: 0, to, text: 'X' }
    const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, [edit]))
    view.applyEdit(edit, after)
    expect(view['view'].model.projection.getRow(1)?.text).toBe(revealed ? '**bold**' : 'bold')
    view.setSelection(after.length, after.length)
    expect(view['view'].model.projection.getRow(1)?.text).toBe('bold')
    expect(view['view'].inlineMapBase?.snapshot).toBe(after.snapshot)
  } finally {
    view.dispose()
  }
})

test('a projected multiline edit moves fold controls and row decorations with source lines', () => {
  const piece = createPieceTableSnapshot('a\nheader\ninside\ntail')
  const before = createDocumentTextSnapshot(piece)
  const view = new VirtualizedTextView(document.createElement('div'))
  try {
    view.setText(before)
    view.setFoldState(
      [{ key: 'fold', startOffset: 2, endOffset: 15, startRow: 1, endRow: 2, collapsed: true }],
      createFoldMap(piece, [
        { startIndex: 2, endIndex: 15, startLine: 1, endLine: 2, type: 'test' },
      ]),
    )
    view.setRowDecorations(new Map([[3, { className: 'tail' }]]))
    const edit = { from: 0, to: 0, text: '\n' }
    const after = createDocumentTextSnapshot(applyBatchToPieceTable(piece, [edit]))
    view.applyEdit(edit, after)
    expect(view['view'].model.foldMap?.ranges[0]?.startPoint.row).toBe(2)
    expect(view['view'].foldMarkers[0]?.startRow).toBe(2)
    expect(view['view'].rowDecorations.get(4)).toEqual({ className: 'tail' })
  } finally {
    view.dispose()
  }
})
