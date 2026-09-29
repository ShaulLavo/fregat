import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentSession,
  createEditorBufferSession,
  createEditorTextBuffer,
} from '../src/documentSession'
import { createDocumentTextSnapshot, type TextSnapshot } from '../src/documentTextSnapshot'
import { projectSyntaxFoldsThroughEdits } from '../src/editor/folds'
import { MANUAL_FOLD_TYPE } from '../src/editor/foldOperations'
import {
  projectTokensThroughEdits,
  tokenProjectionLiveRangeStatus,
} from '../src/editor/tokenProjection'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  materializePieceTableFullText,
  snapBatchEditRanges,
} from '@singapore-editor/textbuffer'

import type { FoldRange } from '../src/syntax/session'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import { createTextEditBatch, mapTextEditBatchOffset } from '../src/textEditBatch'
import type { TextEdit } from '../src/tokens'
import { resolveSelection } from '../src/selections'
import { projectRowDecorationMapThroughEdits } from '../src/virtualization/rowDecorationProjection'

function committedBatch(text: string, edits: readonly TextEdit[]) {
  const before = createPieceTableSnapshot(text)
  const applied = snapBatchEditRanges(before, edits)
  const after = applyBatchToPieceTable(before, applied)
  return createTextEditBatch(
    createDocumentTextSnapshot(before),
    createDocumentTextSnapshot(after),
    applied,
  )
}

describe('committed edit batch map', () => {
  it('maps equal-position insertions using their committed final order', () => {
    const batch = committedBatch('abc', [
      { from: 1, to: 1, text: 'A\n' },
      { from: 1, to: 1, text: 'BB' },
      { from: 1, to: 2, text: 'Q' },
    ])
    expect(batch.after.materializeFullText()).toBe('aBBA\nQc')
    expect(batch.changes).toEqual([
      {
        from: 1,
        to: 2,
        afterFrom: 1,
        afterTo: 6,
        startRow: 0,
        endRow: 0,
        afterStartRow: 0,
        afterEndRow: 1,
        offsetDelta: 4,
        lineDelta: 1,
      },
    ])
    expect(mapTextEditBatchOffset(batch, 1, 'before')).toBe(1)
    expect(mapTextEditBatchOffset(batch, 1, 'after')).toBe(6)
    expect(mapTextEditBatchOffset(batch, 3, 'before')).toBe(7)
  })

  it('includes both adjacent changes when mapping their shared boundary', () => {
    const batch = committedBatch('abcd', [
      { from: 1, to: 2, text: 'XY' },
      { from: 2, to: 3, text: '\nQ' },
    ])
    expect(batch.after.materializeFullText()).toBe('aXY\nQd')
    expect(mapTextEditBatchOffset(batch, 2, 'before')).toBe(1)
    expect(mapTextEditBatchOffset(batch, 2, 'after')).toBe(5)
    expect(batch.changes.map((change) => change.lineDelta)).toEqual([0, 1])
  })

  it('matches a string oracle across line joins, replacements, surrogate snapping and empty inserts', () => {
    const source = 'a😀b\ncdé\nfgh\nijk'
    const cases: readonly (readonly TextEdit[])[] = [
      [
        { from: 2, to: 2, text: 'X' },
        { from: 8, to: 8, text: '\nY' },
      ],
      [
        { from: 1, to: 3, text: '' },
        { from: 4, to: 5, text: '' },
      ],
      [
        { from: 1, to: 4, text: 'q\nr' },
        { from: 6, to: 8, text: 'z' },
      ],
      [
        { from: 0, to: 0, text: '' },
        { from: source.length, to: source.length, text: '\n' },
      ],
    ]
    for (const edits of cases) {
      const batch = committedBatch(source, edits)
      let expected = source
      for (const edit of batch.edits.toSorted((a, b) => b.from - a.from || b.to - a.to)) {
        expected = expected.slice(0, edit.from) + edit.text + expected.slice(edit.to)
      }
      expect(batch.after.materializeFullText()).toBe(expected)
      expect(batch.after.lineCount).toBe(expected.split('\n').length)
      expect(
        batch.changes.reduce((length, change) => length + change.offsetDelta, source.length),
      ).toBe(expected.length)
      expect(
        batch.changes.reduce((lines, change) => lines + change.lineDelta, batch.before.lineCount),
      ).toBe(batch.after.lineCount)
    }
  })

  it('builds and maps sparse changes without reading the unchanged gap or materializing text', () => {
    const committed = committedBatch('head\n' + 'untouched\n'.repeat(10_000) + 'tail', [
      { from: 1, to: 2, text: 'A\n' },
      { from: 100_006, to: 100_007, text: 'B' },
    ])
    const before = unreadableSnapshot(committed.before)
    const after = unreadableSnapshot(committed.after)
    const batch = createTextEditBatch(before, after, committed.edits)
    expect(batch.changes).toHaveLength(2)
    expect(mapTextEditBatchOffset(batch, 50_000, 'after')).toBe(50_001)
    expect(before.readRange).not.toHaveBeenCalled()
    expect(after.readRange).not.toHaveBeenCalled()
    expect(before.materializeFullText).not.toHaveBeenCalled()
    expect(after.materializeFullText).not.toHaveBeenCalled()
  })
})

