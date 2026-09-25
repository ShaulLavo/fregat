import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'
import {
  effortSparkleLevel,
  sparkleCells,
  SPARKLE_CELLS,
  ultrathinkMatches,
} from '@/features/chat/utils/effort-sparkle'

describe('effort sparkle', () => {
  it('sparkles only the highest efforts', () => {
    expect(
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode', 'ultrathink'].map(effortSparkleLevel),
    ).toEqual([null, null, null, 'xhigh', 'max', 'max', 'max'])
  })

  it('max lights more cells than xhigh, all inside the field', () => {
    expect(sparkleCells('xhigh').length).toBeLessThan(sparkleCells('max').length)
    for (const cell of SPARKLE_CELLS) {
      expect(cell.left).toBeGreaterThanOrEqual(0)
      expect(cell.left).toBeLessThan(100)
      expect(cell.delay).toBeLessThan(1)
    }
  })

  it('finds the whole word only', () => {
    expect(ultrathinkMatches('Ultrathink: fix it, then ultrathinking and ultrathink.')).toEqual([
      0, 43,
    ])
  })
})
