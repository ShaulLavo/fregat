import { useEffect } from 'react'

import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import {
  REASONING_FOLD_DELAY_MS,
  settledAutoOpenRowIds,
  streamingReasoningEntryId,
} from '@/features/chat/utils/reasoning'
import type { ChatTimelineItem } from '@/features/chat/utils/timeline-items'

/**
 * Opens reasoning while it streams and folds it a second after. Both changes wait
 * while the reader has scrolled away, so nothing resizes under their eyes.
 */
export function useReasoningAutoFold(items: readonly ChatTimelineItem[], following: boolean) {
  const streamingId = streamingReasoningEntryId(items)
  const autoExpanded = useChatWorkLogExpansionStore((state) => state.autoExpandedRowIds)
  const setAutoRowsExpanded = useChatWorkLogExpansionStore((state) => state.setAutoRowsExpanded)

  useEffect(() => {
    if (!following) return
    if (streamingId && autoExpanded[streamingId] === undefined) {
      setAutoRowsExpanded([streamingId], true)
    }
    const settled = settledAutoOpenRowIds(autoExpanded, streamingId)
    if (settled.length === 0) return

    const timer = setTimeout(() => setAutoRowsExpanded(settled, false), REASONING_FOLD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [autoExpanded, following, setAutoRowsExpanded, streamingId])
}
