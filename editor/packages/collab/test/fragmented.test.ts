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

test('pending replay ancestry lookups grow with edits, not retained scattered gaps', () => {
  const engine = new TextbufferEngine(
    createPieceTableSnapshot('x'.repeat(100_000), {
      normalized: true,
      charIds: initial(0),
    }),
  )
  for (let gap = 0; gap < 2000; gap++)
    insert(engine, `gap${gap}`, initial(gap * 40), initial(gap * 40 + 1))
  const saved = engine.snapshot()
  const offset = 81_960
  const user = new Participant({ actor: 'local', document: 'd', epoch: '1', engine })
  for (let i = 0; i < 100; i++) user.local({ offset: offset + i, deleteCount: 0, text: 'T' })
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
  expect(calls).toBeLessThan(5000)
  expect(user.text().slice(offset, offset + 101)).toBe('T'.repeat(100) + 'R')
  expect(saved.buffer.length).toBe(102_000)
})
