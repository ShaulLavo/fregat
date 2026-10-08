import { createEngine } from './engine-fixture'
import { submitAsAuthor } from './host-fixtures'
import { expect, test } from 'vitest'
import { Host, InMemoryTransport } from '../src/index'
import type { Envelope } from '../src/index'
import { authority, replica, subscribeText } from './fixtures'
import { undoRoom } from './undo-fixtures'

test('time grouping, empty boundaries and replacement boundaries', () => {
  let time = 0
  const room = undoRoom({ groupDelay: 500, now: () => time })
  room.edit(0, 0, 0, 'a')
  time = 499
  room.edit(0, 1, 0, 'b')
  time = 999
  room.edit(0, 2, 0, 'c')
  expect(
    room.users[0]!.history.state().undo.map((transaction) => transaction.edits.length),
  ).toEqual([2, 1])
  room.undo()
  expect(room.text()).toBe('ab')
  room.users[0]!.history.beginTransaction()
  expect(room.users[0]!.history.endTransaction()).toBeNull()
  expect(room.users[0]!.history.state().redo).toHaveLength(1)
  room.edit(0, 0, 1, 'X', { boundary: true })
  room.edit(0, 2, 0, 'd')
  expect(room.users[0]!.history.state().redo).toHaveLength(0)
  room.undo()
  expect(room.text()).toBe('Xb')
  room.undo()
  expect(room.text()).toBe('ab')
  room.converged()
})

test('foreign effect ownership, command identity and sender binding are checked atomically', () => {
  const a = replica('a'),
    b = replica('b')
  const { host } = authority()
  const first = a.insert(0, 'A'),
    foreign = b.insert(0, 'B')
  submitAsAuthor(host, first)
  submitAsAuthor(host, foreign)
  const id = { actor: 'a', seq: 2 }
  const command: Envelope = {
    ...first,
    id,
    lamport: 2,
    change: {
      kind: 'setEffects',
      command: id,
      effects: [
        { op: first.id, active: false },
        { op: foreign.id, active: false },
      ],
    },
  }
  expect(submitAsAuthor(host, command)).toMatchObject({
    status: 'rejected',
    reason: 'foreign-effect',
  })
  expect(host.text()).toBe('AB')
  const own = {
    ...command,
    id: { actor: 'a', seq: 3 },
    change: {
      ...command.change,
      kind: 'setEffects' as const,
      command: { actor: 'a', seq: 3 },
      effects: [{ op: first.id, active: false }],
    },
  }
  expect(() => host.submit(own, 'b')).toThrow('sender-mismatch')
  expect(host.outcome(own.id)).toBeUndefined()
  expect(host.submit(own, 'a').status).toBe('accepted')
  expect(host.text()).toBe('B')
  const mismatched = { ...own, id: { actor: 'a', seq: 4 } }
  expect(submitAsAuthor(host, mismatched)).toMatchObject({
    status: 'rejected',
    reason: 'invalid-effect-command',
  })
})

test('an invalid target or state rejects the entire command before changing any effect', () => {
  const room = undoRoom()
  const first = room.edit(0, 0, 0, 'a')
  room.sync()
  const id = { actor: '0', seq: 2 }
  const command: Envelope = {
    ...first,
    id,
    lamport: 2,
    deps: [first.id],
    change: {
      kind: 'setEffects',
      command: id,
      effects: [
        { op: first.id, active: false },
        { op: { actor: '0', seq: 88 }, active: false },
      ],
    },
  }
  expect(submitAsAuthor(room.host, command)).toMatchObject({
    status: 'rejected',
    reason: 'unknown-effect',
  })
  expect(room.host.text()).toBe('a')
  const invalid: Envelope = {
    ...command,
    id: { actor: '0', seq: 3 },
    change: {
      kind: 'setEffects',
      command: { actor: '0', seq: 3 },
      effects: [
        { op: first.id, active: false },
        { op: first.id, active: true },
      ],
    },
  }
  expect(submitAsAuthor(room.host, invalid)).toMatchObject({
    status: 'rejected',
    reason: 'conflicting-effects',
  })
  expect(room.host.text()).toBe('a')
  const invalidState: Envelope = {
    ...invalid,
    id: { actor: '0', seq: 4 },
    change: {
      kind: 'setEffects',
      command: { actor: '0', seq: 4 },
      effects: [{ op: first.id, active: 1 as unknown as boolean }],
    },
  }
  expect(submitAsAuthor(room.host, invalidState)).toMatchObject({
    status: 'rejected',
    reason: 'invalid-effect-state',
  })
  expect(room.host.text()).toBe('a')
})

