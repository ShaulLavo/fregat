import { expect, it } from 'vitest'
import {
  analyzeX6,
  x6SteadyOperations,
  type TimingBlock,
  type TimingRow,
} from './ghostty-x6-statistics.ts'

function syntheticBlocks(ratio = 1.01, creationPenalty = 0): TimingBlock[] {
  return Array.from({ length: 40 }, (_, block) => {
    const rows: TimingRow[] = []
    for (const repetition of [0, 1]) {
      for (const inert of [0, 1, 100, 1_000, 1_000, 100, 1, 0])
        rows.push({
          operation: 'internal-host-manager-create',
          inert,
          repetition,
          milliseconds:
            10 +
            block / 100 +
            Number(inert > 0) +
            inert / 100 +
            Number(inert === 1_000) * creationPenalty,
        })
      for (const inert of [0, 100, 1_000, 1_000, 100, 0]) {
        rows.push({
          operation: 'cold-internal-first-use',
          inert,
          repetition,
          milliseconds: inert === 0 ? 5 : 1,
        })
        for (const operation of x6SteadyOperations)
          rows.push({
            operation,
            inert,
            repetition,
            operations: 2_000,
            milliseconds: (2 + block / 100) * (inert > 0 ? ratio : 1),
          })
      }
    }
    return { rows }
  })
}

it('uses paired whole-vector intervals and reports fixed activation separately', () => {
  const result = analyzeX6(syntheticBlocks())
  expect(result.passed).toBe(true)
  expect(result.ratios).toHaveLength(24)
  for (const row of result.ratios) {
    expect(row.ratio).toBeCloseTo(1.01, 12)
    expect(row.oneSidedUpper95).toBeCloseTo(1.01, 12)
  }
  expect(result.creation.estimate).toBeCloseTo(0, 12)
  expect(result.activationMilliseconds!.estimate).toBeCloseTo(1.01, 12)
  expect(result.activationMilliseconds!.lower95).toBeCloseTo(1.01, 12)
  expect(result.activationMilliseconds!.upper95).toBeCloseTo(1.01, 12)
  expect(result.coldFirstUseMilliseconds[0]!.estimate).toBe(5)
})

it('retains slower ratio and nonlinear creation failures', () => {
  const result = analyzeX6(syntheticBlocks(1.2, 5))
  expect(result.passed).toBe(false)
  expect(result.ratios.every((row) => !row.passed)).toBe(true)
  expect(result.creation.passed).toBe(false)
})

it('rejects missing blocks and nonpositive controls without dropping them', () => {
  expect(() => analyzeX6(syntheticBlocks().slice(1))).toThrow()
  const blocks = syntheticBlocks()
  blocks[0] = {
    rows: blocks[0]!.rows.map((row) => (row.inert === 0 ? { ...row, milliseconds: 0 } : row)),
  }
  expect(() => analyzeX6(blocks)).toThrow()
})
