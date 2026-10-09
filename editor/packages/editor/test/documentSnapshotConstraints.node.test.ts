import { expect, it, vi } from 'vitest'
import {
  commitPreparedDocumentTransaction,
  createEditorTextBuffer,
  createEditorBufferSession,
  prepareDocumentTransaction,
} from '../src/public/document'
import { registerDocumentSnapshotConstraint } from '../src/documentSession'
import { applyBatchToPieceTable } from '@singapore-editor/textbuffer'

it('checks native and authored edits before publishing or invoking the author', () => {
  const buffer = createEditorTextBuffer('small')
  const session = createEditorBufferSession(buffer)
  const snapshot = buffer.getSnapshot()
  const changed = vi.fn()
  const unsubscribe = buffer.subscribe(changed)
  const author = vi.fn(applyBatchToPieceTable)
  const authorRegistration = buffer.setEditAuthor(author)
  const dispose = registerDocumentSnapshotConstraint(buffer, (text) => {
    if (text.length > 5) throw new RangeError('snapshot constraint')
  })
  try {
    expect(() => session.applyEdits([{ from: 5, to: 5, text: 'x' }])).toThrow('snapshot constraint')
    expect(author).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(buffer.getSnapshot()).toBe(snapshot)
    dispose()
    session.applyEdits([{ from: 5, to: 5, text: 'x' }])
    expect(author).toHaveBeenCalledOnce()
    expect(buffer.getTextSnapshot().length).toBe(6)
  } finally {
    dispose()
    authorRegistration.dispose()
    unsubscribe()
  }
})

it('refuses prepared commits and oversized redo without changing history or snapshots', () => {
  const buffer = createEditorTextBuffer('small')
  const session = createEditorBufferSession(buffer)
  session.applyEdits([{ from: 5, to: 5, text: 'x' }])
  session.undo()
  const snapshot = buffer.getSnapshot()
  const history = buffer.serializeHistory()
  const dispose = registerDocumentSnapshotConstraint(buffer, (text) => {
    if (text.length > 5) throw new RangeError('snapshot constraint')
  })
  try {
    const prepared = prepareDocumentTransaction(buffer, [{ from: 5, to: 5, text: 'x' }], 1, null)
    expect(() =>
      commitPreparedDocumentTransaction({ buffer, sourceView: session.view }, prepared, {
        history: { kind: 'record' },
      }),
    ).toThrow('snapshot constraint')
    expect(() => session.redo()).toThrow('snapshot constraint')
    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(buffer.serializeHistory()).toEqual(history)
    expect(session.canRedo()).toBe(true)
  } finally {
    dispose()
  }
  session.redo()
  expect(buffer.getTextSnapshot().length).toBe(6)
})
