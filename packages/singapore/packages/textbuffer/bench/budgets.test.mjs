import { describe, expect, it } from 'vitest'
import {
  budgetFor,
  compareBudgets,
  formatViolation,
  measureCounters,
  readBudgets,
} from './budgets.mjs'

describe('structural counter budgets', () => {
  it('flags counts over budget, stale budgets and unbudgeted counters', () => {
    const violations = compareBudgets(
      { typing: { 'tree.cloneNode.calls': 10, 'buffers.removed.calls': 5 }, gone: {} },
      { typing: { 'tree.cloneNode.calls': 11, 'reads.added.calls': 2 } },
    )
    expect(violations.map((violation) => violation.kind).sort()).toEqual([
      'missing-workload',
      'over',
      'stale',
      'unbudgeted',
    ])
    expect(violations.map(formatViolation).join('\n')).toContain('11 exceeds budget 10')
    expect(budgetFor(100, 0.02)).toBe(102)
    expect(budgetFor(1, 0.02)).toBe(2)
  })

  const budgets = readBudgets()
  it.each(Object.keys(budgets.profiles))(
    'keeps every structural counter within the committed %s budget',
    async (profileName) => {
      const measured = await measureCounters(profileName, budgets.seed)
      const violations = compareBudgets(budgets.profiles[profileName], measured)
      expect(violations.map(formatViolation)).toEqual([])
    },
    120000,
  )
})
