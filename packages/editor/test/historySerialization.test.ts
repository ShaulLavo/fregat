import { describe, expect, it } from 'vitest'

import {
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorTextBuffer,
} from '../src/documentSession'
import type { SerializedEditorHistory } from '../src/historySerialization'

// "one" typed, " two" typed, undone, " three" typed: a branch point with two children.
function editedBuffer(): EditorTextBuffer {
  const buffer = createEditorTextBuffer('start', { now: () => 1000 })
  const session = createEditorBufferSession(buffer)
  session.applyText(' one')
  session.breakTypingRun()
  session.applyText(' two')
  session.undo()
  session.applyText(' three')
  return buffer
}

// Through JSON, because that is the only form a store can hand back.
function reopened(source: EditorTextBuffer): EditorTextBuffer {
  const data = JSON.parse(JSON.stringify(source.serializeHistory())) as SerializedEditorHistory
  const buffer = createEditorTextBuffer(source.materializeFullText())
  expect(buffer.restoreHistory(data)).toBe(true)
  return buffer
}

describe('history serialization', () => {
  it('has nothing to serialize before the first edit', () => {
    expect(createEditorTextBuffer('start').serializeHistory()).toBeNull()
  })

  it('restores undo, redo and the other branch over freshly loaded text', () => {
    const buffer = reopened(editedBuffer())
    const session = createEditorBufferSession(buffer)

    expect(buffer.isDirty()).toBe(false)
    session.undo()
    expect(buffer.materializeFullText()).toBe('start one')
    session.undo()
    expect(buffer.materializeFullText()).toBe('start')
    session.redo()
    session.redo()
    expect(buffer.materializeFullText()).toBe('start one three')

    const graph = buffer.getHistoryGraph()
    const texts = graph.nodes.map((node) => {
      buffer.checkoutHistoryState(node.id)
      return buffer.materializeFullText()
    })
    expect(texts.toSorted()).toEqual(
      ['start', 'start one', 'start one three', 'start one two'].toSorted(),
    )
  })

  it('reports the inverse edits on undo so a view can patch instead of resync', () => {
    const session = createEditorBufferSession(reopened(editedBuffer()))
    const change = session.undo()
    expect(change.edits).toEqual([{ from: 9, to: 15, text: '' }])
  })

  it('keeps recording after a restore', () => {
    const buffer = reopened(editedBuffer())
    const session = createEditorBufferSession(buffer)
    session.applyText('!')
    session.undo()
    expect(buffer.materializeFullText()).toBe('start one three')
    expect(buffer.canUndo()).toBe(true)
  })

  it('refuses text of another length, another version, and a buffer with its own history', () => {
    const data = editedBuffer().serializeHistory()!

    expect(createEditorTextBuffer('something else entirely').restoreHistory(data)).toBe(false)
    expect(
      createEditorTextBuffer('start one three').restoreHistory({ ...data, version: 2 as 1 }),
    ).toBe(false)
    expect(editedBuffer().restoreHistory(data)).toBe(false)
  })

  it('refuses edits that do not fit the text and leaves the history alone', () => {
    const data = editedBuffer().serializeHistory()!
    const broken: SerializedEditorHistory = {
      ...data,
      nodes: data.nodes.map((node) => ({
        ...node,
        inverseEdits: node.inverseEdits.map((edit) => ({ ...edit, to: edit.to + 1000 })),
      })),
    }
    const buffer = createEditorTextBuffer('start one three')

    expect(buffer.restoreHistory(broken)).toBe(false)
    expect(buffer.canUndo()).toBe(false)
  })
})
