import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'
import { effortTier, ultrathinkMatch } from '@/features/chat/utils/effort-tier'

describe('effort tier', () => {
  it('only max and the ultra levels have a tier', () => {
    expect(
      ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode', 'ultrathink'].map(
        effortTier,
      ),
    ).toEqual([null, null, null, null, null, 'max', 'ultra', 'ultra', 'ultra'])
  })

  it('finds the whole word only', () => {
    expect(ultrathinkMatch('fix it, then ultrathinking and Ultrathink.')).toEqual({
      end: 41,
      start: 31,
    })
    expect(ultrathinkMatch('ultrathinking')).toBeNull()
  })
})