test('provenance occupies identity spans and snapshots retain independently reversible effects', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'abcdef')
  room.sync()
  const original = room.engine.snapshot()
  room.edit(0, 1, 3, '')
  room.edit(1, 2, 3, '')
  room.sync()
  const hidden = room.engine.snapshot()
  room.undo()
  room.sync()
  expect(room.text()).toBe('abf')
  room.undo(1)
  room.sync()
  expect(room.text()).toBe('abcdef')
  room.engine.restore(hidden)
  expect(room.engine.text()).toBe('af')
  room.engine.restore(original)
  expect(room.engine.text()).toBe('abcdef')
})

test('setEffects replay after a later command is deduplicated by command identity', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'x')
  const undo = room.undo(),
    redo = room.redo()
  const engine = createEngine()
  for (const envelope of room.users[0]!.participant.state().pending) engine.apply(envelope)
  expect(engine.text()).toBe('x')
  engine.apply(undo)
  engine.apply(redo)
  expect(engine.text()).toBe('x')
  const saved = engine.snapshot()
  engine.restore(saved)
  engine.apply(undo)
  expect(engine.snapshot()).toEqual(saved)
})

// Singapore scenarios 1, 2, 5, 6, 7, 10, 12 and 13 from docs/collab-editing/c-undo.md §5.
test('1: a graph can switch sibling transactions atomically while retaining remote work', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'A')
  room.edit(0, 1, 0, 'B')
  const b = room.users[0]!.history.state().undo.at(-1)!
  room.undo()
  room.edit(0, 1, 0, 'C')
  const c = room.users[0]!.history.state().undo.at(-1)!
  room.sync()
  room.edit(1, 0, 0, 'R')
  room.sync()
  const states: string[] = []
  subscribeText(room.users[0]!.participant, (text) => states.push(text))
  room.users[0]!.history.setTransactions([
    { transaction: c, active: false },
    { transaction: b, active: true },
  ])
  expect(states).toEqual(['RAB'])
  room.converged()
  expect(room.host.text()).toBe('RAB')
})

test('2: grouped replacement withdraws insertion and deletion effects atomically', () => {
  const room = undoRoom()
  room.edit(1, 0, 0, 'abc')
  room.sync()
  room.users[0]!.history.beginTransaction()
  room.edit(0, 0, 1, 'A')
  room.edit(0, 2, 1, 'C')
  room.users[0]!.history.endTransaction()
  room.sync()
  expect(room.text()).toBe('AbC')
  const seen: string[] = []
  subscribeText(room.users[0]!.participant, (text) => seen.push(text))
  const envelope = room.undo()
  expect(envelope.change).toMatchObject({
    kind: 'setEffects',
    effects: [{ active: false }, { active: false }],
  })
  expect(seen).toEqual(['abc'])
  room.converged()
})

test('5: pending local edit, undo, redo and remote insertion replay capture history once', () => {
  const room = undoRoom()
  const local = room.edit(0, 0, 0, 'a')
  const undo = room.undo(),
    redo = room.redo()
  room.edit(1, 0, 0, 'R')
  room.sync([1])
  room.users[0]!.participant.receive(room.log)
  expect(room.text()).toBe('aR')
  expect(room.users[0]!.history.state().undo[0]!.edits).toEqual([local.id])
  expect(room.users[0]!.participant.state().pending.map((envelope) => envelope.id)).toEqual([
    local.id,
    undo.id,
    redo.id,
  ])
  expect(submitAsAuthor(room.host, redo).status).toBe('deferred')
  expect(submitAsAuthor(room.host, undo).status).toBe('deferred')
  room.converged()
})

