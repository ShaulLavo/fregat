import { expect, test } from 'vitest'
import { Participant, ReferenceEngine } from '../src/index'
import type { Envelope } from '../src/index'
import { createEngine } from './engine-fixture'
import { confirmedHistory, randomFor } from './concurrency-fixtures'

test('seeded multi-author projections match the reference and preserve live identities', () => {
  for (let seed = 0; seed < 50; seed++) {
    const history = confirmedHistory(seed)
    const engine = createEngine()
    const reference = new ReferenceEngine()
    for (const edit of history) {
      engine.apply(edit)
      reference.apply(edit)
    }
    const before = engine.snapshot()
    const random = randomFor(seed + 200)
    const effects = history.map((edit) => ({ op: edit.id, active: random() > 0.5 }))
    const fork = createEngine()
    fork.restore(engine.projectEffects(effects))
    const expected = new ReferenceEngine()
    expected.restore(reference.projectEffects(effects))
    expect(fork.text()).toBe(expected.text())
    expect(fork.characters()).toEqual(expected.characters())
    expect(engine.snapshot()).toEqual(before)
  }
})

function merged() {
  const engine = createEngine()
  const a = new Participant({ actor: 'a', document: 'review', epoch: '1', engine: createEngine() })
  const b = new Participant({ actor: 'b', document: 'review', epoch: '1', engine: createEngine() })
  const initial = a.local({ offset: 0, deleteCount: 0, text: 'count = 1' })
  const message = {
    document: 'review',
    epoch: '1',
    sequence: 1,
    status: 'accepted' as const,
    envelope: initial,
  }
  a.receive([message])
  b.receive([message])
  const left = a.local({ offset: 0, deleteCount: 5, text: 'total' })
  const right = b.local({ offset: 0, deleteCount: 5, text: 'size' })
  for (const edit of [initial, left, right]) engine.apply(edit)
  return { engine, initial, left, right }
}

test('projects both authors and the base while leaving live state and command IDs unchanged', () => {
  const { engine, left, right } = merged()
  const before = engine.snapshot()
  const inspect = (a: boolean, b: boolean) => {
    const snapshot = engine.projectEffects([
      { op: left.id, active: a },
      { op: right.id, active: b },
    ])
    expect(engine.snapshot()).toEqual(before)
    const fork = createEngine()
    fork.restore(snapshot)
    expect(fork.snapshot()).toEqual(snapshot)
    return fork.text()
  }
  expect(inspect(true, false)).toBe('total = 1')
  expect(inspect(false, true)).toBe('size = 1')
  expect(inspect(false, false)).toBe('count = 1')
  expect(engine.snapshot()).toEqual(before)
  const commandId = { actor: 'a', seq: left.id.seq + 1 }
  const undo: Envelope = {
    ...left,
    id: commandId,
    lamport: left.lamport + 1,
    deps: [left.id, right.id],
    change: { kind: 'setEffects', command: commandId, effects: [{ op: left.id, active: false }] },
  }
  engine.apply(undo)
  expect(engine.text()).toBe('size = 1')
})

test('preserves existing undo states and validates projection without partial mutation', () => {
  const { engine, left, right } = merged()
  const id = { actor: right.id.actor, seq: right.id.seq + 1 }
  engine.apply({
    ...right,
    id,
    change: { kind: 'setEffects', command: id, effects: [{ op: right.id, active: false }] },
  })
  const before = engine.snapshot()
  const fork = createEngine()
  fork.restore(engine.projectEffects([{ op: left.id, active: false }]))
  expect(fork.text()).toBe('count = 1')
  expect(engine.projectEffects([])).toEqual(before)
  expect(() =>
    engine.projectEffects([
      { op: left.id, active: false },
      { op: { actor: 'missing', seq: 1 }, active: true },
    ]),
  ).toThrow()
  expect(() =>
    engine.projectEffects([
      { op: left.id, active: false },
      { op: left.id, active: true },
    ]),
  ).toThrow()
  expect(() => engine.projectEffects([{ op: id, active: true }])).toThrow()
  expect(engine.snapshot()).toEqual(before)
})
