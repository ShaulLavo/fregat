import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'
import { effortTier, ultrathinkMatches } from '@/features/chat/utils/effort-tier'

describe('effort tier', () => {
  it('only max and the ultra levels have a tier', () => {
    expect(
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode', 'ultrathink'].map(effortTier),
    ).toEqual([null, null, null, null, 'max', 'ultra', 'ultra'])
  })

  it('finds the whole word only', () => {
    expect(ultrathinkMatches('Ultrathink: fix it, then ultrathinking and ultrathink.')).toEqual([
      0, 43,
    ])
  })
})
