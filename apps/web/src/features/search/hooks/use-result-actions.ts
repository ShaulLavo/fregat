import { use } from 'react'

import { SearchResultActionsContext } from '@/features/search/providers/result-actions-context'
import { requireContext } from '@/lib/require-context'

export function useSearchResultActions() {
  const actions = use(SearchResultActionsContext)
  requireContext(actions, 'useSearchResultActions must be used within SearchResultActionsContext')
  return actions
}
