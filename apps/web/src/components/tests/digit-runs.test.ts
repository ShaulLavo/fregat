import { describe, expect, it } from 'vitest'

import { digitRuns } from '@/components/utils/digit-runs'

describe('digitRuns', () => {
  it('splits a duration into rolling numbers and fixed units', () => {
    expect(digitRuns('1m 20s')).toEqual([
      { digits: true, text: '1' },
      { digits: false, text: 'm ' },
      { digits: true, text: '20' },
      { digits: false, text: 's' },
    ])
  })

  it('keeps a bare count and a bare label whole', () => {
    expect(digitRuns('0s')).toEqual([
      { digits: true, text: '0' },
      { digits: false, text: 's' },
    ])
    expect(digitRuns('')).toEqual([])
  })
})
