import { useState, useSyncExternalStore } from 'react'

import { createPreviewBudget } from '@/features/search/state/preview-budget'

export function useSearchPreviewMaxLength() {
  // Lazy state, not a memo: the rows' ref callback must keep one identity across renders.
  const [budget] = useState(createPreviewBudget)
  const maxLength = useSyncExternalStore(budget.subscribe, budget.maxLength)

  return { maxLength, measureCell: budget.measureCell }
}