function unreadableSnapshot(snapshot: TextSnapshot): TextSnapshot {
  return {
    length: snapshot.length,
    lineCount: snapshot.lineCount,
    lineStart: (row) => snapshot.lineStart(row),
    lineRange: (row) => snapshot.lineRange(row),
    lineAt: (offset) => snapshot.lineAt(offset),
    readRange: vi.fn(() => {
      throw new RangeError('unexpected range read')
    }),
    materializeFullText: vi.fn(() => {
      throw new RangeError('unexpected full read')
    }),
    forEachTextChunk: vi.fn(() => {
      throw new RangeError('unexpected chunk read')
    }),
  }
}

describe('batch projections', () => {
  it('retains tokens in sparse gaps and applies word and line boundary policies once', () => {
    const style = { color: 'red' }
    const tokens = EditorTokenStore.fromTokens([
      { start: 0, end: 5, style },
      { start: 6, end: 10, style },
      { start: 11, end: 16, style },
    ])
    const batch = committedBatch('alpha beta gamma', [
      { from: 5, to: 5, text: 'Name' },
      { from: 12, to: 14, text: '\n' },
    ])
    const projected = projectTokensThroughEdits(tokens, batch)
    expect(projected.toTokens()).toEqual([
      { start: 0, end: 9, style },
      { start: 10, end: 14, style },
    ])
    expect(tokenProjectionLiveRangeStatus(tokens, projected)).toBe(false)
  })

  it('uses the final equal-position inserted run for token expansion', () => {
    const batch = committedBatch('alpha beta', [
      { from: 5, to: 5, text: 'X' },
      { from: 5, to: 5, text: 'Y' },
    ])
    const tokens = EditorTokenStore.fromTokens([{ start: 0, end: 5, style: {} }])
    expect(projectTokensThroughEdits(tokens, batch).toTokens()).toEqual([
      { start: 0, end: 7, style: {} },
    ])
  })

  it('shifts fold boundaries from original rows and invalidates only crossed manual folds', () => {
    const text = 'a\n{\nb\nc\n}\nz\n'
    const fold: FoldRange = { startIndex: 2, endIndex: 9, startLine: 1, endLine: 4, type: 'block' }
    const batch = committedBatch(text, [
      { from: 0, to: 0, text: '\n' },
      { from: 5, to: 5, text: '\n' },
    ])
    expect(projectSyntaxFoldsThroughEdits([fold], batch)).toEqual([
      { ...fold, startIndex: 3, endIndex: 11, startLine: 2, endLine: 6 },
    ])
    const crossed = committedBatch(text, [
      { from: 0, to: 0, text: '\n' },
      { from: 8, to: 10, text: '' },
    ])
    expect(projectSyntaxFoldsThroughEdits([{ ...fold, type: MANUAL_FOLD_TYPE }], crossed)).toEqual(
      [],
    )
    expect(projectSyntaxFoldsThroughEdits([fold], crossed)).toEqual([
      { ...fold, startIndex: 3, endIndex: 10, startLine: 2, endLine: 5 },
    ])
  })

  it('retains changed start rows, drops joined rows and shifts surviving decorations', () => {
    const batch = committedBatch('a\nb\nc\nd\ne\nf', [
      { from: 1, to: 4, text: '' },
      { from: 8, to: 8, text: '\n' },
    ])
    const source = new Map(Array.from({ length: 6 }, (_, row) => [row, { className: `r${row}` }]))
    expect([...projectRowDecorationMapThroughEdits(source, batch)]).toEqual([
      [0, { className: 'r0' }],
      [1, { className: 'r3' }],
      [2, { className: 'r4' }],
      [4, { className: 'r5' }],
    ])
  })
})

describe('committed batch producer coordinates', () => {
  it('delivers nested commits in order and preserves a later explicit source selection', () => {
    const buffer = createEditorTextBuffer('abc')
    const session = createEditorBufferSession(buffer)
    let nested = false
    buffer.subscribe(() => {
      if (nested) return
      nested = true
      session.applyEdits([{ from: 0, to: 0, text: 'X' }])
      session.setSelection(0)
    })
    const delivered: string[] = []
    buffer.subscribe(({ change }) => delivered.push(change.textSnapshot.materializeFullText()))
    session.applyEdits([{ from: 1, to: 2, text: 'B' }])
    expect(delivered).toEqual(['aBc', 'XaBc'])
    const selection = session.getSelections().selections[0]!
    expect(resolveSelection(session.getSnapshot(), selection).headOffset).toBe(0)
  })

  it('publishes undo insertions that replay adjacent deletions in the original order', () => {
    const session = createDocumentSession('abX')
    const change = session.applyEdits([
      { from: 0, to: 1, text: '' },
      { from: 1, to: 2, text: '' },
    ])
    const undo = session.undo()
    expect(materializePieceTableFullText(applyBatchToPieceTable(change.snapshot, undo.edits))).toBe(
      materializePieceTableFullText(undo.snapshot),
    )
    expect(undo.edits).toEqual([
      { from: 0, to: 0, text: 'b' },
      { from: 0, to: 0, text: 'a' },
    ])
    const redo = session.redo()
    expect(materializePieceTableFullText(applyBatchToPieceTable(undo.snapshot, redo.edits))).toBe(
      'X',
    )
  })

  it('selection edits already publish ranges snapped away from surrogate interiors', () => {
    const session = createDocumentSession('a😀b😀c')
    const before = session.getSnapshot()
    session.setSelections([{ anchor: 2 }, { anchor: 5 }])
    const change = session.applyText('Q')
    expect(change.edits).toEqual([
      { from: 1, to: 1, text: 'Q' },
      { from: 4, to: 4, text: 'Q' },
    ])
    expect(materializePieceTableFullText(applyBatchToPieceTable(before, change.edits))).toBe(
      materializePieceTableFullText(change.snapshot),
    )
  })
})
