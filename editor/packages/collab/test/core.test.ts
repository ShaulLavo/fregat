import { createEngine, characters } from './engine-fixture'
import { submitAsAuthor } from './host-fixtures'
import { expect, test } from 'vitest'
import { CollabFailure, Host, InMemoryTransport, Participant } from '../src/index'
import type { Envelope, HostMessage } from '../src/index'
import { accept, authority, replica, subscribeText } from './fixtures'

function accepted(
  message: HostMessage | { status: 'deferred' },
): asserts message is Extract<HostMessage, { status: 'accepted' }> {
  expect(message.status).toBe('accepted')
  if (message.status !== 'accepted') throw new TypeError('Expected accepted edit')
}

test('offset lookup, origins and snapshots retain exact hidden nodes', () => {
  const a = replica('a')
  const first = a.insert(0, 'abc')
  if (first.change.kind !== 'insert') throw new TypeError('Expected insert')
  const id = (counter: number) => ({
    bunch: first.change.kind === 'insert' ? first.change.start.bunch : '',
    counter,
  })
  const live = a.engine.snapshot()
  a.remove(1, 1)
  expect(a.engine.visibleOffset(id(0))).toBe(0)
  expect(a.engine.visibleOffset(id(1))).toBe(1)
  expect(a.engine.visibleOffset(id(2))).toBe(1)
  expect(a.engine.visibleOffset({ bunch: 'unknown', counter: 0 })).toBeNull()
  expect(a.engine.origins(1)).toEqual({ originLeft: id(0), originRight: id(1) })
  const hidden = a.engine.snapshot()
  a.engine.restore(live)
  expect(a.engine.text()).toBe('abc')
  a.engine.restore(hidden)
  expect(a.engine.text()).toBe('ac')
  a.engine.apply(a.edits[1]!)
  expect(a.engine.text()).toBe('ac')
})

test('authoring uses UTF-16 IDs and rejects edits through a surrogate pair', () => {
  const a = replica('a')
  const insert = a.insert(0, 'a😀b')
  expect(characters(a.engine)).toHaveLength(4)
  expect(() => a.insert(2, 'x')).toThrow('split-surrogate')
  expect(() => a.remove(1, 1)).toThrow('split-surrogate')
  const remove = a.remove(1, 2)
  expect(a.participant.text()).toBe('ab')
  if (insert.change.kind !== 'insert') throw new TypeError('Expected insert')
  expect(remove.change).toEqual({
    kind: 'delete',
    spans: [{ start: { bunch: insert.change.start.bunch, counter: 1 }, count: 2 }],
  })
})

test('straight typing extends its reserved bunch and replay retains the IDs', () => {
  const a = replica('a')
  const first = a.insert(0, 'ab')
  const next = a.insert(2, 'c')
  expect(first.change).toMatchObject({ start: { bunch: 'a:0', counter: 0 } })
  expect(next.change).toMatchObject({ start: { bunch: 'a:0', counter: 2 } })
  const before = a.participant.state().pending
  const b = replica('b')
  b.insert(0, 'x')
  accept(a.participant, b.edits)
  expect(a.participant.state().pending).toEqual(before)
  expect(a.participant.text()).toBe('abcx')
  const backwards = a.insert(0, 'z')
  expect(backwards.change).toMatchObject({ start: { bunch: 'a:1', counter: 0 } })
})

test('deleting a counter span preserves concurrent inserts between its fragments', () => {
  const a = replica('a'),
    b = replica('b')
  a.insert(0, 'abcd')
  accept(b.participant, a.edits)
  b.insert(2, 'XY')
  a.remove(1, 2)
  const engine = createEngine()
  engine.apply(a.edits[0]!)
  engine.apply(b.edits[0]!)
  engine.apply(a.edits[1]!)
  engine.apply(a.edits[1]!)
  expect(engine.text()).toBe('aXYd')
})

