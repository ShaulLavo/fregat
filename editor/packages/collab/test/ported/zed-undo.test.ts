// Independently implemented semantic scenarios from Zed crates/text/src/tests.rs
// at dc3fb21676457b84d2233ac4c6bec5cebc698ec3. No GPL source is copied or translated.
// Scenario inventory and source licence are recorded in THIRD_PARTY_TEST_NOTICES.md.
import { expect, test } from 'vitest'
import { simulate } from '../../src/index'
import { undoRoom } from '../undo-fixtures'

test('Zed test_undo_redo: selective transaction effects and time grouping', () => {
  let time = 0
  const room = undoRoom({ groupDelay: 300, now: () => time })
  room.edit(1, 0, 0, '012345')
  room.sync()
  room.edit(0, 1, 2, 'ab')
  time = 200
  room.edit(0, 3, 1, 'c')
  time = 501
  room.edit(0, 0, 1, 'X')
  expect(room.text()).toBe('Xabc45')
  room.undo()
  expect(room.text()).toBe('0abc45')
  room.undo()
  expect(room.text()).toBe('012345')
  room.redo()
  room.redo()
  expect(room.text()).toBe('Xabc45')
  room.converged()
})

test('Zed test_finalize_last_transaction: sealed groups cannot merge', () => {
  const room = undoRoom({ groupDelay: 1000, now: () => 0 })
  room.edit(0, 0, 0, 'a')
  room.users[0]!.history.seal()
  room.edit(0, 1, 0, 'b')
  room.edit(0, 2, 0, 'c')
  room.undo()
  expect(room.text()).toBe('a')
  room.undo()
  expect(room.text()).toBe('')
  room.redo()
  room.redo()
  room.converged()
  expect(room.text()).toBe('abc')
})

test('Zed test_concurrent_edits: each author independently reverses a replacement', () => {
  const room = undoRoom({ groupDelay: 0 }, 4)
  room.edit(3, 0, 0, 'abcdef')
  room.sync()
  room.edit(0, 1, 1, 'X')
  room.edit(1, 3, 1, 'Y')
  room.edit(2, 5, 1, 'Z')
  room.converged()
  expect(room.text()).toBe('aXcYeZ')
  room.undo(1)
  room.converged()
  expect(room.text()).toBe('aXcdeZ')
  room.redo(1)
  room.converged()
  expect(room.text()).toBe('aXcYeZ')
})

test('Zed test_edit_partially_intersecting_a_deleted_fragment: retain partial hidden targets', () => {
  const room = undoRoom()
  const first = room.edit(0, 0, 0, 'abcdefgh')
  room.sync()
  room.edit(0, 2, 3, '')
  room.sync([0])
  room.edit(1, 1, 3, '')
  room.sync()
  expect(room.text()).toBe('afgh')
  room.undo(1)
  room.converged()
  expect(room.text()).toBe('abfgh')
  room.undo()
  room.converged()
  expect(room.text()).toBe('abcdefgh')
  expect(room.engine.snapshot().nodes.map((node) => node.id.bunch)).toEqual(
    Array(8).fill(first.change.kind === 'insert' ? first.change.start.bunch : ''),
  )
})

const concurrentUndoSeeds = Array.from({ length: 100 }, (_, index) => 400 + index)

test.each(concurrentUndoSeeds)(
  'Zed test_random_concurrent_edits: edits, undo, redo and asynchronous delivery converge, seed %s',
  (seed) => {
    expect(simulate({ seed, participants: 3, edits: 64, undoRedo: true }).hostSequence).toBe(64)
  },
)

test('Zed test_edit_undo_after_split: reverse a long replacement across identity splits', () => {
  const room = undoRoom()
  room.edit(1, 0, 0, 'left right')
  room.sync()
  const ids = room.engine.snapshot().nodes.map((node) => node.id)
  room.edit(0, 4, 1, 'Q'.repeat(64))
  room.sync()
  room.edit(1, 12, 0, '!')
  room.sync()
  room.undo()
  room.converged()
  expect(room.text()).toBe('left! right')
  expect(
    room.engine
      .snapshot()
      .nodes.filter((node) =>
        ids.some((id) => id.bunch === node.id.bunch && id.counter === node.id.counter),
      )
      .every((node) => !node.deleted),
  ).toBe(true)
})
