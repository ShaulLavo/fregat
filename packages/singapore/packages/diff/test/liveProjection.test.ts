import { describe, expect, it } from 'vitest'
import { createLiveDiffProjection, createTextDiff } from '../src'

describe('createLiveDiffProjection', () => {
  it('emits phantom rows for deletions and row decorations for additions', () => {
    const file = createTextDiff({
      oldFile: { path: 'note.txt', text: 'a\nremove\nb\n' },
      newFile: { path: 'note.txt', text: 'a\nb\nadd\n' },
    })

    const projection = createLiveDiffProjection(file)

    expect(projection.injectedRows).toHaveLength(1)
    expect(projection.injectedRows[0]).toMatchObject({
      id: 'diff-delete-old-2',
      anchorBufferRow: 1,
      placement: 'before',
      text: 'remove',
      className: 'editor-diff-row editor-diff-row-deletion',
      gutterClassName: 'editor-diff-gutter-row editor-diff-gutter-row-deletion',
      metadata: {
        type: 'deletion',
        oldLineNumber: 2,
      },
    })
    expect(projection.rowDecorations.get(2)).toEqual({
      className: 'editor-diff-row editor-diff-row-addition',
      gutterClassName: 'editor-diff-gutter-row editor-diff-gutter-row-addition',
    })
    expect(projection.rowsByBufferRow.get(1)).toMatchObject({
      type: 'context',
      oldLineNumber: 3,
      newLineNumber: 2,
    })
    expect(projection.rowsByBufferRow.get(2)).toMatchObject({
      type: 'addition',
      newLineNumber: 3,
    })
  })

  it('keeps deletion row ids stable when hunk shape changes', () => {
    const withoutInsertedLine = createLiveDiffProjection(
      createTextDiff({
        oldFile: { path: 'note.txt', text: 'a\nremove\nb\n' },
        newFile: { path: 'note.txt', text: 'a\nb\n' },
      }),
    )
    const withInsertedLine = createLiveDiffProjection(
      createTextDiff({
        oldFile: { path: 'note.txt', text: 'a\nremove\nb\n' },
        newFile: { path: 'note.txt', text: 'a\ninsert\nb\n' },
      }),
    )

    expect(withoutInsertedLine.injectedRows.map((row) => row.id)).toContain('diff-delete-old-2')
    expect(withInsertedLine.injectedRows.map((row) => row.id)).toContain('diff-delete-old-2')
  })

  it('marks trailing empty rows from inserted newlines as additions', () => {
    const projection = createLiveDiffProjection(
      createTextDiff({
        oldFile: { path: 'note.txt', text: 'abc' },
        newFile: { path: 'note.txt', text: 'abc\n' },
      }),
    )

    expect(projection.rowsByBufferRow.get(1)).toMatchObject({
      type: 'addition',
      text: '',
      newLineNumber: 2,
    })
    expect(projection.rowDecorations.get(1)).toEqual({
      className: 'editor-diff-row editor-diff-row-addition',
      gutterClassName: 'editor-diff-gutter-row editor-diff-gutter-row-addition',
    })
  })
})
