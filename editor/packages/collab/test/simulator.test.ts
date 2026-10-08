import { characters, createEngine } from './engine-fixture'
import type { TestEngine } from './engine-fixture'
import { expect, test } from 'vitest'
import { ReferenceEngine, simulate } from '../src/index'

const rounds = process.env.COLLAB_STRESS === '1' ? 10_000 : 500

function run(seed: number, participants: number, edits: number, factory: () => TestEngine) {
  let identity: unknown
  const result = simulate({
    createEngine: factory,
    identity: (engine) => {
      identity = characters(engine as TestEngine)
        .slice()
        .sort((a, b) => a.id.bunch.localeCompare(b.id.bunch) || a.id.counter - b.id.counter)
      return identity
    },
    seed,
    participants,
    edits,
  })
  return { result, identity }
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