test('replace targets authored IDs and preserves a concurrent insertion', () => {
  const a = replica('a'),
    b = replica('b')
  a.insert(0, 'abcd')
  accept(b.participant, a.edits)
  b.insert(2, 'XY')
  a.replace(1, 2, 'Q')
  const engine = createEngine()
  engine.apply(a.edits[0]!)
  engine.apply(b.edits[0]!)
  engine.apply(a.edits[1]!)
  expect(engine.text()).toBe('aQXYd')
})

test('host defers unknown dependencies then assigns the causal prefix', () => {
  const a = replica('a')
  const first = a.insert(0, 'a'),
    next = a.insert(1, 'b')
  const { host, messages } = authority()
  expect(submitAsAuthor(host, next).status).toBe('deferred')
  expect(submitAsAuthor(host, next).status).toBe('deferred')
  expect(messages).toHaveLength(0)
  accepted(submitAsAuthor(host, first))
  expect(host.text()).toBe('ab')
  expect(messages.map((message) => message.sequence)).toEqual([1, 2])
  a.participant.receive(messages)
  expect(a.participant.state().pending).toHaveLength(0)
})

test('host rejects unknown dependencies when configured to reject', () => {
  const a = replica('a')
  a.insert(0, 'a')
  const next = a.insert(1, 'b')
  const { host } = authority({ unknownDeps: 'reject' })
  expect(submitAsAuthor(host, next)).toMatchObject({
    status: 'rejected',
    reason: 'unknown-dependency',
    sequence: 1,
  })
  expect(host.text()).toBe('')
})

test('duplicate accepted and rejected IDs return the exact stored outcomes', () => {
  const a = replica('a')
  const edit = a.insert(0, 'a')
  const { host, messages } = authority()
  const success = submitAsAuthor(host, edit)
  expect(
    submitAsAuthor(host, { ...edit, change: { ...edit.change, kind: 'delete', spans: [] } }),
  ).toBe(success)
  const invalid = { ...edit, id: { actor: 'a', seq: 2 }, epoch: 'old' }
  const rejection = submitAsAuthor(host, invalid)
  expect(rejection).toMatchObject({ status: 'rejected', reason: 'wrong-document-epoch' })
  expect(submitAsAuthor(host, { ...invalid, epoch: '1' })).toBe(rejection)
  expect(host.hostSequence).toBe(2)
  expect(messages).toHaveLength(2)
  expect(host.text()).toBe('a')
})

test('an invalid replace is rejected before any deletion is committed', () => {
  const a = replica('a')
  const { host } = authority()
  const first = a.insert(0, 'abc')
  submitAsAuthor(host, first)
  const replace = a.replace(0, 3, 'q')
  if (replace.change.kind !== 'replace' || first.change.kind !== 'insert')
    throw new TypeError('Expected replace and insert')
  const invalid: Envelope = {
    ...replace,
    change: { ...replace.change, insert: { ...replace.change.insert, start: first.change.start } },
  }
  expect(submitAsAuthor(host, invalid)).toMatchObject({
    status: 'rejected',
    reason: 'duplicate-character',
  })
  expect(host.text()).toBe('abc')
})

test('host validates origins and Lamport dependencies', () => {
  const a = replica('a')
  const { host } = authority()
  const first = a.insert(0, 'abc')
  submitAsAuthor(host, first)
  const second = a.insert(3, 'd')
  expect(submitAsAuthor(host, { ...second, lamport: first.lamport })).toMatchObject({
    status: 'rejected',
    reason: 'invalid-lamport',
  })
  if (first.change.kind !== 'insert') throw new TypeError('Expected insert')
  const invalid: Envelope = {
    ...first,
    id: { actor: 'bad', seq: 1 },
    change: {
      ...first.change,
      start: { bunch: 'bad:1', counter: 0 },
      originLeft: { bunch: 'missing', counter: 0 },
    },
  }
  expect(submitAsAuthor(host, invalid)).toMatchObject({
    status: 'rejected',
    reason: 'unknown-character',
  })
  expect(host.text()).toBe('abc')
})

