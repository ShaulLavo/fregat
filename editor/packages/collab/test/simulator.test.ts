import { characters, createEngine } from './engine-fixture'
import type { TestEngine } from './engine-fixture'
import { expect, test } from 'vitest'
import { ReferenceEngine, TextbufferEngine, simulate } from '../src/index'
import type { LeftOrigin } from '../src/index'

const rounds = process.env.COLLAB_STRESS === '1' ? 10_000 : 500

test.each([0, 1, 2])('custom factory mixes engine implementations for seed %s', (seed) => {
  let instance = 0
  expect(
    simulate({
      seed,
      participants: 3,
      createEngine: () => (instance++ % 2 === 0 ? new TextbufferEngine() : new ReferenceEngine()),
    }),
  ).toEqual(simulate({ seed, participants: 3 }))
})

test.each([0, 1, 2])(
  'custom factory converges without an identity projector for seed %s',
  (seed) => {
    const expected = simulate({ seed, participants: 3 })
    expect(simulate({ seed, participants: 3, createEngine: () => new TextbufferEngine() })).toEqual(
      expected,
    )
  },
)

test.each(['inventory', 'liveness', 'order'] as const)(
  'custom factory detects %s divergence with identical visible text',
  (difference) => {
    let instance = 0
    const createEngine = () => {
      const engine = new TextbufferEngine()
      const diverging = instance++ === 1
      const insert = (bunch: string, left: LeftOrigin) =>
        engine.apply({
          document: 'simulation',
          epoch: '1',
          id: { actor: bunch, seq: 1 },
          lamport: 1,
          deps: [],
          change: {
            kind: 'insert',
            start: { bunch, counter: 0 },
            originLeft: left,
            originRight: 'end',
            text: 'x',
          },
        })
      const hide = (bunch: string) =>
        engine.apply({
          document: 'simulation',
          epoch: '1',
          id: { actor: bunch, seq: 2 },
          lamport: 2,
          deps: [],
          change: { kind: 'delete', spans: [{ start: { bunch, counter: 0 }, count: 1 }] },
        })
      if (difference === 'inventory' && !diverging) return engine
      if (difference === 'inventory') {
        insert('hidden', 'start')
        hide('hidden')
        return engine
      }
      const first = difference === 'order' && diverging ? 'b' : 'a'
      const second = first === 'a' ? 'b' : 'a'
      insert(first, 'start')
      insert(second, { bunch: first, counter: 0 })
      if (difference === 'liveness') hide(diverging ? second : first)
      return engine
    }
    expect(() => simulate({ seed: 0, participants: 3, edits: 0, createEngine })).toThrow(
      'identity-seed-0',
    )
  },
)

function run(seed: number, participants: number, edits: number, factory: () => TestEngine) {
  let host: TestEngine | undefined
  const result = simulate({
    createEngine: () => {
      const engine = factory()
      host ??= engine
      return engine
    },
    seed,
    participants,
    edits,
  })
  return { result, identity: characters(host!) }
}

test(`${rounds} seeded rounds converge with three to five participants and match the reference IDs`, () => {
  for (let seed = 0; seed < rounds; seed++) {
    const participants = 3 + (seed % 3)
    const actual = run(seed, participants, 32, createEngine)
    expect(actual.result.hostSequence, `seed ${seed}`).toBe(32)
    expect(actual, `seed ${seed}`).toEqual(run(seed, participants, 32, () => new ReferenceEngine()))
  }
}, 120_000)

test('single-author rounds match the plain string model and reference IDs', () => {
  for (let seed = 0; seed < 200; seed++) {
    const actual = run(seed, 1, 48, createEngine)
    expect(actual.result.hostSequence).toBe(48)
    expect(actual, `seed ${seed}`).toEqual(run(seed, 1, 48, () => new ReferenceEngine()))
  }
}, 120_000)
