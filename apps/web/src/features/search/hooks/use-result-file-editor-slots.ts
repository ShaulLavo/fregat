import { useState } from 'react'

import { syncSearchResultFileEditorSlots } from '@/features/search/state/result-editor-pool'
import type {
  SearchResultFileEditorSlot,
  SearchResultRenderedFileResultItem,
} from '@/features/search/utils/result-editor-types'
import type { SearchResultVirtualListViewport } from '@/features/search/utils/result-virtual-list'

export function useSearchResultFileEditorSlots(
  items: readonly SearchResultRenderedFileResultItem[],
  viewport: SearchResultVirtualListViewport,
) {
  const [slots, setSlots] = useState<readonly SearchResultFileEditorSlot[]>([])
  const nextSlots = syncSearchResultFileEditorSlots(slots, items, viewport)
  if (nextSlots !== slots) setSlots(nextSlots)

  return nextSlots
}