test('remote-before-ack replays dependent pending edits with unchanged origins', () => {
  const a = replica('a'),
    b = replica('b')
  const first = a.insert(0, 'a'),
    next = a.insert(1, 'b')
  const remote = b.insert(0, 'x')
  const { host, messages } = authority()
  submitAsAuthor(host, remote)
  const before = a.participant.state().pending
  const changes: string[] = []
  let projection = a.participant.text()
  a.participant.subscribe((change) => {
    for (const edit of change.edits.toReversed())
      projection = projection.slice(0, edit.from) + edit.text + projection.slice(edit.to)
    changes.push(projection)
  })
  a.participant.receive(messages)
  expect(a.participant.state().pending).toEqual(before)
  expect(changes).toEqual(['abx'])
  submitAsAuthor(host, first)
  submitAsAuthor(host, next)
  a.participant.receive(messages)
  expect(changes).toEqual(['abx', 'abx'])
  expect(a.participant.state()).toMatchObject({
    text: host.text(),
    hostSequence: 3,
    pending: [],
    blocked: [],
  })
})

test('one batch with remote and local acknowledgments publishes one coherent change', () => {
  const a = replica('a'),
    b = replica('b')
  const local = a.insert(0, 'a'),
    remote = b.insert(0, 'b')
  const { host, messages } = authority()
  submitAsAuthor(host, remote)
  submitAsAuthor(host, local)
  const states: string[] = []
  let projection = a.participant.text()
  a.participant.subscribe((change) => {
    for (const edit of change.edits.toReversed())
      projection = projection.slice(0, edit.from) + edit.text + projection.slice(edit.to)
    states.push(projection)
  })
  a.participant.receive(messages)
  expect(states).toEqual(['ab'])
  expect(a.participant.state().pending).toHaveLength(0)
  a.participant.receive(messages)
  expect(states).toEqual(['ab'])
})

test('host sequence gaps buffer until a contiguous confirmed prefix arrives', () => {
  const a = replica('a'),
    b = replica('b')
  const { host, messages } = authority()
  submitAsAuthor(host, b.insert(0, 'b'))
  submitAsAuthor(host, b.insert(1, 'c'))
  const states: string[] = []
  let projection = a.participant.text()
  a.participant.subscribe((change) => {
    for (const edit of change.edits.toReversed())
      projection = projection.slice(0, edit.from) + edit.text + projection.slice(edit.to)
    states.push(projection)
  })
  a.participant.receive([messages[1]!])
  expect(a.participant.text()).toBe('')
  expect(states).toHaveLength(0)
  a.participant.receive([messages[0]!])
  expect(states).toEqual(['bc'])
  expect(a.participant.state().hostSequence).toBe(2)
})

test('rejected insertions block pending dependants until the host rejects them too', () => {
  const a = replica('a')
  const first = a.insert(0, 'a'),
    next = a.insert(1, 'b')
  const { host, messages } = authority()
  submitAsAuthor(host, { ...first, epoch: 'old' })
  a.participant.receive(messages)
  expect(a.participant.text()).toBe('')
  expect(a.participant.state().pending).toEqual([next])
  expect(a.participant.state().blocked).toEqual([next.id])
  expect(submitAsAuthor(host, next)).toMatchObject({
    status: 'rejected',
    reason: 'rejected-dependency',
  })
  a.participant.receive(messages)
  expect(a.participant.state()).toMatchObject({ pending: [], blocked: [], text: '' })
  const independent = a.insert(0, 'z')
  accepted(submitAsAuthor(host, independent))
  a.participant.receive(messages)
  expect(a.participant.text()).toBe('z')
})