test('6: duplicate acknowledgements and retransmission never duplicate or invert undo', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'x')
  room.sync()
  const command = room.undo()
  const outcome = submitAsAuthor(room.host, command)
  expect(submitAsAuthor(room.host, command)).toBe(outcome)
  room.users[0]!.participant.receive(room.log)
  room.users[0]!.participant.receive(room.log)
  expect(room.users[0]!.history.state()).toMatchObject({
    undo: [],
    redo: [{ edits: [{ actor: '0', seq: 1 }] }],
  })
  room.redo()
  room.converged()
  expect(submitAsAuthor(room.host, command)).toBe(outcome)
  expect(room.host.text()).toBe('x')
})

test('7 and 13: a second delete retains provenance and a visually empty undo is acknowledged', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'abc')
  room.sync()
  room.edit(0, 1, 1, '')
  room.edit(1, 1, 1, '')
  room.sync()
  const sequence = room.host.hostSequence
  const undo = room.undo()
  room.sync()
  expect(room.host.outcome(undo.id)?.status).toBe('accepted')
  expect(room.host.hostSequence).toBe(sequence + 1)
  expect(room.text()).toBe('ac')
  expect(room.users[0]!.history.state().redo).toHaveLength(1)
  room.undo(1)
  room.converged()
  expect(room.text()).toBe('abc')
})

test('10: dropping history entries does not deactivate baseline operations', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'base')
  room.sync()
  room.users[0]!.history.clearUndo()
  room.edit(0, 4, 0, 'x')
  room.undo()
  room.converged()
  expect(room.text()).toBe('base')
  expect(room.users[0]!.history.undo()).toBeNull()
})

test('12: rejected undo and its dependent redo recover the prior local history', () => {
  const room = undoRoom()
  const original = room.edit(0, 0, 0, 'x')
  room.sync()
  const command = room.undo(),
    redo = room.redo()
  submitAsAuthor(room.host, { ...command, epoch: 'old' })
  room.users[0]!.participant.receive(room.log)
  expect(room.text()).toBe('x')
  expect(room.users[0]!.participant.state().blocked).toEqual([redo.id])
  expect(room.users[0]!.history.state()).toMatchObject({
    undo: [{ edits: [original.id] }],
    redo: [],
  })
  expect(submitAsAuthor(room.host, redo)).toMatchObject({
    status: 'rejected',
    reason: 'rejected-dependency',
  })
  room.users[0]!.participant.receive(room.log)
  const retry = room.undo()
  expect(submitAsAuthor(room.host, retry).status).toBe('accepted')
  room.users[0]!.participant.receive(room.log)
  expect(room.text()).toBe('')
})

test('effect state survives a retained snapshot without allocating replacement identities', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'abc')
  room.sync()
  const ids = room.engine.characters().map((node) => node.id)
  room.undo()
  room.sync()
  const engine = createEngine()
  engine.restore(room.engine.snapshot())
  const host = new Host({ document: 'undo', epoch: '1', engine })
  // Full host handoff also needs outcome/frontier transfer in the session layer.
  const redo = room.redo()
  engine.apply(redo)
  expect(host.text()).toBe('abc')
  expect(engine.characters().map((node) => node.id)).toEqual(ids)
})

test('publication-created local work clears redo before rejection recovery replays history', () => {
  const room = undoRoom()
  room.edit(0, 0, 0, 'x')
  room.sync()
  let inserted = false
  subscribeText(room.users[0]!.participant, (text) => {
    if (inserted || text !== '') return
    inserted = true
    room.edit(0, 0, 0, 'y')
  })
  room.undo()
  room.sync()
  expect(room.text()).toBe('y')
  expect(room.users[0]!.history.state().redo).toHaveLength(0)
  const rejected = room.edit(0, 1, 0, 'z')
  submitAsAuthor(room.host, { ...rejected, epoch: 'old' })
  room.users[0]!.participant.receive(room.log)
  expect(room.text()).toBe('y')
  expect(room.users[0]!.history.state().redo).toHaveLength(0)
  expect(room.users[0]!.history.state().undo).toHaveLength(1)
})

