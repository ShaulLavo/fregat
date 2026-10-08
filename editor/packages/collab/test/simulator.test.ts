import { characters, createEngine } from './engine-fixture'
import type { TestEngine } from './engine-fixture'
import { expect, test } from 'vitest'
import { ReferenceEngine, TextbufferEngine, simulate } from '../src/index'
import type { LeftOrigin } from '../src/index'
import { stressSeeds } from './stress-seeds'

const stress = process.env.COLLAB_STRESS === '1'
const rounds = stress ? 10_000 : 16
const edits = stress ? 32 : 24
const singleAuthorRounds = stress ? 200 : 16
const singleAuthorEdits = stress ? 48 : 24
const seeds = stressSeeds(rounds)
const singleAuthorSeeds = stressSeeds(singleAuthorRounds)
const timeout = stress ? 300_000 : undefined

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
      /identity-seed-0|oracle-identities-|oracle-visibility-|oracle-text-/,
    )
  },
)

function run(
  seed: number,
  participants: number,
  edits: number,
  factory: () => TestEngine,
  undoRedo = false,
) {
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
    undoRedo,
  })
  return { result, identity: characters(host!) }
}

test(
  `${seeds.length} seeded rounds converge with three to five participants and match the reference IDs`,
  () => {
    for (const seed of seeds) {
      const participants = 3 + (seed % 3)
      const actual = run(seed, participants, edits, createEngine)
      expect(actual.result.hostSequence, `seed ${seed}`).toBe(edits)
      expect(actual, `seed ${seed}`).toEqual(
        run(seed, participants, edits, () => new ReferenceEngine()),
      )
    }
  },
  timeout,
)

test(
  'single-author rounds match the plain string model and reference IDs',
  () => {
    for (const seed of singleAuthorSeeds) {
      const actual = run(seed, 1, singleAuthorEdits, createEngine)
      expect(actual.result.hostSequence).toBe(singleAuthorEdits)
      expect(actual, `seed ${seed}`).toEqual(
        run(seed, 1, singleAuthorEdits, () => new ReferenceEngine()),
      )
    }
  },
  timeout,
)
test(
  `${seeds.length} seeded rounds converge with random undo, redo and duplicate delivery`,
  () => {
    let undos = 0
    let redos = 0
    for (const seed of seeds) {
      const actual = run(seed, 3 + (seed % 3), edits, createEngine, true)
      expect(actual).toEqual(run(seed, 3 + (seed % 3), edits, () => new ReferenceEngine(), true))
      const result = actual.result
      expect(result.hostSequence, `seed ${seed}`).toBe(edits)
      undos += result.undoCommands
      redos += result.redoCommands
    }
    expect(undos).toBeGreaterThan(seeds.length)
    expect(redos).toBeGreaterThan(seeds.length / 4)
  },
  timeout,
)

test('single-author undo and redo match an independent snapshot history model', () => {
  for (const seed of singleAuthorSeeds)
    expect(run(seed, 1, singleAuthorEdits, createEngine, true)).toEqual(
      run(seed, 1, singleAuthorEdits, () => new ReferenceEngine(), true),
    )
})
