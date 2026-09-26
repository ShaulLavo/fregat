import { describe, expect, it } from 'vitest'

import { computeTreeRowClickPlan } from '@/features/workspace/utils/tree-row-click-plan'

describe('search interaction policy', () => {
  it.each([
    { closeSearch: true, searchBlurBehavior: 'close' as const },
    { closeSearch: false, searchBlurBehavior: 'retain' as const },
  ])(
    '$searchBlurBehavior row clicks resolve closeSearch=$closeSearch',
    ({ closeSearch, searchBlurBehavior }) => {
      const plan = computeTreeRowClickPlan({
        event: { ctrlKey: false, metaKey: false, shiftKey: false },
        isDirectory: false,
        isSearchOpen: true,
        mode: 'flow',
        searchBlurBehavior,
      })

      expect(plan.closeSearch).toBe(closeSearch)
    },
  )

  it('never asks to close a search that is not open', () => {
    const plan = computeTreeRowClickPlan({
      event: { ctrlKey: false, metaKey: false, shiftKey: false },
      isDirectory: false,
      isSearchOpen: false,
      mode: 'flow',
      searchBlurBehavior: 'close',
    })

    expect(plan.closeSearch).toBe(false)
  })
})