test('a capture observer failure still publishes the edit and closes its boundary', () => {
  let fail = true
  const room = undoRoom({
    groupDelay: 500,
    now: () => 0,
    onEvent: () => {
      if (fail) throw new TypeError('observer')
    },
  })
  const published: string[] = []
  subscribeText(room.users[0]!.participant, (text) => published.push(text))
  expect(() => room.edit(0, 0, 0, 'x', { boundary: true })).toThrow('observer')
  expect(published).toEqual(['x'])
  fail = false
  room.edit(0, 1, 0, 'y')
  expect(room.users[0]!.history.state().undo).toHaveLength(2)
  room.undo()
  expect(room.text()).toBe('x')
  room.converged()
})

test('an observer failure preserves an already-applied history command', () => {
  const room = undoRoom({
    groupDelay: 0,
    onEvent: (event) => {
      if (event.kind === 'undo') throw new TypeError('observer')
    },
  })
  room.edit(0, 0, 0, 'x')
  expect(() => room.undo()).toThrow('observer')
  expect(room.text()).toBe('')
  expect(room.users[0]!.history.state()).toMatchObject({
    undo: [],
    redo: [{ edits: [{ actor: '0', seq: 1 }] }],
  })
  expect(room.users[0]!.history.currentTransaction).toBeNull()
  room.converged()
})

test('host requires a sender even for retransmissions and transport requires a registered session', () => {
  const a = replica('a')
  const impostor = replica('a')
  const { host } = authority()
  const envelope = a.insert(0, 'a')
  expect(() => Reflect.apply(host.submit, host, [envelope])).toThrow('missing-sender')
  expect(() => host.submit(envelope, '')).toThrow('missing-sender')
  expect(host.hostSequence).toBe(0)
  const transport = new InMemoryTransport(host, [a.participant])
  try {
    expect(() => transport.submit(impostor.participant, envelope)).toThrow('unknown-sender')
    transport.submit(a.participant, envelope)
    transport.quiesce()
    expect(() => host.submit(envelope, 'b')).toThrow('sender-mismatch')
    expect(() => Reflect.apply(host.submit, host, [envelope])).toThrow('missing-sender')
    expect(host.text()).toBe('a')
    expect(host.hostSequence).toBe(1)
  } finally {
    transport.close()
  }
})

test('remote redo touching an already-hidden ID seals the local capture group', () => {
  const room = undoRoom({ groupDelay: 500, now: () => 0 })
  room.edit(1, 0, 0, 'abc', { history: false })
  room.sync()
  room.edit(1, 1, 1, '')
  room.sync()
  room.undo(1)
  room.sync()
  room.edit(0, 1, 1, '')
  room.sync()
  room.redo(1)
  room.sync()
  room.edit(0, 0, 0, 'Y')
  expect(room.users[0]!.history.state().undo).toHaveLength(2)
  room.undo(0)
  room.converged()
  expect(room.text()).toBe('ac')
})

test('disjoint remote undo and redo preserve an open local capture group', () => {
  const room = undoRoom({ groupDelay: 500, now: () => 0 })
  room.edit(1, 0, 0, 'abc')
  room.sync()
  room.edit(0, 3, 0, 'X')
  room.sync()
  room.undo(1)
  room.sync()
  room.edit(0, 1, 0, 'Y')
  room.sync()
  room.redo(1)
  room.sync()
  room.edit(0, room.text().length, 0, 'Z')
  expect(room.users[0]!.history.state().undo).toHaveLength(1)
  room.undo(0)
  room.converged()
  expect(room.text()).toBe('abc')
})
