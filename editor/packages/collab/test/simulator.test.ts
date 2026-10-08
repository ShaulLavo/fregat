import { expect, test } from 'vitest'
import { simulate } from '../src/index'

const stress = process.env.COLLAB_STRESS === '1'
const rounds = stress ? 10_000 : 16
const edits = stress ? 32 : 24
const singleAuthorRounds = stress ? 200 : 16
const singleAuthorEdits = stress ? 48 : 24
const timeout = stress ? 120_000 : undefined

test(
  `${rounds} seeded rounds converge with three to five participants`,
  () => {
    for (let seed = 0; seed < rounds; seed++) {
      const result = simulate({ seed, participants: 3 + (seed % 3), edits })
      expect(result.hostSequence, `seed ${seed}`).toBe(edits)
    }
  },
  timeout,
)

test('single-author rounds match an independent plain string model', () => {
  for (let seed = 0; seed < singleAuthorRounds; seed++)
    expect(simulate({ seed, participants: 1, edits: singleAuthorEdits }).hostSequence).toBe(
      singleAuthorEdits,
    )
})

test(
  `${rounds} seeded rounds converge with random undo, redo and duplicate delivery`,
  () => {
    let undos = 0
    let redos = 0
    for (let seed = 0; seed < rounds; seed++) {
      const result = simulate({ seed, participants: 3 + (seed % 3), edits, undoRedo: true })
      expect(result.hostSequence, `seed ${seed}`).toBe(edits)
      undos += result.undoCommands
      redos += result.redoCommands
    }
    expect(undos).toBeGreaterThan(rounds)
    expect(redos).toBeGreaterThan(rounds / 4)
  },
  timeout,
)

test('single-author undo and redo match an independent snapshot history model', () => {
  for (let seed = 0; seed < singleAuthorRounds; seed++)
    expect(
      simulate({ seed, participants: 1, edits: singleAuthorEdits, undoRedo: true }).hostSequence,
    ).toBe(singleAuthorEdits)
})