test('frontier tracks causal maxima separately from host sequence and Lamport', () => {
  const a = replica('a'),
    b = replica('b'),
    c = replica('c')
  const { host, messages } = authority()
  const first = a.insert(0, 'a'),
    concurrent = b.insert(0, 'b')
  submitAsAuthor(host, first)
  submitAsAuthor(host, concurrent)
  c.participant.receive(messages)
  expect(c.participant.state().frontier).toEqual([first.id, concurrent.id])
  const joined = c.insert(2, 'c')
  expect(joined.deps).toEqual([first.id, concurrent.id])
  expect(joined.lamport).toBe(2)
  submitAsAuthor(host, joined)
  c.participant.receive(messages)
  expect(c.participant.state().frontier).toEqual([joined.id])
})

test('host listener submissions preserve broadcast order for every subscriber', () => {
  const a = replica('a')
  const first = a.insert(0, 'a'),
    second = a.insert(1, 'b')
  const host = new Host({ document: 'test', epoch: '1', engine: createEngine() })
  const received: number[][] = [[], []]
  host.subscribe((message) => {
    received[0]!.push(message.sequence)
    if (message.sequence === 1) submitAsAuthor(host, second)
  })
  host.subscribe((message) => received[1]!.push(message.sequence))
  submitAsAuthor(host, first)
  expect(received).toEqual([
    [1, 2],
    [1, 2],
  ])
})

test('in-memory transport delivers the same ordered log despite submission delay', () => {
  const a = replica('a'),
    b = replica('b')
  const { host } = authority()
  let delay = 0
  const transport = new InMemoryTransport(host, [a.participant, b.participant], () => delay++ % 5)
  transport.submit(a.participant, a.insert(0, 'a'), 4)
  transport.submit(a.participant, a.insert(1, 'b'), 0)
  transport.submit(b.participant, b.insert(0, 'c'), 1)
  transport.quiesce()
  expect(a.participant.text()).toBe(host.text())
  expect(b.participant.text()).toBe(host.text())
  expect(a.participant.state().pending).toHaveLength(0)
  transport.close()
})

test('a plain engine implementation supplies its own snapshot type', () => {
  let value = ''
  const engine = {
    text: () => value,
    snapshot: () => value,
    restore: (snapshot: string) => {
      value = snapshot
    },
    author: () => {
      throw new CollabFailure('test-author-unused')
    },
    apply: (envelope: Envelope) => {
      if (envelope.change.kind === 'insert') value += envelope.change.text
    },
  }
  const participant = new Participant({ actor: 'a', document: 'test', epoch: '1', engine })
  const { messages, host } = authority()
  submitAsAuthor(host, replica('b').insert(0, 'hello'))
  participant.receive(messages)
  expect(participant.text()).toBe('hello')
})

test('FugueMax reverses right-origin sequence order before the ID tie-break', () => {
  const b = replica('1'),
    c = replica('2'),
    z = replica('z'),
    a = replica('a')
  const initial = b.insert(0, 'b'),
    sibling = c.insert(0, 'c')
  accept(z.participant, [initial])
  const toEnd = z.insert(1, 'Z')
  accept(a.participant, [initial, sibling])
  const beforeSibling = a.insert(1, 'A')
  for (const history of [
    [initial, sibling, beforeSibling, toEnd],
    [initial, toEnd, sibling, beforeSibling],
  ]) {
    const engine = createEngine()
    for (const envelope of history) engine.apply(envelope)
    expect(engine.text()).toBe('bZAc')
    const snapshot = engine.snapshot()
    engine.restore(snapshot)
    expect(engine.text()).toBe('bZAc')
  }
})

test('host restores its snapshot when a supplied engine fails after changing state', () => {
  let value = 'base'
  const engine = {
    text: () => value,
    snapshot: () => value,
    restore: (snapshot: string) => {
      value = snapshot
    },
    author: () => {
      throw new CollabFailure('test-author-unused')
    },
    apply: () => {
      value = 'partial'
      throw new CollabFailure('test-rejected')
    },
  }
  const host = new Host({ document: 'test', epoch: '1', engine })
  expect(submitAsAuthor(host, replica('a').insert(0, 'a'))).toMatchObject({
    status: 'rejected',
    reason: 'test-rejected',
  })
  expect(host.text()).toBe('base')
})

