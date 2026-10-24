import { Editor } from '../src/editor'
import { expect, it } from 'vitest'
import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  deleteFromPieceTable,
  createDocumentSession,
  createEditorTextBuffer,
  createEditorBufferSession,
} from '../src/public/document'
import { captureJumpLocation, resolveJumpLocation, JumpHistory } from '../src/editor/jumpHistory'

it('follows edits, skips deleted waypoints, and makes undo restore their eligibility', () => {
  const original = createPieceTableSnapshot('alpha beta gamma')
  const at = (offset: number) =>
    captureJumpLocation(
      original,
      {
        selections: [{ anchor: offset, head: offset }],
        lastAddedIndex: 0,
        scrollTop: 0,
        scrollLeft: 0,
      },
      0,
      0,
    )
  const history = new JumpHistory()
  history.record(original, at(1), at(7))
  history.record(original, at(7), at(13))
  const removed = deleteFromPieceTable(original, 6, 5)
  expect(history.move(removed, 'back', at(13))?.selections[0]?.head).toBe(1)
  expect(history.move(original, 'forward', at(1))?.selections[0]?.head).toBe(7)
  const inserted = insertIntoPieceTable(original, 0, 'prefix ')
  expect(history.move(inserted, 'back', at(7))?.selections[0]?.head).toBe(8)
})

it('keeps explicit editor jumps through edits without recording ordinary caret moves', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, { defaultText: 'alpha beta gamma' })
  editor.setSelection(1)
  editor.jumpTo(7)
  editor.edit({ from: 0, to: 0, text: 'prefix ' })
  expect(editor.jumpBack()).toBe(true)
  expect(editor.getState().cursor.column).toBe(8)
  expect(editor.jumpBack()).toBe(false)
  expect(editor.dispatchCommand('jumpForward')).toBe(true)
  expect(editor.getState().cursor.column).toBe(14)
  editor.setText('new document')
  expect(editor.jumpBack()).toBe(false)
  editor.dispose()
  host.remove()
})

it('bounds waypoints and replaces the forward tail after a fresh jump', () => {
  const snapshot = createPieceTableSnapshot('x'.repeat(100))
  const at = (offset: number) =>
    captureJumpLocation(
      snapshot,
      {
        selections: [{ anchor: offset, head: offset }],
        lastAddedIndex: 0,
        scrollTop: 0,
        scrollLeft: 0,
      },
      0,
      0,
    )
  const history = new JumpHistory()
  for (let offset = 1; offset <= 60; offset++) history.record(snapshot, at(offset - 1), at(offset))
  let current = at(60)
  let count = 0
  while (true) {
    const previous = history.move(snapshot, 'back', current)
    if (!previous) break
    count++
    current = at(previous.selections[0]!.head)
  }
  expect(count).toBe(49)
  history.record(snapshot, current, at(90))
  expect(history.move(snapshot, 'forward', at(90))).toBeNull()
  expect(history.move(snapshot, 'back', at(90))?.selections[0]?.head).toBe(11)
})

it('preserves backward selections and affinity, removing deleted secondary carets', () => {
  const snapshot = createPieceTableSnapshot('alpha beta gamma')
  const location = captureJumpLocation(
    snapshot,
    {
      selections: [
        { anchor: 4, head: 1, affinity: 'before' },
        { anchor: 7, head: 7, affinity: 'after' },
        { anchor: 13, head: 13, affinity: 'before' },
      ],
      lastAddedIndex: 2,
      scrollTop: 0,
      scrollLeft: 23,
    },
    1,
    4,
  )
  const edited = deleteFromPieceTable(snapshot, 6, 5)
  expect(resolveJumpLocation(edited, location)).toMatchObject({
    selections: [
      { anchor: 4, head: 1, affinity: 'before' },
      { anchor: 8, head: 8, affinity: 'before' },
    ],
    lastAddedIndex: 1,
    scrollLeft: 23,
    viewportOffset: 1,
    topDelta: 4,
  })
})

