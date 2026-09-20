import { describe, expect, it } from 'vitest'

import { budgetCommitMessagePatch } from '../utils/commit-message-patch'

describe('commit message patch budget', () => {
  it('passes a small diff through untouched', () => {
    const files = [
      { patch: 'diff a\n+one\n', path: 'a.ts' },
      { patch: 'diff b\n+two', path: 'b.ts' },
    ]

    expect(budgetCommitMessagePatch(files, 1000)).toBe('diff a\n+one\n\ndiff b\n+two')
  })

  it('keeps every path and whole small patches while clipping the large one', () => {
    const files = [
      { patch: `diff big\n${'+x\n'.repeat(5000)}`, path: 'big.ts' },
      { patch: 'diff small\n+tiny', path: 'small.ts' },
    ]

    const result = budgetCommitMessagePatch(files, 600)

    expect(result.length).toBeLessThanOrEqual(600)
    expect(result).toContain('big.ts\nsmall.ts')
    expect(result).toContain('diff small\n+tiny')
    expect(result).toContain('[patch truncated]')
  })

  it('drops patch bodies but not paths when the budget cannot hold them', () => {
    const files = Array.from({ length: 50 }, (_, position) => ({
      patch: 'x'.repeat(400),
      path: `file-${position}.ts`,
    }))

    const result = budgetCommitMessagePatch(files, 700)

    expect(result).toContain('file-49.ts')
    expect(result).not.toContain('xxxx')
  })
})