test('reentrant local edits publish effective edits in order to every subscriber', () => {
  const a = replica('a')
  let nested = false
  a.participant.subscribe(() => {
    if (nested) return
    nested = true
    a.participant.local({ offset: 1, deleteCount: 0, text: 'b' })
  })
  let projection = ''
  const states: string[] = []
  a.participant.subscribe((change) => {
    for (const edit of change.edits.toReversed())
      projection = projection.slice(0, edit.from) + edit.text + projection.slice(edit.to)
    states.push(projection)
  })
  a.participant.local({ offset: 0, deleteCount: 0, text: 'a' })
  expect(states).toEqual(['a', 'ab'])
})

test('subscriptions created during delivery start at their current projection', () => {
  const a = replica('a')
  let projection = ''
  const states: string[] = []
  const listener = (change: import('../src/index').ParticipantChange) => {
    for (const edit of change.edits.toReversed())
      projection = projection.slice(0, edit.from) + edit.text + projection.slice(edit.to)
    states.push(projection)
  }
  let nested = false
  let unsubscribe = () => {}
  a.participant.subscribe(() => {
    if (nested) return
    nested = true
    a.participant.local({ offset: 1, deleteCount: 0, text: 'b' })
    unsubscribe()
    projection = a.participant.text()
    a.participant.subscribe(listener)
  })
  unsubscribe = a.participant.subscribe(listener)
  a.participant.local({ offset: 0, deleteCount: 0, text: 'a' })
  expect(states).toEqual([])
  a.participant.local({ offset: 2, deleteCount: 0, text: 'c' })
  expect(states).toEqual(['abc'])
})

test.each([false, true])(
  'throwing subscribers preserve healthy projections with nested=%s',
  (nested) => {
    const a = replica('a')
    const failure = new TypeError('observer failure')
    let authored = false
    const stop = a.participant.subscribe(() => {
      if (nested && !authored) {
        authored = true
        a.participant.local({ offset: 1, deleteCount: 0, text: 'b' })
      }
      throw failure
    })
    let projection = ''
    const states: string[] = []
    subscribeText(a.participant, (text) => {
      projection = text
      states.push(text)
    })
    let caught: unknown
    try {
      a.participant.local({ offset: 0, deleteCount: 0, text: 'a' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(failure)
    expect(states).toEqual(nested ? ['a', 'ab'] : ['a'])
    expect(projection).toBe(a.participant.text())
    stop()
    a.participant.local({ offset: nested ? 2 : 1, deleteCount: 0, text: 'c' })
    expect(projection).toBe(nested ? 'abc' : 'ac')
    expect(projection).toBe(a.participant.text())
  },
)

test('a batch failure after staged authoring restores pending, history and publication state', () => {
  const a = replica('a')
  const seed = a.insert(0, '😀ab')
  accept(a.participant, [seed])
  const before = a.participant.state()
  const history = a.participant.undoManager.state()
  let publications = 0
  const stop = a.participant.subscribe(() => publications++)
  expect(() =>
    a.participant.localBatch([
      { offset: 4, deleteCount: 0, text: 'X' },
      { offset: 1, deleteCount: 1, text: '' },
    ]),
  ).toThrow('split-surrogate')
  expect(a.participant.state()).toEqual(before)
  expect(a.participant.undoManager.state()).toEqual(history)
  expect(publications).toBe(0)
  const next = a.participant.local({ offset: 4, deleteCount: 0, text: 'ok' })
  expect(next.id.seq).toBe(seed.id.seq + 1)
  expect(next.lamport).toBe(seed.lamport + 1)
  expect(a.participant.text()).toBe('😀abok')
  stop()
})
