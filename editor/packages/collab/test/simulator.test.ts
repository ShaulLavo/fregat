import { expect, test } from 'vitest'
import { simulate } from '../src/index'

const rounds = process.env.COLLAB_STRESS === '1' ? 10_000 : 500

test(`${rounds} seeded rounds converge with three to five participants`, () => {
  for (let seed = 0; seed < rounds; seed++) {
    const result = simulate({ seed, participants: 3 + (seed % 3) })
    expect(result.hostSequence, `seed ${seed}`).toBe(32)
  }
}, 120_000)

test('single-author rounds match an independent plain string model', () => {
  for (let seed = 0; seed < 200; seed++)
    expect(simulate({ seed, participants: 1, edits: 48 }).hostSequence).toBe(48)
})

test(`${rounds} seeded rounds converge with random undo, redo and duplicate delivery`, () => {
  let undos = 0
  let redos = 0
  for (let seed = 0; seed < rounds; seed++) {
    const result = simulate({ seed, participants: 3 + (seed % 3), undoRedo: true })
    expect(result.hostSequence, `seed ${seed}`).toBe(32)
    undos += result.undoCommands
    redos += result.redoCommands
  }
  expect(undos).toBeGreaterThan(rounds)
  expect(redos).toBeGreaterThan(rounds / 4)
}, 120_000)

test('single-author undo and redo match an independent snapshot history model', () => {
  for (let seed = 0; seed < 200; seed++)
    expect(simulate({ seed, participants: 1, edits: 48, undoRedo: true }).hostSequence).toBe(48)
})
