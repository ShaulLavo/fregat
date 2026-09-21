import { describe, expect, it } from 'vitest'

import { formatCompactDiffCount } from '@/components/utils/compact-diff-count'

describe('formatCompactDiffCount', () => {
  it('leaves counts that already fit alone', () => {
    expect(formatCompactDiffCount(0)).toBe('0')
    expect(formatCompactDiffCount(999)).toBe('999')
  })

  it('compacts the counts that used to blow out the row edge', () => {
    expect(formatCompactDiffCount(12_480)).toBe('12k')
    expect(formatCompactDiffCount(1_500)).toBe('1.5k')
    expect(formatCompactDiffCount(1_000)).toBe('1k')
    expect(formatCompactDiffCount(2_400_000)).toBe('2.4m')
    expect(formatCompactDiffCount(3_000_000_000)).toBe('3b')
  })
})