it('keeps two views on a shared buffer independently navigable', () => {
  const buffer = createEditorTextBuffer('alpha beta gamma')
  const sessions = [createEditorBufferSession(buffer), createEditorBufferSession(buffer)]
  const hosts = [document.createElement('div'), document.createElement('div')]
  const editors = hosts.map((host) => {
    document.body.append(host)
    return new Editor(host)
  })
  for (const [index, editor] of editors.entries()) editor.attachSession(sessions[index]!)
  const [first, second] = editors as [Editor, Editor]
  first.setSelection(1)
  first.jumpTo(7)
  expect(second.jumpBack()).toBe(false)
  second.jumpTo(13)
  expect(first.getState().cursor.column).toBe(7)
  first.edit({ from: 0, to: 0, text: 'prefix ' })
  expect(first.jumpBack()).toBe(true)
  expect(first.getState().cursor.column).toBe(8)
  first.detachSession()
  first.attachSession(sessions[0]!)
  expect(first.jumpBack()).toBe(false)
  for (const editor of editors) editor.dispose()
  for (const host of hosts) host.remove()
})

it('coalesces explicit jumps inside an operation from its original location', () => {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host, { defaultText: 'alpha beta gamma' })
  editor.setSelection(1)
  editor.runInOperation(() => {
    editor.jumpTo(7)
    editor.jumpTo(13)
  })
  expect(editor.jumpBack()).toBe(true)
  expect(editor.getState().cursor.column).toBe(1)
  editor.dispose()
  host.remove()
})

it('skips a waypoint whose primary anchor was deleted', () => {
  const snapshot = createPieceTableSnapshot('alpha beta gamma')
  const location = captureJumpLocation(
    snapshot,
    {
      selections: [
        { anchor: 1, head: 4 },
        { anchor: 13, head: 13 },
      ],
      lastAddedIndex: 1,
      scrollTop: 0,
      scrollLeft: 0,
    },
    0,
    0,
  )
  expect(resolveJumpLocation(deleteFromPieceTable(snapshot, 0, 2), location)).toBeNull()
})

it('clears a trail on detach even when the identical session is immediately reattached', () => {
  const session = createDocumentSession('alpha beta gamma')
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor(host)
  editor.attachSession(session)
  editor.setSelection(1)
  editor.jumpTo(7)
  editor.detachSession()
  editor.attachSession(session)
  expect(editor.jumpBack()).toBe(false)
  editor.dispose()
  host.remove()
})

function captureCaret(text: string, offset: number) {
  const snapshot = createPieceTableSnapshot(text)
  const location = captureJumpLocation(
    snapshot,
    {
      selections: [{ anchor: offset, head: offset }],
      lastAddedIndex: 0,
      scrollTop: 0,
      scrollLeft: 0,
    },
    offset,
    0,
  )
  return { snapshot, location }
}

it.each([
  ['Delete at a caret', 'alpha beta', 2, 2, 1, 2],
  ['joining lines', 'alpha\nbeta', 5, 5, 1, 5],
  ['deleting the last character', 'alpha', 5, 4, 1, 4],
  ['Backspace at a caret', 'alpha beta', 2, 1, 1, 1],
] as const)('retains a waypoint after %s', (_name, text, offset, from, length, expected) => {
  const { snapshot, location } = captureCaret(text, offset)
  const edited = deleteFromPieceTable(snapshot, from, length)
  expect(resolveJumpLocation(edited, location)?.selections[0]?.head).toBe(expected)
})

it('retains a Find selection after replacing the match', () => {
  const host = document.createElement('div')
  const editor = new Editor(host, { defaultText: 'alpha beta gamma' })
  try {
    editor.jumpTo(6, 10, 'find')
    editor.jumpTo(15)
    editor.edit({ from: 6, to: 10, text: 'B' })
    expect(editor.jumpBack()).toBe(true)
    expect(editor.getState().cursor.column).toBe(7)
  } finally {
    editor.dispose()
  }
})

it('keeps an empty-document origin at zero after insertion', () => {
  const { snapshot, location } = captureCaret('', 0)
  expect(resolveJumpLocation(insertIntoPieceTable(snapshot, 0, 'abc'), location)).toMatchObject({
    selections: [{ anchor: 0, head: 0 }],
    viewportOffset: 0,
  })
})
