import { expect, test } from 'vitest'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { Participant, TextbufferEngine } from '../src/index'
import type { Envelope } from '../src/index'
import { createEngine } from './engine-fixture'
import { undoRoom } from './undo-fixtures'
import { VisibilityModel } from '../src/visibility-model'

function command(
  source: Envelope,
  seq: number,
  effects: Extract<Envelope['change'], { kind: 'setEffects' }>['effects'],
): Envelope {
  const id = { actor: source.id.actor, seq }
  return { ...source, id, change: { kind: 'setEffects', command: id, effects } }
}

test('coalesced insertion runs preserve each edit provenance across undo and replay', () => {
  const room = undoRoom()
  const first = room.edit(0, 0, 0, 'a')
  const second = room.edit(0, 1, 0, 'b')
  const third = room.edit(0, 2, 0, 'c')
  const engine = createEngine()
  for (const envelope of [first, second, third]) engine.apply(envelope)
  const before = engine.snapshot()
  const undo = command(second, 4, [{ op: second.id, active: false }])
  engine.apply(undo)
  expect(engine.text()).toBe('ac')
  const identities = engine.characters().map(({ id }) => id)
  const hidden = engine.snapshot()
  const redo = command(second, 5, [{ op: second.id, active: true }])
  engine.apply(redo)
  engine.apply(undo)
  engine.apply(second)
  expect(engine.text()).toBe('abc')
  expect(engine.characters().map(({ id }) => id)).toEqual(identities)
  engine.restore(hidden)
  expect(engine.text()).toBe('ac')
  engine.apply(redo)
  expect(engine.text()).toBe('abc')
  engine.restore(before)
  expect(engine.text()).toBe('abc')
})

test('invalid effect batches leave text, provenance and command dedup untouched', () => {
  const room = undoRoom()
  const edit = room.edit(0, 0, 0, 'abc')
  const engine = createEngine()
  engine.apply(edit)
  const saved = engine.snapshot()
  const invalid = command(edit, 2, [
    { op: edit.id, active: false },
    { op: { actor: edit.id.actor, seq: 99 }, active: false },
  ])
  expect(() => engine.apply(invalid)).toThrow('unknown-effect')
  expect(engine.snapshot()).toEqual(saved)
  expect(engine.text()).toBe('abc')
  engine.apply(command(edit, 2, [{ op: edit.id, active: false }]))
  expect(engine.text()).toBe('')
})

test.each([false, true])(
  'bootstrap provenance and effect snapshots retain by reference with transient=%s',
  (transient) => {
    const original = createPieceTableSnapshot('a😀\nbc', {
      normalized: true,
      transient,
      charIds: { bunch: 'bootstrap', counter: 0 },
    })
    const engine = new TextbufferEngine(original)
    const participant = new Participant({ actor: 'a', document: 'd', epoch: '1', engine })
    const before = engine.snapshot()
    const deletion = participant.local({ offset: 1, deleteCount: 3, text: '' })
    const hidden = engine.snapshot()
    const undo = participant.undoManager.undo()!
    const revived = engine.snapshot()
    expect(engine.text()).toBe('a😀\nbc')
    expect(revived.buffer.buffers).toBe(original.buffers)
    engine.restore(hidden)
    expect(engine.snapshot()).toBe(hidden)
    expect(engine.text()).toBe('abc')
    engine.apply(undo)
    expect(engine.text()).toBe('a😀\nbc')
    engine.restore(before)
    expect(engine.snapshot()).toBe(before)
    engine.apply(deletion)
    expect(engine.text()).toBe('abc')
    engine.restore(revived)
    expect(engine.snapshot()).toBe(revived)
    engine.apply(deletion)
    expect(engine.text()).toBe('a😀\nbc')
  },
)

test('independent visibility oracle rejects last-delete-only diagnostics under both engines', () => {
  const room = undoRoom({ groupDelay: 0 }, 3)
  room.edit(2, 0, 0, 'abc')
  room.sync()
  room.edit(0, 1, 1, '')
  room.edit(1, 1, 1, '')
  room.sync()
  room.undo(1)
  room.sync()
  const oracle = new VisibilityModel()
  for (const message of room.log) if (message.status === 'accepted') oracle.apply(message.envelope)
  oracle.check(room.engine, 'known-good')
  expect(room.text()).toBe('ac')
  const observed = room.engine.characters()
  expect(() =>
    oracle.check(
      {
        text: () => room.engine.text(),
        characters: () => observed.map((node) => ({ ...node, deleted: false })),
      },
      'last-delete-only-mutant',
    ),
  ).toThrow('oracle-visibility-last-delete-only-mutant')
})
