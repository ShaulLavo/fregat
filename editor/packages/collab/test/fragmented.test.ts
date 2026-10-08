import { expect, test } from 'vitest'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { Participant, TextbufferEngine } from '../src/index'
import type { CharId, Envelope, LeftOrigin, RightOrigin } from '../src/index'

const initial = (counter: number): CharId => ({ bunch: 'base', counter })
function insert(engine: TextbufferEngine, actor: string, left: LeftOrigin, right: RightOrigin) {
  const envelope: Envelope = {
    document: 'd',
    epoch: '1',
    id: { actor, seq: 1 },
    lamport: 1,
    deps: [],
    change: {
      kind: 'insert',
      start: { bunch: actor, counter: 0 },
      originLeft: left,
      originRight: right,
      text: 'T',
    },
  }
  engine.apply(envelope)
  return envelope.change.kind === 'insert' ? envelope.change.start : initial(0)
}
function countRunLookups(engine: TextbufferEngine, action: () => void): number {
  const observed = engine as unknown as { run: (id: CharId) => unknown }
  const run = observed.run
  let calls = 0
  observed.run = (id) => {
    calls++
    return run.call(engine, id)
  }
  try {
    action()
  } finally {
    observed.run = run
  }
  return calls
}

test('tail authoring does not climb retained placement ancestry', () => {
  const engine = new TextbufferEngine()
  let left: LeftOrigin = 'start'
  for (let step = 0; step < 2000; step++) left = insert(engine, `tail${step}`, left, 'end')
  const saved = engine.snapshot()
  const calls = countRunLookups(engine, () => {
    expect(engine.origins(2000)).toEqual({ originLeft: left, originRight: 'end' })
  })
  expect(calls).toBeLessThan(32)
  engine.restore(saved)
  expect(engine.origins(2000).originRight).toBe('end')
})

test.each([1, 10, 100])(
  'replaying %i pending edits stays bounded at two retained history sizes',
  (pending) => {
    const counts: number[] = []
    for (const gaps of [1000, 2000]) {
      const engine = new TextbufferEngine(
        createPieceTableSnapshot('x'.repeat(100_000), {
          normalized: true,
          charIds: initial(0),
        }),
      )
      for (let gap = 0; gap < gaps; gap++)
        insert(engine, `gap${gap}`, initial(gap * 40), initial(gap * 40 + 1))
      const saved = engine.snapshot()
      const offset = gaps * 41 - 40
      const user = new Participant({ actor: 'local', document: 'd', epoch: '1', engine })
      for (let i = 0; i < pending; i++)
        user.local({ offset: offset + i, deleteCount: 0, text: 'T' })
      const remoteEngine = new TextbufferEngine()
      remoteEngine.restore(saved)
      const remote = new Participant({
        actor: 'remote',
        document: 'd',
        epoch: '1',
        engine: remoteEngine,
      })
      const envelope = remote.local({ offset, deleteCount: 0, text: 'R' })
      const calls = countRunLookups(engine, () =>
        user.receive([{ document: 'd', epoch: '1', sequence: 1, status: 'accepted', envelope }]),
      )
      counts.push(calls)
      expect(calls).toBeLessThan(50 * (pending + 1))
      expect(user.text().slice(offset, offset + pending + 1)).toBe('T'.repeat(pending) + 'R')
      expect(saved.buffer.length).toBe(100_000 + gaps)
    }
    expect(counts[1]!).toBeLessThanOrEqual(counts[0]! * 1.5)
  },
)

test('subscriptions publish coherent effective edits without full-text reads', () => {
  const engine = new TextbufferEngine(
    createPieceTableSnapshot('line\n'.repeat(100_000), {
      normalized: true,
      charIds: initial(0),
    }),
  )
  const original = engine.snapshot()
  const user = new Participant({ actor: 'local', document: 'd', epoch: '1', engine })
  let reads = 0
  const text = engine.text.bind(engine)
  engine.text = () => {
    reads++
    return text()
  }
  const notifications: {
    readonly edits: readonly { readonly from: number; readonly to: number; readonly text: string }[]
  }[] = []
  const stop = user.subscribe((change) => notifications.push(change))
  user.local({ offset: 250_000, deleteCount: 0, text: 'T' })
  expect(notifications[0]!.edits).toEqual([{ from: 250_000, to: 250_000, text: 'T' }])
  const remoteEngine = new TextbufferEngine()
  remoteEngine.restore(original)
  const remote = new Participant({
    actor: 'remote',
    document: 'd',
    epoch: '1',
    engine: remoteEngine,
  })
  const envelope = remote.local({ offset: 250_000, deleteCount: 0, text: 'R' })
  user.receive([{ document: 'd', epoch: '1', sequence: 1, status: 'accepted', envelope }])
  expect(notifications).toHaveLength(2)
  expect(notifications[1]!.edits).toEqual([{ from: 250_001, to: 250_001, text: 'R' }])
  expect(reads).toBe(0)
  expect(user.state().text.slice(250_000, 250_002)).toBe('TR')
  expect(reads).toBe(1)
  stop()
})
