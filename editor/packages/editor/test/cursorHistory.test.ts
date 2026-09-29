import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Editor } from '../src/editor'
import { defaultEditorKeyBindings, editorCommandPackForCommand } from '../src/editor/keymap'
import { createDocumentSession, type DocumentSession } from '../src/public/document'
import { resetEditorInstanceCount } from '../src/public/testing'
import { resolveSelection } from '../src/selections'

const LONG_TEXT = Array.from({ length: 500 }, (_value, index) => `line ${index}`).join('\n')

function affinityCursorState(session: DocumentSession): {
  readonly affinities: readonly ('before' | 'after')[]
  readonly lastAddedAffinity: 'before' | 'after'
} {
  const snapshot = session.getSnapshot()
  const set = session.getSelections()
  const resolved = set.selections.map((selection) => resolveSelection(snapshot, selection))
  const lastAdded = resolved[set.lastAddedIndex ?? 0]
  if (!lastAdded) throw new Error('missing last-added selection')

  return {
    affinities: resolved.map((selection) => selection.affinity),
    lastAddedAffinity: lastAdded.affinity,
  }
}

describe('cursor history', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('walks the caret back and forward through pure moves', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)

    expect(editor.cursorUndo()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 4, row: 0 })
    expect(editor.cursorUndo()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 15, row: 0 })
    expect(editor.cursorRedo()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 4, row: 0 })
  })

  it('restores affinity while walking the caret history', () => {
    const session = createDocumentSession('const value = 1')
    session.setSelection(4, 4, { affinity: 'before' })
    editor = new Editor(container)
    editor.attachSession(session)

    editor.setSelection(11)
    expect(editor.cursorUndo()).toBe(true)
    expect(primaryAffinity()).toBe('before')

    expect(editor.cursorRedo()).toBe(true)
    expect(primaryAffinity()).toBe('after')

    function primaryAffinity(): 'before' | 'after' {
      const selection = session.getSelections().selections[0]!
      return resolveSelection(session.getSnapshot(), selection).affinity
    }
  })

  it('keeps the last-added opposite-affinity caret through cursor undo', () => {
    const session = createDocumentSession('abc')
    session.setSelection(1, 1, { affinity: 'after' })
    session.addSelection(1, 1, { affinity: 'before' })
    editor = new Editor(container)
    editor.attachSession(session)

    editor.setSelection(2)
    expect(editor.cursorUndo()).toBe(true)
    expect(affinityCursorState(session)).toEqual({
      affinities: ['before', 'after'],
      lastAddedAffinity: 'before',
    })

    expect(editor.dispatchCommand('clearSecondarySelections')).toBe(true)
    expect(affinityCursorState(session)).toEqual({
      affinities: ['before'],
      lastAddedAffinity: 'before',
    })
  })

  it('keeps the last-added opposite-affinity caret through cursor redo', () => {
    const session = createDocumentSession('abc')
    editor = new Editor(container)
    editor.attachSession(session)
    editor.setSelection(0)

    session.setSelection(1, 1, { affinity: 'after' })
    session.addSelection(1, 1, { affinity: 'before' })
    editor.setSelection(2)

    expect(editor.cursorUndo()).toBe(true)
    expect(editor.cursorUndo()).toBe(true)
    expect(editor.cursorRedo()).toBe(true)
    expect(affinityCursorState(session)).toEqual({
      affinities: ['before', 'after'],
      lastAddedAffinity: 'before',
    })
  })

  it('leaves the document alone when the caret is undone', () => {
    editor = new Editor(container, { defaultText: 'abc' })

    editor.edit({ from: 3, to: 3, text: 'd' })
    editor.setSelection(1)
    editor.setSelection(0)

    expect(editor.cursorUndo()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 1, row: 0 })
    expect(editor.materializeFullText()).toBe('abcd')
    expect(editor.getState().canUndo).toBe(true)
  })

  it('hands an edit back to the document history rather than the caret stack', () => {
    editor = new Editor(container, { defaultText: 'abc' })

    editor.setSelection(1)
    editor.setSelection(2)
    editor.edit({ from: 3, to: 3, text: 'd' })

    expect(editor.cursorUndo()).toBe(false)
    expect(editor.dispatchCommand('undo')).toBe(true)
    expect(editor.materializeFullText()).toBe('abc')
  })

  it('returns the view to where the caret was left, not to where it is now', () => {
    editor = new Editor(container, { defaultText: LONG_TEXT })

    editor.setSelection(5)
    editor.setScrollPosition({ top: 400 })
    editor.setSelection(200)
    editor.setScrollPosition({ top: 0 })

    expect(editor.cursorUndo()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 5, row: 0 })
    expect(editor.getScrollPosition().top).toBe(400)
  })

  it('caps how far back the caret can be walked', () => {
    editor = new Editor(container, { defaultText: LONG_TEXT })

    for (let offset = 1; offset <= 60; offset += 1) editor.setSelection(offset)

    // Bounded rather than `while`: a stack that records its own restores never
    // empties, and that has to read as a failure instead of a hang.
    let steps = 0
    while (steps < 60 && editor.cursorUndo()) steps += 1

    expect(steps).toBe(50)
  })

  it('does not record the restore itself', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)
    editor.cursorUndo()
    editor.cursorUndo()

    expect(editor.getState().cursor).toMatchObject({ column: 15, row: 0 })
  })

  it('does not record the restore when it runs inside a wider pass', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)
    editor.runInOperation(() => editor.cursorUndo())

    expect(editor.cursorRedo()).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 11, row: 0 })
  })

  it('spends no step on a pass that left the carets where they were', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)
    // Re-issuing the same selection, and a caret move that runs into the end with its canonical
    // forward affinity already set, both flush a pass without moving anything.
    editor.setSelection(11)
    editor.setSelection(15, 15, { affinity: 'before' })
    editor.dispatchCommand('cursorRight')

    // Three moves happened — the initial caret to 4, 4 to 11, 11 to 15 — so
    // exactly three steps lead back to where it started, and the two passes
    // that moved nothing contribute none.
    expect([
      editor.cursorUndo(),
      editor.cursorUndo(),
      editor.cursorUndo(),
      editor.cursorUndo(),
    ]).toEqual([true, true, true, false])
    expect(editor.getState().cursor).toMatchObject({ column: 15, row: 0 })
  })

  it('is reachable as a command', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)

    expect(editor.dispatchCommand('cursorUndo')).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 4, row: 0 })
    expect(editor.dispatchCommand('cursorRedo')).toBe(true)
    expect(editor.getState().cursor).toMatchObject({ column: 11, row: 0 })
  })

  it('abandons the forward path once a fresh move is made', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)
    editor.cursorUndo()
    editor.setSelection(2)

    // Redo is only ever offered along the path already walked, and that path
    // ended the moment the carets left it.
    expect(editor.cursorRedo()).toBe(false)
  })

  it('forgets where the carets were once the text moves under them', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.setSelection(11)
    // An edit and a caret move in one pass: the offsets already on the stack
    // address text this pass has just moved.
    editor.runInOperation(() => {
      editor.edit({ from: 0, to: 5, text: 'CONSTANT' })
      editor.setSelection(3)
    })

    expect(editor.cursorUndo()).toBe(false)
  })

  it('records the pass before its own listeners move the carets', () => {
    const moves: number[] = []
    let moved = false
    editor = new Editor(container, {
      defaultText: 'const value = 1',
      onChange: () => {
        if (moved) return

        moved = true
        editor.setSelection(2)
      },
    })

    editor.setSelection(11)
    while (editor.cursorUndo()) moves.push(editor.getState().cursor.column)

    // The listener's move is a later pass, so taking the steps back must walk
    // it first and the outer move second — not the other way round.
    expect(moves).toEqual([11, 15])
  })

  it('is on the default keymap', () => {
    // Reachable only by a host calling the method by hand is the same as not
    // shipped, and the command pack it belongs to decides that.
    const commands = defaultEditorKeyBindings().map((binding) => binding.command)

    expect(commands).toContain('cursorUndo')
    expect(commands).toContain('cursorRedo')
    // And they belong to a pack, so a host that rebinds them keeps them: an
    // unclassified command is dropped from every layer built from bindings.
    expect(editorCommandPackForCommand('cursorUndo')).toBe('text-editing')
    expect(editorCommandPackForCommand('cursorRedo')).toBe('text-editing')
  })

  it('drops entries that address a document the editor no longer holds', () => {
    editor = new Editor(container, { defaultText: 'const value = 1' })

    editor.setSelection(4)
    editor.openDocument({ documentId: 'other.ts', text: 'other document text' })

    expect(editor.cursorUndo()).toBe(false)
  })
})
