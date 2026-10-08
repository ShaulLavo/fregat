// Adapted semantic cases from loro-dev/loro at c00c9fa501f8d32f68d6255eacb7035a67fb6ab6.
// Sources: crates/loro-internal/tests/undo.rs and crates/loro/tests/integration_test/undo_test.rs.
// Copyright (c) 2023 Loro. MIT; see THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { undoRoom } from '../undo-fixtures'

const cases = [
  'undo_id_span_that_contains_remote_deps_inside',
  'undo_id_span_that_contains_remote_deps_inside_many_times',
]
for (const [index, name] of cases.entries())
  test(`Loro ${name}`, () => {
    const room = undoRoom()
    const times = index === 0 ? 1 : 10
    for (let iteration = 0; iteration < times; iteration++) {
      room.edit(0, 0, 0, 'A')
      room.sync()
      room.edit(1, 0, 1, 'B')
      room.edit(0, 1, 0, ' rules')
      room.sync()
      room.edit(0, 7, 0, '.')
      room.sync()
    }
    while (room.users[0]!.history.state().undo.length) room.undo()
    room.converged()
    expect(room.text()).toBe('B'.repeat(times))
  })

test('Loro test_basic_undo_group_checkpoint', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, '0')
  room.users[0]!.history.beginTransaction()
  room.edit(0, 0, 1, '1')
  room.edit(0, 1, 0, '2')
  room.users[0]!.history.endTransaction()
  room.undo()
  expect(room.text()).toBe('0')
  room.redo()
  room.converged()
  expect(room.text()).toBe('12')
})

test('Loro test_invalid_nested_group', () => {
  const room = undoRoom()
  room.users[0]!.history.beginTransaction()
  expect(() => room.users[0]!.history.beginTransaction()).toThrow('nested-transaction')
  room.users[0]!.history.endTransaction()
  expect(() => room.users[0]!.history.beginTransaction()).not.toThrow()
  expect(room.users[0]!.history.endTransaction()).toBeNull()
})

test('Loro test_simulate_intersecting_remote_undo: remote insertion closes the edited region', () => {
  const room = undoRoom()
  room.users[0]!.history.beginTransaction()
  room.edit(0, 0, 0, '1')
  room.edit(0, 1, 0, '2')
  room.sync()
  room.edit(1, 2, 0, '3')
  room.sync()
  room.edit(0, 3, 0, '4')
  room.users[0]!.history.endTransaction()
  room.undo()
  expect(room.text()).toBe('123')
  room.undo()
  room.converged()
  expect(room.text()).toBe('3')
})

test('Loro test_simulate_non_intersecting_remote_undo: disjoint text keeps a group open', () => {
  const room = undoRoom()
  room.edit(1, 0, 0, 'base')
  room.sync()
  room.users[0]!.history.beginTransaction()
  room.edit(0, 4, 0, '1')
  room.edit(0, 5, 0, '2')
  room.sync()
  room.edit(1, 0, 0, 'R')
  room.sync()
  room.edit(0, 7, 0, '3')
  room.users[0]!.history.endTransaction()
  room.undo()
  room.converged()
  expect(room.text()).toBe('Rbase')
})

test('Loro test_undo_group_start_with_remote_ops', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'hi')
  room.sync()
  room.edit(1, 0, 0, 'test')
  room.sync()
  room.users[0]!.history.beginTransaction()
  room.edit(0, 0, 0, 't')
  room.undo()
  expect(room.text()).toBe('testhi')
  room.undo()
  expect(room.text()).toBe('test')
  room.redo()
  room.redo()
  room.converged()
  expect(room.text()).toBe('ttesthi')
})

for (const clear of ['clearRedo', 'clearUndo'] as const)
  test(`Loro test_${clear === 'clearRedo' ? 'clear_redo' : 'clear_undo'}`, () => {
    const room = undoRoom()
    room.edit(0, 0, 0, 'hello')
    room.edit(0, 5, 0, ' world')
    room.undo()
    room.users[0]!.history[clear]()
    if (clear === 'clearRedo') {
      expect(room.users[0]!.history.redo()).toBeNull()
      room.undo()
      expect(room.text()).toBe('')
    } else {
      expect(room.users[0]!.history.undo()).toBeNull()
      room.redo()
      expect(room.text()).toBe('hello world')
    }
    room.converged()
  })

