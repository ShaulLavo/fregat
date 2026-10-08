// Adapted plain-text semantics from yjs/yjs tests/undo-redo.tests.js
// at d01eefc997cf12d29d5aabea804df5f69c659a79. Copyright (c) 2023 Kevin Jahns
// and RWTH Aachen University. MIT; see THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import type { UndoEvent } from '../../src/index'
import { undoRoom } from '../undo-fixtures'

test('Yjs testUndoText: same-interval insertion/deletion and collaborator deletion survive redo', () => {
  const room = undoRoom({ groupDelay: 500, now: () => 0 })
  room.edit(0, 0, 0, 'test')
  room.edit(0, 0, 4, '')
  room.undo()
  expect(room.text()).toBe('')
  room.users[0]!.history.seal()
  room.edit(0, 0, 0, 'a')
  room.users[0]!.history.seal()
  room.edit(0, 0, 1, '')
  room.undo()
  expect(room.text()).toBe('a')
  room.undo()
  expect(room.text()).toBe('')
  room.edit(0, 0, 0, 'abc')
  room.edit(1, 0, 0, 'xyz')
  room.sync()
  room.undo()
  expect(room.text()).toBe('xyz')
  room.redo()
  room.sync()
  expect(room.text()).toBe('abcxyz')
  room.edit(1, 0, 1, '')
  room.sync()
  room.undo()
  expect(room.text()).toBe('xyz')
  room.redo()
  room.converged()
  expect(room.text()).toBe('bcxyz')
})

test('Yjs testUndoEvents: capture and pop preserve caller metadata', () => {
  const events: UndoEvent[] = []
  const room = undoRoom({ groupDelay: 0, onEvent: (event) => events.push(event) })
  const metadata = { selection: [0, 3] }
  room.edit(0, 0, 0, 'abc', { metadata })
  room.undo()
  room.redo()
  expect(events.map((event) => event.kind)).toEqual(['record', 'undo', 'redo'])
  expect(events.every((event) => event.transaction.metadata === metadata)).toBe(true)
  room.converged()
})

test('Yjs testTrackClass: only captured local origins enter undo', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'base', { history: false })
  room.edit(0, 4, 0, 'local')
  room.sync()
  room.edit(1, 0, 0, 'R')
  room.sync()
  room.undo()
  room.converged()
  expect(room.text()).toBe('Rbase')
  expect(room.users[0]!.history.state().undo).toHaveLength(0)
})

test('Yjs testTypeScope: one document manager cannot consume another document history', () => {
  const first = undoRoom(),
    second = undoRoom()
  first.edit(0, 0, 0, 'one')
  second.edit(0, 0, 0, 'two')
  first.undo()
  first.converged()
  second.converged()
  expect(first.text()).toBe('')
  expect(second.text()).toBe('two')
  expect(second.users[0]!.history.state().undo).toHaveLength(1)
})

test('Yjs testUndoUntilChangePerformed: provenance-only undo advances exactly one transaction', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'ab')
  room.sync()
  room.edit(0, 1, 1, '')
  room.edit(1, 1, 1, '')
  room.sync()
  const before = room.users[0]!.history.state()
  room.undo()
  expect(room.text()).toBe('a')
  expect(room.users[0]!.history.state().undo).toHaveLength(before.undo.length - 1)
  expect(room.users[0]!.history.state().redo).toHaveLength(1)
  room.undo(1)
  room.converged()
  expect(room.text()).toBe('ab')
})

test('Yjs testConsecutiveRedoBug: every replacement returns after consecutive redo', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, '0')
  room.edit(0, 0, 1, '100')
  room.edit(0, 0, 3, '200')
  room.edit(0, 0, 3, '300')
  for (const expected of ['200', '100', '0', '']) {
    room.undo()
    expect(room.text()).toBe(expected)
  }
  for (const expected of ['0', '100', '200', '300']) {
    room.redo()
    expect(room.text()).toBe(expected)
  }
  room.converged()
})

test('Yjs testSpecialDeletionCase: reversing a grouped replacement/delete restores retained content', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'original', { history: false })
  room.users[0]!.history.beginTransaction()
  room.edit(0, 0, 8, 'updated')
  room.edit(0, 0, 7, '')
  room.users[0]!.history.endTransaction()
  room.undo()
  room.converged()
  expect(room.text()).toBe('original')
})

test('Yjs testUndoDoingStackItem: the initiating transaction is exposed during publication', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'abc', { metadata: '42' })
  const metadata: unknown[] = []
  room.users[0]!.participant.subscribe(() =>
    metadata.push(room.users[0]!.history.currentTransaction?.metadata),
  )
  room.undo()
  room.redo()
  expect(metadata).toEqual(['42', '42'])
  expect(room.users[0]!.history.currentTransaction).toBeNull()
  room.converged()
})

test.skip('Yjs testUndoDeleteFilter needs protected rich-object targets', () => {})
test.skip('Yjs testUndoNestedUndoIssue needs nested shared objects and parent restoration', () => {})