test('Loro undo_text_collab_delete: hidden local steps still advance provenance history', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'A ')
  room.edit(0, 2, 0, 'fox ')
  room.edit(0, 6, 0, 'jumped')
  room.sync()
  room.edit(1, 2, 4, '')
  room.sync()
  room.edit(0, 0, 0, '123!')
  for (let iteration = 0; iteration < 3; iteration++) {
    expect(room.text()).toBe('123!A jumped')
    room.undo()
    expect(room.text()).toBe('A jumped')
    room.undo()
    expect(room.text()).toBe('A ')
    room.undo()
    expect(room.text()).toBe('A ')
    room.undo()
    expect(room.text()).toBe('')
    for (let step = 0; step < 4; step++) room.redo()
    room.sync()
  }
  room.converged()
})

test('Loro collab_undo: repeated local reversals preserve the other author', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'Hello ')
  room.sync()
  room.edit(1, 6, 0, 'A ')
  room.sync()
  room.edit(1, 8, 0, 'fox')
  room.edit(0, 6, 0, 'World! ')
  room.sync()
  room.edit(1, room.text(1).length, 0, ' jumped.')
  room.sync()
  for (let iteration = 0; iteration < 3; iteration++) {
    room.undo(0)
    room.undo(0)
    expect(room.text()).toBe('A fox jumped.')
    room.redo(0)
    room.redo(0)
    room.sync()
    expect(room.text()).toBe('Hello World! A fox jumped.')
    for (let step = 0; step < 3; step++) room.undo(1)
    expect(room.text(1)).toBe('Hello World! ')
    for (let step = 0; step < 3; step++) room.redo(1)
    room.sync()
  }
  room.converged()
})

test('Loro test_remote_merge_transform: remote deletion leaves a provenance-only local undo', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'B')
  room.edit(0, 0, 0, 'Hello ')
  room.sync()
  room.edit(1, 0, 6, '')
  room.sync()
  expect(room.text()).toBe('B')
  room.undo()
  expect(room.text()).toBe('B')
  room.undo()
  room.converged()
  expect(room.text()).toBe('')
})

test('Loro undo_redo_when_collab: remote removal survives every local redo', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'Hello ')
  room.edit(0, 6, 0, 'World')
  room.sync()
  room.edit(1, 0, 5, 'Hi')
  room.edit(0, 0, 0, 'Alice')
  room.sync()
  room.edit(1, 0, 5, '')
  room.undo()
  expect(room.text()).toBe('Hi World')
  room.sync()
  room.undo()
  expect(room.text()).toBe('Hi ')
  room.edit(1, 0, 0, 'Bob ')
  room.sync()
  room.undo()
  expect(room.text()).toBe('Bob Hi')
  room.redo()
  expect(room.text()).toBe('Bob Hi ')
  room.redo()
  expect(room.text()).toBe('Bob Hi World')
  room.redo()
  room.converged()
  expect(room.text()).toBe('Bob Hi World')
})

test('Loro undo_transform_cursor_position: selection identities survive remote edits and same-ID revival', () => {
  const room = undoRoom()
  const first = room.edit(0, 0, 0, 'Hello world!')
  if (first.change.kind !== 'insert') throw new TypeError('Expected insertion')
  const start = first.change.start
  const cursors = [1, 4].map((counter) => ({ bunch: start.bunch, counter }))
  room.edit(0, 1, 4, '', { metadata: cursors })
  room.sync()
  room.edit(1, 0, 0, 'Hi ')
  room.edit(1, 4, 0, 'ii')
  room.sync()
  expect(room.text()).toBe('Hi Hii world!')
  const transaction = room.users[0]!.history.state().undo.at(-1)!
  room.undo()
  room.converged()
  // Tombstone origins retain the remote insertion before the returning original IDs.
  expect(room.text()).toBe('Hi Hiiello world!')
  expect(transaction.metadata).toEqual(cursors)
  expect(cursors.map((id) => room.users[0]!.engine.visibleOffset(id))).toEqual([6, 9])
  expect(
    cursors.every((id) =>
      room.engine
        .snapshot()
        .nodes.some(
          (node) => node.id.bunch === id.bunch && node.id.counter === id.counter && !node.deleted,
        ),
    ),
  ).toBe(true)
})

test('Loro undo_while_paused_does_not_leak_processing_flag', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'a')
  room.users[0]!.history.pause()
  room.undo()
  expect(room.text()).toBe('')
  room.edit(0, 0, 0, 'R')
  room.users[0]!.history.resume()
  room.edit(0, 1, 0, 'b')
  room.undo()
  expect(room.text()).toBe('R')
  expect(room.users[0]!.history.currentTransaction).toBeNull()
  room.converged()
})
